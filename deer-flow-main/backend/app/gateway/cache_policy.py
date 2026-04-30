"""Reusable cache policy helpers for gateway services.

The project has several in-process caches with the same operational needs:

- bounded size
- TTL-based expiry
- LRU-style eviction
- lightweight logging for observability

This module keeps those concerns in one place so services can share the same
cache behavior without duplicating ad-hoc dict logic.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class TimedCacheEntry[V]:
    value: V
    created_at: float
    last_accessed_at: float
    hits: int = 0


class TimedOrderedCache[K, V]:
    """Thread-safe TTL + LRU cache with observability.

    The cache stores entries in insertion order and moves touched keys to the
    end. When the cache reaches capacity, the oldest live entry is evicted.
    TTL eviction is checked lazily on reads and writes so callers do not need to
    run a background cleaner.
    """

    def __init__(
        self,
        *,
        name: str,
        ttl_seconds: float,
        max_size: int,
        logger: logging.Logger | None = None,
    ) -> None:
        self._name = name
        self._ttl_seconds = max(0.0, float(ttl_seconds))
        self._max_size = max(1, int(max_size))
        self._logger = logger or logging.getLogger(__name__)
        self._entries: OrderedDict[K, TimedCacheEntry[V]] = OrderedDict()
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._ttl_evictions = 0
        self._capacity_evictions = 0

    def _now(self) -> float:
        return time.time()

    def _is_expired(self, entry: TimedCacheEntry[V], now: float) -> bool:
        if self._ttl_seconds <= 0:
            return False
        return now - entry.last_accessed_at >= self._ttl_seconds

    def _evict_expired_locked(self, now: float) -> int:
        expired_keys = [
            key
            for key, entry in self._entries.items()
            if self._is_expired(entry, now)
        ]
        if not expired_keys:
            return 0

        for key in expired_keys:
            self._entries.pop(key, None)
        self._ttl_evictions += len(expired_keys)
        self._logger.info("🗑️ %s 缓存 TTL 淘汰 %d 项", self._name, len(expired_keys))
        return len(expired_keys)

    def _evict_capacity_locked(self) -> tuple[K | None, TimedCacheEntry[V] | None]:
        if len(self._entries) < self._max_size:
            return None, None

        evicted_key, evicted_entry = self._entries.popitem(last=False)
        self._capacity_evictions += 1
        self._logger.info("🗑️ %s 缓存容量淘汰 1 项", self._name)
        return evicted_key, evicted_entry

    def get_entry(self, key: K, *, now: float | None = None) -> TimedCacheEntry[V] | None:
        timestamp = self._now() if now is None else now
        with self._lock:
            self._evict_expired_locked(timestamp)
            entry = self._entries.get(key)
            if entry is None:
                self._misses += 1
                return None

            entry.hits += 1
            entry.last_accessed_at = timestamp
            self._entries.move_to_end(key)
            self._hits += 1
            return entry

    def get(self, key: K, *, now: float | None = None) -> V | None:
        entry = self.get_entry(key, now=now)
        if entry is None:
            return None
        return entry.value

    def set(self, key: K, value: V, *, now: float | None = None) -> TimedCacheEntry[V]:
        timestamp = self._now() if now is None else now
        with self._lock:
            self._evict_expired_locked(timestamp)

            existing = self._entries.get(key)
            if existing is not None:
                existing.value = value
                existing.last_accessed_at = timestamp
                self._entries.move_to_end(key)
                return existing

            self._evict_capacity_locked()
            entry = TimedCacheEntry(
                value=value,
                created_at=timestamp,
                last_accessed_at=timestamp,
            )
            self._entries[key] = entry
            return entry

    def delete(self, key: K) -> bool:
        with self._lock:
            return self._entries.pop(key, None) is not None

    def clear(self) -> None:
        with self._lock:
            count = len(self._entries)
            self._entries.clear()
        self._logger.info("🧹 %s 缓存已清空，共 %d 项", self._name, count)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            entries = {
                str(key): {
                    "created_at": entry.created_at,
                    "last_accessed_at": entry.last_accessed_at,
                    "hits": entry.hits,
                }
                for key, entry in self._entries.items()
            }
            return {
                "name": self._name,
                "size": len(self._entries),
                "ttl_seconds": self._ttl_seconds,
                "max_size": self._max_size,
                "hits": self._hits,
                "misses": self._misses,
                "ttl_evictions": self._ttl_evictions,
                "capacity_evictions": self._capacity_evictions,
                "entries": entries,
            }
