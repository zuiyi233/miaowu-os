from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.api import ai_provider
from app.gateway.middleware.intent_recognition_middleware import IntentRecognitionResult


class _NeverCalledAiService:
    async def generate_text(self, *args, **kwargs):
        raise AssertionError("generate_text should not be called for handled intent")

    async def generate_text_with_messages(self, *args, **kwargs):
        raise AssertionError("generate_text_with_messages should not be called for handled intent")

    async def generate_text_stream(self, *args, **kwargs):
        raise AssertionError("generate_text_stream should not be called for handled intent")

    async def generate_text_stream_with_messages(self, *args, **kwargs):
        raise AssertionError("generate_text_stream_with_messages should not be called for handled intent")


class _ToolCallAiService:
    async def generate_text_with_messages(self, *args, **kwargs):
        return {
            "content": "ok",
            "tool_calls": [{"name": "create_novel", "args": {"title": "A"}}],
        }


def _build_payload(*, stream: bool = False) -> dict:
    return {
        "messages": [{"role": "user", "content": "请创建小说"}],
        "stream": stream,
        "provider_config": {
            "provider": "openai",
            "api_key": None,
            "base_url": "",
            "model_name": "gpt-4o-mini",
            "temperature": 0.2,
            "max_tokens": 64,
        },
    }


def _build_app(service):
    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: service
    return app


def test_chat_returns_intent_result_and_bypass_headers(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    ai_provider._REQUEST_WINDOWS.clear()

    async def _fake_process_request(*args, **kwargs):
        return IntentRecognitionResult(
            handled=True,
            content="已创建小说",
            tool_calls=[{"function": {"name": "create_novel"}}],
            novel={"id": "novel-1", "title": "测试", "genre": "科幻"},
            session={
                "mode": "create",
                "status": "awaiting_confirmation",
                "action_protocol": {
                    "action_type": "create_novel",
                    "slot_schema": {"title": {"required": True, "value": "测试"}},
                    "missing_slots": ["genre"],
                    "confirmation_required": False,
                    "execution_mode": {
                        "status": "readonly",
                        "enabled": False,
                        "updated_at": "2026-01-01T00:00:00+00:00",
                    },
                    "pending_action": None,
                    "execute_result": None,
                },
            },
        )

    monkeypatch.setattr(ai_provider._INTENT_RECOGNITION_MIDDLEWARE, "process_request", _fake_process_request)

    app = _build_app(_NeverCalledAiService())
    with TestClient(app) as client:
        response = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=False),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["content"] == "已创建小说"
    assert data["tool_calls"][0]["function"]["name"] == "create_novel"
    assert data["novel"]["id"] == "novel-1"
    assert data["session"]["action_protocol"]["action_type"] == "create_novel"
    assert data["action_protocol"]["missing_slots"] == ["genre"]
    assert data["action_protocol"]["execution_mode"]["status"] == "readonly"
    assert response.headers.get("x-prompt-cache") == "bypass"
    assert response.headers.get("cache-control") == "no-store"


def test_chat_passes_through_tool_calls_from_ai_service(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
    ai_provider._REQUEST_WINDOWS.clear()

    async def _not_handled(*args, **kwargs):
        return IntentRecognitionResult(handled=False)

    monkeypatch.setattr(ai_provider._INTENT_RECOGNITION_MIDDLEWARE, "process_request", _not_handled)

    app = _build_app(_ToolCallAiService())
    with TestClient(app) as client:
        response = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=False),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["content"] == "ok"
    assert data["tool_calls"][0]["name"] == "create_novel"
