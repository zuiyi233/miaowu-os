from __future__ import annotations

import importlib
import sys
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient


class _RaisingAsyncIterator:
    def __init__(self, message: str):
        self.message = message

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise RuntimeError(self.message)


def _load_ai_provider_module(monkeypatch):
    """Load ai_provider with lightweight stubs to avoid import cycles in tests."""
    fake_settings_module = types.ModuleType("app.gateway.novel_migrated.api.settings")
    fake_settings_module.get_user_ai_service = lambda: None

    fake_ai_service_module = types.ModuleType("app.gateway.novel_migrated.services.ai_service")
    fake_ai_service_module.AIService = object

    monkeypatch.setitem(sys.modules, "app.gateway.novel_migrated.api.settings", fake_settings_module)
    monkeypatch.setitem(sys.modules, "app.gateway.novel_migrated.services.ai_service", fake_ai_service_module)
    monkeypatch.delitem(sys.modules, "app.gateway.api.ai_provider", raising=False)

    return importlib.import_module("app.gateway.api.ai_provider")


def _build_payload(stream: bool) -> dict:
    return {
        "messages": [{"role": "user", "content": "hello"}],
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


def test_messages_non_stream_error_matches_legacy_branch(monkeypatch):
    ai_provider = _load_ai_provider_module(monkeypatch)
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    ai_provider._REQUEST_WINDOWS.clear()

    class _ErrorAiService:
        async def generate_text_with_messages(self, *args, **kwargs):
            raise RuntimeError("internal secret details")

        async def generate_text(self, *args, **kwargs):
            raise RuntimeError("internal secret details")

    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: _ErrorAiService()

    with TestClient(app) as client:
        monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
        messages_response = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=False),
            headers={"Authorization": "Bearer secret-token"},
        )
        monkeypatch.setenv("USE_MESSAGES_FORMAT", "0")
        legacy_response = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=False),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert messages_response.status_code == 500
    assert legacy_response.status_code == 500
    assert messages_response.json()["detail"] == legacy_response.json()["detail"] == "AI 请求失败: internal secret details"


def test_messages_stream_error_is_sanitized(monkeypatch):
    ai_provider = _load_ai_provider_module(monkeypatch)
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.delenv("DEERFLOW_AI_PROVIDER_STREAM_EXPOSE_RAW_ERROR", raising=False)
    monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
    ai_provider._REQUEST_WINDOWS.clear()

    class _ErrorAiService:
        def generate_text_stream_with_messages(self, *args, **kwargs):
            return _RaisingAsyncIterator("stream internal details")

    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: _ErrorAiService()

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=True),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")
    assert response.headers.get("cache-control") == "no-cache"
    assert response.headers.get("x-accel-buffering") == "no"
    assert "AI 请求失败" in response.text
    assert "stream internal details" not in response.text


def test_legacy_stream_error_is_sanitized_by_default(monkeypatch):
    ai_provider = _load_ai_provider_module(monkeypatch)
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.delenv("DEERFLOW_AI_PROVIDER_STREAM_EXPOSE_RAW_ERROR", raising=False)
    monkeypatch.setenv("USE_MESSAGES_FORMAT", "0")
    ai_provider._REQUEST_WINDOWS.clear()

    class _ErrorAiService:
        def generate_text_stream(self, *args, **kwargs):
            return _RaisingAsyncIterator("legacy stream internal details")

    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: _ErrorAiService()

    with TestClient(app) as client:
        response = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=True),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert response.status_code == 200
    assert "AI 请求失败" in response.text
    assert "legacy stream internal details" not in response.text


def test_stream_error_can_expose_raw_details_via_env(monkeypatch):
    ai_provider = _load_ai_provider_module(monkeypatch)
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_STREAM_EXPOSE_RAW_ERROR", "true")
    ai_provider._REQUEST_WINDOWS.clear()

    class _ErrorAiService:
        def generate_text_stream_with_messages(self, *args, **kwargs):
            return _RaisingAsyncIterator("messages raw details")

        def generate_text_stream(self, *args, **kwargs):
            return _RaisingAsyncIterator("legacy raw details")

    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: _ErrorAiService()

    with TestClient(app) as client:
        monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
        messages_resp = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=True),
            headers={"Authorization": "Bearer secret-token"},
        )
        monkeypatch.setenv("USE_MESSAGES_FORMAT", "0")
        legacy_resp = client.post(
            "/api/ai/chat",
            json=_build_payload(stream=True),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert messages_resp.status_code == 200
    assert legacy_resp.status_code == 200
    assert "messages raw details" in messages_resp.text
    assert "legacy raw details" in legacy_resp.text


def test_use_messages_format_env_bool_parsing(monkeypatch):
    ai_provider = _load_ai_provider_module(monkeypatch)

    monkeypatch.delenv("USE_MESSAGES_FORMAT", raising=False)
    assert ai_provider._is_messages_format_enabled() is True

    monkeypatch.setenv("USE_MESSAGES_FORMAT", "0")
    assert ai_provider._is_messages_format_enabled() is False

    monkeypatch.setenv("USE_MESSAGES_FORMAT", "false")
    assert ai_provider._is_messages_format_enabled() is False

    monkeypatch.setenv("USE_MESSAGES_FORMAT", " NO ")
    assert ai_provider._is_messages_format_enabled() is False

    monkeypatch.setenv("USE_MESSAGES_FORMAT", "off")
    assert ai_provider._is_messages_format_enabled() is False

    monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
    assert ai_provider._is_messages_format_enabled() is True

    monkeypatch.setenv("USE_MESSAGES_FORMAT", "true")
    assert ai_provider._is_messages_format_enabled() is True
