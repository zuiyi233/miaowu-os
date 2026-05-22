from __future__ import annotations

import asyncio
import logging
import sys
import types

from deerflow.tools.builtins import novel_tools


class _FakeIntentMiddleware:
    def __init__(self, active_pairs: set[tuple[str, str]]):
        self._active_pairs = active_pairs
        self.build_calls: list[tuple[str, dict | None]] = []
        self.check_calls: list[tuple[str, str]] = []

    def build_session_key_for_context(self, *, user_id: str, context: dict | None):
        self.build_calls.append((user_id, context))
        thread_id = ""
        if isinstance(context, dict):
            thread_id = str(context.get("thread_id") or context.get("threadId") or "").strip()
        if thread_id:
            return f"{user_id}:thread_id:{thread_id}"
        return f"{user_id}:default"

    async def has_active_creation_session(self, *, user_id: str, session_key: str):
        self.check_calls.append((user_id, session_key))
        return (user_id, session_key) in self._active_pairs


def _install_fake_ai_provider(monkeypatch, fake_middleware: _FakeIntentMiddleware) -> None:
    fake_module = types.ModuleType("app.gateway.api.ai_provider")
    fake_module._INTENT_RECOGNITION_MIDDLEWARE = fake_middleware
    monkeypatch.setitem(sys.modules, "app.gateway.api.ai_provider", fake_module)


def test_create_novel_blocks_when_same_user_same_session_has_active_creation(monkeypatch):
    active_pair = ("user-1", "user-1:thread_id:thread-1")
    fake_middleware = _FakeIntentMiddleware(active_pairs={active_pair})
    _install_fake_ai_provider(monkeypatch, fake_middleware)

    async def _should_not_call_post_json(*args, **kwargs):
        raise AssertionError("post_json should not be called when session gate is active")

    monkeypatch.setattr(novel_tools, "post_json", _should_not_call_post_json)

    result = asyncio.run(
        novel_tools.create_novel.coroutine(
            title="星海回声",
            genre="科幻",
            description="",
            config={"configurable": {"user_id": "user-1", "thread_id": "thread-1"}},
        )
    )

    assert result["success"] is False
    assert result["source"] == "session_gate"
    assert result["error"] == "active_creation_session"
    assert fake_middleware.check_calls == [active_pair]


def test_create_novel_not_blocked_for_different_user(monkeypatch):
    fake_middleware = _FakeIntentMiddleware(active_pairs={("user-1", "user-1:thread_id:thread-1")})
    _install_fake_ai_provider(monkeypatch, fake_middleware)

    async def _disable_internal_project(*args, **kwargs):
        raise RuntimeError("force http fallback in test")

    async def _disable_internal_legacy(*args, **kwargs):
        raise RuntimeError("force http fallback in test")

    monkeypatch.setattr(novel_tools, "_create_project_via_internal", _disable_internal_project)
    monkeypatch.setattr(novel_tools, "_create_legacy_via_internal", _disable_internal_legacy)

    async def _fake_post_json(url: str, payload: dict, **kwargs):
        if url.endswith("/projects"):
            return {"id": "proj-1", "title": payload["title"], "genre": payload["genre"]}
        if url.endswith("/api/novels"):
            return {
                "id": payload.get("id") or "proj-1",
                "title": payload["title"],
                "metadata": payload.get("metadata", {}),
            }
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(novel_tools, "post_json", _fake_post_json)

    result = asyncio.run(
        novel_tools.create_novel.coroutine(
            title="新项目",
            genre="悬疑",
            description="",
            config={"configurable": {"user_id": "user-2", "thread_id": "thread-1"}},
        )
    )

    assert result["success"] is True
    assert result["source"] == "novel_migrated.projects"
    assert result["id"] == "proj-1"
    assert result.get("legacy_sync", {}).get("status") in {"completed", "queued"}
    assert "progress" in result
    assert "stages" in result["progress"]
    assert fake_middleware.check_calls == [("user-2", "user-2:thread_id:thread-1")]


def test_create_novel_fail_open_when_missing_user_context(monkeypatch, caplog):
    fake_middleware = _FakeIntentMiddleware(active_pairs={("user-1", "user-1:thread_id:thread-1")})
    _install_fake_ai_provider(monkeypatch, fake_middleware)

    async def _disable_internal_project(*args, **kwargs):
        raise RuntimeError("force http fallback in test")

    async def _disable_internal_legacy(*args, **kwargs):
        raise RuntimeError("force http fallback in test")

    monkeypatch.setattr(novel_tools, "_create_project_via_internal", _disable_internal_project)
    monkeypatch.setattr(novel_tools, "_create_legacy_via_internal", _disable_internal_legacy)

    async def _fake_post_json(url: str, payload: dict, **kwargs):
        if url.endswith("/api/novels"):
            return {
                "id": payload.get("id") or "proj-2",
                "title": payload["title"],
                "metadata": payload.get("metadata", {}),
            }
        return {"id": "proj-2", "title": payload["title"], "genre": payload["genre"]}

    monkeypatch.setattr(novel_tools, "post_json", _fake_post_json)
    caplog.set_level(logging.WARNING)

    result = asyncio.run(
        novel_tools.create_novel.coroutine(
            title="缺用户上下文",
            genre="科幻",
            description="",
            config={"configurable": {"thread_id": "thread-1"}},
        )
    )

    assert result["success"] is True
    assert result["source"] == "novel_migrated.projects"
    assert fake_middleware.check_calls == []
    assert "progress" in result
    assert any("missing user/session context" in record.getMessage() for record in caplog.records)


def test_create_novel_resolves_context_from_helper_key_set(monkeypatch):
    fake_middleware = _FakeIntentMiddleware(active_pairs=set())
    _install_fake_ai_provider(monkeypatch, fake_middleware)

    async def _disable_internal_project(*args, **kwargs):
        raise RuntimeError("force http fallback in test")

    async def _disable_internal_legacy(*args, **kwargs):
        raise RuntimeError("force http fallback in test")

    monkeypatch.setattr(novel_tools, "_create_project_via_internal", _disable_internal_project)
    monkeypatch.setattr(novel_tools, "_create_legacy_via_internal", _disable_internal_legacy)

    async def _fake_post_json(url: str, payload: dict, **kwargs):
        if url.endswith("/projects"):
            return {"id": "proj-3", "title": payload["title"], "genre": payload["genre"]}
        if url.endswith("/api/novels"):
            return {"id": "proj-3", "title": payload["title"], "metadata": {"genre": payload.get("metadata", {}).get("genre", "")}}
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(novel_tools, "post_json", _fake_post_json)

    result = asyncio.run(
        novel_tools.create_novel.coroutine(
            title="上下文键兼容",
            genre="都市",
            description="",
            config={"context": {"userId": "user-3", "threadId": "thread-9"}},
        )
    )

    assert result["success"] is True
    assert "progress" in result
    assert fake_middleware.check_calls == [("user-3", "user-3:thread_id:thread-9")]


def test_create_novel_prefers_internal_direct_path(monkeypatch):
    fake_middleware = _FakeIntentMiddleware(active_pairs=set())
    _install_fake_ai_provider(monkeypatch, fake_middleware)

    async def _fake_internal_project(*args, **kwargs):
        return {"id": "proj-internal-1", "title": "内部直连", "genre": "科幻"}

    async def _fake_internal_legacy(payload: dict):
        return {
            "id": payload.get("id") or "proj-internal-1",
            "title": payload.get("title", ""),
            "metadata": payload.get("metadata", {}),
        }

    async def _should_not_call_post_json(*args, **kwargs):
        raise AssertionError("post_json should not be called when internal path is available")

    monkeypatch.setattr(novel_tools, "_create_project_via_internal", _fake_internal_project)
    monkeypatch.setattr(novel_tools, "_create_legacy_via_internal", _fake_internal_legacy)
    monkeypatch.setattr(novel_tools, "post_json", _should_not_call_post_json)

    result = asyncio.run(
        novel_tools.create_novel.coroutine(
            title="内部直连优先",
            genre="科幻",
            description="",
            config={"configurable": {"user_id": "user-9", "thread_id": "thread-9"}},
        )
    )

    assert result["success"] is True
    assert result["source"] == "novel_migrated.projects"
    assert result.get("source_detail") == "internal"
    assert result["id"] == "proj-internal-1"
    assert result.get("legacy_sync", {}).get("status") == "completed"


def test_create_novel_retries_modern_http_path(monkeypatch):
    fake_middleware = _FakeIntentMiddleware(active_pairs=set())
    _install_fake_ai_provider(monkeypatch, fake_middleware)

    async def _disable_internal_project(*args, **kwargs):
        raise RuntimeError("force modern internal failure")

    async def _fake_internal_legacy(payload: dict):
        return {
            "id": payload.get("id") or "proj-retry-1",
            "title": payload.get("title", ""),
            "metadata": payload.get("metadata", {}),
        }

    modern_http_attempts = 0
    allow_route_fallback_flags: list[bool] = []

    async def _flaky_post_json(url: str, payload: dict, **kwargs):
        nonlocal modern_http_attempts
        allow_route_fallback_flags.append(bool(kwargs.get("allow_route_fallback")))

        if url.endswith("/projects"):
            modern_http_attempts += 1
            if modern_http_attempts == 1:
                raise RuntimeError("temporary modern http failure")
            return {
                "id": "proj-retry-1",
                "title": payload["title"],
                "genre": payload["genre"],
            }

        if url.endswith("/api/novels"):
            return {
                "id": payload.get("id") or "proj-retry-1",
                "title": payload["title"],
                "metadata": payload.get("metadata", {}),
            }
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(novel_tools, "_create_project_via_internal", _disable_internal_project)
    monkeypatch.setattr(novel_tools, "_create_legacy_via_internal", _fake_internal_legacy)
    monkeypatch.setattr(novel_tools, "post_json", _flaky_post_json)
    monkeypatch.setenv("DEERFLOW_CREATE_NOVEL_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("DEERFLOW_CREATE_NOVEL_RETRY_BACKOFF_MS", "0")

    result = asyncio.run(
        novel_tools.create_novel.coroutine(
            title="重试项目",
            genre="科幻",
            description="",
            config={"configurable": {"user_id": "user-10", "thread_id": "thread-10"}},
        )
    )

    assert result["success"] is True
    assert result["source"] == "novel_migrated.projects"
    assert result["id"] == "proj-retry-1"
    assert modern_http_attempts == 2
    assert all(allow_route_fallback_flags)
