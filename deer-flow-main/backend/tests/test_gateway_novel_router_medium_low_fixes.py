from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
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
    project = SimpleNamespace(
        id="project-1",
        title="统一主库项目",
        description="简介",
        cover_image_url=None,
        genre="玄幻",
        theme="成长",
        status="created",
        target_words=100000,
        created_at=None,
        updated_at=None,
    )

    class _ScalarResult:
        def __init__(self, value: Any) -> None:
            self.value = value

        def scalar(self) -> Any:
            return self.value

    class _Scalars:
        def __init__(self, values: list[Any]) -> None:
            self.values = values

        def all(self) -> list[Any]:
            return self.values

    class _ScalarsResult:
        def scalars(self) -> _Scalars:
            return _Scalars([project])

    class _StatsResult:
        @staticmethod
        def one() -> tuple[int, int]:
            return 3, 1200

    class _FakeDB:
        def __init__(self) -> None:
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, _query):
            self.calls += 1
            if self.calls == 1:
                return _ScalarResult(1)
            if self.calls == 2:
                return _ScalarsResult()
            if self.calls == 3:
                return _StatsResult()
            raise AssertionError("unexpected execute call")

    async def _fake_init_db_schema() -> None:
        return None

    monkeypatch.setattr(novel_router, "init_db_schema", _fake_init_db_schema)
    monkeypatch.setattr(novel_router, "AsyncSessionLocal", _FakeDB)

    result = asyncio.run(novel_router.list_novels(user_id="user-1", page=2, page_size=5))

    assert result["items"][0]["id"] == "project-1"
    assert result["items"][0]["chaptersCount"] == 3
    assert result["items"][0]["wordCount"] == 1200
    assert result["total"] == 1


def test_create_chapter_forwards_header_idempotency_key_and_strips_payload(monkeypatch):
    captured: dict[str, Any] = {}

    class _ScalarResult:
        def __init__(self, value: Any) -> None:
            self.value = value

        def scalar_one_or_none(self) -> Any:
            return self.value

        def scalar(self) -> Any:
            return self.value

    class _FakeDB:
        def __init__(self) -> None:
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, _query):
            self.calls += 1
            if self.calls == 1:
                return _ScalarResult(SimpleNamespace(id="novel-1", user_id="user-1"))
            if self.calls == 2:
                return _ScalarResult(0)
            raise AssertionError("unexpected execute call")

        def add(self, obj: Any) -> None:
            captured["chapter"] = obj

        async def commit(self) -> None:
            captured["committed"] = True

        async def refresh(self, obj: Any) -> None:
            obj.id = "chapter-1"
            obj.version = 1

    async def _fake_init_db_schema() -> None:
        return None

    monkeypatch.setattr(novel_router, "init_db_schema", _fake_init_db_schema)
    monkeypatch.setattr(novel_router, "AsyncSessionLocal", _FakeDB)

    request = _make_request(
        method="POST",
        path="/api/novels/novel-1/chapters",
        headers={"X-Idempotency-Key": "  header-idem  "},
        body={"title": "章节A", "idempotencyKey": "body-idem"},
    )
    result = asyncio.run(novel_router.create_chapter("novel-1", request, user_id="user-1"))

    assert result["id"] == "chapter-1"
    assert result["novelId"] == "novel-1"
    assert captured["chapter"].title == "章节A"
    assert captured["committed"] is True


def test_update_chapter_forwards_body_idempotency_key_when_header_missing(monkeypatch):
    chapter = SimpleNamespace(
        id="chapter-1",
        project_id="novel-1",
        title="旧标题",
        content="old",
        summary="",
        chapter_number=1,
        version=1,
        status="draft",
        created_at=None,
        updated_at=None,
    )

    class _ScalarResult:
        def __init__(self, value: Any) -> None:
            self.value = value

        def scalar_one_or_none(self) -> Any:
            return self.value

    class _FakeDB:
        def __init__(self) -> None:
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, _query):
            self.calls += 1
            if self.calls == 1:
                return _ScalarResult(SimpleNamespace(id="novel-1", user_id="user-1"))
            if self.calls == 2:
                return _ScalarResult(chapter)
            raise AssertionError("unexpected execute call")

        async def commit(self) -> None:
            return None

        async def refresh(self, _obj: Any) -> None:
            return None

    async def _fake_init_db_schema() -> None:
        return None

    monkeypatch.setattr(novel_router, "init_db_schema", _fake_init_db_schema)
    monkeypatch.setattr(novel_router, "AsyncSessionLocal", _FakeDB)

    request = _make_request(
        method="PUT",
        path="/api/novels/novel-1/chapters/chapter-1",
        body={"content": "new content", "idempotency_key": "body-idem-key"},
    )
    result = asyncio.run(novel_router.update_chapter("novel-1", "chapter-1", request, user_id="user-1"))

    assert result["id"] == "chapter-1"
    assert result["content"] == "new content"
    assert chapter.word_count == len("new content")


def test_delete_chapter_forwards_idempotency_header(monkeypatch):
    captured: dict[str, Any] = {}

    chapter = SimpleNamespace(id="chapter-1", project_id="novel-1")

    class _ScalarResult:
        def __init__(self, value: Any) -> None:
            self.value = value

        def scalar_one_or_none(self) -> Any:
            return self.value

    class _FakeDB:
        def __init__(self) -> None:
            self.calls = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, _query):
            self.calls += 1
            if self.calls == 1:
                return _ScalarResult(SimpleNamespace(id="novel-1", user_id="user-1"))
            if self.calls == 2:
                return _ScalarResult(chapter)
            raise AssertionError("unexpected execute call")

        async def delete(self, obj: Any) -> None:
            captured["deleted"] = obj

        async def commit(self) -> None:
            captured["committed"] = True

    async def _fake_init_db_schema() -> None:
        return None

    monkeypatch.setattr(novel_router, "init_db_schema", _fake_init_db_schema)
    monkeypatch.setattr(novel_router, "AsyncSessionLocal", _FakeDB)

    request = _make_request(
        method="DELETE",
        path="/api/novels/novel-1/chapters/chapter-1",
        headers={"Idempotency-Key": "header-del-key"},
        query_string="idempotency_key=query-del-key",
    )
    result = asyncio.run(novel_router.delete_chapter("novel-1", "chapter-1", request, user_id="user-1"))

    assert result == {"deleted": True}
    assert captured["deleted"] is chapter
    assert captured["committed"] is True


def test_ignore_recommendation_route_marks_recommendation_as_ignored(monkeypatch):
    owned_calls: list[tuple[str, str]] = []

    async def _fake_ensure_owned_novel(novel_id: str, user_id: str) -> None:
        owned_calls.append((novel_id, user_id))

    async def _fake_ignore_recommendation(novel_id: str, rec_id: str) -> dict[str, Any]:
        return {"id": rec_id, "novelId": novel_id, "status": "ignored"}

    monkeypatch.setattr(novel_router, "_ensure_owned_novel", _fake_ensure_owned_novel)
    monkeypatch.setattr(novel_router._novel_store, "ignore_recommendation", _fake_ignore_recommendation)

    result = asyncio.run(novel_router.ignore_recommendation("novel-1", "rec-1", user_id="user-1"))

    assert result["status"] == "ignored"
    assert owned_calls == [("novel-1", "user-1")]


def test_ignore_recommendation_route_returns_404_when_missing(monkeypatch):
    async def _fake_ensure_owned_novel(_novel_id: str, _user_id: str) -> None:
        return None

    async def _fake_ignore_recommendation(_novel_id: str, _rec_id: str):
        return None

    monkeypatch.setattr(novel_router, "_ensure_owned_novel", _fake_ensure_owned_novel)
    monkeypatch.setattr(novel_router._novel_store, "ignore_recommendation", _fake_ignore_recommendation)

    try:
        asyncio.run(novel_router.ignore_recommendation("novel-1", "missing", user_id="user-1"))
        assert False, "expected HTTPException"
    except Exception as exc:  # noqa: BLE001
        from fastapi import HTTPException

        assert isinstance(exc, HTTPException)
        assert exc.status_code == 404


def test_legacy_novel_store_persist_is_disabled(tmp_path):
    store = novel_router.NovelStore(storage_path=tmp_path / "novel_store.json")
    store._novels["novel-1"] = {"id": "novel-1", "title": "兼容项目"}

    result = asyncio.run(store.create_timeline_event("novel-1", {"title": "本地兼容事件"}))

    assert result["novelId"] == "novel-1"
    assert not (tmp_path / "novel_store.json").exists()
