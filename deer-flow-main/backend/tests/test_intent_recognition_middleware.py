from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.gateway.middleware.intent_recognition_middleware import IntentRecognitionMiddleware
from app.gateway.novel_migrated.api.import_export import build_export_download_path


class _FakeAiService:
    async def generate_text_with_messages(self, *args, **kwargs):
        return {"content": "建议1：科幻\n建议2：悬疑\n建议3：奇幻"}


def _request_with_message(message: str, *, thread_id: str = "t-1"):
    return SimpleNamespace(
        messages=[SimpleNamespace(role="user", content=message)],
        context={"thread_id": thread_id},
        stream=False,
    )


def test_detect_intent_extracts_prefill_fields():
    middleware = IntentRecognitionMiddleware()

    intent = middleware._detect_novel_creation_intent("请帮我创建一部名为《星际迷航》的科幻小说，目标20万字")

    assert intent is not None
    assert intent.prefill["title"] == "星际迷航"
    assert intent.prefill["genre"] == "科幻"
    assert intent.prefill["target_words"] == 200000


def test_detect_intent_ignores_how_to_question():
    middleware = IntentRecognitionMiddleware()

    intent = middleware._detect_novel_creation_intent("怎么创建小说项目？")

    assert intent is None


def test_process_request_returns_not_handled_for_normal_chat():
    middleware = IntentRecognitionMiddleware()
    request = _request_with_message("你好，今天天气怎么样")

    result = asyncio.run(
        middleware.process_request(
            request=request,
            user_id="user-1",
            db_session=None,
        )
    )

    assert result.handled is False


def test_process_request_starts_session_without_persisting(monkeypatch):
    middleware = IntentRecognitionMiddleware()

    called = {"count": 0}

    async def _fake_create(*args, **kwargs):
        called["count"] += 1
        return {"id": "novel-1", "title": "x", "genre": "科幻"}

    monkeypatch.setattr(middleware, "_create_with_modern_projects", _fake_create)

    result = asyncio.run(
        middleware.process_request(
            request=_request_with_message("请创建一本小说", thread_id="s-1"),
            user_id="user-2",
            db_session=object(),
            ai_service=_FakeAiService(),
        )
    )

    assert result.handled is True
    assert "请告诉我这本小说的书名" in result.content
    assert called["count"] == 0


def test_session_collects_fields_then_confirms_and_creates(monkeypatch):
    middleware = IntentRecognitionMiddleware()

    async def _fake_create(*args, **kwargs):
        session = kwargs["session"]
        assert session.fields["title"] == "星海回声"
        assert session.fields["genre"] == "科幻"
        assert session.fields["theme"] == "文明冲突"
        assert session.fields["audience"] == "青少年"
        assert session.fields["target_words"] == 180000
        return {
            "id": "novel-123",
            "title": "星海回声",
            "genre": "科幻",
            "theme": "文明冲突",
            "target_words": 180000,
            "source": "novel_migrated.projects",
        }

    monkeypatch.setattr(middleware, "_create_with_modern_projects", _fake_create)

    steps = [
        "请创建一本小说",
        "星海回声",
        "科幻",
        "主题是文明冲突",
        "面向青少年",
        "18万字",
    ]

    for text in steps:
        result = asyncio.run(
            middleware.process_request(
                request=_request_with_message(text, thread_id="s-2"),
                user_id="user-3",
                db_session=object(),
                ai_service=_FakeAiService(),
            )
        )

    assert result.handled is True
    assert "请确认创建信息" in result.content

    confirm_result = asyncio.run(
        middleware.process_request(
            request=_request_with_message("确认创建", thread_id="s-2"),
            user_id="user-3",
            db_session=object(),
            ai_service=_FakeAiService(),
        )
    )

    assert confirm_result.handled is True
    assert confirm_result.novel is not None
    assert confirm_result.novel["id"] == "novel-123"
    assert confirm_result.tool_calls[0]["name"] == "create_novel"


def test_session_can_return_skill_guidance(monkeypatch):
    middleware = IntentRecognitionMiddleware()

    # Start session first
    asyncio.run(
        middleware.process_request(
            request=_request_with_message("创建一本小说", thread_id="skill-s"),
            user_id="user-4",
            db_session=None,
            ai_service=_FakeAiService(),
        )
    )

    result = asyncio.run(
        middleware.process_request(
            request=_request_with_message("技能推荐", thread_id="skill-s"),
            user_id="user-4",
            db_session=None,
            ai_service=_FakeAiService(),
        )
    )

    assert result.handled is True
    assert "技能建议" in result.content


def test_session_auto_uses_enabled_skills_without_manual_trigger(monkeypatch):
    middleware = IntentRecognitionMiddleware()

    monkeypatch.setattr(
        middleware,
        "_load_enabled_novel_skills",
        lambda force_refresh=False: [
            {
                "name": "novel-plot-skill",
                "description": "剧情设计",
                "snippet": "强调冲突与角色目标",
            }
        ],
    )

    result = asyncio.run(
        middleware.process_request(
            request=_request_with_message("创建一本小说", thread_id="auto-skill"),
            user_id="user-5",
            db_session=None,
            ai_service=_FakeAiService(),
        )
    )

    assert result.handled is True
    assert "技能建议" in result.content


def test_has_active_creation_session_is_scoped_by_user_and_session():
    middleware = IntentRecognitionMiddleware()
    user_id = "gate-user-a"
    thread_id = "gate-thread-a"

    asyncio.run(
        middleware.process_request(
            request=_request_with_message("请创建一本小说", thread_id=thread_id),
            user_id=user_id,
            db_session=None,
            ai_service=_FakeAiService(),
        )
    )

    session_key = middleware.build_session_key_for_context(
        user_id=user_id,
        context={"thread_id": thread_id},
    )

    same_user_hit = asyncio.run(
        middleware.has_active_creation_session(user_id=user_id, session_key=session_key)
    )
    other_user_hit = asyncio.run(
        middleware.has_active_creation_session(user_id="gate-user-b", session_key=session_key)
    )
    other_session_hit = asyncio.run(
        middleware.has_active_creation_session(
            user_id=user_id,
            session_key=middleware.build_session_key_for_context(
                user_id=user_id,
                context={"thread_id": "other-thread"},
            ),
        )
    )

    assert same_user_hit is True
    assert other_user_hit is False
    assert other_session_hit is False


def test_has_active_creation_session_hits_database_backend(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    user_id = "gate-db-user"
    thread_id = "gate-db-thread"

    asyncio.run(
        middleware.process_request(
            request=_request_with_message("请创建一本小说", thread_id=thread_id),
            user_id=user_id,
            db_session=None,
            ai_service=_FakeAiService(),
        )
    )

    session_key = middleware.build_session_key_for_context(
        user_id=user_id,
        context={"thread_id": thread_id},
    )
    cached_session = asyncio.run(middleware._get_session(session_key))
    assert cached_session is not None

    called = {"count": 0}

    async def _fake_db_get_session(key: str):
        called["count"] += 1
        if key == session_key:
            return cached_session
        return None

    async def _fake_db_prune_expired_sessions():
        return None

    monkeypatch.setattr(middleware, "_db_get_session", _fake_db_get_session)
    monkeypatch.setattr(middleware, "_db_prune_expired_sessions", _fake_db_prune_expired_sessions)
    middleware._storage_backend = "database"

    hit = asyncio.run(
        middleware.has_active_creation_session(user_id=user_id, session_key=session_key)
    )

    assert hit is True
    assert called["count"] >= 1


def test_export_project_archive_returns_real_download_path(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    project_id = "proj-export-1"

    async def _fake_get_project_model(*args, **kwargs):
        return SimpleNamespace(id=project_id)

    class _FakeExportService:
        async def export_project(self, *, project_id: str, db):
            assert project_id == "proj-export-1"
            return b"zip-content"

    monkeypatch.setattr(middleware, "_get_project_model", _fake_get_project_model)
    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.import_export_service.get_import_export_service",
        lambda: _FakeExportService(),
    )

    action = SimpleNamespace(
        action="export_project_archive",
        project_id=project_id,
        target_id=project_id,
        payload={},
    )
    session = SimpleNamespace(user_id="export-user")

    payload = asyncio.run(
        middleware._dispatch_manage_action(
            action=action,
            session=session,
            db_session=object(),
        )
    )

    assert payload["project_id"] == project_id
    assert payload["file_name"].endswith(".zip")
    assert payload["download_path"] == build_export_download_path(project_id)
