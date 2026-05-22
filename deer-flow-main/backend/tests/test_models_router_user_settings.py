from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import models as models_router


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
