from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.api import ai_provider
from app.gateway.middleware.intent_recognition_middleware import IntentRecognitionResult
from app.gateway.observability.metrics import get_gateway_metrics_snapshot, reset_gateway_metrics


class _OkAiService:
    async def generate_text(self, *args, **kwargs):
        return {"content": "ok"}

    async def generate_text_with_messages(self, *args, **kwargs):
        return {"content": "ok"}

    async def generate_text_stream(self, *args, **kwargs):
        yield "ok"

    async def generate_text_stream_with_messages(self, *args, **kwargs):
        yield "ok"


class _ErrorAiService:
    async def generate_text_with_messages(self, *args, **kwargs):
        raise RuntimeError("boom")


class _StreamErrorAiService:
    async def generate_text_stream_with_messages(self, *args, **kwargs):
        yield "partial"
        raise RuntimeError("stream boom")


def _build_payload() -> dict:
    return {
        "messages": [{"role": "user", "content": "hello"}],
        "stream": False,
        "context": {"thread_id": "t-obs-1", "project_id": "p-obs-1"},
        "provider_config": {
            "provider": "openai",
            "api_key": None,
            "base_url": "",
            "model_name": "gpt-4o-mini",
            "temperature": 0.2,
            "max_tokens": 64,
        },
    }


def _build_app(service) -> FastAPI:
    app = FastAPI()
    app.include_router(ai_provider.router)
    app.dependency_overrides[ai_provider.get_user_ai_service] = lambda: service
    return app


def _build_stream_payload() -> dict:
    payload = _build_payload()
    payload["stream"] = True
    return payload


def test_chat_metrics_collect_success_failure_and_retry(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
    reset_gateway_metrics()
    ai_provider._REQUEST_WINDOWS.clear()

    async def _not_handled(*args, **kwargs):
        return IntentRecognitionResult(handled=False)

    monkeypatch.setattr(ai_provider._INTENT_RECOGNITION_MIDDLEWARE, "process_request", _not_handled)

    ok_app = _build_app(_OkAiService())
    with TestClient(ok_app) as client:
        response_ok = client.post(
            "/api/ai/chat",
            json=_build_payload(),
            headers={"Authorization": "Bearer secret-token"},
        )
        response_retry = client.post(
            "/api/ai/chat",
            json=_build_payload(),
            headers={"Authorization": "Bearer secret-token", "X-Retry-Attempt": "1"},
        )

    assert response_ok.status_code == 200
    assert response_retry.status_code == 200

    err_app = _build_app(_ErrorAiService())
    with TestClient(err_app) as client:
        response_error = client.post(
            "/api/ai/chat",
            json=_build_payload(),
            headers={"Authorization": "Bearer secret-token"},
        )

    assert response_error.status_code == 500

    snapshot = get_gateway_metrics_snapshot()
    assert snapshot["requests_total"] == 3
    assert snapshot["requests_success_total"] == 2
    assert snapshot["requests_failure_total"] == 1
    assert snapshot["requests_retry_total"] == 1
    assert snapshot["p95_latency_ms"] >= 0


def test_chat_stream_metrics_mark_success_after_stream_completion(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
    reset_gateway_metrics()
    ai_provider._REQUEST_WINDOWS.clear()

    async def _not_handled(*args, **kwargs):
        return IntentRecognitionResult(handled=False)

    monkeypatch.setattr(ai_provider._INTENT_RECOGNITION_MIDDLEWARE, "process_request", _not_handled)

    app = _build_app(_OkAiService())
    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/api/ai/chat",
            json=_build_stream_payload(),
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            body_text = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"content": "ok"' in body_text
    assert "[DONE]" in body_text

    snapshot = get_gateway_metrics_snapshot()
    assert snapshot["requests_total"] == 1
    assert snapshot["requests_success_total"] == 1
    assert snapshot["requests_failure_total"] == 0
    assert snapshot["requests_retry_total"] == 0
    assert snapshot["p95_latency_ms"] >= 0


def test_chat_stream_metrics_mark_failure_on_midstream_exception(monkeypatch):
    monkeypatch.setenv("DEERFLOW_AI_PROVIDER_API_TOKEN", "secret-token")
    monkeypatch.setenv("USE_MESSAGES_FORMAT", "1")
    reset_gateway_metrics()
    ai_provider._REQUEST_WINDOWS.clear()

    async def _not_handled(*args, **kwargs):
        return IntentRecognitionResult(handled=False)

    monkeypatch.setattr(ai_provider._INTENT_RECOGNITION_MIDDLEWARE, "process_request", _not_handled)

    app = _build_app(_StreamErrorAiService())
    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/api/ai/chat",
            json=_build_stream_payload(),
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            body_text = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"error": "AI 请求失败"' in body_text

    snapshot = get_gateway_metrics_snapshot()
    assert snapshot["requests_total"] == 1
    assert snapshot["requests_success_total"] == 0
    assert snapshot["requests_failure_total"] == 1
    assert snapshot["requests_retry_total"] == 0
    assert snapshot["p95_latency_ms"] >= 0
