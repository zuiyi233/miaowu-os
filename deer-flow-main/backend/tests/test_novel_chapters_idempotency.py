from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

from starlette.requests import Request

from app.gateway.novel_migrated.api import chapters as chapters_api


def _make_request(
    *,
    method: str = "POST",
    path: str = "/api/chapters/project/p-1",
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    query_string: str = "",
) -> Request:
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    body_bytes = json.dumps(body).encode("utf-8") if body is not None else b""
    emitted = False

    async def _receive() -> dict[str, Any]:
        nonlocal emitted
        if emitted:
            return {"type": "http.request", "body": b"", "more_body": False}
        emitted = True
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "path": path,
        "raw_path": path.encode("utf-8"),
        "headers": raw_headers,
        "query_string": query_string.encode("utf-8"),
        "scheme": "http",
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
        "root_path": "",
    }
    return Request(scope, _receive)


def test_extract_idempotency_key_prefers_header_over_body_and_query():
    request = _make_request(
        headers={"X-Idempotency-Key": " header-idem "},
        query_string="idempotency_key=query-idem",
    )
    key = chapters_api._extract_idempotency_key(
        request,
        {"idempotency_key": "body-idem"},
    )
    assert key == "header-idem"


def test_extract_idempotency_key_falls_back_to_body_then_query():
    request = _make_request(query_string="idempotencyKey=query-idem")
    key_from_body = chapters_api._extract_idempotency_key(
        request,
        {"idempotencyKey": " body-idem "},
    )
    key_from_query = chapters_api._extract_idempotency_key(request, {})
    assert key_from_body == "body-idem"
    assert key_from_query == "query-idem"


def test_strip_idempotency_fields_removes_dirty_keys():
    payload = {
        "title": "章节A",
        "summary": "概要",
        "idempotencyKey": "idem-a",
        "idempotency_key": "idem-b",
    }
    stripped = chapters_api._strip_idempotency_fields(payload)
    assert stripped == {"title": "章节A", "summary": "概要"}


def test_create_chapter_binds_idempotency_context_from_request_model(monkeypatch):
    captured: dict[str, Any] = {}

    monkeypatch.setattr(
        chapters_api,
        "update_trace_context",
        lambda **kwargs: captured.update(kwargs),
    )

    async def _fake_verify_project_access(*args, **kwargs):
        return None

    monkeypatch.setattr(chapters_api, "verify_project_access", _fake_verify_project_access)

    class _FakeDB:
        def __init__(self) -> None:
            self.added = None

        async def execute(self, *args, **kwargs):
            return SimpleNamespace(scalar=lambda: 0)

        def add(self, item):
            self.added = item

        async def commit(self):
            return None

        async def refresh(self, item):
            item.id = "chapter-1"
            return None

    db = _FakeDB()
    req = chapters_api.ChapterCreateRequest(
        title="新章节",
        idempotency_key="body-idem",
    )
    request = _make_request()

    result = asyncio.run(
        chapters_api.create_chapter(
            "project-1",
            req,
            request,
            user_id="user-1",
            db=db,
        )
    )

    assert result["id"] == "chapter-1"
    assert captured["idempotency_key"] == "body-idem"
