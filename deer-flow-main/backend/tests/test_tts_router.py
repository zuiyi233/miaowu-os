from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import tts as tts_router


def _build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(tts_router.router)
    return app


def test_get_tts_config_respects_env_availability(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:8551/v1")
    monkeypatch.setenv("VOLCENGINE_TTS_APPID", "app-id")
    monkeypatch.setenv("VOLCENGINE_TTS_ACCESS_TOKEN", "token")

    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]["openai"]["available"] is True
    assert payload["providers"]["volcengine"]["available"] is True
    assert payload["default_provider"] == "openai"


def test_get_tts_config_uses_volcengine_when_openai_unavailable(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_BASE", raising=False)
    monkeypatch.setenv("VOLCENGINE_TTS_APPID", "app-id")
    monkeypatch.setenv("VOLCENGINE_TTS_ACCESS_TOKEN", "token")

    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]["openai"]["available"] is False
    assert payload["providers"]["volcengine"]["available"] is True
    assert payload["default_provider"] == "volcengine"


def test_list_voices_filters_by_provider() -> None:
    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/tts/voices", params={"provider": "openai"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["voices"], "expected non-empty voices for openai"
    assert all(voice["provider"] == "openai" for voice in payload["voices"])


def test_synthesize_rejects_invalid_request_payload() -> None:
    app = _build_app()
    with TestClient(app) as client:
        response = client.post(
            "/api/tts/synthesize",
            json={
                "text": "",
                "provider": "openai",
            },
        )

    assert response.status_code == 422
