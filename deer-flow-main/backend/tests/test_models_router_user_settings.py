from __future__ import annotations

import time
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import models as models_router


@pytest.fixture(autouse=True)
def _clear_models_cache():
    models_router._models_cache.clear()
    yield
    models_router._models_cache.clear()


class _FakeDB:
    pass


class _FakeAISettingsService:
    def __init__(self, payload: object):
        self.payload = payload

    async def get_ai_settings(self, user_id: str, db: object) -> object:
        return self.payload


class _FailingAISettingsService:
    async def get_ai_settings(self, user_id: str, db: object) -> object:
        raise RuntimeError("db unavailable")


def _build_model(
    *,
    name: str,
    model: str,
    display_name: str,
    description: str,
    supports_thinking: bool,
    supports_reasoning_effort: bool,
) -> object:
    return SimpleNamespace(
        name=name,
        model=model,
        display_name=display_name,
        description=description,
        supports_thinking=supports_thinking,
        supports_reasoning_effort=supports_reasoning_effort,
    )


def _build_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _inject_user(request, call_next):
        request.state.user_id = "models-user"
        request.state.auth = SimpleNamespace(user=SimpleNamespace(id="models-user"))
        return await call_next(request)

    app.include_router(models_router.router)
    app.dependency_overrides[models_router.get_db] = lambda: fake_db
    return app


def test_list_models_prefers_user_ai_settings_models(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="openai-gpt-4o-mini",
                model="gpt-4o-mini",
                display_name="GPT-4o Mini",
                description="OpenAI mini model",
                supports_thinking=True,
                supports_reasoning_effort=True,
            ),
            _build_model(
                name="claude-3-7-sonnet",
                model="claude-3-7-sonnet",
                display_name="Claude 3.7 Sonnet",
                description="Anthropic model",
                supports_thinking=True,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=True),
    )
    service = _FakeAISettingsService({"providers": [{"models": ["gpt-4o-mini", "custom-model"]}]})
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload["models"]] == ["gpt-4o-mini", "custom-model"]

    mapped_model = payload["models"][0]
    assert mapped_model["display_name"] == "GPT-4o Mini"
    assert mapped_model["description"] == "OpenAI mini model"
    assert mapped_model["supports_thinking"] is True
    assert mapped_model["supports_reasoning_effort"] is True

    unmapped_model = payload["models"][1]
    assert unmapped_model["name"] == "custom-model"
    assert unmapped_model["model"] == "custom-model"
    assert unmapped_model["display_name"] == "custom-model"
    assert unmapped_model["supports_thinking"] is False
    assert unmapped_model["supports_reasoning_effort"] is False


def test_list_models_falls_back_to_static_models_when_user_models_empty(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="static-model-a",
                model="gpt-4o-mini",
                display_name="Static A",
                description="From config",
                supports_thinking=True,
                supports_reasoning_effort=False,
            ),
            _build_model(
                name="static-model-b",
                model="claude-3-7-sonnet",
                display_name="Static B",
                description="From config",
                supports_thinking=False,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=False),
    )
    service = _FakeAISettingsService({"providers": [{"models": []}]})
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload["models"]] == ["static-model-a", "static-model-b"]
    assert payload["token_usage"] == {"enabled": False}


def test_get_model_finds_user_ai_settings_model(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="openai-gpt-4o-mini",
                model="gpt-4o-mini",
                display_name="GPT-4o Mini",
                description="OpenAI mini model",
                supports_thinking=True,
                supports_reasoning_effort=True,
            )
        ],
        token_usage=SimpleNamespace(enabled=True),
    )
    service = _FakeAISettingsService({"providers": [{"models": ["custom-user-model"]}]})
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models/custom-user-model")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "custom-user-model"
    assert payload["model"] == "custom-user-model"
    assert payload["supports_thinking"] is False
    assert payload["supports_reasoning_effort"] is False


def test_list_models_falls_back_to_static_models_when_user_settings_read_fails(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="static-model-a",
                model="gpt-4o-mini",
                display_name="Static A",
                description="From config",
                supports_thinking=True,
                supports_reasoning_effort=False,
            ),
            _build_model(
                name="static-model-b",
                model="claude-3-7-sonnet",
                display_name="Static B",
                description="From config",
                supports_thinking=False,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: _FailingAISettingsService())

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload["models"]] == ["static-model-a", "static-model-b"]
    assert payload["token_usage"] == {"enabled": True}


def test_get_model_falls_back_to_static_model_when_user_models_empty(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="static-model-a",
                model="gpt-4o-mini",
                display_name="Static A",
                description="From config",
                supports_thinking=True,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=True),
    )
    service = _FakeAISettingsService({"providers": [{"models": []}]})
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models/static-model-a")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "static-model-a"
    assert payload["model"] == "gpt-4o-mini"
    assert payload["display_name"] == "Static A"


def test_get_model_falls_back_to_static_model_when_user_settings_read_fails(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="static-model-a",
                model="gpt-4o-mini",
                display_name="Static A",
                description="From config",
                supports_thinking=True,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=True),
    )
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: _FailingAISettingsService())

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models/static-model-a")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "static-model-a"
    assert payload["model"] == "gpt-4o-mini"
    assert payload["display_name"] == "Static A"


def test_get_model_uses_config_metadata_when_user_model_matches_config_name(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="openai-gpt-4o-mini",
                model="gpt-4o-mini",
                display_name="GPT-4o Mini",
                description="OpenAI mini model",
                supports_thinking=True,
                supports_reasoning_effort=True,
            )
        ],
        token_usage=SimpleNamespace(enabled=True),
    )
    service = _FakeAISettingsService({"providers": [{"models": ["openai-gpt-4o-mini"]}]})
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models/openai-gpt-4o-mini")

    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "openai-gpt-4o-mini"
    assert payload["model"] == "gpt-4o-mini"
    assert payload["display_name"] == "GPT-4o Mini"
    assert payload["description"] == "OpenAI mini model"


def test_list_models_returns_default_model_name_from_default_provider(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="openai-gpt-4o-mini",
                model="gpt-4o-mini",
                display_name="GPT-4o Mini",
                description="",
                supports_thinking=False,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=False),
    )
    service = _FakeAISettingsService({
        "default_provider_id": "vip-provider",
        "providers": [
            {"id": "standard-provider", "models": ["gpt-4o-mini"], "is_active": False},
            {"id": "vip-provider", "models": ["mimo-v2.5-pro", "deepseek-r1"], "is_active": True},
        ],
    })
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_model_name"] == "mimo-v2.5-pro"
    assert payload["default_provider_id"] == "vip-provider"


def test_list_models_falls_back_when_default_provider_has_no_models(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[],
        token_usage=SimpleNamespace(enabled=False),
    )
    service = _FakeAISettingsService({
        "default_provider_id": "empty-provider",
        "providers": [
            {"id": "empty-provider", "models": [], "is_active": True},
            {"id": "fallback-provider", "models": ["fallback-model"], "is_active": False},
        ],
    })
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_model_name"] == "fallback-model"
    assert payload["default_provider_id"] == "fallback-provider"


def test_list_models_includes_provider_id_on_each_model(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[],
        token_usage=SimpleNamespace(enabled=False),
    )
    service = _FakeAISettingsService({
        "providers": [
            {"id": "provider-a", "models": ["model-x", "model-y"], "is_active": True},
            {"id": "provider-b", "models": ["model-z"], "is_active": False},
        ],
    })
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: service)

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    model_map = {m["name"]: m for m in payload["models"]}
    assert model_map["model-x"]["provider_id"] == "provider-a"
    assert model_map["model-y"]["provider_id"] == "provider-a"
    assert model_map["model-z"]["provider_id"] == "provider-b"


def test_list_models_default_model_name_null_when_no_user_settings(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="static-model",
                model="gpt-4o-mini",
                display_name="Static",
                description="",
                supports_thinking=False,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=False),
    )
    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: _FailingAISettingsService())

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        response = client.get("/api/models")

    assert response.status_code == 200
    payload = response.json()
    assert payload["default_model_name"] is None
    assert payload["default_provider_id"] is None


def test_list_models_cache_ttl_expired(monkeypatch) -> None:
    config = SimpleNamespace(
        models=[
            _build_model(
                name="cached-model",
                model="gpt-4o-mini",
                display_name="Cached",
                description="",
                supports_thinking=False,
                supports_reasoning_effort=False,
            ),
        ],
        token_usage=SimpleNamespace(enabled=False),
    )
    call_count = 0

    class _CountingService:
        async def get_ai_settings(self, user_id, db):
            nonlocal call_count
            call_count += 1
            return {"providers": [{"models": ["cached-model"]}]}

    monkeypatch.setattr(models_router, "get_app_config", lambda: config)
    monkeypatch.setattr(models_router, "get_ai_settings_service", lambda: _CountingService())

    app = _build_app(_FakeDB())
    with TestClient(app) as client:
        r1 = client.get("/api/models")
        assert r1.status_code == 200
        assert call_count == 1

        r2 = client.get("/api/models")
        assert r2.status_code == 200
        assert call_count == 1

        expired_key = next(iter(models_router._models_cache))
        ts, resp = models_router._models_cache[expired_key]
        # Directly mutate cache timestamp to simulate TTL expiry.
        # Relies on internal structure: tuple[float, ModelsListResponse].
        models_router._models_cache[expired_key] = (ts - models_router._MODELS_CACHE_TTL_SEC - 1, resp)

        r3 = client.get("/api/models")
        assert r3.status_code == 200
        assert call_count == 2


def test_list_models_cache_max_size_eviction() -> None:
    original_max = models_router._MODELS_CACHE_MAX_SIZE
    try:
        models_router._MODELS_CACHE_MAX_SIZE = 3

        now = time.monotonic()
        for i in range(5):
            models_router._models_cache[f"user-{i}"] = (now + i * 0.001, SimpleNamespace(models=[], token_usage=SimpleNamespace(enabled=False)))

        models_router._evict_models_cache()

        assert len(models_router._models_cache) <= 3
        assert "user-0" not in models_router._models_cache
        assert "user-1" not in models_router._models_cache
    finally:
        models_router._MODELS_CACHE_MAX_SIZE = original_max


def test_list_models_cache_store_evicts_after_insert_at_max_size() -> None:
    original_max = models_router._MODELS_CACHE_MAX_SIZE
    try:
        models_router._MODELS_CACHE_MAX_SIZE = 3

        now = time.monotonic()
        for i in range(3):
            models_router._models_cache[f"user-{i}"] = (now + i * 0.001, SimpleNamespace(models=[], token_usage=SimpleNamespace(enabled=False)))

        response = SimpleNamespace(models=[], token_usage=SimpleNamespace(enabled=False))
        models_router._store_models_cache("user-new", response)

        assert len(models_router._models_cache) == 3
        assert "user-new" in models_router._models_cache
        assert "user-0" not in models_router._models_cache
    finally:
        models_router._MODELS_CACHE_MAX_SIZE = original_max


def test_list_models_cache_ttl_eviction() -> None:
    now = time.monotonic()
    models_router._models_cache["expired-user"] = (now - models_router._MODELS_CACHE_TTL_SEC - 1, SimpleNamespace(models=[], token_usage=SimpleNamespace(enabled=False)))
    models_router._models_cache["fresh-user"] = (now, SimpleNamespace(models=[], token_usage=SimpleNamespace(enabled=False)))

    models_router._evict_models_cache()

    assert "expired-user" not in models_router._models_cache
    assert "fresh-user" in models_router._models_cache
