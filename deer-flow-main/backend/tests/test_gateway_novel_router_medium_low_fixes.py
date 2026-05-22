from __future__ import annotations

import asyncio
import json
from typing import Any

from starlette.requests import Request

from app.gateway.novel_migrated.services.novel_query_service import NovelQueryService
from app.gateway.routers import novel as novel_router


def _make_request(
    *,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    query_string: str = "",
) -> Request:
    raw_headers = []
    for key, value in (headers or {}).items():
        raw_headers.append((key.lower().encode("latin-1"), value.encode("latin-1")))

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


def test_novel_query_service_merges_by_id_without_title_dedup(monkeypatch):
    service = NovelQueryService()
    legacy_result = {
        "items": [
            {"id": "legacy-1", "title": "同名标题", "updatedAt": "2026-04-01T00:00:00+00:00"},
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }

    async def _fake_fetch_modern_items() -> list[dict[str, Any]]:
        return [
            {"id": "modern-1", "title": "同名标题", "updatedAt": "2026-04-03T00:00:00+00:00"},
            {"id": "legacy-1", "title": "legacy duplicate", "updatedAt": "2026-04-04T00:00:00+00:00"},
        ]

    monkeypatch.setattr(service, "_fetch_modern_items", _fake_fetch_modern_items)
    result = asyncio.run(service.list_novels(legacy_result=legacy_result, page=1, page_size=20))
    ids = [item["id"] for item in result["items"]]

    assert result["total"] == 2
    assert ids.count("legacy-1") == 1
    assert "modern-1" in ids


def test_list_novels_route_uses_query_service(monkeypatch):
    async def _fake_legacy_list(page: int, page_size: int) -> dict[str, Any]:
        assert page == 2
        assert page_size == 5
        return {"items": [{"id": "legacy-1"}], "total": 1, "page": page, "page_size": page_size}

    captured: dict[str, Any] = {}

    async def _fake_query_service(*, legacy_result: dict[str, Any], page: int, page_size: int) -> dict[str, Any]:
        captured["legacy_result"] = legacy_result
        captured["page"] = page
        captured["page_size"] = page_size
        return {"items": [{"id": "merged-1"}], "total": 1, "page": page, "page_size": page_size}

    monkeypatch.setattr(novel_router._novel_store, "list_novels", _fake_legacy_list)
    monkeypatch.setattr(novel_router.novel_query_service, "list_novels", _fake_query_service)

    result = asyncio.run(novel_router.list_novels(page=2, page_size=5))

    assert result["items"] == [{"id": "merged-1"}]
    assert captured["legacy_result"]["items"] == [{"id": "legacy-1"}]
    assert captured["page"] == 2
    assert captured["page_size"] == 5


def test_create_chapter_forwards_header_idempotency_key_and_strips_payload(monkeypatch):
    captured: dict[str, Any] = {}

    async def _fake_create_chapter(novel_id: str, data: dict[str, Any], *, idempotency_key: str | None = None) -> dict[str, Any]:
        captured["novel_id"] = novel_id
        captured["data"] = data
        captured["idempotency_key"] = idempotency_key
        return {"id": "chapter-1", "novelId": novel_id, **data}

    monkeypatch.setattr(novel_router._novel_store, "create_chapter", _fake_create_chapter)

    request = _make_request(
        method="POST",
        path="/api/novels/novel-1/chapters",
        headers={"X-Idempotency-Key": "  header-idem  "},
        body={"title": "章节A", "idempotencyKey": "body-idem"},
    )
    result = asyncio.run(novel_router.create_chapter("novel-1", request))

    assert result["id"] == "chapter-1"
    assert captured["novel_id"] == "novel-1"
    assert captured["idempotency_key"] == "header-idem"
    assert "idempotencyKey" not in captured["data"]
    assert "idempotency_key" not in captured["data"]


def test_update_chapter_forwards_body_idempotency_key_when_header_missing(monkeypatch):
    captured: dict[str, Any] = {}

    async def _fake_update_chapter(
        novel_id: str,
        chapter_id: str,
        data: dict[str, Any],
        *,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        captured["novel_id"] = novel_id
        captured["chapter_id"] = chapter_id
        captured["data"] = data
        captured["idempotency_key"] = idempotency_key
        return {"id": chapter_id, "novelId": novel_id, **data}

    monkeypatch.setattr(novel_router._novel_store, "update_chapter", _fake_update_chapter)

    request = _make_request(
        method="PUT",
        path="/api/novels/novel-1/chapters/chapter-1",
        body={"content": "new content", "idempotency_key": "body-idem-key"},
    )
    result = asyncio.run(novel_router.update_chapter("novel-1", "chapter-1", request))

    assert result["id"] == "chapter-1"
    assert captured["idempotency_key"] == "body-idem-key"
    assert "idempotencyKey" not in captured["data"]
    assert "idempotency_key" not in captured["data"]


def test_delete_chapter_forwards_idempotency_header(monkeypatch):
    captured: dict[str, Any] = {}

    async def _fake_delete_chapter(novel_id: str, chapter_id: str, *, idempotency_key: str | None = None) -> bool:
        captured["novel_id"] = novel_id
        captured["chapter_id"] = chapter_id
        captured["idempotency_key"] = idempotency_key
        return True

    monkeypatch.setattr(novel_router._novel_store, "delete_chapter", _fake_delete_chapter)

    request = _make_request(
        method="DELETE",
        path="/api/novels/novel-1/chapters/chapter-1",
        headers={"Idempotency-Key": "header-del-key"},
        query_string="idempotency_key=query-del-key",
    )
    result = asyncio.run(novel_router.delete_chapter("novel-1", "chapter-1", request))

    assert result == {"deleted": True}
    assert captured["novel_id"] == "novel-1"
    assert captured["chapter_id"] == "chapter-1"
    assert captured["idempotency_key"] == "header-del-key"


def test_ignore_recommendation_route_marks_recommendation_as_ignored(monkeypatch):
    async def _fake_ignore_recommendation(novel_id: str, rec_id: str) -> dict[str, Any]:
        return {"id": rec_id, "novelId": novel_id, "status": "ignored"}

    monkeypatch.setattr(novel_router._novel_store, "ignore_recommendation", _fake_ignore_recommendation)

    result = asyncio.run(novel_router.ignore_recommendation("novel-1", "rec-1"))

    assert result["status"] == "ignored"


def test_ignore_recommendation_route_returns_404_when_missing(monkeypatch):
    async def _fake_ignore_recommendation(_novel_id: str, _rec_id: str):
        return None

    monkeypatch.setattr(novel_router._novel_store, "ignore_recommendation", _fake_ignore_recommendation)

    try:
        asyncio.run(novel_router.ignore_recommendation("novel-1", "missing"))
        assert False, "expected HTTPException"
    except Exception as exc:  # noqa: BLE001
        from fastapi import HTTPException

        assert isinstance(exc, HTTPException)
        assert exc.status_code == 404
