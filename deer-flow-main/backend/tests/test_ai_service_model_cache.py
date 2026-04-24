from __future__ import annotations

from app.gateway.novel_migrated.services import ai_service


def _stats_key_for(cache_key: tuple[str, ...]) -> str:
    if len(cache_key) == 1:
        return cache_key[0]
    return "|".join(cache_key)


def test_model_cache_stats_track_by_cache_key(monkeypatch):
    ai_service.clear_model_cache()

    created: list[tuple[str, dict]] = []

    def _fake_create_chat_model(*, name: str, **overrides):
        marker = {"name": name, "overrides": overrides, "index": len(created)}
        created.append((name, overrides))
        return marker

    monkeypatch.setattr(ai_service, "create_chat_model", _fake_create_chat_model)

    first = ai_service._get_cached_model("gpt-4o-mini", base_url="https://api.example.com/v1", api_key="sk-1")
    second = ai_service._get_cached_model("gpt-4o-mini", base_url="https://api.example.com/v1", api_key="sk-1")

    assert first is second
    assert len(created) == 1

    stats = ai_service.get_model_cache_stats()
    cache_key = ai_service._make_cache_key("gpt-4o-mini", base_url="https://api.example.com/v1", api_key="sk-1")
    entry_stats = stats["entries"][_stats_key_for(cache_key)]

    assert entry_stats["hits"] == 1
    assert entry_stats["misses"] == 1
    assert entry_stats["model_name"] == "gpt-4o-mini"
    assert stats["models"]["gpt-4o-mini"]["hits"] == 1
    assert stats["models"]["gpt-4o-mini"]["misses"] == 1


def test_model_cache_eviction_uses_lru_metadata(monkeypatch):
    ai_service.clear_model_cache()
    monkeypatch.setattr(ai_service, "_MODEL_CACHE_MAX_SIZE", 2)
    monkeypatch.setattr(
        ai_service,
        "create_chat_model",
        lambda *, name, **overrides: {"name": name, "overrides": overrides},
    )

    key1 = ai_service._make_cache_key("gpt-4o-mini", base_url="https://a.example/v1", api_key="sk-a")
    key2 = ai_service._make_cache_key("gpt-4o-mini", base_url="https://b.example/v1", api_key="sk-b")
    key3 = ai_service._make_cache_key("gpt-4o-mini", base_url="https://c.example/v1", api_key="sk-c")

    ai_service._get_cached_model("gpt-4o-mini", base_url="https://a.example/v1", api_key="sk-a")
    ai_service._get_cached_model("gpt-4o-mini", base_url="https://b.example/v1", api_key="sk-b")
    ai_service._get_cached_model("gpt-4o-mini", base_url="https://a.example/v1", api_key="sk-a")  # refresh LRU
    ai_service._get_cached_model("gpt-4o-mini", base_url="https://c.example/v1", api_key="sk-c")  # evict key2

    stats = ai_service.get_model_cache_stats()
    assert stats["cache_size"] == 2
    assert _stats_key_for(key1) in stats["entries"]
    assert _stats_key_for(key3) in stats["entries"]
    assert _stats_key_for(key2) not in stats["entries"]


def test_clear_model_cache_clears_entries_and_models(monkeypatch):
    ai_service.clear_model_cache()
    monkeypatch.setattr(ai_service, "create_chat_model", lambda *, name, **overrides: object())

    ai_service._get_cached_model("gpt-4o-mini")
    before_clear = ai_service.get_model_cache_stats()
    assert before_clear["cache_size"] == 1
    assert before_clear["models"]
    assert before_clear["entries"]

    ai_service.clear_model_cache()

    after_clear = ai_service.get_model_cache_stats()
    assert after_clear["cache_size"] == 0
    assert after_clear["models"] == {}
    assert after_clear["entries"] == {}
