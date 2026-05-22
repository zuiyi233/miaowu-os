from __future__ import annotations

import logging

from app.gateway.cache_policy import TimedOrderedCache


def test_timed_ordered_cache_evicts_oldest_entry_and_logs(caplog):
    caplog.set_level(logging.INFO)
    current_time = {"value": 1000.0}

    def fake_time() -> float:
        value = current_time["value"]
        current_time["value"] += 1.0
        return value

    cache = TimedOrderedCache[str, str](
        name="unit test cache",
        ttl_seconds=60,
        max_size=2,
        logger=logging.getLogger("test.cache_policy"),
    )

    # Monkeypatch the module-level time source used by the cache.
    from app.gateway import cache_policy

    original_time = cache_policy.time.time
    cache_policy.time.time = fake_time
    try:
        cache.set("a", "A")
        cache.set("b", "B")
        assert cache.get("a") == "A"

        cache.set("c", "C")

        assert cache.get("b") is None
        assert cache.get("a") == "A"
        assert cache.get("c") == "C"

        snapshot = cache.snapshot()
        assert snapshot["size"] == 2
        assert snapshot["capacity_evictions"] == 1
        assert list(snapshot["entries"].keys()) == ["a", "c"]
        assert any("容量淘汰" in record.message for record in caplog.records)
    finally:
        cache_policy.time.time = original_time


def test_timed_ordered_cache_expires_entries_by_ttl(caplog):
    caplog.set_level(logging.INFO)
    current_time = {"value": 2000.0}

    def fake_time() -> float:
        return current_time["value"]

    cache = TimedOrderedCache[str, str](
        name="ttl test cache",
        ttl_seconds=5,
        max_size=2,
        logger=logging.getLogger("test.cache_policy"),
    )

    from app.gateway import cache_policy

    original_time = cache_policy.time.time
    cache_policy.time.time = fake_time
    try:
        cache.set("stale", "value")
        current_time["value"] += 6.0

        assert cache.get("stale") is None

        snapshot = cache.snapshot()
        assert snapshot["size"] == 0
        assert snapshot["ttl_evictions"] == 1
        assert any("TTL 淘汰" in record.message for record in caplog.records)
    finally:
        cache_policy.time.time = original_time
