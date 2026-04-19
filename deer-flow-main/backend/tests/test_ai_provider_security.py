import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.api import ai_provider


class _FakeAiService:
    async def generate_text(self, *args, **kwargs):
        return {"content": "ok"}

    async def generate_text_stream(self, *args, **kwargs):
        yield "ok"


def _build_app():
    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: _FakeAiService()
    return app


def test_providers_requires_loopback_or_token(monkeypatch):
    monkeypatch.delenv("DEERFLOW_AI_PROVIDER_API_TOKEN", raising=False)
    ai_provider._REQUEST_WINDOWS.clear()

    app = _build_app()
    with TestClient(app) as client:
        response = client.get("/api/ai/providers")

    assert response.status_code == 403
    assert "loopback" in response.json()["detail"]


def test_providers_allows_bearer_token(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    ai_provider._REQUEST_WINDOWS.clear()

    app = _build_app()
    with TestClient(app) as client:
        response = client.get(
            "/api/ai/providers",
            headers={"Authorization": "Bearer secret-token"},
        )

    assert response.status_code == 200
    assert "providers" in response.json()


def test_chat_rate_limit(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_RATE_LIMIT_PER_MINUTE", "1")
    ai_provider._REQUEST_WINDOWS.clear()

    app = _build_app()
    payload = {
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False,
        "provider_config": {
            "provider": "openai",
            "api_key": "sk-test-should-be-ignored",
            "base_url": "",
            "model_name": "gpt-4o-mini",
            "temperature": 0.2,
            "max_tokens": 64,
        },
    }

    with TestClient(app) as client:
        first = client.post(
            "/api/ai/chat",
            json=payload,
            headers={"Authorization": "Bearer secret-token"},
        )
        second = client.post(
            "/api/ai/chat",
            json=payload,
            headers={"Authorization": "Bearer secret-token"},
        )

    assert first.status_code == 200
    assert first.json()["content"] == "ok"
    assert second.status_code == 429
    assert "Rate limit exceeded" in second.json()["detail"]

