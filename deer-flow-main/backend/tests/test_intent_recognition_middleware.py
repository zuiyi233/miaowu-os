from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace

from app.gateway.middleware.intent_recognition_middleware import (
    IntentRecognitionMiddleware,
    IntentRecognitionResult,
    _NovelCreationSession,
    _PendingAction,
)
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


def test_detect_management_intent_supports_english_action_entity():
    middleware = IntentRecognitionMiddleware()
    hit = middleware._detect_novel_management_intent("Please delete chapter 3 in this project")
    assert hit is True


def test_detect_management_intent_avoids_projector_false_positive():
    middleware = IntentRecognitionMiddleware()
    hit = middleware._detect_novel_management_intent("please update the projector brightness")
    assert hit is False


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
    assert "请告诉我" in result.content
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
        lambda force_refresh=False, session=None, user_id=None: [
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


def test_load_enabled_novel_skills_uses_three_layer_governance_when_feature_on(monkeypatch, tmp_path):
    middleware = IntentRecognitionMiddleware()

    skill_a_file = tmp_path / "skill-a.md"
    skill_a_file.write_text("plot planning for mystery novel", encoding="utf-8")
    skill_b_file = tmp_path / "skill-b.md"
    skill_b_file.write_text("character relationship design", encoding="utf-8")

    class _FakeSkill:
        def __init__(self, name: str, description: str, skill_file, category: str = "public"):
            self.name = name
            self.description = description
            self.skill_file = skill_file
            self.category = category

    fake_skills = [
        _FakeSkill("plot-skill", "剧情规划", skill_a_file),
        _FakeSkill("character-skill", "角色关系", skill_b_file),
    ]

    class _FakeExtensionsConfig:
        def is_skill_enabled(self, skill_name: str, skill_category: str) -> bool:
            assert skill_category == "public"
            return True

        def is_feature_enabled_for_user(self, feature_name: str, *, user_id: str | None, default: bool = True) -> bool:
            assert feature_name == "intent_skill_governance"
            assert user_id == "governance-user"
            return True

    monkeypatch.setattr(
        "app.gateway.middleware.intent_recognition_middleware.load_skills",
        lambda enabled_only=False: fake_skills,
    )
    monkeypatch.setattr(
        "app.gateway.middleware.intent_recognition_middleware.ExtensionsConfig.from_file",
        lambda: _FakeExtensionsConfig(),
    )
    monkeypatch.setattr(
        middleware,
        "_derive_session_candidate_skills",
        lambda *, all_entries, session: ["character-skill"],
    )
    monkeypatch.setattr(
        middleware,
        "_get_create_session_skill_whitelist",
        lambda: {"character-skill"},
    )

    session = _NovelCreationSession(
        session_key="governance-session",
        user_id="governance-user",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        mode="create",
        fields={"theme": "角色冲突"},
    )
    result = middleware._load_enabled_novel_skills(
        force_refresh=True,
        session=session,
        user_id=session.user_id,
    )

    assert [item["name"] for item in result] == ["character-skill"]


def test_load_enabled_novel_skills_applies_create_session_whitelist(monkeypatch, tmp_path):
    middleware = IntentRecognitionMiddleware()

    skill_a_file = tmp_path / "skill-a.md"
    skill_a_file.write_text("novel writing guidance", encoding="utf-8")
    skill_b_file = tmp_path / "skill-b.md"
    skill_b_file.write_text("chapter architecture and pacing", encoding="utf-8")
    skill_c_file = tmp_path / "skill-c.md"
    skill_c_file.write_text("generic assistant skill", encoding="utf-8")

    class _FakeSkill:
        def __init__(self, name: str, description: str, skill_file, category: str = "public"):
            self.name = name
            self.description = description
            self.skill_file = skill_file
            self.category = category

    fake_skills = [
        _FakeSkill("novel-control-station", "小说控制台", skill_a_file),
        _FakeSkill("novel-creation-skill", "小说创作", skill_b_file),
        _FakeSkill("generic-skill", "通用技能", skill_c_file),
    ]

    class _FakeExtensionsConfig:
        @staticmethod
        def is_skill_enabled(skill_name: str, skill_category: str) -> bool:
            assert skill_category == "public"
            return True

    monkeypatch.setattr(
        "app.gateway.middleware.intent_recognition_middleware.load_skills",
        lambda enabled_only=False: fake_skills,
    )
    monkeypatch.setattr(
        "app.gateway.middleware.intent_recognition_middleware.ExtensionsConfig.from_file",
        lambda: _FakeExtensionsConfig(),
    )
    monkeypatch.setattr(
        middleware,
        "_get_create_session_skill_whitelist",
        lambda: {"novel-control-station", "novel-creation-skill"},
    )

    session = _NovelCreationSession(
        session_key="create-whitelist-session",
        user_id="create-whitelist-user",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        mode="create",
    )
    result = middleware._load_enabled_novel_skills(
        force_refresh=True,
        session=session,
        user_id=session.user_id,
    )

    assert [item["name"] for item in result] == ["novel-control-station", "novel-creation-skill"]


def test_load_enabled_novel_skills_manage_session_not_limited_by_create_whitelist(monkeypatch, tmp_path):
    middleware = IntentRecognitionMiddleware()

    skill_a_file = tmp_path / "skill-a.md"
    skill_a_file.write_text("novel writing guidance", encoding="utf-8")
    skill_b_file = tmp_path / "skill-b.md"
    skill_b_file.write_text("chapter architecture and pacing", encoding="utf-8")
    skill_c_file = tmp_path / "skill-c.md"
    skill_c_file.write_text("generic assistant skill", encoding="utf-8")

    class _FakeSkill:
        def __init__(self, name: str, description: str, skill_file, category: str = "public"):
            self.name = name
            self.description = description
            self.skill_file = skill_file
            self.category = category

    fake_skills = [
        _FakeSkill("novel-control-station", "小说控制台", skill_a_file),
        _FakeSkill("novel-creation-skill", "小说创作", skill_b_file),
        _FakeSkill("generic-skill", "通用技能", skill_c_file),
    ]

    class _FakeExtensionsConfig:
        @staticmethod
        def is_skill_enabled(skill_name: str, skill_category: str) -> bool:
            assert skill_category == "public"
            return True

    monkeypatch.setattr(
        "app.gateway.middleware.intent_recognition_middleware.load_skills",
        lambda enabled_only=False: fake_skills,
    )
    monkeypatch.setattr(
        "app.gateway.middleware.intent_recognition_middleware.ExtensionsConfig.from_file",
        lambda: _FakeExtensionsConfig(),
    )
    monkeypatch.setattr(
        middleware,
        "_get_create_session_skill_whitelist",
        lambda: {"novel-control-station", "novel-creation-skill"},
    )

    session = _NovelCreationSession(
        session_key="manage-whitelist-session",
        user_id="manage-whitelist-user",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        mode="manage",
    )
    result = middleware._load_enabled_novel_skills(
        force_refresh=True,
        session=session,
        user_id=session.user_id,
    )

    result_names = [item["name"] for item in result]
    assert "generic-skill" in result_names
    assert "novel-control-station" in result_names


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

    same_user_hit = asyncio.run(middleware.has_active_creation_session(user_id=user_id, session_key=session_key))
    other_user_hit = asyncio.run(middleware.has_active_creation_session(user_id="gate-user-b", session_key=session_key))
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

    hit = asyncio.run(middleware.has_active_creation_session(user_id=user_id, session_key=session_key))

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


def test_manage_session_returns_action_protocol_for_missing_slots(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-missing",
        user_id="user-6",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        active_project_id="proj-1",
        active_project_title="测试项目",
        idempotency_key="idem-manage-missing",
    )

    async def _fake_resolve_chapter(*args, **kwargs):
        return None

    monkeypatch.setattr(middleware, "_resolve_chapter_from_text", _fake_resolve_chapter)

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="修改第3章",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is True
    assert result.session is not None
    protocol = result.session["action_protocol"]
    assert protocol["action_type"] == "update_chapter"
    assert "chapter_selector" in protocol["missing_slots"]
    assert "chapter_updates" in protocol["missing_slots"]
    assert protocol["confirmation_required"] is False
    assert protocol["execution_mode"]["status"] in {"readonly", "execution_mode_active"}
    assert protocol["pending_action"]["action_type"] == "update_chapter"


def test_manage_confirmation_step_exposes_confirmation_required_in_protocol(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    action = _PendingAction(
        action="update_chapter",
        entity="chapter",
        operation="update",
        project_id="proj-2",
        target_id="chapter-2",
        target_label="第2章",
        payload={"content": "新的正文"},
    )
    session = _NovelCreationSession(
        session_key="manage-confirm",
        user_id="user-7",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        active_project_id="proj-2",
        active_project_title="测试项目2",
        pending_action=action,
        idempotency_key="idem-manage-confirm",
    )

    async def _noop_merge_pending_action(*args, **kwargs):
        return None

    monkeypatch.setattr(middleware, "_merge_pending_action_from_message", _noop_merge_pending_action)

    result = asyncio.run(
        middleware._handle_manage_confirmation_step(
            session=session,
            user_message="请再确认一次",
            lowered="请再确认一次",
            db_session=object(),
        )
    )

    assert result.handled is True
    assert result.session is not None
    protocol = result.session["action_protocol"]
    assert protocol["action_type"] == "update_chapter"
    assert protocol["missing_slots"] == []
    assert protocol["confirmation_required"] is True
    assert protocol["execution_mode"]["status"] == "awaiting_authorization"
    assert protocol["pending_action"]["action_type"] == "update_chapter"


def test_execute_pending_action_returns_execute_result_in_protocol(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    action = _PendingAction(
        action="update_chapter",
        entity="chapter",
        operation="update",
        project_id="proj-3",
        target_id="chapter-3",
        target_label="第3章",
        payload={"content": "更新后的章节内容"},
    )
    session = _NovelCreationSession(
        session_key="manage-execute",
        user_id="user-8",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        active_project_id="proj-3",
        active_project_title="测试项目3",
        pending_action=action,
        idempotency_key="idem-manage-execute",
    )

    async def _consume_once(*args, **kwargs):
        return True

    async def _fake_dispatch_manage_action(*args, **kwargs):
        return {"id": "chapter-3", "updated": True}

    monkeypatch.setattr(middleware, "_consume_idempotency_key", _consume_once)
    monkeypatch.setattr(middleware, "_dispatch_manage_action", _fake_dispatch_manage_action)

    result = asyncio.run(
        middleware._execute_pending_action(
            session=session,
            db_session=object(),
        )
    )

    assert result.handled is True
    assert result.session is not None
    protocol = result.session["action_protocol"]
    assert protocol["action_type"] == "update_chapter"
    assert protocol["execute_result"]["status"] == "success"
    assert protocol["execute_result"]["target_id"] == "chapter-3"
    assert protocol["execution_mode"]["status"] in {"readonly", "execution_mode_active"}
    assert protocol["pending_action"]["action_type"] == "update_chapter"


def test_extract_character_payload_writes_relationships_field(monkeypatch):
    middleware = IntentRecognitionMiddleware()

    payload = middleware._extract_character_create_payload("角色名为林彻，关系描述：与周舟是搭档")

    assert payload.get("relationships") == "与周舟是搭档"
    assert "relationships_text" not in payload


class _RollbackTrackingSession:
    def __init__(self, *, in_transaction: bool = True) -> None:
        self._in_transaction = in_transaction
        self.rollback_calls = 0

    def in_transaction(self) -> bool:
        return self._in_transaction

    async def rollback(self) -> None:
        self.rollback_calls += 1


def test_execute_pending_action_rolls_back_session_on_dispatch_error(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    action = _PendingAction(
        action="update_chapter",
        entity="chapter",
        operation="update",
        project_id="proj-rollback",
        target_id="chapter-rollback",
        payload={"content": "boom"},
    )
    session = _NovelCreationSession(
        session_key="manage-rollback",
        user_id="user-rollback",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        active_project_id="proj-rollback",
        active_project_title="回滚测试项目",
        pending_action=action,
        idempotency_key="idem-manage-rollback",
    )

    async def _consume_once(*args, **kwargs):
        return True

    async def _failing_dispatch(*args, **kwargs):
        raise RuntimeError("db write failed")

    db_session = _RollbackTrackingSession(in_transaction=True)
    monkeypatch.setattr(middleware, "_consume_idempotency_key", _consume_once)
    monkeypatch.setattr(middleware, "_dispatch_manage_action", _failing_dispatch)

    result = asyncio.run(
        middleware._execute_pending_action(
            session=session,
            db_session=db_session,
        )
    )

    assert result.handled is True
    assert "执行失败" in result.content
    assert db_session.rollback_calls == 1


def test_creation_confirmation_auto_executes_after_execution_mode_enabled(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="create-auto-exec-enabled",
        user_id="user-create-auto-exec",
        mode="create",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields(
            {
                "title": "星海回声",
                "genre": "科幻",
                "theme": "文明冲突",
                "audience": "青少年",
                "target_words": 180000,
            }
        ),
        awaiting_confirm=True,
        idempotency_key="idem-create-auto-exec",
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        confirmation_required=False,
    )

    async def _fake_finalize_creation(*, session: _NovelCreationSession, db_session: object | None):
        return IntentRecognitionResult(
            handled=True,
            content="自动执行完成",
            session=middleware._session_brief(session),
        )

    monkeypatch.setattr(middleware, "_finalize_creation", _fake_finalize_creation)

    result = asyncio.run(
        middleware._handle_creation_confirmation_step(
            session=session,
            user_message="可以，不用讨论了，直接帮我创建。",
            lowered="可以，不用讨论了，直接帮我创建。",
            db_session=object(),
            ai_service=None,
        )
    )

    assert result.handled is True
    assert result.content == "自动执行完成"


def test_manage_session_question_priority_returns_not_handled():
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-question-priority",
        user_id="user-question",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        active_project_id="proj-question",
        active_project_title="问答项目",
        idempotency_key="idem-question-priority",
    )

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="灵石体系如何运作？",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is False


def test_manage_session_structured_enter_execution_mode_signal():
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-structured-enter-mode",
        user_id="user-structured-enter",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        active_project_id="proj-structured-enter",
        active_project_title="结构化授权项目",
    )

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="__enter_execution_mode__",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is True
    assert session.execution_gate["execution_mode"] is True
    assert session.execution_gate["status"] == "execution_mode_active"


def test_manage_session_structured_exit_execution_mode_signal():
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-structured-exit-mode",
        user_id="user-structured-exit",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        active_project_id="proj-structured-exit",
        active_project_title="结构化撤销项目",
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        pending_action=None,
        confirmation_required=False,
    )

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="__exit_execution_mode__",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is True
    assert session.execution_gate["execution_mode"] is False
    assert session.execution_gate["status"] == "revoked"


def test_manage_session_exit_execution_mode_keeps_pending_confirmation():
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-structured-exit-keep-pending",
        user_id="user-structured-exit-keep-pending",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        pending_action=_PendingAction(
            action="update_chapter",
            entity="chapter",
            operation="update",
            project_id="proj-structured-exit-keep-pending",
            target_id="chapter-keep",
            payload={"content": "待确认"},
        ),
        active_project_id="proj-structured-exit-keep-pending",
        active_project_title="结构化撤销保留动作",
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        confirmation_required=True,
    )

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="__exit_execution_mode__",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is True
    assert session.awaiting_confirm is True
    assert session.pending_action is not None
    assert session.execution_gate["execution_mode"] is False
    assert session.execution_gate["status"] == "revoked"


def test_manage_confirmation_exit_execution_mode_keeps_pending_action():
    middleware = IntentRecognitionMiddleware()
    action = _PendingAction(
        action="update_chapter",
        entity="chapter",
        operation="update",
        project_id="proj-exit-keep-pending",
        target_id="chapter-9",
        payload={"content": "待执行内容"},
    )
    session = _NovelCreationSession(
        session_key="manage-exit-keep-pending",
        user_id="user-exit-keep-pending",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        pending_action=action,
        active_project_id="proj-exit-keep-pending",
        active_project_title="退出授权保留动作",
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        confirmation_required=True,
    )

    result = asyncio.run(
        middleware._handle_manage_confirmation_step(
            session=session,
            user_message="__exit_execution_mode__",
            lowered="__exit_execution_mode__",
            db_session=object(),
        )
    )

    assert result.handled is True
    assert session.awaiting_confirm is True
    assert session.pending_action is not None
    assert session.execution_gate["execution_mode"] is False
    assert session.execution_gate["status"] == "revoked"


def test_create_confirmation_cancel_keeps_execution_mode_state(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="create-cancel-keep-mode",
        user_id="user-create-cancel",
        mode="create",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields(
            {
                "title": "星海回声",
                "genre": "科幻",
                "theme": "文明冲突",
                "audience": "青少年",
                "target_words": 180000,
            }
        ),
        awaiting_confirm=True,
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        confirmation_required=True,
    )

    result = asyncio.run(
        middleware._handle_creation_confirmation_step(
            session=session,
            user_message="__cancel_action__",
            lowered="__cancel_action__",
            db_session=object(),
            ai_service=None,
        )
    )

    assert result.handled is True
    assert session.awaiting_confirm is False
    assert session.execution_gate["execution_mode"] is True
    assert session.execution_gate["status"] == "execution_mode_active"


def test_manage_session_confirmation_flow_accepts_polite_direct_execute_phrase():
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-direct-exec-polite",
        user_id="user-direct-exec",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        active_project_id="proj-direct-exec",
        active_project_title="待确认项目",
        pending_action=_PendingAction(
            action="update_chapter",
            entity="chapter",
            operation="update",
            project_id="proj-direct-exec",
            target_id="chapter-1",
            target_label="第一章",
            payload={"content": "新的章节内容"},
        ),
        idempotency_key="idem-direct-exec-polite",
    )

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="可以，不用讨论了，直接帮我创建。",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is True
    assert result.session is not None
    protocol = result.session["action_protocol"]
    assert protocol["confirmation_required"] is True
    assert protocol["action_type"] == "update_chapter"
    assert isinstance(protocol.get("decision"), dict)
    assert isinstance(protocol.get("ui_hints"), dict)


def test_manage_confirmation_enter_execution_mode_executes_pending_action(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    action = _PendingAction(
        action="update_chapter",
        entity="chapter",
        operation="update",
        project_id="proj-exec-mode",
        target_id="chapter-exec-mode",
        target_label="第5章",
        payload={"content": "已授权执行"},
    )
    session = _NovelCreationSession(
        session_key="manage-enter-execution-mode",
        user_id="user-exec-mode",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        awaiting_confirm=True,
        active_project_id="proj-exec-mode",
        active_project_title="执行模式项目",
        pending_action=action,
        idempotency_key="idem-exec-mode",
    )

    captured: dict[str, object] = {}

    async def _fake_execute_pending_action(*, session: _NovelCreationSession, db_session: object):
        captured["gate"] = dict(session.execution_gate)
        return IntentRecognitionResult(
            handled=True,
            content="执行成功",
            session=middleware._session_brief(session),
        )

    monkeypatch.setattr(middleware, "_execute_pending_action", _fake_execute_pending_action)

    result = asyncio.run(
        middleware._handle_manage_confirmation_step(
            session=session,
            user_message="进入执行模式",
            lowered="进入执行模式",
            db_session=object(),
        )
    )

    assert result.handled is True
    gate = captured["gate"]
    assert gate["execution_mode"] is True
    assert gate["status"] == "execution_mode_active"


def test_manage_session_executes_next_action_directly_when_execution_mode_active(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-exec-direct",
        user_id="user-exec-direct",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        active_project_id="proj-exec-direct",
        active_project_title="直通执行项目",
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        pending_action=None,
        confirmation_required=False,
    )

    async def _fake_build(*, session: _NovelCreationSession, user_message: str, db_session: object):
        assert "第1章" in user_message
        return _PendingAction(
            action="update_chapter",
            entity="chapter",
            operation="update",
            project_id=session.active_project_id,
            target_id="chapter-direct-1",
            target_label="第1章",
            payload={"content": "执行模式直通更新"},
        )

    async def _fake_dispatch_manage_action(*, action: _PendingAction, session: _NovelCreationSession, db_session: object):
        assert action.action == "update_chapter"
        return {"id": action.target_id, "updated": True}

    monkeypatch.setattr(middleware._manage_action_router, "build", _fake_build)
    monkeypatch.setattr(middleware, "_dispatch_manage_action", _fake_dispatch_manage_action)

    result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="把第1章正文改成最新版本",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert result.handled is True
    assert "已完成操作：update_chapter" in result.content
    assert result.session is not None
    protocol = result.session["action_protocol"]
    assert protocol["confirmation_required"] is False
    assert protocol["execute_result"]["status"] == "success"
    assert protocol["execution_mode"]["status"] == "execution_mode_active"


def test_manage_session_revoke_then_requires_authorization_again(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="manage-revoke-then-block",
        user_id="user-revoke-then-block",
        mode="manage",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        fields=middleware._initialize_fields({}),
        active_project_id="proj-revoke-then-block",
        active_project_title="撤销授权项目",
    )
    middleware._set_execution_gate(
        session,
        status="execution_mode_active",
        execution_mode=True,
        pending_action=None,
        confirmation_required=False,
    )

    revoke_result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="退出执行模式",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert revoke_result.handled is True
    assert session.execution_gate["execution_mode"] is False
    assert session.execution_gate["status"] == "revoked"

    async def _fake_build(*, session: _NovelCreationSession, user_message: str, db_session: object):
        assert "第2章" in user_message
        return _PendingAction(
            action="update_chapter",
            entity="chapter",
            operation="update",
            project_id=session.active_project_id,
            target_id="chapter-revoke-2",
            target_label="第2章",
            payload={"content": "撤销后应二次确认"},
        )

    monkeypatch.setattr(middleware._manage_action_router, "build", _fake_build)

    blocked_result = asyncio.run(
        middleware._handle_manage_session(
            session=session,
            user_message="把第2章改一下",
            db_session=object(),
            ai_service=None,
            opening=False,
        )
    )

    assert blocked_result.handled is True
    assert blocked_result.session is not None
    protocol = blocked_result.session["action_protocol"]
    assert protocol["confirmation_required"] is True
    assert protocol["execution_mode"]["status"] == "awaiting_authorization"
    assert protocol["pending_action"]["action_type"] == "update_chapter"
