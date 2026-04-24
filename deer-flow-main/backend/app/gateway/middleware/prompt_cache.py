"""Application-level prompt caching middleware for AI API requests.

Implements L1 cache layer with in-memory dictionary storage:
- Exact match caching based on SHA256 hash of request payload
- TTL-based expiration (default 300 seconds)
- LRU eviction when max entries reached
- Only intercepts POST /api/ai/chat requests
- Only caches non-streaming JSON responses; streaming SSE responses bypass cache
- Graceful degradation on errors (bypasses cache on failure)

Environment Variables:
    ENABLE_PROMPT_CACHE: Enable/disable middleware (default: true)
    PROMPT_CACHE_TTL: Cache TTL in seconds (default: 300)
    PROMPT_CACHE_MAX_ENTRIES: Maximum cache entries (default: 1000)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import StreamingResponse

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)

_ENABLE_PROMPT_CACHE_ENV = "ENABLE_PROMPT_CACHE"
_TTL_ENV = "PROMPT_CACHE_TTL"
_MAX_ENTRIES_ENV = "PROMPT_CACHE_MAX_ENTRIES"
_MAX_REQUEST_BYTES_ENV = "PROMPT_CACHE_MAX_REQUEST_BYTES"


@dataclass
class CacheEntry:
    """Cache entry with value and metadata."""

    response_data: dict[str, Any] | str
    created_at: float
    last_accessed_at: float = 0.0
    is_streaming: bool = False
    access_count: int = 0


class PromptCacheMiddleware(BaseHTTPMiddleware):
    """In-memory prompt cache middleware for AI chat endpoints.

    Provides L1 caching layer to reduce latency and API costs by caching
    identical requests within the TTL window. Uses SHA256 hash of normalized
    request body as cache key for exact matching.

    Attributes:
        ttl: Time-to-live for cache entries in seconds
        max_entries: Maximum number of cache entries before LRU eviction
        _cache: In-memory cache storage dictionary
        _stats: Cache hit/miss statistics
    """

    def __init__(
        self,
        app,
        ttl: int = 300,
        max_entries: int = 1000,
    ):
        super().__init__(app)
        self.ttl = ttl
        self.max_entries = max_entries
        self._cache: dict[str, CacheEntry] = {}
        self._stats = {"hits": 0, "misses": 0}
        self._enabled = os.getenv(_ENABLE_PROMPT_CACHE_ENV, "true").lower() in ("1", "true", "yes")
        self._max_request_bytes = int(os.getenv(_MAX_REQUEST_BYTES_ENV, str(2 * 1024 * 1024)))
        logger.info(
            "PromptCacheMiddleware initialized: enabled=%s, ttl=%ds, max_entries=%d, max_request_bytes=%d",
            self._enabled,
            self.ttl,
            self.max_entries,
            self._max_request_bytes,
        )

    @property
    def enabled(self) -> bool:
        """Check if caching is enabled."""
        return self._enabled

    @staticmethod
    def _restore_request_body(request: Request, body: bytes) -> None:
        """Restore request body so downstream handlers can read it again."""
        consumed = False
        receive_lock: asyncio.Lock | None = None

        async def _receive() -> dict[str, Any]:
            nonlocal consumed, receive_lock
            if receive_lock is None:
                receive_lock = asyncio.Lock()

            async with receive_lock:
                if consumed:
                    return {"type": "http.request", "body": b"", "more_body": False}
                consumed = True
                return {"type": "http.request", "body": body, "more_body": False}

        request._receive = _receive  # type: ignore[attr-defined]

    async def dispatch(self, request: Request, call_next) -> Response:
        """Intercept and cache AI chat requests.

        Only processes POST /api/ai/chat requests when caching is enabled.
        For other requests or when disabled, passes through directly.

        Args:
            request: Incoming HTTP request
            call_next: Next middleware/endpoint handler

        Returns:
            HTTP response (cached or fresh)
        """
        if not self._should_cache(request):
            return await call_next(request)
        if not self._is_safe_body_read_request(request):
            return await call_next(request)

        body = b""
        try:
            body = await request.body()
            self._restore_request_body(request, body)

            if not body:
                return await call_next(request)

            request_data = json.loads(body)
            cache_key = self._compute_cache_key(request_data)

            cached_entry = self._get_cached_entry(cache_key)

            if cached_entry is not None:
                logger.debug("Cache HIT for key %s", cache_key[:16])
                return self._build_cached_response(cached_entry)

            logger.debug("Cache MISS for key %s", cache_key[:16])
            self._stats["misses"] += 1

            self._restore_request_body(request, body)
            response = await call_next(request)

            if response.status_code == 200:
                if isinstance(response, StreamingResponse):
                    logger.debug("Bypassing cache for streaming response key %s", cache_key[:16])
                    return response
                if self._should_bypass_response_cache(response):
                    logger.debug("Bypassing cache via response header for key %s", cache_key[:16])
                    return response

                cached_response = await self._cache_non_streaming_response(cache_key, response)
                if cached_response is not None:
                    return cached_response

            return response

        except json.JSONDecodeError as exc:
            logger.warning("Failed to parse request body for caching: %s", exc)
            self._restore_request_body(request, body)
            return await call_next(request)
        except Exception as exc:
            logger.error("Prompt cache error, bypassing: %s", exc)
            self._restore_request_body(request, body)
            return await call_next(request)

    def _should_cache(self, request: Request) -> bool:
        """Determine if request should be cached.

        Args:
            request: HTTP request to evaluate

        Returns:
            True if request should be cached
        """
        if not self._enabled:
            return False

        if request.method != "POST":
            return False

        return request.url.path == "/api/ai/chat"

    @staticmethod
    def _should_bypass_response_cache(response: Response) -> bool:
        marker = (response.headers.get("X-Prompt-Cache") or "").strip().lower()
        if marker in {"bypass", "skip", "no-store"}:
            return True

        content_type = (response.headers.get("content-type") or "").strip().lower()
        if "text/event-stream" in content_type:
            return True

        cache_control = (response.headers.get("Cache-Control") or "").strip().lower()
        return "no-store" in cache_control

    @staticmethod
    def _header_value(request: Request, key: str) -> str:
        headers = getattr(request, "headers", None)
        if headers is None:
            return ""
        getter = getattr(headers, "get", None)
        if not callable(getter):
            return ""
        value = getter(key)
        if isinstance(value, str):
            return value
        return ""

    def _is_safe_body_read_request(self, request: Request) -> bool:
        """Read request body only for safe JSON scenarios (M-22)."""
        content_type = self._header_value(request, "content-type").lower()
        if content_type and "json" not in content_type:
            return False

        transfer_encoding = self._header_value(request, "transfer-encoding").lower()
        if "chunked" in transfer_encoding:
            return False

        content_length = self._header_value(request, "content-length").strip()
        if content_length:
            try:
                if int(content_length) > self._max_request_bytes:
                    return False
            except ValueError:
                return False

        return True

    @staticmethod
    def _to_json_compatible(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, list):
            return [PromptCacheMiddleware._to_json_compatible(item) for item in value]
        if isinstance(value, tuple):
            return [PromptCacheMiddleware._to_json_compatible(item) for item in value]
        if isinstance(value, dict):
            return {
                str(key): PromptCacheMiddleware._to_json_compatible(item)
                for key, item in value.items()
            }
        return str(value)

    @staticmethod
    def _normalize_context_for_key(data: dict[str, Any]) -> dict[str, Any]:
        context = data.get("context")
        if not isinstance(context, dict):
            context = {}

        return {
            "context": PromptCacheMiddleware._to_json_compatible(context),
            "thread_id": PromptCacheMiddleware._to_json_compatible(data.get("thread_id") or data.get("threadId")),
            "conversation_id": PromptCacheMiddleware._to_json_compatible(
                data.get("conversation_id") or data.get("conversationId")
            ),
            "workspace_id": PromptCacheMiddleware._to_json_compatible(data.get("workspace_id") or data.get("workspaceId")),
        }

    def _compute_cache_key(self, data: dict[str, Any]) -> str:
        """Generate SHA256 hash key from normalized request data.

        Normalizes JSON with sorted keys and fixed precision for numeric fields
        to ensure consistent hashing.

        Args:
            data: Request body dictionary

        Returns:
            SHA256 hash string prefixed with 'prompt_cache:'
        """
        normalized = {
            "messages": data.get("messages", []),
            "model": data.get("provider_config", {}).get("model_name", ""),
            "temperature": round(data.get("provider_config", {}).get("temperature", 0.7), 2),
            "max_tokens": data.get("provider_config", {}).get("max_tokens", 2000),
            "routing_context": self._normalize_context_for_key(data),
        }

        serialized = json.dumps(normalized, sort_keys=True, ensure_ascii=False)
        hash_value = hashlib.sha256(serialized.encode("utf-8")).hexdigest()

        return f"prompt_cache:{hash_value}"

    def _get_cached_entry(self, cache_key: str) -> CacheEntry | None:
        """Retrieve cache entry if exists and not expired.

        Also performs TTL cleanup and LRU tracking update.

        Args:
            cache_key: Cache key to look up

        Returns:
            CacheEntry if found and valid, None otherwise
        """
        entry = self._cache.get(cache_key)

        if entry is None:
            return None

        current_time = time.monotonic()
        if current_time - entry.created_at > self.ttl:
            del self._cache[cache_key]
            return None

        entry.last_accessed_at = current_time
        entry.access_count += 1
        self._stats["hits"] += 1
        return entry

    def _store_cache_entry(self, cache_key: str, response_data: dict[str, Any]) -> None:
        """Store response data in cache with LRU eviction.

        Evicts least recently used entry if cache is full.

        Args:
            cache_key: Key under which to store
            response_data: Response data to cache
        """
        if len(self._cache) >= self.max_entries:
            lru_key = min(
                self._cache.keys(),
                key=lambda k: self._cache[k].last_accessed_at or self._cache[k].created_at,
            )
            del self._cache[lru_key]
            logger.debug("Evicted cache entry: %s", lru_key[:16])

        now = time.monotonic()
        self._cache[cache_key] = CacheEntry(
            response_data=response_data,
            created_at=now,
            last_accessed_at=now,
        )

    async def _cache_non_streaming_response(self, cache_key: str, response: Response) -> JSONResponse | None:
        """Cache non-streaming (JSON) response.

        Args:
            cache_key: Cache key for this request
            response: Regular Response to cache

        Returns:
            JSONResponse with cached data if successful, None otherwise
        """
        try:
            response_body = b""
            if hasattr(response, "body_iterator"):
                async for chunk in response.body_iterator:
                    response_body += chunk
            else:
                body = getattr(response, "body", None)
                if callable(body):
                    response_body = await body()
                elif isinstance(body, bytes):
                    response_body = body

            response_data = json.loads(response_body)
            self._store_cache_entry(cache_key, response_data)

            logger.debug("Cached non-streaming response for key %s", cache_key[:16])
            return self._build_cached_response(CacheEntry(
                response_data=response_data,
                created_at=time.monotonic(),
                last_accessed_at=time.monotonic(),
                is_streaming=False,
            ))

        except (json.JSONDecodeError, Exception) as exc:
            logger.debug("Failed to cache non-streaming response: %s", exc)
            return None

    def _build_cached_response(self, entry: CacheEntry) -> JSONResponse:
        """Build HTTP response from cached entry.

        Args:
            entry: Cache entry containing response data

        Returns:
            JSONResponse with cached data
        """
        headers = {
            "X-Cache-Status": "HIT",
            "X-Cache-Age": str(int(time.monotonic() - entry.created_at)),
            "X-Cache-Type": "streaming" if entry.is_streaming else "non-streaming",
        }
        return JSONResponse(content=entry.response_data, headers=headers)

    def get_stats(self) -> dict[str, Any]:
        """Get cache performance statistics.

        Returns:
            Dictionary with hits, misses, hit_rate, size info
        """
        total = self._stats["hits"] + self._stats["misses"]
        hit_rate = (self._stats["hits"] / total * 100) if total > 0 else 0.0

        return {
            "enabled": self._enabled,
            "hits": self._stats["hits"],
            "misses": self._stats["misses"],
            "hit_rate": round(hit_rate, 2),
            "size": len(self._cache),
            "max_size": self.max_entries,
            "ttl_seconds": self.ttl,
        }

    def clear_cache(self) -> None:
        """Clear all cached entries."""
        self._cache.clear()
        logger.info("Prompt cache cleared")

    def invalidate(self, cache_key: str) -> bool:
        """Invalidate specific cache entry.

        Args:
            cache_key: Key to invalidate

        Returns:
            True if entry was removed, False if not found
        """
        if cache_key in self._cache:
            del self._cache[cache_key]
            return True
        return False
