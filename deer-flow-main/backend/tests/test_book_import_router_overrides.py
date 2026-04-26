from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import Request

from app.gateway.novel_migrated.api import book_import
from app.gateway.novel_migrated.schemas.book_import import (
    BookImportApplyRequest,
    BookImportChapter,
    BookImportOutline,
    BookImportRetryRequest,
    ProjectSuggestion,
)


def _request() -> Request:
    return Request({"type": "http", "method": "POST", "headers": []})


def _apply_payload() -> BookImportApplyRequest:
    return BookImportApplyRequest(
        project_suggestion=ProjectSuggestion(title="书名"),
        chapters=[BookImportChapter(title="第一章", chapter_number=1, content="正文")],
        outlines=[BookImportOutline(title="大纲1", order_index=1)],
        module_id="novel-book-import",
        ai_provider_id="provider-1",
        ai_model="model-1",
    )


def test_apply_book_import_forwards_override_fields(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_apply_import(**kwargs):
        captured.update(kwargs)
        return {"success": True, "project_id": "p-1", "statistics": {}, "warnings": []}

    monkeypatch.setattr(book_import, "get_user_id", lambda _req: "u-1")
    monkeypatch.setattr(book_import.book_import_service, "apply_import", _fake_apply_import)

    result = asyncio.run(
        book_import.apply_book_import(
            task_id="task-1",
            payload=_apply_payload(),
            request=_request(),
            db=SimpleNamespace(),
        )
    )

    assert result["success"] is True
    assert captured["module_id"] == "novel-book-import"
    assert captured["ai_provider_id"] == "provider-1"
    assert captured["ai_model"] == "model-1"


def test_retry_failed_steps_stream_forwards_override_fields(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_retry(**kwargs):
        captured.update(kwargs)
        return {"success": True, "still_failed": []}

    monkeypatch.setattr(book_import, "get_user_id", lambda _req: "u-1")
    monkeypatch.setattr(book_import.book_import_service, "retry_failed_steps_stream", _fake_retry)
    monkeypatch.setattr(book_import, "create_sse_response", lambda generator: generator)
    monkeypatch.setattr(book_import.SSEResponse, "send_progress", AsyncMock(return_value="event:progress\ndata:{}\n\n"))
    monkeypatch.setattr(book_import.SSEResponse, "send_result", AsyncMock(return_value="event:result\ndata:{}\n\n"))
    monkeypatch.setattr(book_import.SSEResponse, "send_done", AsyncMock(return_value="event:done\ndata:{}\n\n"))
    monkeypatch.setattr(book_import.SSEResponse, "send_error", AsyncMock(return_value="event:error\ndata:{}\n\n"))
    monkeypatch.setattr(book_import.SSEResponse, "format_sse", staticmethod(lambda _payload: "event:progress\ndata:{}\n\n"))

    stream = asyncio.run(
        book_import.retry_failed_steps_stream(
            task_id="task-1",
            payload=BookImportRetryRequest(
                steps=["world_building"],
                module_id="novel-book-import",
                ai_provider_id="provider-2",
                ai_model="model-2",
            ),
            request=_request(),
            db=SimpleNamespace(),
        )
    )

    assert stream is not None
    async def _drain_until_called(gen):
        async for _event in gen:
            if captured:
                break
        await gen.aclose()

    asyncio.run(_drain_until_called(stream))
    assert captured["module_id"] == "novel-book-import"
    assert captured["ai_provider_id"] == "provider-2"
    assert captured["ai_model"] == "model-2"
