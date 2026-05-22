"""Bounded fallback store helpers for novel memory storage."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any


def parse_created_at(value: Any) -> datetime:
    text = str(value or "").strip()
    if not text:
        return datetime.min.replace(tzinfo=UTC)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def evict_oldest_fallback_entry(
    fallback_store: dict[tuple[str, str], list[dict[str, Any]]],
    total_count: int,
    *,
    preferred_key: tuple[str, str] | None = None,
    parse_created_at_fn: Callable[[Any], datetime] = parse_created_at,
    logger: logging.Logger | None = None,
) -> tuple[bool, int]:
    if total_count <= 0:
        return False, total_count

    candidate: tuple[datetime, tuple[str, str], int] | None = None
    keys: list[tuple[str, str]] = []
    if preferred_key is not None and preferred_key in fallback_store:
        keys.append(preferred_key)
    keys.extend(key for key in fallback_store.keys() if key != preferred_key)

    for scope_key in keys:
        bucket = fallback_store.get(scope_key) or []
        for idx, item in enumerate(bucket):
            created_at = parse_created_at_fn(item.get("created_at"))
            if candidate is None or created_at < candidate[0]:
                candidate = (created_at, scope_key, idx)

    if candidate is None:
        if logger is not None:
            logger.warning(
                "⚠️ fallback 记忆缓存已满但未找到可淘汰条目: preferred_key=%s total=%d",
                preferred_key,
                total_count,
            )
        return False, total_count

    _, scope_key, idx = candidate
    bucket = fallback_store.get(scope_key)
    if not bucket:
        return False, total_count
    if idx < 0 or idx >= len(bucket):
        return False, total_count

    del bucket[idx]
    new_total_count = max(0, total_count - 1)
    if not bucket:
        fallback_store.pop(scope_key, None)

    if logger is not None:
        logger.info(
            "🗑️ fallback 记忆缓存容量淘汰 1 条最旧记忆: preferred_key=%s scope=%s remaining=%d",
            preferred_key,
            scope_key,
            new_total_count,
        )
    return True, new_total_count


def ensure_fallback_capacity(
    fallback_store: dict[tuple[str, str], list[dict[str, Any]]],
    total_count: int,
    *,
    capacity: int,
    preferred_key: tuple[str, str] | None = None,
    parse_created_at_fn: Callable[[Any], datetime] = parse_created_at,
    logger: logging.Logger | None = None,
) -> tuple[bool, int]:
    normalized_capacity = max(1, int(capacity))
    if total_count < normalized_capacity:
        return False, total_count

    return evict_oldest_fallback_entry(
        fallback_store,
        total_count,
        preferred_key=preferred_key,
        parse_created_at_fn=parse_created_at_fn,
        logger=logger,
    )
