import asyncio
import json
import logging

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.gateway.middleware.request_trace import RequestTraceMiddleware
from app.gateway.observability.context import copy_trace_context


def test_request_trace_middleware_binds_context_and_header():
    app = FastAPI()
    app.add_middleware(RequestTraceMiddleware)

    @app.get("/ping")
    async def ping():
        return copy_trace_context()

    with TestClient(app) as client:
        response = client.get(
            "/ping",
            headers={
                "X-Request-ID": "req-123",
                "X-Thread-ID": "thread-1",
                "X-Project-ID": "project-1",
                "X-Session-Key": "session-1",
                "Idempotency-Key": "idem-1",
            },
        )

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "req-123"
    payload = response.json()
    assert payload["request_id"] == "req-123"
    assert payload["thread_id"] == "thread-1"
    assert payload["project_id"] == "project-1"
    assert payload["session_key"] == "session-1"
    assert payload["idempotency_key"] == "idem-1"


def test_request_trace_middleware_keeps_context_during_streaming_response():
    app = FastAPI()
    app.add_middleware(RequestTraceMiddleware)

    @app.get("/stream")
    async def stream():
        async def _event_stream():
            yield json.dumps(copy_trace_context()).encode("utf-8") + b"\n"
            await asyncio.sleep(0)
            yield json.dumps(copy_trace_context()).encode("utf-8") + b"\n"

        return StreamingResponse(_event_stream(), media_type="application/jsonl")

    with TestClient(app) as client:
        with client.stream(
            "GET",
            "/stream",
            headers={
                "X-Request-ID": "req-stream-1",
                "X-Thread-ID": "thread-stream-1",
                "X-Project-ID": "project-stream-1",
                "X-Session-Key": "session-stream-1",
                "Idempotency-Key": "idem-stream-1",
            },
        ) as response:
            lines = [line for line in response.iter_lines() if line]

    assert response.status_code == 200
    payloads = [json.loads(line) for line in lines]
    assert len(payloads) == 2
    for payload in payloads:
        assert payload["request_id"] == "req-stream-1"
        assert payload["thread_id"] == "thread-stream-1"
        assert payload["project_id"] == "project-stream-1"
        assert payload["session_key"] == "session-stream-1"
        assert payload["idempotency_key"] == "idem-stream-1"


def test_request_trace_logs_duration_for_success(caplog: pytest.LogCaptureFixture):
    app = FastAPI()
    app.add_middleware(RequestTraceMiddleware)

    @app.get("/ok")
    async def ok():
        return {"ok": True}

    with caplog.at_level(logging.INFO, logger="app.gateway.middleware.request_trace"):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/ok")

    assert response.status_code == 200
    assert any(
        "Gateway request completed method=GET path=/ok status_code=200 duration_ms=" in record.message
        for record in caplog.records
    )


def test_request_trace_logs_duration_for_exception(caplog: pytest.LogCaptureFixture):
    app = FastAPI()
    app.add_middleware(RequestTraceMiddleware)

    @app.get("/boom")
    async def boom():
        raise RuntimeError("boom")

    with caplog.at_level(logging.ERROR, logger="app.gateway.middleware.request_trace"):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/boom")

    assert response.status_code == 500
    assert any(
        "Gateway request failed method=GET path=/boom duration_ms=" in record.message
        for record in caplog.records
    )
