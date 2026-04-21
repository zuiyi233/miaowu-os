"""Intent recognition middleware for global AI chat routing.

This middleware provides two guided flows for /api/ai/chat:
1. Novel creation session (collect fields -> explicit confirmation -> persist)
2. Novel lifecycle management session (project/chapters/outlines/characters/
   relationships/organizations/items mapped to foreshadows)

Both flows are opt-in by intent detection and keep normal chat untouched when
no actionable intent is detected.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.gateway.observability.context import extract_trace_fields_from_context, update_trace_context
from app.gateway.observability.metrics import record_duplicate_write_intercept
from deerflow.config.extensions_config import ExtensionsConfig
from deerflow.skills import load_skills

logger = logging.getLogger(__name__)

_DEFAULT_GENRE = "科幻"
_SESSION_TTL = timedelta(hours=2)
_SKILL_CACHE_TTL = timedelta(minutes=5)
_MAX_SKILL_ENTRIES = 12
_SESSION_STORE_PATH_ENV = "DEERFLOW_INTENT_SESSION_STORE_PATH"
_SESSION_BACKEND_ENV = "DEERFLOW_INTENT_SESSION_BACKEND"
_DATABASE_STORAGE_BACKENDS = {"database", "db", "sqlite"}
_FILE_STORAGE_BACKENDS = {"file", "json"}
_SESSION_CONTEXT_KEYS: tuple[str, ...] = (
    "thread_id",
    "threadId",
    "conversation_id",
    "conversationId",
    "chat_id",
    "chatId",
    "workspace_id",
    "workspaceId",
    "session_id",
    "sessionId",
    "novel_id",
    "novelId",
    "project_id",
    "projectId",
)

_FIELD_ORDER: tuple[str, ...] = (
    "title",
    "genre",
    "theme",
    "audience",
    "target_words",
)

_FIELD_LABELS: dict[str, str] = {
    "title": "小说名字",
    "genre": "类型",
    "theme": "题材/主题",
    "audience": "目标受众",
    "target_words": "目标字数",
}

_FIELD_QUESTIONS: dict[str, str] = {
    "title": "请告诉我这本小说的书名。",
    "genre": "请告诉我小说类型（例如：科幻、玄幻、悬疑、言情）。",
    "theme": "请告诉我核心题材/主题（例如：星际殖民、校园成长、末日求生）。",
    "audience": "请告诉我目标受众（例如：青少年、女性向、硬核科幻读者）。",
    "target_words": "请告诉我目标字数（例如：20万字）。",
}

_INTENT_KEYWORDS = (
    "创建小说",
    "新建小说",
    "建立小说",
    "创建一本小说",
    "创建一部小说",
    "写一本小说",
    "写一部小说",
    "创建小说项目",
    "新建小说项目",
    "我要写小说",
    "帮我写小说",
    "create novel",
    "new novel",
    "create a novel",
    "create novel project",
)

_INTENT_PATTERNS = (
    re.compile(r"(创建|新建|建立|写|帮我写).{0,24}(小说|小说项目)"),
    re.compile(r"(create|new|write).{0,24}(novel|novel\s+project)", re.IGNORECASE),
)

_MANAGE_ENTITY_KEYWORDS = (
    "项目",
    "章节",
    "章",
    "大纲",
    "角色",
    "人物",
    "关系",
    "组织",
    "物品",
    "道具",
    "伏笔",
)

_MANAGE_ACTION_KEYWORDS = (
    "管理",
    "修改",
    "更新",
    "删除",
    "导入",
    "导出",
    "生成",
    "新增",
    "新建",
    "创建",
    "切换",
    "查看",
    "列出",
    "调整",
    "完善",
    "改",
)

_MANAGE_INTENT_PATTERNS = (
    re.compile(r"(管理|修改|更新|删除|新增|新建|切换|查看|列出|导入|导出|生成).{0,24}(项目|章节|大纲|角色|关系|组织|物品|伏笔)"),
    re.compile(r"(chapter|outline|character|relationship|project).{0,24}(update|delete|create|list|manage)", re.IGNORECASE),
)

_PROJECT_LIST_KEYWORDS = (
    "项目列表",
    "列出项目",
    "有哪些项目",
    "查看项目",
)

_PROJECT_SWITCH_KEYWORDS = (
    "切换项目",
    "选择项目",
    "进入项目",
    "使用项目",
)

_QUESTION_PREFIXES = ("怎么", "如何", "怎样", "可以", "能否", "是否", "what", "how")

_CONFIRM_KEYWORDS = {"确认", "确认创建", "确认执行", "开始创建", "创建", "提交", "yes", "y", "ok", "好的"}
_CANCEL_KEYWORDS = {"取消", "不用了", "算了", "no", "n", "停止"}
_EXIT_KEYWORDS = {"退出创建", "结束创建", "取消创建", "先不创建"}
_MANAGE_EXIT_KEYWORDS = {"退出管理", "结束管理", "取消管理", "先不管理"}
_SKILL_REQUEST_KEYWORDS = ("技能推荐", "技能建议", "调用技能", "用技能", "skill")

_GENRE_MAP: tuple[tuple[str, str], ...] = (
    ("科幻", "科幻"),
    ("sci-fi", "科幻"),
    ("玄幻", "玄幻"),
    ("奇幻", "奇幻"),
    ("仙侠", "仙侠"),
    ("武侠", "武侠"),
    ("悬疑", "悬疑"),
    ("推理", "推理"),
    ("恐怖", "恐怖"),
    ("惊悚", "恐怖"),
    ("言情", "言情"),
    ("恋爱", "言情"),
    ("都市", "都市"),
    ("历史", "历史"),
    ("校园", "校园"),
    ("末世", "末世"),
)

_TITLE_PATTERNS = (
    re.compile(r"《([^》]{1,60})》"),
    re.compile(r"(?:名为|叫做|叫|书名(?:是|为)?|标题(?:是|为)?)[\"“《]?([^\"”》\n，。,.!?]{1,60})[\"”》]?"),
)
_THEME_PATTERN = re.compile(r"(?:题材|主题|故事主题|核心设定)(?:是|为|：|:)?\s*([^，。,.!?\n]{1,80})")
_AUDIENCE_PATTERN = re.compile(r"(?:受众|读者|面向)(?:是|为|：|:)?\s*([^，。,.!?\n]{1,60})")
_TARGET_WORDS_PATTERN = re.compile(r"(\d{1,5})(\s*万)?\s*字")
_PROJECT_ID_PATTERN = re.compile(r"(?:项目ID|project_id|project id)\s*[:：]?\s*([0-9a-fA-F-]{8,})")
_CHAPTER_NO_PATTERN = re.compile(r"第\s*(\d{1,4})\s*章")
_OUTLINE_NO_PATTERN = re.compile(r"(?:第\s*)?(\d{1,4})\s*(?:条)?\s*大纲")
_POWER_LEVEL_PATTERN = re.compile(r"(?:势力值|势力等级|power\s*level)\s*(?:改成|改为|设为|为|:|：)?\s*(\d{1,3})", re.IGNORECASE)
_RELATION_PAIR_PATTERN = re.compile(r"([\u4e00-\u9fa5A-Za-z0-9_]{1,24})\s*(?:和|与|跟)\s*([\u4e00-\u9fa5A-Za-z0-9_]{1,24})")

_NOVEL_SKILL_KEYWORDS = (
    "小说",
    "写作",
    "剧情",
    "故事",
    "角色",
    "世界观",
    "大纲",
    "章节",
    "novel",
    "story",
    "writing",
    "plot",
    "character",
)

_MANAGE_FIELD_QUESTIONS: dict[str, str] = {
    "project_selector": "请先告诉我要操作哪个项目（可说项目名或项目ID）。",
    "project_updates": "请告诉我要修改项目的哪些字段（书名/类型/主题/目标字数/章节数等）。",
    "chapter_selector": "请告诉我目标章节（例如：第3章 或 章节标题）。",
    "chapter_updates": "请告诉我要修改章节的哪些内容（标题/摘要/正文/扩写计划）。",
    "chapter_create_payload": "请补充新章节信息（至少给标题或正文，例：标题《重返旧港》，正文：……）。",
    "outline_selector": "请告诉我目标大纲（例如：第2条大纲 或 大纲标题）。",
    "outline_updates": "请告诉我要修改大纲的哪些内容（标题/内容/结构）。",
    "outline_create_payload": "请补充新大纲信息（至少给标题和内容）。",
    "character_selector": "请告诉我目标角色（角色名）。",
    "character_updates": "请告诉我要修改角色的哪些信息（性格/背景/外貌/状态等）。",
    "character_create_payload": "请补充角色信息（至少给角色名）。",
    "relationship_pair": "请告诉我关系双方（例如：林彻和周舟）。",
    "relationship_name": "请告诉我关系名称（例如：师徒、敌对、盟友）。",
    "relationship_updates": "请告诉我要修改关系的哪些字段（关系名/亲密度/描述/状态）。",
    "organization_create_payload": "请补充组织信息（至少组织名，可选组织类型/目的/势力值/地点）。",
    "organization_selector": "请告诉我目标组织名称。",
    "organization_updates": "请告诉我要修改组织哪些信息（组织类型/目的/层级/势力值/地点）。",
    "organization_member_payload": "请补充组织成员信息（成员名，及可选职位/等级/忠诚度）。",
    "item_selector": "请告诉我目标物品名称。",
    "item_create_payload": "请补充物品信息（至少名称+描述）。",
    "item_updates": "请告诉我要修改物品的哪些信息（名称/描述/标签等）。",
}


@dataclass
class IntentRecognitionResult:
    handled: bool
    content: str = ""
    tool_calls: list[dict[str, Any]] | None = None
    novel: dict[str, Any] | None = None
    session: dict[str, Any] | None = None


@dataclass
class _NovelCreateIntent:
    raw_message: str
    prefill: dict[str, Any] = field(default_factory=dict)


@dataclass
class _PendingAction:
    action: str
    entity: str
    operation: str
    project_id: str | None = None
    target_id: str | None = None
    target_label: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    missing_fields: list[str] = field(default_factory=list)


@dataclass
class _NovelCreationSession:
    session_key: str
    user_id: str
    started_at: datetime
    updated_at: datetime
    mode: str = "normal"
    fields: dict[str, Any] = field(default_factory=dict)
    awaiting_confirm: bool = False
    last_prompted_field: str | None = None
    skill_suggestions: dict[str, str] = field(default_factory=dict)
    active_project_id: str | None = None
    active_project_title: str | None = None
    pending_action: _PendingAction | None = None
    idempotency_key: str | None = None


class IntentRecognitionMiddleware:
    """Guided intent recognition middleware for /api/ai/chat."""

    _INTENT_FEATURE_FLAG = "intent_recognition"

    def __init__(self) -> None:
        self._sessions: dict[str, _NovelCreationSession] = {}
        self._lock = asyncio.Lock()
        self._skills_cache_at: datetime | None = None
        self._skills_cache: list[dict[str, str]] = []
        self._skills_cache_config_mtime: float | None = None
        self._used_idempotency_keys: dict[str, datetime] = {}
        self._storage_backend = self._resolve_storage_backend()
        self._session_store_path = self._resolve_session_store_path()
        if self._storage_backend == "file":
            self._load_state_from_disk()

    async def process_request(
        self,
        request: Any,
        *,
        user_id: str,
        db_session: Any | None,
        ai_service: Any | None = None,
    ) -> IntentRecognitionResult:
        if not self._is_feature_enabled(user_id=user_id):
            return IntentRecognitionResult(handled=False)

        messages = list(getattr(request, "messages", []) or [])
        user_message = self._extract_latest_user_message(messages)
        if not user_message:
            return IntentRecognitionResult(handled=False)

        await self._prune_expired_sessions()
        await self._prune_expired_idempotency_keys()
        session_key = self._resolve_session_key(request, user_id)
        update_trace_context(
            **extract_trace_fields_from_context(getattr(request, "context", None)),
            session_key=session_key,
        )

        session = await self._get_session(session_key)
        if session is not None:
            if session.mode == "normal":
                pass
            elif session.mode == "create":
                return await self._handle_active_creation_session(
                    session=session,
                    user_message=user_message,
                    db_session=db_session,
                    ai_service=ai_service,
                )
            elif session.mode == "manage":
                return await self._handle_manage_session(
                    session=session,
                    user_message=user_message,
                    db_session=db_session,
                    ai_service=ai_service,
                    opening=False,
                )

        intent = self._detect_novel_creation_intent(user_message)
        if intent is not None:
            idem_key = self._generate_idempotency_key(user_id, "create_novel")
            session = _NovelCreationSession(
                session_key=session_key,
                user_id=user_id,
                mode="create",
                started_at=datetime.now(),
                updated_at=datetime.now(),
                fields=self._initialize_fields(intent.prefill),
                idempotency_key=idem_key,
            )
            await self._save_session(session)
            return await self._ask_next_field(
                session=session,
                ai_service=ai_service,
                opening=True,
            )

        if self._detect_novel_management_intent(user_message):
            idem_key = self._generate_idempotency_key(user_id, "manage_novel")
            session = _NovelCreationSession(
                session_key=session_key,
                user_id=user_id,
                mode="manage",
                started_at=datetime.now(),
                updated_at=datetime.now(),
                fields=self._initialize_fields({}),
                idempotency_key=idem_key,
            )
            await self._save_session(session)
            return await self._handle_manage_session(
                session=session,
                user_message=user_message,
                db_session=db_session,
                ai_service=ai_service,
                opening=True,
            )

        return IntentRecognitionResult(handled=False)

    def build_session_key_for_context(self, *, user_id: str, context: dict[str, Any] | None) -> str:
        """Build a stable session key from user and context.

        This is the public API used by external callers (e.g. tool layer) to
        avoid coupling with internal key-generation logic.
        """
        return self._resolve_session_key_from_context(context, (user_id or "").strip())

    async def has_active_creation_session(self, *, user_id: str, session_key: str) -> bool:
        """Whether the given user/session currently has an active create flow."""
        normalized_user_id = (user_id or "").strip()
        normalized_session_key = (session_key or "").strip()
        if not normalized_user_id or not normalized_session_key:
            return False

        await self._prune_expired_sessions()
        session = await self._get_session(normalized_session_key)
        if session is None:
            return False
        return session.mode == "create" and session.user_id == normalized_user_id

    def invalidate_skill_cache(self) -> None:
        """Clear middleware skill cache so updates in extensions config apply immediately."""
        self._skills_cache = []
        self._skills_cache_at = None
        self._skills_cache_config_mtime = None

    async def _handle_active_creation_session(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        db_session: Any | None,
        ai_service: Any | None,
    ) -> IntentRecognitionResult:
        normalized = user_message.strip()
        lowered = normalized.lower()

        if normalized in _EXIT_KEYWORDS or lowered in _EXIT_KEYWORDS:
            await self._remove_session(session.session_key)
            return IntentRecognitionResult(
                handled=True,
                content="已退出创建小说流程。你可以随时说“创建小说”重新开始。",
                session={"status": "cancelled", "mode": "create"},
            )

        if self._is_skill_assist_request(lowered):
            field_name = self._resolve_field_from_text(normalized) or self._next_missing_field(session)
            if field_name is None and session.awaiting_confirm:
                field_name = "theme"
            return await self._reply_with_skill_guidance(
                session=session,
                field_name=field_name or "theme",
                ai_service=ai_service,
                include_question=True,
            )

        if session.awaiting_confirm:
            return await self._handle_creation_confirmation_step(
                session=session,
                user_message=normalized,
                lowered=lowered,
                db_session=db_session,
                ai_service=ai_service,
            )

        self._update_session_fields_from_message(session, normalized)
        session.updated_at = datetime.now()
        await self._save_session(session)
        return await self._ask_next_field(session=session, ai_service=ai_service, opening=False)

    async def _handle_creation_confirmation_step(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        lowered: str,
        db_session: Any | None,
        ai_service: Any | None,
    ) -> IntentRecognitionResult:
        if lowered in _CANCEL_KEYWORDS or user_message in _CANCEL_KEYWORDS:
            session.awaiting_confirm = False
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content=(
                    "好的，已取消本次提交。"
                    "请直接告诉我你要修改的字段，例如：\n"
                    "- 书名改成《星海回声》\n"
                    "- 类型改成悬疑"
                ),
                session=self._session_brief(session),
            )

        if lowered in _CONFIRM_KEYWORDS or user_message in _CONFIRM_KEYWORDS:
            return await self._finalize_creation(session=session, db_session=db_session)

        self._update_session_fields_from_message(session, user_message)
        session.awaiting_confirm = True
        session.updated_at = datetime.now()
        await self._save_session(session)

        summary = self._build_confirmation_summary(session)
        if self._is_skill_assist_request(lowered):
            guidance = await self._generate_skill_guidance(
                session=session,
                field_name="theme",
                ai_service=ai_service,
            )
            if guidance:
                summary = f"{summary}\n\n{guidance}"

        return IntentRecognitionResult(
            handled=True,
            content=summary,
            session=self._session_brief(session),
        )

    async def _ask_next_field(
        self,
        *,
        session: _NovelCreationSession,
        ai_service: Any | None,
        opening: bool,
    ) -> IntentRecognitionResult:
        missing = self._next_missing_field(session)
        if missing is None:
            session.awaiting_confirm = True
            session.last_prompted_field = None
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content=self._build_confirmation_summary(session),
                session=self._session_brief(session),
            )

        session.last_prompted_field = missing
        session.updated_at = datetime.now()
        await self._save_session(session)

        prefix = "已进入创建小说流程。" if opening else ""
        question = _FIELD_QUESTIONS[missing]
        skill_hint = await self._generate_skill_guidance(
            session=session,
            field_name=missing,
            ai_service=ai_service,
        )

        content_parts = [part for part in [prefix, question] if part]
        if skill_hint:
            content_parts.append(skill_hint)
        content_parts.append("你也可以说“退出创建”随时离开该流程。")

        return IntentRecognitionResult(
            handled=True,
            content="\n\n".join(content_parts),
            session=self._session_brief(session),
        )

    async def _finalize_creation(
        self,
        *,
        session: _NovelCreationSession,
        db_session: Any | None,
    ) -> IntentRecognitionResult:
        idem_key = session.idempotency_key
        if idem_key and not await self._consume_idempotency_key(
            idem_key,
            user_id=session.user_id,
            action="create_novel",
        ):
            update_trace_context(idempotency_key=idem_key)
            record_duplicate_write_intercept(action="create_novel")
            await self._remove_session(session.session_key)
            return IntentRecognitionResult(
                handled=True,
                content="该创建请求已被处理过，请勿重复提交。",
                session={"status": "duplicate", "mode": "create", "idempotency_key": idem_key},
            )

        payload: dict[str, Any] | None = None
        errors: list[str] = []

        if db_session is not None:
            try:
                payload = await self._create_with_modern_projects(session=session, db_session=db_session)
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning("modern project creation failed: %s", exc, exc_info=True)
                errors.append(f"modern:{exc}")

        if payload is None:
            try:
                payload = await self._create_with_legacy_store(session=session)
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.error("legacy novel creation failed: %s", exc, exc_info=True)
                errors.append(f"legacy:{exc}")

        await self._remove_session(session.session_key)

        if payload is None:
            error_summary = "; ".join(errors) if errors else "unknown error"
            return IntentRecognitionResult(
                handled=True,
                content="已完成信息收集，但创建失败。请稍后重试或手动在小说页面创建项目。",
                tool_calls=[
                    self._build_wire_tool_call(
                        name="create_novel",
                        args={
                            "title": str(session.fields.get("title") or ""),
                            "genre": str(session.fields.get("genre") or _DEFAULT_GENRE),
                        },
                        call_id="call_create_novel_error",
                    )
                ],
                novel={"status": "error", "error": error_summary},
                session={"status": "failed", "mode": "create"},
            )

        content = (
            f"已按确认信息创建小说《{payload.get('title', session.fields.get('title', ''))}》"
            f"（类型：{payload.get('genre', session.fields.get('genre', _DEFAULT_GENRE))}），"
            f"ID：{payload.get('id', 'unknown')}。"
        )
        tool_call = self._build_wire_tool_call(
            name="create_novel",
            args={
                "title": str(session.fields.get("title") or ""),
                "genre": str(session.fields.get("genre") or _DEFAULT_GENRE),
                "description": self._compose_description(session.fields),
            },
            call_id="call_create_novel",
        )
        return IntentRecognitionResult(
            handled=True,
            content=content,
            tool_calls=[tool_call],
            novel=payload,
            session={"status": "completed", "mode": "create"},
        )

    async def _handle_manage_session(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        db_session: Any | None,
        ai_service: Any | None,
        opening: bool,
    ) -> IntentRecognitionResult:
        normalized = user_message.strip()
        lowered = normalized.lower()

        if db_session is None:
            return IntentRecognitionResult(
                handled=True,
                content="当前会话未连接小说数据库，暂时无法执行生命周期管理操作。",
                session=self._session_brief(session),
            )

        if normalized in _MANAGE_EXIT_KEYWORDS or lowered in _MANAGE_EXIT_KEYWORDS:
            await self._remove_session(session.session_key)
            return IntentRecognitionResult(
                handled=True,
                content="已退出小说管理会话。你可以随时说“管理小说”重新进入。",
                session={"status": "cancelled", "mode": "manage"},
            )

        if self._is_skill_assist_request(lowered):
            return await self._reply_manage_skill_guidance(session=session, ai_service=ai_service)

        if self._is_project_list_request(normalized):
            return await self._reply_project_list(session=session, db_session=db_session)

        if self._is_project_switch_request(normalized):
            return await self._handle_project_switch(session=session, user_message=normalized, db_session=db_session)

        if self._is_current_project_request(normalized):
            return await self._reply_current_project(session=session, db_session=db_session)

        if self._is_entity_list_request(lowered):
            return await self._reply_entity_list(session=session, user_message=normalized, db_session=db_session)

        if session.awaiting_confirm and session.pending_action is not None:
            return await self._handle_manage_confirmation_step(
                session=session,
                user_message=normalized,
                lowered=lowered,
                db_session=db_session,
            )

        if session.pending_action is not None:
            await self._merge_pending_action_from_message(
                action=session.pending_action,
                user_message=normalized,
                session=session,
                db_session=db_session,
            )
            session.pending_action.missing_fields = self._compute_missing_fields(session.pending_action)
            session.updated_at = datetime.now()
            await self._save_session(session)

            if session.pending_action.missing_fields:
                return IntentRecognitionResult(
                    handled=True,
                    content=self._build_manage_missing_question(session.pending_action),
                    session=self._session_brief(session),
                )

            session.awaiting_confirm = True
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content=self._build_manage_confirmation_summary(session.pending_action, session),
                session=self._session_brief(session),
            )

        if session.active_project_id is None:
            context_result = await self._try_attach_project_context_from_text(
                session=session,
                user_message=normalized,
                db_session=db_session,
                opening=opening,
            )
            if context_result is not None:
                return context_result

        action = await self._build_pending_action_from_message(
            session=session,
            user_message=normalized,
            db_session=db_session,
        )

        if action is None:
            return await self._reply_manage_help(session=session, db_session=db_session, opening=opening)

        action.missing_fields = self._compute_missing_fields(action)
        session.pending_action = action
        session.awaiting_confirm = False
        session.idempotency_key = self._generate_idempotency_key(session.user_id, action.action)
        session.updated_at = datetime.now()
        await self._save_session(session)

        if action.missing_fields:
            return IntentRecognitionResult(
                handled=True,
                content=self._build_manage_missing_question(action),
                session=self._session_brief(session),
            )

        session.awaiting_confirm = True
        session.updated_at = datetime.now()
        await self._save_session(session)
        return IntentRecognitionResult(
            handled=True,
            content=self._build_manage_confirmation_summary(action, session),
            session=self._session_brief(session),
        )

    async def _handle_manage_confirmation_step(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        lowered: str,
        db_session: Any,
    ) -> IntentRecognitionResult:
        action = session.pending_action
        if action is None:
            session.awaiting_confirm = False
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content="当前没有待确认的动作。请直接告诉我你要管理的内容。",
                session=self._session_brief(session),
            )

        if lowered in _CANCEL_KEYWORDS or user_message in _CANCEL_KEYWORDS:
            session.awaiting_confirm = False
            session.pending_action = None
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content="好的，已取消本次执行。你可以继续说下一步要管理的内容。",
                session=self._session_brief(session),
            )

        if lowered in _CONFIRM_KEYWORDS or user_message in _CONFIRM_KEYWORDS:
            return await self._execute_pending_action(session=session, db_session=db_session)

        await self._merge_pending_action_from_message(
            action=action,
            user_message=user_message,
            session=session,
            db_session=db_session,
        )
        action.missing_fields = self._compute_missing_fields(action)
        session.awaiting_confirm = not bool(action.missing_fields)
        session.updated_at = datetime.now()
        await self._save_session(session)

        if action.missing_fields:
            return IntentRecognitionResult(
                handled=True,
                content=(
                    "已取消确认，继续补全信息。\n"
                    f"{self._build_manage_missing_question(action)}"
                ),
                session=self._session_brief(session),
            )

        return IntentRecognitionResult(
            handled=True,
            content=self._build_manage_confirmation_summary(action, session),
            session=self._session_brief(session),
        )

    async def _reply_manage_help(
        self,
        *,
        session: _NovelCreationSession,
        db_session: Any,
        opening: bool,
    ) -> IntentRecognitionResult:
        header = "已进入小说生命周期管理会话。" if opening else "我可以继续帮你管理小说项目。"
        project_line = ""
        if session.active_project_id:
            project_line = f"当前项目：{session.active_project_title or session.active_project_id}"

        skill_hint = self._build_manage_skill_hint()

        content = (
            f"{header}\n"
            f"{project_line}\n"
            "你可以直接说：\n"
            "- 切换项目《项目名》\n"
            "- 修改第3章内容为：...\n"
            "- 新建大纲 标题：... 内容：...\n"
            "- 修改角色 林彻 性格改成冷静克制\n"
            "- 新增关系 林彻和周舟 关系为盟友\n"
            "- 删除关系 林彻和周舟\n"
            "- 创建组织 星火会 组织类型：秘密社团 目的：守护遗迹\n"
            "- 更新组织 星火会 势力值改成85\n"
            "- 删除组织 星火会\n"
            "- 新增物品 龙纹钥匙 描述：可开启旧文明遗迹\n"
            "- 生成完整大纲 章节数30 目标字数20万\n"
            "- 自动生成角色与组织 角色数8\n"
            "- 导出当前项目数据包\n"
            "- 删除项目（会删除当前项目）\n"
            "所有写操作都会先确认，回复“确认执行”后才落库。"
        ).strip()

        if skill_hint:
            content = f"{content}\n\n{skill_hint}"

        return IntentRecognitionResult(
            handled=True,
            content=content,
            session=self._session_brief(session),
        )

    async def _reply_manage_skill_guidance(
        self,
        *,
        session: _NovelCreationSession,
        ai_service: Any | None,
    ) -> IntentRecognitionResult:
        field_name = "theme"
        if session.pending_action and session.pending_action.missing_fields:
            field_name = session.pending_action.missing_fields[0]

        guidance = await self._generate_skill_guidance(
            session=session,
            field_name=field_name,
            ai_service=ai_service,
            force_refresh=True,
        )
        if not guidance:
            guidance = "当前没有可用技能建议，请继续直接描述你要执行的管理动作。"

        return IntentRecognitionResult(
            handled=True,
            content=guidance,
            session=self._session_brief(session),
        )

    async def _reply_project_list(self, *, session: _NovelCreationSession, db_session: Any) -> IntentRecognitionResult:
        projects = await self._list_user_projects(user_id=session.user_id, db_session=db_session, limit=8)
        if not projects:
            return IntentRecognitionResult(
                handled=True,
                content="当前还没有可管理的小说项目。你可以先说“创建小说”开始。",
                session=self._session_brief(session),
            )

        lines = [
            "可用项目：",
            *[
                f"- {item['title']}（ID: {item['id']}，类型: {item.get('genre') or '未设置'}）"
                for item in projects
            ],
            "请说“切换项目《项目名》”或“切换项目ID: xxx”。",
        ]
        return IntentRecognitionResult(
            handled=True,
            content="\n".join(lines),
            session=self._session_brief(session),
        )

    async def _reply_current_project(self, *, session: _NovelCreationSession, db_session: Any) -> IntentRecognitionResult:
        if not session.active_project_id:
            return await self._reply_project_list(session=session, db_session=db_session)

        project = await self._get_project_by_id(
            project_id=session.active_project_id,
            user_id=session.user_id,
            db_session=db_session,
        )
        if project is None:
            session.active_project_id = None
            session.active_project_title = None
            session.updated_at = datetime.now()
            await self._save_session(session)
            return await self._reply_project_list(session=session, db_session=db_session)

        session.active_project_title = str(project.get("title") or session.active_project_id)
        session.updated_at = datetime.now()
        await self._save_session(session)

        content = (
            f"当前项目：{project.get('title')}\n"
            f"- ID: {project.get('id')}\n"
            f"- 类型: {project.get('genre') or '未设置'}\n"
            f"- 主题: {project.get('theme') or '未设置'}\n"
            f"- 目标字数: {project.get('target_words') or 0}\n"
            f"- 状态: {project.get('status') or 'unknown'}"
        )
        return IntentRecognitionResult(
            handled=True,
            content=content,
            session=self._session_brief(session),
        )

    async def _handle_project_switch(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        db_session: Any,
    ) -> IntentRecognitionResult:
        project = await self._resolve_project_from_text(
            user_message=user_message,
            user_id=session.user_id,
            db_session=db_session,
        )
        if project is None:
            return await self._reply_project_list(session=session, db_session=db_session)

        session.active_project_id = str(project.get("id") or "")
        session.active_project_title = str(project.get("title") or session.active_project_id)
        session.pending_action = None
        session.awaiting_confirm = False
        session.updated_at = datetime.now()
        await self._save_session(session)

        return IntentRecognitionResult(
            handled=True,
            content=(
                f"已切换到项目《{session.active_project_title}》。\n"
                "你可以继续说“修改第3章内容为... / 新建大纲... / 修改角色...”。"
            ),
            session=self._session_brief(session),
        )

    async def _try_attach_project_context_from_text(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        db_session: Any,
        opening: bool,
    ) -> IntentRecognitionResult | None:
        project = await self._resolve_project_from_text(
            user_message=user_message,
            user_id=session.user_id,
            db_session=db_session,
        )
        if project is not None:
            session.active_project_id = str(project.get("id") or "")
            session.active_project_title = str(project.get("title") or session.active_project_id)
            session.updated_at = datetime.now()
            await self._save_session(session)
            return None

        projects = await self._list_user_projects(user_id=session.user_id, db_session=db_session, limit=8)
        if len(projects) == 1:
            session.active_project_id = str(projects[0].get("id") or "")
            session.active_project_title = str(projects[0].get("title") or session.active_project_id)
            session.updated_at = datetime.now()
            await self._save_session(session)
            return None

        if opening:
            return await self._reply_project_list(session=session, db_session=db_session)

        return IntentRecognitionResult(
            handled=True,
            content="请先指定项目（例如：切换项目《星海回声》）。",
            session=self._session_brief(session),
        )

    async def _reply_entity_list(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        db_session: Any,
    ) -> IntentRecognitionResult:
        lowered = user_message.lower()

        if not session.active_project_id:
            context_result = await self._try_attach_project_context_from_text(
                session=session,
                user_message=user_message,
                db_session=db_session,
                opening=False,
            )
            if context_result is not None:
                return context_result

        project_id = session.active_project_id
        if not project_id:
            return await self._reply_project_list(session=session, db_session=db_session)

        if "章节" in lowered or "章" in lowered:
            from app.gateway.novel_migrated.api.chapters import list_chapters

            data = await list_chapters(project_id=project_id, user_id=session.user_id, db=db_session, outline_id=None, status=None, offset=0, limit=20)
            chapters = data.get("chapters", [])
            if not chapters:
                content = "当前项目还没有章节。"
            else:
                lines = [f"- 第{c.get('chapter_number')}章《{c.get('title') or '未命名'}》" for c in chapters[:12]]
                content = "章节列表：\n" + "\n".join(lines)
            return IntentRecognitionResult(handled=True, content=content, session=self._session_brief(session))

        if "大纲" in lowered:
            from app.gateway.novel_migrated.api.outlines import list_outlines

            data = await list_outlines(project_id=project_id, user_id=session.user_id, db=db_session)
            outlines = data.get("outlines", [])
            if not outlines:
                content = "当前项目还没有大纲。"
            else:
                lines = [f"- 第{o.get('order_index')}条《{o.get('title') or '未命名'}》" for o in outlines[:12]]
                content = "大纲列表：\n" + "\n".join(lines)
            return IntentRecognitionResult(handled=True, content=content, session=self._session_brief(session))

        if "角色" in lowered or "人物" in lowered:
            from app.gateway.novel_migrated.api.characters import list_characters

            data = await list_characters(project_id=project_id, user_id=session.user_id, db=db_session, is_organization=None, role_type=None)
            characters = data.get("characters", [])
            if not characters:
                content = "当前项目还没有角色。"
            else:
                lines = [f"- {c.get('name')}（{c.get('role_type') or 'unknown'}）" for c in characters[:20] if not c.get("is_organization")]
                content = "角色列表：\n" + ("\n".join(lines) if lines else "暂无角色条目")
            return IntentRecognitionResult(handled=True, content=content, session=self._session_brief(session))

        if "关系" in lowered:
            from app.gateway.novel_migrated.api.relationships import list_relationships

            data = await list_relationships(project_id=project_id, user_id=session.user_id, db=db_session, character_id=None)
            relationships = data.get("relationships", [])
            if not relationships:
                content = "当前项目还没有角色关系。"
            else:
                lines = [
                    f"- {r.get('character_from_id')} -> {r.get('character_to_id')}：{r.get('relationship_name') or '未命名关系'}"
                    for r in relationships[:20]
                ]
                content = "关系列表：\n" + "\n".join(lines)
            return IntentRecognitionResult(handled=True, content=content, session=self._session_brief(session))

        if "组织" in lowered:
            from app.gateway.novel_migrated.api.organizations import list_organizations

            data = await list_organizations(project_id=project_id, user_id=session.user_id, db=db_session)
            organizations = data.get("organizations", [])
            if not organizations:
                content = "当前项目还没有组织。"
            else:
                lines = [f"- {o.get('name')}（成员 {len(o.get('members') or [])}）" for o in organizations[:20]]
                content = "组织列表：\n" + "\n".join(lines)
            return IntentRecognitionResult(handled=True, content=content, session=self._session_brief(session))

        if "物品" in lowered or "道具" in lowered or "伏笔" in lowered:
            items = await self._list_item_foreshadows(project_id=project_id, db_session=db_session)
            if not items:
                content = "当前项目还没有物品条目。"
            else:
                lines = [f"- {item.get('title')}（状态：{item.get('status') or 'pending'}）" for item in items[:20]]
                content = "物品列表（映射到伏笔 category=item）：\n" + "\n".join(lines)
            return IntentRecognitionResult(handled=True, content=content, session=self._session_brief(session))

        return await self._reply_manage_help(session=session, db_session=db_session, opening=False)

    async def _build_pending_action_from_message(
        self,
        *,
        session: _NovelCreationSession,
        user_message: str,
        db_session: Any,
    ) -> _PendingAction | None:
        lowered = user_message.lower()
        project_id = session.active_project_id

        if not project_id:
            return None

        if self._is_project_export_request(lowered):
            return _PendingAction(
                action="export_project_archive",
                entity="project",
                operation="export",
                project_id=project_id,
                target_id=project_id,
                target_label=session.active_project_title or project_id,
                payload={},
            )

        if self._is_outline_generate_request(lowered):
            payload = self._extract_outline_generate_payload(user_message)
            return _PendingAction(
                action="generate_outline",
                entity="outline",
                operation="generate",
                project_id=project_id,
                target_id=project_id,
                target_label="完整大纲",
                payload=payload,
            )

        if self._is_character_generate_request(lowered):
            payload = self._extract_character_generate_payload(user_message)
            return _PendingAction(
                action="generate_characters",
                entity="character",
                operation="generate",
                project_id=project_id,
                target_id=project_id,
                target_label="角色与组织",
                payload=payload,
            )

        if self._is_chapter_create_request(lowered):
            payload = self._extract_chapter_create_payload(user_message)
            return _PendingAction(
                action="create_chapter",
                entity="chapter",
                operation="create",
                project_id=project_id,
                target_label="新章节",
                payload=payload,
            )

        if self._is_chapter_delete_request(lowered):
            chapter = await self._resolve_chapter_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            return _PendingAction(
                action="delete_chapter",
                entity="chapter",
                operation="delete",
                project_id=project_id,
                target_id=chapter.get("id") if chapter else None,
                target_label=self._chapter_label(chapter) if chapter else "",
                payload={},
            )

        if self._is_chapter_update_request(lowered):
            chapter = await self._resolve_chapter_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            payload = self._extract_chapter_update_payload(user_message)
            return _PendingAction(
                action="update_chapter",
                entity="chapter",
                operation="update",
                project_id=project_id,
                target_id=chapter.get("id") if chapter else None,
                target_label=self._chapter_label(chapter) if chapter else "",
                payload=payload,
            )

        if self._is_outline_create_request(lowered):
            payload = self._extract_outline_create_payload(user_message)
            return _PendingAction(
                action="create_outline",
                entity="outline",
                operation="create",
                project_id=project_id,
                target_label="新大纲",
                payload=payload,
            )

        if self._is_outline_delete_request(lowered):
            outline = await self._resolve_outline_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            return _PendingAction(
                action="delete_outline",
                entity="outline",
                operation="delete",
                project_id=project_id,
                target_id=outline.get("id") if outline else None,
                target_label=self._outline_label(outline) if outline else "",
                payload={},
            )

        if self._is_outline_update_request(lowered):
            outline = await self._resolve_outline_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            payload = self._extract_outline_update_payload(user_message)
            return _PendingAction(
                action="update_outline",
                entity="outline",
                operation="update",
                project_id=project_id,
                target_id=outline.get("id") if outline else None,
                target_label=self._outline_label(outline) if outline else "",
                payload=payload,
            )

        if self._is_character_create_request(lowered):
            payload = self._extract_character_create_payload(user_message)
            return _PendingAction(
                action="create_character",
                entity="character",
                operation="create",
                project_id=project_id,
                target_label=payload.get("name") or "新角色",
                payload=payload,
            )

        if self._is_character_delete_request(lowered):
            character = await self._resolve_character_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
                allow_organization=True,
            )
            return _PendingAction(
                action="delete_character",
                entity="character",
                operation="delete",
                project_id=project_id,
                target_id=character.get("id") if character else None,
                target_label=self._character_label(character) if character else "",
                payload={},
            )

        if self._is_character_update_request(lowered):
            character = await self._resolve_character_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
                allow_organization=True,
            )
            payload = self._extract_character_update_payload(user_message)
            return _PendingAction(
                action="update_character",
                entity="character",
                operation="update",
                project_id=project_id,
                target_id=character.get("id") if character else None,
                target_label=self._character_label(character) if character else "",
                payload=payload,
            )

        if self._is_relationship_create_request(lowered):
            payload = self._extract_relationship_payload(user_message)
            return _PendingAction(
                action="create_relationship",
                entity="relationship",
                operation="create",
                project_id=project_id,
                target_label="角色关系",
                payload=payload,
            )

        if self._is_relationship_update_request(lowered):
            payload = self._extract_relationship_payload(user_message)
            return _PendingAction(
                action="update_relationship",
                entity="relationship",
                operation="update",
                project_id=project_id,
                target_label="角色关系",
                payload=payload,
            )

        if self._is_relationship_delete_request(lowered):
            payload = self._extract_relationship_payload(user_message)
            return _PendingAction(
                action="delete_relationship",
                entity="relationship",
                operation="delete",
                project_id=project_id,
                target_label="角色关系",
                payload=payload,
            )

        if self._is_organization_create_request(lowered):
            payload = self._extract_organization_create_payload(user_message)
            return _PendingAction(
                action="create_organization",
                entity="organization",
                operation="create",
                project_id=project_id,
                target_label=payload.get("name") or "新组织",
                payload=payload,
            )

        if self._is_organization_member_request(lowered):
            payload = self._extract_organization_member_payload(user_message)
            return _PendingAction(
                action="add_organization_member",
                entity="organization",
                operation="member_add",
                project_id=project_id,
                target_label=payload.get("organization_name") or "组织成员",
                payload=payload,
            )

        if self._is_organization_update_request(lowered):
            org = await self._resolve_organization_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            payload = self._extract_organization_update_payload(user_message)
            return _PendingAction(
                action="update_organization",
                entity="organization",
                operation="update",
                project_id=project_id,
                target_id=org.get("id") if org else None,
                target_label=self._organization_label(org) if org else "",
                payload=payload,
            )

        if self._is_organization_delete_request(lowered):
            org = await self._resolve_organization_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            return _PendingAction(
                action="delete_organization",
                entity="organization",
                operation="delete",
                project_id=project_id,
                target_id=org.get("id") if org else None,
                target_label=self._organization_label(org) if org else "",
                payload={},
            )

        if self._is_item_create_request(lowered):
            payload = self._extract_item_create_payload(user_message)
            return _PendingAction(
                action="create_item",
                entity="item",
                operation="create",
                project_id=project_id,
                target_label=payload.get("title") or "新物品",
                payload=payload,
            )

        if self._is_item_delete_request(lowered):
            item = await self._resolve_item_from_text(project_id=project_id, user_message=user_message, db_session=db_session)
            return _PendingAction(
                action="delete_item",
                entity="item",
                operation="delete",
                project_id=project_id,
                target_id=item.get("id") if item else None,
                target_label=item.get("title") if item else "",
                payload={},
            )

        if self._is_item_update_request(lowered):
            item = await self._resolve_item_from_text(project_id=project_id, user_message=user_message, db_session=db_session)
            payload = self._extract_item_update_payload(user_message)
            return _PendingAction(
                action="update_item",
                entity="item",
                operation="update",
                project_id=project_id,
                target_id=item.get("id") if item else None,
                target_label=item.get("title") if item else "",
                payload=payload,
            )

        if self._is_project_update_request(lowered):
            payload = self._extract_project_update_payload(user_message)
            return _PendingAction(
                action="update_project",
                entity="project",
                operation="update",
                project_id=project_id,
                target_id=project_id,
                target_label=session.active_project_title or project_id,
                payload=payload,
            )

        if self._is_project_delete_request(lowered):
            return _PendingAction(
                action="delete_project",
                entity="project",
                operation="delete",
                project_id=project_id,
                target_id=project_id,
                target_label=session.active_project_title or project_id,
                payload={},
            )

        return None

    async def _merge_pending_action_from_message(
        self,
        *,
        action: _PendingAction,
        user_message: str,
        session: _NovelCreationSession,
        db_session: Any,
    ) -> None:
        project_id = action.project_id or session.active_project_id
        if not project_id:
            return

        if action.action == "update_project":
            action.payload.update(self._extract_project_update_payload(user_message))
            return

        if action.action == "generate_outline":
            action.payload.update(self._extract_outline_generate_payload(user_message))
            return

        if action.action == "generate_characters":
            action.payload.update(self._extract_character_generate_payload(user_message))
            return

        if action.action == "create_chapter":
            action.payload.update(self._extract_chapter_create_payload(user_message))
            return

        if action.action in {"update_chapter", "delete_chapter"}:
            if not action.target_id:
                chapter = await self._resolve_chapter_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if chapter:
                    action.target_id = chapter.get("id")
                    action.target_label = self._chapter_label(chapter)
            if action.action == "update_chapter":
                action.payload.update(self._extract_chapter_update_payload(user_message))
            return

        if action.action == "create_outline":
            action.payload.update(self._extract_outline_create_payload(user_message))
            return

        if action.action in {"update_outline", "delete_outline"}:
            if not action.target_id:
                outline = await self._resolve_outline_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if outline:
                    action.target_id = outline.get("id")
                    action.target_label = self._outline_label(outline)
            if action.action == "update_outline":
                action.payload.update(self._extract_outline_update_payload(user_message))
            return

        if action.action == "create_character":
            action.payload.update(self._extract_character_create_payload(user_message))
            return

        if action.action in {"update_character", "delete_character"}:
            if not action.target_id:
                character = await self._resolve_character_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                    allow_organization=True,
                )
                if character:
                    action.target_id = character.get("id")
                    action.target_label = self._character_label(character)
            if action.action == "update_character":
                action.payload.update(self._extract_character_update_payload(user_message))
            return

        if action.action in {"create_relationship", "update_relationship", "delete_relationship"}:
            action.payload.update(self._extract_relationship_payload(user_message))
            return

        if action.action == "create_organization":
            action.payload.update(self._extract_organization_create_payload(user_message))
            if action.payload.get("name"):
                action.target_label = str(action.payload.get("name") or "")
            return

        if action.action == "update_organization":
            if not action.target_id:
                org = await self._resolve_organization_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if org:
                    action.target_id = org.get("id")
                    action.target_label = self._organization_label(org)
            action.payload.update(self._extract_organization_update_payload(user_message))
            return

        if action.action == "delete_organization":
            if not action.target_id:
                org = await self._resolve_organization_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if org:
                    action.target_id = org.get("id")
                    action.target_label = self._organization_label(org)
            return

        if action.action == "add_organization_member":
            action.payload.update(self._extract_organization_member_payload(user_message))
            return

        if action.action == "create_item":
            action.payload.update(self._extract_item_create_payload(user_message))
            return

        if action.action in {"update_item", "delete_item"}:
            if not action.target_id:
                item = await self._resolve_item_from_text(project_id=project_id, user_message=user_message, db_session=db_session)
                if item:
                    action.target_id = item.get("id")
                    action.target_label = str(item.get("title") or "")
            if action.action == "update_item":
                action.payload.update(self._extract_item_update_payload(user_message))

    def _compute_missing_fields(self, action: _PendingAction) -> list[str]:
        missing: list[str] = []

        if not action.project_id:
            missing.append("project_selector")
            return missing

        if action.action == "update_project":
            if not action.payload:
                missing.append("project_updates")
            return missing

        if action.action == "delete_project":
            return missing

        if action.action == "export_project_archive":
            return missing

        if action.action == "generate_outline":
            return missing

        if action.action == "generate_characters":
            return missing

        if action.action == "create_chapter":
            if not any(action.payload.get(key) for key in ("title", "summary", "content")):
                missing.append("chapter_create_payload")
            return missing

        if action.action == "update_chapter":
            if not action.target_id:
                missing.append("chapter_selector")
            if not action.payload:
                missing.append("chapter_updates")
            return missing

        if action.action == "delete_chapter":
            if not action.target_id:
                missing.append("chapter_selector")
            return missing

        if action.action == "create_outline":
            if not action.payload.get("title") or not action.payload.get("content"):
                missing.append("outline_create_payload")
            return missing

        if action.action == "update_outline":
            if not action.target_id:
                missing.append("outline_selector")
            if not action.payload:
                missing.append("outline_updates")
            return missing

        if action.action == "delete_outline":
            if not action.target_id:
                missing.append("outline_selector")
            return missing

        if action.action == "create_character":
            if not action.payload.get("name"):
                missing.append("character_create_payload")
            return missing

        if action.action == "update_character":
            if not action.target_id:
                missing.append("character_selector")
            if not action.payload:
                missing.append("character_updates")
            return missing

        if action.action == "delete_character":
            if not action.target_id:
                missing.append("character_selector")
            return missing

        if action.action == "create_relationship":
            if not action.payload.get("character_from_name") or not action.payload.get("character_to_name"):
                missing.append("relationship_pair")
            if not action.payload.get("relationship_name"):
                missing.append("relationship_name")
            return missing

        if action.action == "update_relationship":
            if not action.payload.get("character_from_name") or not action.payload.get("character_to_name"):
                missing.append("relationship_pair")
            if not any(key in action.payload for key in ("relationship_name", "intimacy_level", "description", "status")):
                missing.append("relationship_updates")
            return missing

        if action.action == "delete_relationship":
            if not action.payload.get("character_from_name") or not action.payload.get("character_to_name"):
                missing.append("relationship_pair")
            return missing

        if action.action == "create_organization":
            if not action.payload.get("name"):
                missing.append("organization_create_payload")
            return missing

        if action.action == "update_organization":
            if not action.target_id:
                missing.append("organization_selector")
            if not action.payload:
                missing.append("organization_updates")
            return missing

        if action.action == "delete_organization":
            if not action.target_id:
                missing.append("organization_selector")
            return missing

        if action.action == "add_organization_member":
            if not action.payload.get("organization_name") or not action.payload.get("member_name"):
                missing.append("organization_member_payload")
            return missing

        if action.action == "create_item":
            if not action.payload.get("title") or not action.payload.get("content"):
                missing.append("item_create_payload")
            return missing

        if action.action == "update_item":
            if not action.target_id:
                missing.append("item_selector")
            if not action.payload:
                missing.append("item_updates")
            return missing

        if action.action == "delete_item":
            if not action.target_id:
                missing.append("item_selector")
            return missing

        return missing

    def _build_manage_missing_question(self, action: _PendingAction) -> str:
        if not action.missing_fields:
            return "信息已齐全。"

        first = action.missing_fields[0]
        question = _MANAGE_FIELD_QUESTIONS.get(first, "请补充执行该动作所需的信息。")
        if len(action.missing_fields) == 1:
            return question
        more = "、".join(_MANAGE_FIELD_QUESTIONS.get(key, key) for key in action.missing_fields[1:])
        return f"{question}\n另外还需要：{more}"

    def _build_manage_confirmation_summary(self, action: _PendingAction, session: _NovelCreationSession) -> str:
        payload_text = self._format_payload_for_summary(action.payload)
        project_name = session.active_project_title or action.project_id or "未指定项目"
        target_text = f"，目标：{action.target_label}" if action.target_label else ""
        return (
            "请确认执行以下操作：\n"
            f"- 项目：{project_name}\n"
            f"- 动作：{action.action}{target_text}\n"
            f"- 参数：{payload_text}\n\n"
            "回复“确认执行”后我才会真正落库；回复“取消”可放弃本次操作。"
        )

    @staticmethod
    def _format_payload_for_summary(payload: dict[str, Any]) -> str:
        if not payload:
            return "无"
        preview: dict[str, Any] = {}
        for key, value in payload.items():
            if isinstance(value, str) and len(value) > 120:
                preview[key] = f"{value[:120]}..."
            else:
                preview[key] = value
        return json.dumps(preview, ensure_ascii=False)

    @staticmethod
    def _build_wire_tool_call(*, name: str, args: dict[str, Any], call_id: str) -> dict[str, Any]:
        """Build tool call object compatible with deerflow wire format."""
        return {
            "name": name,
            "args": args,
            "id": call_id,
        }

    async def _execute_pending_action(self, *, session: _NovelCreationSession, db_session: Any) -> IntentRecognitionResult:
        action = session.pending_action
        if action is None:
            session.awaiting_confirm = False
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content="没有待执行动作。",
                session=self._session_brief(session),
            )

        idem_key = session.idempotency_key
        if idem_key and not await self._consume_idempotency_key(
            idem_key,
            user_id=session.user_id,
            action=action.action,
        ):
            update_trace_context(
                idempotency_key=idem_key,
                project_id=action.project_id,
            )
            record_duplicate_write_intercept(action=action.action)
            session.awaiting_confirm = False
            session.pending_action = None
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content="该操作已被处理过，请勿重复提交。",
                session={"status": "duplicate", "mode": "manage", "idempotency_key": idem_key},
            )

        try:
            result_payload = await self._dispatch_manage_action(action=action, session=session, db_session=db_session)
        except Exception as exc:
            message = getattr(exc, "detail", None) or str(exc)
            logger.warning("manage action %s failed: %s", action.action, message, exc_info=True)
            session.awaiting_confirm = False
            session.pending_action = None
            session.updated_at = datetime.now()
            await self._save_session(session)
            return IntentRecognitionResult(
                handled=True,
                content=f"执行失败：{message}",
                tool_calls=[
                    self._build_wire_tool_call(
                        name=action.action,
                        args={
                            "project_id": action.project_id,
                            "target_id": action.target_id,
                            **action.payload,
                        },
                        call_id=f"call_{action.action}_error",
                    )
                ],
                session=self._session_brief(session),
            )

        tool_call = self._build_wire_tool_call(
            name=action.action,
            args={
                "project_id": action.project_id,
                "target_id": action.target_id,
                **action.payload,
            },
            call_id=f"call_{action.action}",
        )

        content = f"已完成操作：{action.action}。"
        if action.target_label:
            content = f"已完成操作：{action.action}（{action.target_label}）。"
        if action.action == "export_project_archive" and isinstance(result_payload, dict):
            download_path = str(result_payload.get("download_path") or "").strip()
            if download_path:
                content = f"已完成操作：{action.action}。可通过 {download_path} 下载导出包。"
            elif result_payload.get("file_name"):
                content = f"已完成操作：{action.action}。导出文件：{result_payload.get('file_name')}。"

        if action.action == "update_project" and isinstance(result_payload, dict):
            session.active_project_title = str(result_payload.get("title") or session.active_project_title or "")
        if action.action == "delete_project":
            session.active_project_id = None
            session.active_project_title = None

        session.awaiting_confirm = False
        session.pending_action = None
        session.updated_at = datetime.now()
        await self._save_session(session)

        return IntentRecognitionResult(
            handled=True,
            content=content,
            tool_calls=[tool_call],
            novel=result_payload if isinstance(result_payload, dict) else {"result": result_payload},
            session=self._session_brief(session),
        )

    async def _dispatch_manage_action(self, *, action: _PendingAction, session: _NovelCreationSession, db_session: Any) -> dict[str, Any]:
        action_name = action.action

        if action_name == "update_project":
            from app.gateway.novel_migrated.api.projects import ProjectUpdateRequest, update_project

            req = ProjectUpdateRequest(**action.payload)
            return await update_project(project_id=action.project_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "delete_project":
            from app.gateway.novel_migrated.api.projects import delete_project

            payload = await delete_project(project_id=action.target_id or action.project_id or "", user_id=session.user_id, db=db_session)
            if isinstance(payload, dict):
                return payload
            return {"message": "Project deleted"}

        if action_name == "export_project_archive":
            from app.gateway.novel_migrated.api.import_export import build_export_download_path
            from app.gateway.novel_migrated.services.import_export_service import get_import_export_service

            project = await self._get_project_model(
                project_id=action.project_id or "",
                user_id=session.user_id,
                db_session=db_session,
            )
            if project is None:
                raise ValueError("项目不存在或无权限")

            service = get_import_export_service()
            export_bytes = await service.export_project(project_id=project.id, db=db_session)
            export_dir = Path(__file__).resolve().parents[1] / "data" / "exports"
            export_dir.mkdir(parents=True, exist_ok=True)
            file_name = f"project-{project.id}-{datetime.now().strftime('%Y%m%d%H%M%S')}.zip"
            file_path = export_dir / file_name
            file_path.write_bytes(export_bytes)
            return {
                "project_id": project.id,
                "file_name": file_name,
                "file_path": str(file_path),
                "download_path": build_export_download_path(project.id),
                "size_bytes": len(export_bytes),
                "source": "import_export_service",
            }

        if action_name == "generate_outline":
            from app.gateway.novel_migrated.services.book_import_service import book_import_service

            project = await self._get_project_model(
                project_id=action.project_id or "",
                user_id=session.user_id,
                db_session=db_session,
            )
            if project is None:
                raise ValueError("项目不存在或无权限")

            chapter_count = max(5, min(int(action.payload.get("chapter_count") or project.chapter_count or 30), 300))
            narrative_perspective = str(
                action.payload.get("narrative_perspective")
                or project.narrative_perspective
                or "第三人称"
            )
            target_words = max(1000, min(int(action.payload.get("target_words") or project.target_words or 100000), 3_000_000))

            outlines_count = await book_import_service._generate_outline_from_project(  # noqa: SLF001
                db=db_session,
                user_id=session.user_id,
                project=project,
                chapter_count=chapter_count,
                narrative_perspective=narrative_perspective,
                target_words=target_words,
            )
            project.wizard_step = 4
            project.wizard_status = "completed"
            project.status = "writing"
            await db_session.commit()
            return {
                "project_id": project.id,
                "outlines_count": outlines_count,
                "chapter_count": chapter_count,
                "target_words": target_words,
                "narrative_perspective": narrative_perspective,
                "source": "book_import_service.generate_outline",
            }

        if action_name == "generate_characters":
            from app.gateway.novel_migrated.services.book_import_service import book_import_service

            project = await self._get_project_model(
                project_id=action.project_id or "",
                user_id=session.user_id,
                db_session=db_session,
            )
            if project is None:
                raise ValueError("项目不存在或无权限")

            count = max(5, min(int(action.payload.get("count") or project.character_count or 8), 20))
            if action.payload.get("theme"):
                project.theme = str(action.payload.get("theme"))
            if action.payload.get("genre"):
                project.genre = str(action.payload.get("genre"))[:50]
            project.character_count = count

            generated_count = await book_import_service._generate_characters_and_organizations_from_project(  # noqa: SLF001
                db=db_session,
                user_id=session.user_id,
                project=project,
                count=count,
            )
            project.wizard_step = max(int(project.wizard_step or 0), 3)
            project.wizard_status = "incomplete"
            await db_session.commit()
            return {
                "project_id": project.id,
                "count": count,
                "generated_count": generated_count,
                "source": "book_import_service.generate_characters",
            }

        if action_name == "create_chapter":
            from app.gateway.novel_migrated.api.chapters import ChapterCreateRequest, create_chapter

            req = ChapterCreateRequest(**action.payload)
            return await create_chapter(project_id=action.project_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "update_chapter":
            from app.gateway.novel_migrated.api.chapters import ChapterUpdateRequest, update_chapter

            req = ChapterUpdateRequest(**action.payload)
            return await update_chapter(chapter_id=action.target_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "delete_chapter":
            from app.gateway.novel_migrated.api.chapters import delete_chapter

            payload = await delete_chapter(chapter_id=action.target_id or "", user_id=session.user_id, db=db_session)
            if isinstance(payload, dict):
                return payload
            return {"message": "Chapter deleted"}

        if action_name == "create_outline":
            from app.gateway.novel_migrated.api.outlines import OutlineCreateRequest, create_outline

            req = OutlineCreateRequest(**action.payload)
            return await create_outline(project_id=action.project_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "update_outline":
            from app.gateway.novel_migrated.api.outlines import OutlineUpdateRequest, update_outline

            req = OutlineUpdateRequest(**action.payload)
            return await update_outline(outline_id=action.target_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "delete_outline":
            from app.gateway.novel_migrated.api.outlines import delete_outline

            payload = await delete_outline(outline_id=action.target_id or "", user_id=session.user_id, db=db_session)
            if isinstance(payload, dict):
                return payload
            return {"message": "Outline deleted"}

        if action_name == "create_character":
            from app.gateway.novel_migrated.api.characters import CharacterCreateRequest, create_character

            req = CharacterCreateRequest(**action.payload)
            return await create_character(project_id=action.project_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "update_character":
            from app.gateway.novel_migrated.api.characters import CharacterUpdateRequest, update_character

            req = CharacterUpdateRequest(**action.payload)
            return await update_character(character_id=action.target_id or "", req=req, user_id=session.user_id, db=db_session)

        if action_name == "delete_character":
            from app.gateway.novel_migrated.api.characters import delete_character

            payload = await delete_character(character_id=action.target_id or "", user_id=session.user_id, db=db_session)
            if isinstance(payload, dict):
                return payload
            return {"message": "Character deleted"}

        if action_name == "create_relationship":
            from app.gateway.novel_migrated.api.relationships import RelationshipCreateRequest, create_relationship

            from_char = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_from_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            to_char = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_to_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            req = RelationshipCreateRequest(
                project_id=action.project_id or "",
                character_from_id=str(from_char.get("id") or ""),
                character_to_id=str(to_char.get("id") or ""),
                relationship_name=str(action.payload.get("relationship_name") or "相关"),
                intimacy_level=int(action.payload.get("intimacy_level") or 50),
                description=str(action.payload.get("description") or ""),
                status=str(action.payload.get("status") or "active"),
            )
            return await create_relationship(req=req, user_id=session.user_id, db=db_session)

        if action_name == "update_relationship":
            from app.gateway.novel_migrated.api.relationships import RelationshipUpdateRequest, list_relationships, update_relationship

            from_char = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_from_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            to_char = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_to_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            rel_data = await list_relationships(project_id=action.project_id or "", user_id=session.user_id, db=db_session, character_id=None)
            relationships = rel_data.get("relationships", [])
            rel = self._match_relationship(relationships, str(from_char.get("id") or ""), str(to_char.get("id") or ""))
            if rel is None:
                raise ValueError("未找到对应关系，请先创建关系")

            req = RelationshipUpdateRequest(
                relationship_name=action.payload.get("relationship_name"),
                intimacy_level=action.payload.get("intimacy_level"),
                description=action.payload.get("description"),
                status=action.payload.get("status"),
            )
            return await update_relationship(relationship_id=str(rel.get("id") or ""), req=req, user_id=session.user_id, db=db_session)

        if action_name == "delete_relationship":
            from app.gateway.novel_migrated.api.relationships import delete_relationship, list_relationships

            from_char = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_from_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            to_char = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_to_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            rel_data = await list_relationships(project_id=action.project_id or "", user_id=session.user_id, db=db_session, character_id=None)
            relationships = rel_data.get("relationships", [])
            rel = self._match_relationship(relationships, str(from_char.get("id") or ""), str(to_char.get("id") or ""))
            if rel is None:
                raise ValueError("未找到对应关系")

            payload = await delete_relationship(relationship_id=str(rel.get("id") or ""), user_id=session.user_id, db=db_session)
            if isinstance(payload, dict):
                return payload
            return {"message": "Relationship deleted"}

        if action_name == "create_organization":
            from app.gateway.novel_migrated.api.characters import CharacterCreateRequest, create_character
            from app.gateway.novel_migrated.api.organizations import OrganizationUpdateRequest, update_organization

            org_name = str(action.payload.get("name") or "").strip()
            if not org_name:
                raise ValueError("缺少组织名称")

            created = await create_character(
                project_id=action.project_id or "",
                req=CharacterCreateRequest(
                    name=org_name,
                    is_organization=True,
                    role_type="supporting",
                    organization_type=action.payload.get("organization_type"),
                    organization_purpose=action.payload.get("purpose"),
                ),
                user_id=session.user_id,
                db=db_session,
            )

            org_updates = {
                key: value
                for key, value in action.payload.items()
                if key in {"organization_type", "purpose", "hierarchy", "power_level", "location"}
            }
            if org_updates:
                await update_organization(
                    organization_id=str(created.get("id") or ""),
                    req=OrganizationUpdateRequest(**org_updates),
                    user_id=session.user_id,
                    db=db_session,
                )
            return created

        if action_name == "update_organization":
            from app.gateway.novel_migrated.api.characters import CharacterUpdateRequest, update_character
            from app.gateway.novel_migrated.api.organizations import OrganizationUpdateRequest, update_organization

            org_updates = {
                key: value
                for key, value in action.payload.items()
                if key in {"organization_type", "purpose", "hierarchy", "power_level", "location"}
            }
            char_updates = {}
            if "organization_type" in org_updates:
                char_updates["organization_type"] = org_updates["organization_type"]
            if "purpose" in org_updates:
                char_updates["organization_purpose"] = org_updates["purpose"]

            latest: dict[str, Any] = {"id": action.target_id}
            if char_updates:
                latest = await update_character(
                    character_id=action.target_id or "",
                    req=CharacterUpdateRequest(**char_updates),
                    user_id=session.user_id,
                    db=db_session,
                )

            if org_updates:
                org_result = await update_organization(
                    organization_id=action.target_id or "",
                    req=OrganizationUpdateRequest(**org_updates),
                    user_id=session.user_id,
                    db=db_session,
                )
                if isinstance(org_result, dict):
                    latest.update(org_result)

            return latest

        if action_name == "delete_organization":
            from app.gateway.novel_migrated.api.characters import delete_character

            payload = await delete_character(character_id=action.target_id or "", user_id=session.user_id, db=db_session)
            if isinstance(payload, dict):
                return payload
            return {"message": "Organization deleted"}

        if action_name == "add_organization_member":
            from app.gateway.novel_migrated.api.organizations import (
                MemberAddRequest,
                OrganizationUpdateRequest,
                add_member,
                update_organization,
            )

            org = await self._resolve_organization_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("organization_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            member = await self._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("member_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )

            # Ensure organization detail exists before adding member.
            await update_organization(
                organization_id=str(org.get("id") or ""),
                req=OrganizationUpdateRequest(),
                user_id=session.user_id,
                db=db_session,
            )

            req = MemberAddRequest(
                character_id=str(member.get("id") or ""),
                position=str(action.payload.get("position") or ""),
                rank=int(action.payload.get("rank") or 5),
                loyalty=int(action.payload.get("loyalty") or 50),
                status=str(action.payload.get("status") or "active"),
            )
            return await add_member(organization_id=str(org.get("id") or ""), req=req, user_id=session.user_id, db=db_session)

        if action_name in {"create_item", "update_item", "delete_item"}:
            return await self._dispatch_item_action(action=action, db_session=db_session)

        raise ValueError(f"unsupported action: {action_name}")

    async def _dispatch_item_action(self, *, action: _PendingAction, db_session: Any) -> dict[str, Any]:
        from app.gateway.novel_migrated.schemas.foreshadow import ForeshadowCreate, ForeshadowUpdate
        from app.gateway.novel_migrated.services.foreshadow_service import foreshadow_service

        if action.action == "create_item":
            req = ForeshadowCreate(
                project_id=action.project_id or "",
                title=str(action.payload.get("title") or ""),
                content=str(action.payload.get("content") or ""),
                category="item",
                tags=action.payload.get("tags") or [],
                notes=action.payload.get("notes") or None,
            )
            created = await foreshadow_service.create_foreshadow(db=db_session, data=req)
            return created.to_dict()

        if action.action == "update_item":
            req = ForeshadowUpdate(
                title=action.payload.get("title"),
                content=action.payload.get("content"),
                tags=action.payload.get("tags"),
                notes=action.payload.get("notes"),
            )
            updated = await foreshadow_service.update_foreshadow(db=db_session, foreshadow_id=action.target_id or "", data=req)
            if updated is None:
                raise ValueError("物品不存在")
            return updated.to_dict()

        if action.action == "delete_item":
            deleted = await foreshadow_service.delete_foreshadow(db=db_session, foreshadow_id=action.target_id or "")
            if not deleted:
                raise ValueError("物品不存在")
            return {"message": "Item deleted", "id": action.target_id}

        raise ValueError(f"unsupported item action: {action.action}")

    async def _resolve_project_from_text(self, *, user_message: str, user_id: str, db_session: Any) -> dict[str, Any] | None:
        project_id_match = _PROJECT_ID_PATTERN.search(user_message)
        if project_id_match:
            return await self._get_project_by_id(project_id=project_id_match.group(1), user_id=user_id, db_session=db_session)

        title = self._extract_title(user_message)
        if not title:
            title = self._extract_name_after_keyword(user_message, keywords=("项目",), max_len=80)
        if not title:
            return None

        projects = await self._list_user_projects(user_id=user_id, db_session=db_session, limit=50)
        return self._match_by_title_or_name(projects, title, title_key="title")

    async def _list_user_projects(self, *, user_id: str, db_session: Any, limit: int) -> list[dict[str, Any]]:
        from app.gateway.novel_migrated.api.projects import list_projects

        payload = await list_projects(user_id=user_id, db=db_session, status=None, offset=0, limit=max(1, min(limit, 100)))
        projects = payload.get("projects")
        if isinstance(projects, list):
            return [item for item in projects if isinstance(item, dict)]
        return []

    async def _get_project_by_id(self, *, project_id: str, user_id: str, db_session: Any) -> dict[str, Any] | None:
        from app.gateway.novel_migrated.api.projects import get_project

        try:
            project = await get_project(project_id=project_id, user_id=user_id, db=db_session)
            if isinstance(project, dict):
                return project
            return None
        except Exception:
            return None

    async def _get_project_model(self, *, project_id: str, user_id: str, db_session: Any) -> Any | None:
        from sqlalchemy import select

        from app.gateway.novel_migrated.models.project import Project

        result = await db_session.execute(
            select(Project).where(
                Project.id == project_id,
                Project.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def _resolve_chapter_from_text(
        self,
        *,
        project_id: str,
        user_id: str,
        user_message: str,
        db_session: Any,
    ) -> dict[str, Any] | None:
        from app.gateway.novel_migrated.api.chapters import list_chapters

        data = await list_chapters(
            project_id=project_id,
            user_id=user_id,
            db=db_session,
            outline_id=None,
            status=None,
            offset=0,
            limit=200,
        )
        chapters = data.get("chapters", [])
        if not isinstance(chapters, list):
            chapters = []

        number_match = _CHAPTER_NO_PATTERN.search(user_message)
        if number_match:
            chapter_number = int(number_match.group(1))
            for item in chapters:
                if int(item.get("chapter_number") or 0) == chapter_number:
                    return item

        title = self._extract_title(user_message)
        if not title:
            title = self._extract_name_after_keyword(user_message, keywords=("章节", "章"), max_len=100)
        if title:
            return self._match_by_title_or_name(chapters, title, title_key="title")

        return None

    async def _resolve_outline_from_text(
        self,
        *,
        project_id: str,
        user_id: str,
        user_message: str,
        db_session: Any,
    ) -> dict[str, Any] | None:
        from app.gateway.novel_migrated.api.outlines import list_outlines

        data = await list_outlines(project_id=project_id, user_id=user_id, db=db_session)
        outlines = data.get("outlines", [])
        if not isinstance(outlines, list):
            outlines = []

        idx_match = _OUTLINE_NO_PATTERN.search(user_message)
        if idx_match:
            index = int(idx_match.group(1))
            for item in outlines:
                if int(item.get("order_index") or 0) == index:
                    return item

        title = self._extract_title(user_message)
        if not title:
            title = self._extract_name_after_keyword(user_message, keywords=("大纲",), max_len=100)
        if title:
            return self._match_by_title_or_name(outlines, title, title_key="title")
        return None

    async def _resolve_character_from_text(
        self,
        *,
        project_id: str,
        user_id: str,
        user_message: str,
        db_session: Any,
        allow_organization: bool,
    ) -> dict[str, Any] | None:
        from app.gateway.novel_migrated.api.characters import list_characters

        data = await list_characters(
            project_id=project_id,
            user_id=user_id,
            db=db_session,
            is_organization=None if allow_organization else False,
            role_type=None,
        )
        characters = data.get("characters", [])
        if not isinstance(characters, list):
            characters = []

        name = self._extract_name_after_keyword(user_message, keywords=("角色", "人物", "组织"), max_len=80)
        if not name:
            title = self._extract_title(user_message)
            if title:
                name = title
        if not name:
            return None

        return self._match_by_title_or_name(characters, name, title_key="name")

    async def _resolve_character_by_name(self, *, project_id: str, name: str, user_id: str, db_session: Any) -> dict[str, Any]:
        from app.gateway.novel_migrated.api.characters import list_characters

        data = await list_characters(project_id=project_id, user_id=user_id, db=db_session, is_organization=None, role_type=None)
        characters = data.get("characters", [])
        if not isinstance(characters, list):
            characters = []
        matched = self._match_by_title_or_name(characters, name, title_key="name")
        if matched is None:
            raise ValueError(f"未找到角色：{name}")
        return matched

    async def _resolve_organization_from_text(
        self,
        *,
        project_id: str,
        user_id: str,
        user_message: str,
        db_session: Any,
    ) -> dict[str, Any] | None:
        from app.gateway.novel_migrated.api.organizations import list_organizations

        data = await list_organizations(project_id=project_id, user_id=user_id, db=db_session)
        organizations = data.get("organizations", [])
        if not isinstance(organizations, list):
            organizations = []

        name = self._extract_name_after_keyword(user_message, keywords=("组织",), max_len=80)
        if not name:
            title = self._extract_title(user_message)
            if title:
                name = title
        if not name:
            return None

        return self._match_by_title_or_name(organizations, name, title_key="name")

    async def _resolve_organization_by_name(self, *, project_id: str, name: str, user_id: str, db_session: Any) -> dict[str, Any]:
        from app.gateway.novel_migrated.api.organizations import list_organizations

        data = await list_organizations(project_id=project_id, user_id=user_id, db=db_session)
        organizations = data.get("organizations", [])
        if not isinstance(organizations, list):
            organizations = []
        matched = self._match_by_title_or_name(organizations, name, title_key="name")
        if matched is None:
            raise ValueError(f"未找到组织：{name}")
        return matched

    async def _resolve_item_from_text(self, *, project_id: str, user_message: str, db_session: Any) -> dict[str, Any] | None:
        items = await self._list_item_foreshadows(project_id=project_id, db_session=db_session)
        if not items:
            return None

        name = self._extract_name_after_keyword(user_message, keywords=("物品", "道具"), max_len=80)
        if not name:
            title = self._extract_title(user_message)
            if title:
                name = title
        if not name:
            return None

        return self._match_by_title_or_name(items, name, title_key="title")

    async def _list_item_foreshadows(self, *, project_id: str, db_session: Any) -> list[dict[str, Any]]:
        from app.gateway.novel_migrated.services.foreshadow_service import foreshadow_service

        payload = await foreshadow_service.get_project_foreshadows(
            db=db_session,
            project_id=project_id,
            status=None,
            category="item",
            source_type=None,
            is_long_term=None,
            page=1,
            limit=200,
        )
        items = payload.get("items") if isinstance(payload, dict) else []
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
        return []

    @staticmethod
    def _match_by_title_or_name(items: list[dict[str, Any]], query: str, *, title_key: str) -> dict[str, Any] | None:
        normalized = query.strip().lower()
        if not normalized:
            return None

        exact = [item for item in items if str(item.get(title_key) or "").strip().lower() == normalized]
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            return exact[0]

        contains = [item for item in items if normalized in str(item.get(title_key) or "").strip().lower()]
        if not contains:
            return None
        return contains[0]

    @staticmethod
    def _match_relationship(relationships: list[dict[str, Any]], from_id: str, to_id: str) -> dict[str, Any] | None:
        for item in relationships:
            source = str(item.get("character_from_id") or "")
            target = str(item.get("character_to_id") or "")
            if source == from_id and target == to_id:
                return item
        return None

    @staticmethod
    def _chapter_label(chapter: dict[str, Any] | None) -> str:
        if not chapter:
            return ""
        return f"第{chapter.get('chapter_number')}章《{chapter.get('title') or '未命名'}》"

    @staticmethod
    def _outline_label(outline: dict[str, Any] | None) -> str:
        if not outline:
            return ""
        return f"第{outline.get('order_index')}条《{outline.get('title') or '未命名'}》"

    @staticmethod
    def _character_label(character: dict[str, Any] | None) -> str:
        if not character:
            return ""
        return str(character.get("name") or "")

    @staticmethod
    def _organization_label(organization: dict[str, Any] | None) -> str:
        if not organization:
            return ""
        return str(organization.get("name") or "")

    @staticmethod
    def _is_chapter_create_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("新建章节", "新增章节", "创建章节"))

    @staticmethod
    def _is_chapter_update_request(lowered: str) -> bool:
        return ("章" in lowered or "章节" in lowered) and any(keyword in lowered for keyword in ("修改", "更新", "改写", "重写"))

    @staticmethod
    def _is_chapter_delete_request(lowered: str) -> bool:
        return ("章" in lowered or "章节" in lowered) and "删除" in lowered

    @staticmethod
    def _is_outline_create_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("新建大纲", "新增大纲", "创建大纲"))

    @staticmethod
    def _is_outline_update_request(lowered: str) -> bool:
        return "大纲" in lowered and any(keyword in lowered for keyword in ("修改", "更新", "调整", "改"))

    @staticmethod
    def _is_outline_delete_request(lowered: str) -> bool:
        return "大纲" in lowered and "删除" in lowered

    @staticmethod
    def _is_character_create_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("新增角色", "创建角色", "新增人物", "创建人物"))

    @staticmethod
    def _is_character_update_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("角色", "人物")) and any(keyword in lowered for keyword in ("修改", "更新", "改"))

    @staticmethod
    def _is_character_delete_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("角色", "人物")) and "删除" in lowered

    @staticmethod
    def _is_relationship_create_request(lowered: str) -> bool:
        return "关系" in lowered and any(keyword in lowered for keyword in ("新增", "新建", "创建", "添加"))

    @staticmethod
    def _is_relationship_update_request(lowered: str) -> bool:
        return "关系" in lowered and any(keyword in lowered for keyword in ("修改", "更新", "调整", "改"))

    @staticmethod
    def _is_relationship_delete_request(lowered: str) -> bool:
        return "关系" in lowered and "删除" in lowered

    @staticmethod
    def _is_organization_create_request(lowered: str) -> bool:
        return "组织" in lowered and any(keyword in lowered for keyword in ("新增", "新建", "创建", "添加"))

    @staticmethod
    def _is_organization_update_request(lowered: str) -> bool:
        return "组织" in lowered and any(keyword in lowered for keyword in ("修改", "更新", "调整", "改"))

    @staticmethod
    def _is_organization_delete_request(lowered: str) -> bool:
        return "组织" in lowered and "删除" in lowered

    @staticmethod
    def _is_organization_member_request(lowered: str) -> bool:
        return "组织" in lowered and any(keyword in lowered for keyword in ("成员", "加入")) and any(keyword in lowered for keyword in ("新增", "添加", "加入", "更新"))

    @staticmethod
    def _is_item_create_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("新增物品", "新建物品", "创建物品", "添加物品", "新增道具", "新建道具", "创建道具"))

    @staticmethod
    def _is_item_update_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("物品", "道具")) and any(keyword in lowered for keyword in ("修改", "更新", "改"))

    @staticmethod
    def _is_item_delete_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("物品", "道具")) and "删除" in lowered

    @staticmethod
    def _is_project_update_request(lowered: str) -> bool:
        return "项目" in lowered and any(keyword in lowered for keyword in ("修改", "更新", "改", "设置"))

    @staticmethod
    def _is_project_delete_request(lowered: str) -> bool:
        return "项目" in lowered and "删除" in lowered

    @staticmethod
    def _is_project_export_request(lowered: str) -> bool:
        return "项目" in lowered and any(keyword in lowered for keyword in ("导出", "export"))

    @staticmethod
    def _is_outline_generate_request(lowered: str) -> bool:
        return "大纲" in lowered and any(keyword in lowered for keyword in ("生成", "自动生成", "重建"))

    @staticmethod
    def _is_character_generate_request(lowered: str) -> bool:
        return any(keyword in lowered for keyword in ("角色", "人物", "组织")) and any(
            keyword in lowered
            for keyword in (
                "自动生成",
                "批量生成",
                "生成角色与组织",
                "生成组织和角色",
                "补充角色",
            )
        )

    @staticmethod
    def _is_project_list_request(text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in _PROJECT_LIST_KEYWORDS) or any(keyword in lowered for keyword in ("list projects",))

    @staticmethod
    def _is_project_switch_request(text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in _PROJECT_SWITCH_KEYWORDS) or any(keyword in lowered for keyword in ("switch project", "use project"))

    @staticmethod
    def _is_current_project_request(text: str) -> bool:
        lowered = text.lower()
        return any(keyword in text for keyword in ("当前项目", "现在项目", "项目信息")) or "current project" in lowered

    @staticmethod
    def _is_entity_list_request(lowered: str) -> bool:
        list_keywords = ("列表", "列出", "查看", "有哪些")
        return any(keyword in lowered for keyword in list_keywords) and any(entity in lowered for entity in _MANAGE_ENTITY_KEYWORDS)

    @staticmethod
    def _extract_name_after_keyword(text: str, *, keywords: tuple[str, ...], max_len: int) -> str | None:
        for keyword in keywords:
            pattern = re.compile(rf"{re.escape(keyword)}\s*[：:]?\s*([\u4e00-\u9fa5A-Za-z0-9_\-]{1,{max_len}})")
            match = pattern.search(text)
            if match:
                return match.group(1).strip()
        return None

    def _extract_project_update_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        title = self._extract_assignment(text, labels=("书名", "项目名", "标题", "title"), max_len=120)
        if title:
            payload["title"] = title

        genre_raw = self._extract_assignment(text, labels=("类型", "genre"), max_len=30)
        if genre_raw:
            payload["genre"] = self._extract_genre(genre_raw) or genre_raw[:30]

        theme = self._extract_assignment(text, labels=("主题", "题材", "核心设定", "theme"), max_len=120)
        if theme:
            payload["theme"] = theme

        description = self._extract_long_text(text, prefixes=("简介改成", "简介为", "项目简介", "description:"), max_len=2000)
        if description:
            payload["description"] = description

        target_words = self._extract_target_words(text)
        if target_words is not None:
            payload["target_words"] = target_words

        chapter_count = self._extract_integer_assignment(text, labels=("章节数", "章节数量", "chapter_count"))
        if chapter_count is not None:
            payload["chapter_count"] = max(1, chapter_count)

        perspective = self._extract_assignment(text, labels=("叙事视角", "视角", "narrative_perspective"), max_len=30)
        if perspective:
            payload["narrative_perspective"] = perspective

        outline_mode = self._extract_outline_mode(text)
        if outline_mode:
            payload["outline_mode"] = outline_mode

        world_time_period = self._extract_assignment(text, labels=("时间背景", "时代", "world_time_period"), max_len=120)
        if world_time_period:
            payload["world_time_period"] = world_time_period

        world_location = self._extract_assignment(text, labels=("地理位置", "地点", "world_location"), max_len=120)
        if world_location:
            payload["world_location"] = world_location

        world_atmosphere = self._extract_assignment(text, labels=("氛围", "基调", "world_atmosphere"), max_len=120)
        if world_atmosphere:
            payload["world_atmosphere"] = world_atmosphere

        world_rules = self._extract_long_text(text, prefixes=("世界规则", "规则改成", "world_rules"), max_len=2000)
        if world_rules:
            payload["world_rules"] = world_rules

        return payload

    def _extract_chapter_create_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        chapter_no_match = _CHAPTER_NO_PATTERN.search(text)
        if chapter_no_match:
            payload["chapter_number"] = int(chapter_no_match.group(1))

        title = self._extract_assignment(text, labels=("标题", "章节标题", "章名", "title"), max_len=120)
        if title:
            payload["title"] = title

        summary = self._extract_long_text(text, prefixes=("摘要改成", "摘要为", "摘要：", "summary:"), max_len=2000)
        if summary:
            payload["summary"] = summary

        content = self._extract_long_text(text, prefixes=("内容改成", "正文改成", "内容为", "正文为", "内容：", "正文：", "content:"), max_len=8000)
        if content:
            payload["content"] = content

        expansion_plan = self._extract_long_text(text, prefixes=("扩写计划", "展开计划", "expansion_plan"), max_len=2000)
        if expansion_plan:
            payload["expansion_plan"] = expansion_plan

        return payload

    def _extract_chapter_update_payload(self, text: str) -> dict[str, Any]:
        payload = self._extract_chapter_create_payload(text)
        payload.pop("chapter_number", None)
        return payload

    def _extract_outline_create_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        title = self._extract_assignment(text, labels=("标题", "大纲标题", "title"), max_len=120)
        if title:
            payload["title"] = title

        content = self._extract_long_text(text, prefixes=("内容改成", "内容为", "内容：", "正文：", "summary:"), max_len=8000)
        if content:
            payload["content"] = content

        structure = self._extract_long_text(text, prefixes=("结构改成", "结构为", "structure:"), max_len=4000)
        if structure:
            payload["structure"] = structure

        order_index = self._extract_integer_assignment(text, labels=("顺序", "序号", "order_index"))
        if order_index is not None:
            payload["order_index"] = order_index

        return payload

    def _extract_outline_update_payload(self, text: str) -> dict[str, Any]:
        return self._extract_outline_create_payload(text)

    def _extract_character_create_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        name = self._extract_name_after_keyword(text, keywords=("角色", "人物"), max_len=80)
        if not name:
            name = self._extract_assignment(text, labels=("姓名", "名字", "name"), max_len=80)
        if name:
            payload["name"] = name

        if "组织" in text and "角色" not in text and "人物" not in text:
            payload["is_organization"] = True

        role_type = self._extract_role_type(text)
        if role_type:
            payload["role_type"] = role_type

        personality = self._extract_long_text(text, prefixes=("性格改成", "性格为", "性格：", "personality:"), max_len=2000)
        if personality:
            payload["personality"] = personality

        background = self._extract_long_text(text, prefixes=("背景改成", "背景为", "背景：", "background:"), max_len=4000)
        if background:
            payload["background"] = background

        appearance = self._extract_long_text(text, prefixes=("外貌改成", "外貌为", "外貌：", "appearance:"), max_len=2000)
        if appearance:
            payload["appearance"] = appearance

        age = self._extract_assignment(text, labels=("年龄", "age"), max_len=20)
        if age:
            payload["age"] = age

        gender = self._extract_assignment(text, labels=("性别", "gender"), max_len=20)
        if gender:
            payload["gender"] = gender

        organization_type = self._extract_assignment(text, labels=("组织类型", "organization_type"), max_len=80)
        if organization_type:
            payload["organization_type"] = organization_type

        organization_purpose = self._extract_long_text(text, prefixes=("组织目的", "宗旨", "organization_purpose"), max_len=1000)
        if organization_purpose:
            payload["organization_purpose"] = organization_purpose

        relationships_text = self._extract_long_text(text, prefixes=("关系描述", "关系：", "relationships_text"), max_len=3000)
        if relationships_text:
            payload["relationships_text"] = relationships_text

        return payload

    def _extract_character_update_payload(self, text: str) -> dict[str, Any]:
        payload = self._extract_character_create_payload(text)
        payload.pop("name", None)
        payload.pop("is_organization", None)

        current_state = self._extract_long_text(text, prefixes=("状态改成", "当前状态", "current_state"), max_len=2000)
        if current_state:
            payload["current_state"] = current_state

        return payload

    def _extract_relationship_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        pair_match = _RELATION_PAIR_PATTERN.search(text)
        if pair_match:
            payload["character_from_name"] = pair_match.group(1)
            payload["character_to_name"] = pair_match.group(2)

        relationship_name = self._extract_assignment(text, labels=("关系", "关系名", "relationship"), max_len=60)
        if relationship_name:
            payload["relationship_name"] = relationship_name

        intimacy = self._extract_integer_assignment(text, labels=("亲密度", "intimacy", "intimacy_level"))
        if intimacy is not None:
            payload["intimacy_level"] = max(-100, min(100, intimacy))

        description = self._extract_long_text(text, prefixes=("关系描述", "描述：", "description:"), max_len=2000)
        if description:
            payload["description"] = description

        status = self._extract_assignment(text, labels=("关系状态", "status"), max_len=30)
        if status:
            payload["status"] = status

        return payload

    def _extract_organization_update_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        organization_type = self._extract_assignment(text, labels=("组织类型", "organization_type"), max_len=80)
        if organization_type:
            payload["organization_type"] = organization_type

        purpose = self._extract_long_text(text, prefixes=("组织目的", "目的改成", "宗旨", "purpose"), max_len=1000)
        if purpose:
            payload["purpose"] = purpose

        hierarchy = self._extract_long_text(text, prefixes=("层级", "架构", "hierarchy"), max_len=1000)
        if hierarchy:
            payload["hierarchy"] = hierarchy

        power_match = _POWER_LEVEL_PATTERN.search(text)
        if power_match:
            payload["power_level"] = max(0, min(100, int(power_match.group(1))))

        location = self._extract_assignment(text, labels=("地点", "所在地", "location"), max_len=120)
        if location:
            payload["location"] = location

        return payload

    def _extract_organization_create_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        name = self._extract_name_after_keyword(text, keywords=("组织",), max_len=80)
        if not name:
            name = self._extract_assignment(text, labels=("组织名", "组织名称", "name"), max_len=80)
        if name:
            payload["name"] = name

        payload.update(self._extract_organization_update_payload(text))
        return payload

    def _extract_organization_member_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        org_name = self._extract_name_after_keyword(text, keywords=("组织",), max_len=80)
        if org_name:
            payload["organization_name"] = org_name

        member_name = self._extract_name_after_keyword(text, keywords=("成员", "角色", "人物"), max_len=80)
        if member_name:
            payload["member_name"] = member_name

        position = self._extract_assignment(text, labels=("职位", "position"), max_len=80)
        if position:
            payload["position"] = position

        rank = self._extract_integer_assignment(text, labels=("等级", "rank"))
        if rank is not None:
            payload["rank"] = max(0, min(100, rank))

        loyalty = self._extract_integer_assignment(text, labels=("忠诚度", "loyalty"))
        if loyalty is not None:
            payload["loyalty"] = max(0, min(100, loyalty))

        status = self._extract_assignment(text, labels=("状态", "status"), max_len=30)
        if status:
            payload["status"] = status

        return payload

    def _extract_item_create_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}

        title = self._extract_name_after_keyword(text, keywords=("物品", "道具"), max_len=120)
        if not title:
            title = self._extract_assignment(text, labels=("物品名", "道具名", "名称", "title"), max_len=120)
        if title:
            payload["title"] = title

        content = self._extract_long_text(text, prefixes=("描述改成", "描述为", "描述：", "作用", "content:"), max_len=4000)
        if content:
            payload["content"] = content

        tags_text = self._extract_assignment(text, labels=("标签", "tags"), max_len=200)
        if tags_text:
            payload["tags"] = [part.strip() for part in re.split(r"[，,、]", tags_text) if part.strip()]

        notes = self._extract_long_text(text, prefixes=("备注", "notes"), max_len=2000)
        if notes:
            payload["notes"] = notes

        return payload

    def _extract_item_update_payload(self, text: str) -> dict[str, Any]:
        payload = self._extract_item_create_payload(text)
        payload.pop("title", None)
        return payload

    def _extract_outline_generate_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        chapter_count = self._extract_integer_assignment(text, labels=("章节数", "章数", "chapter_count"))
        if chapter_count is not None:
            payload["chapter_count"] = max(5, min(chapter_count, 300))

        perspective = self._extract_assignment(
            text,
            labels=("叙事视角", "视角", "narrative_perspective"),
            max_len=30,
        )
        if perspective:
            payload["narrative_perspective"] = perspective

        target_words = self._extract_target_words(text)
        if target_words is not None:
            payload["target_words"] = target_words
        return payload

    def _extract_character_generate_payload(self, text: str) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        count = self._extract_integer_assignment(text, labels=("角色数", "人物数", "count", "character_count"))
        if count is not None:
            payload["count"] = max(5, min(count, 20))

        genre_raw = self._extract_assignment(text, labels=("类型", "genre"), max_len=30)
        if genre_raw:
            payload["genre"] = self._extract_genre(genre_raw) or genre_raw[:30]

        theme = self._extract_assignment(text, labels=("主题", "题材", "theme"), max_len=120)
        if theme:
            payload["theme"] = theme
        return payload

    @staticmethod
    def _extract_assignment(text: str, *, labels: tuple[str, ...], max_len: int) -> str | None:
        for label in labels:
            patterns = (
                rf"{re.escape(label)}\s*(?:改成|改为|设为|设置为|为|是|:|：)\s*([^\n，。!?；;]{{1,{max_len}}})",
                rf"{re.escape(label)}\s*[:：]\s*([^\n，。!?；;]{{1,{max_len}}})",
            )
            for pattern in patterns:
                match = re.search(pattern, text, flags=re.IGNORECASE)
                if not match:
                    continue
                candidate = match.group(1).strip().strip('"“”')
                if candidate:
                    return candidate[:max_len]
        return None

    @staticmethod
    def _extract_integer_assignment(text: str, *, labels: tuple[str, ...]) -> int | None:
        for label in labels:
            match = re.search(rf"{re.escape(label)}\s*(?:改成|改为|设为|设置为|为|是|:|：)?\s*(-?\d{{1,6}})", text, flags=re.IGNORECASE)
            if match:
                return int(match.group(1))
        return None

    @staticmethod
    def _extract_long_text(text: str, *, prefixes: tuple[str, ...], max_len: int) -> str | None:
        lowered = text.lower()
        for prefix in prefixes:
            idx = lowered.find(prefix.lower())
            if idx == -1:
                continue
            candidate = text[idx + len(prefix) :].strip().lstrip("：:，, ")
            if candidate:
                return candidate[:max_len]
        return None

    @staticmethod
    def _extract_outline_mode(text: str) -> str | None:
        lowered = text.lower()
        if "一对一" in text or "one-to-one" in lowered:
            return "one-to-one"
        if "一对多" in text or "one-to-many" in lowered:
            return "one-to-many"
        return None

    @staticmethod
    def _extract_role_type(text: str) -> str | None:
        lowered = text.lower()
        if "主角" in text or "protagonist" in lowered:
            return "protagonist"
        if "反派" in text or "antagonist" in lowered:
            return "antagonist"
        if "配角" in text or "supporting" in lowered:
            return "supporting"

        role_type = IntentRecognitionMiddleware._extract_assignment(text, labels=("角色类型", "role_type"), max_len=40)
        return role_type

    def _build_manage_skill_hint(self) -> str:
        skills = self._load_enabled_novel_skills(force_refresh=False)
        if not skills:
            return ""
        top = "、".join(entry["name"] for entry in skills[:3])
        return f"当前已按主项目技能开关加载技能：{top}。后续追问会按需参考这些技能。"

    async def _reply_with_skill_guidance(
        self,
        *,
        session: _NovelCreationSession,
        field_name: str,
        ai_service: Any | None,
        include_question: bool,
    ) -> IntentRecognitionResult:
        guidance = await self._generate_skill_guidance(
            session=session,
            field_name=field_name,
            ai_service=ai_service,
            force_refresh=True,
        )
        question = _FIELD_QUESTIONS.get(field_name, "请继续补充创建信息。")

        parts: list[str] = []
        if include_question:
            parts.append(question)
        if guidance:
            parts.append(guidance)
        else:
            parts.append("当前未读取到可用技能建议，请直接填写该字段。")

        return IntentRecognitionResult(
            handled=True,
            content="\n\n".join(parts),
            session=self._session_brief(session),
        )

    async def _generate_skill_guidance(
        self,
        *,
        session: _NovelCreationSession,
        field_name: str,
        ai_service: Any | None,
        force_refresh: bool = False,
    ) -> str:
        cached = session.skill_suggestions.get(field_name)
        if cached and not force_refresh:
            return cached

        skill_entries = self._load_enabled_novel_skills(force_refresh=force_refresh)
        if not skill_entries:
            return ""

        guidance = ""
        if ai_service is not None:
            guidance = await self._generate_skill_guidance_via_model(
                field_name=field_name,
                fields=session.fields,
                ai_service=ai_service,
                skills=skill_entries,
            )

        if not guidance:
            top_skills = "、".join(entry["name"] for entry in skill_entries[:3])
            guidance = f"已加载主项目技能：{top_skills}。如果你需要，我可以基于这些技能给你更细的选项。"

        session.skill_suggestions[field_name] = guidance
        session.updated_at = datetime.now()
        await self._save_session(session)
        return guidance

    async def _generate_skill_guidance_via_model(
        self,
        *,
        field_name: str,
        fields: dict[str, Any],
        ai_service: Any,
        skills: list[dict[str, str]],
    ) -> str:
        try:
            skill_text = "\n\n".join(
                f"[技能]{entry['name']}\n描述: {entry['description']}\n要点摘录:\n{entry['snippet']}"
                for entry in skills[:4]
            )
            fields_json = json.dumps(fields, ensure_ascii=False)

            messages = [
                {
                    "role": "system",
                    "content": (
                        "你是小说创建向导。"
                        "你必须优先参考给定的主项目技能内容，"
                        "为当前字段提供最多3条简短建议，每条一行。"
                        "不要输出JSON。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"当前字段: {_FIELD_LABELS.get(field_name, field_name)}\n"
                        f"已收集信息: {fields_json}\n"
                        f"可参考技能:\n{skill_text}"
                    ),
                },
            ]

            result = await ai_service.generate_text_with_messages(
                messages=messages,
                temperature=0.3,
                max_tokens=280,
                auto_mcp=False,
            )
            content = str(result.get("content") or "").strip()
            if content:
                return f"技能建议：\n{content}"
            return ""
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("skill guidance generation failed: %s", exc)
            return ""

    def _load_enabled_novel_skills(self, *, force_refresh: bool = False) -> list[dict[str, str]]:
        now = datetime.now()
        config_mtime = self._get_extensions_config_mtime()
        can_reuse_cache = (
            not force_refresh
            and self._skills_cache_at is not None
            and now - self._skills_cache_at < _SKILL_CACHE_TTL
            and self._skills_cache_config_mtime == config_mtime
        )
        if can_reuse_cache:
            return self._skills_cache

        entries: list[dict[str, str]] = []
        try:
            skills = load_skills(enabled_only=False)

            try:
                extensions_config = ExtensionsConfig.from_file()
                enabled_skills = [
                    skill
                    for skill in skills
                    if extensions_config.is_skill_enabled(skill.name, skill.category)
                ]
            except Exception as config_exc:
                logger.warning("failed to load extensions config for skill toggles: %s", config_exc)
                # Follow deerflow fail-open behavior: keep skills available when config is unreadable.
                enabled_skills = skills

            for skill in enabled_skills:
                name = skill.name.strip()
                description = (skill.description or "").strip()
                raw = skill.skill_file.read_text(encoding="utf-8", errors="ignore")
                snippet = self._extract_skill_snippet(raw)
                content_for_filter = f"{name}\n{description}\n{snippet}".lower()
                relevance = sum(1 for keyword in _NOVEL_SKILL_KEYWORDS if keyword in content_for_filter)

                entries.append(
                    {
                        "name": name,
                        "description": description,
                        "snippet": snippet[:1200],
                        "_relevance": relevance,
                    }
                )

            entries.sort(
                key=lambda item: (
                    int(item.get("_relevance", 0)),
                    len(str(item.get("description", ""))),
                ),
                reverse=True,
            )
            entries = entries[:_MAX_SKILL_ENTRIES]
            for item in entries:
                item.pop("_relevance", None)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("failed to load enabled skills for intent middleware: %s", exc)
            entries = []

        self._skills_cache = entries
        self._skills_cache_at = now
        self._skills_cache_config_mtime = config_mtime
        return entries

    @staticmethod
    def _get_extensions_config_mtime() -> float | None:
        try:
            path = ExtensionsConfig.resolve_config_path()
            if path is None or not path.exists():
                return None
            return path.stat().st_mtime
        except Exception:
            return None

    @staticmethod
    def _extract_skill_snippet(content: str) -> str:
        text = content.strip()
        if text.startswith("---"):
            parts = text.split("---", 2)
            if len(parts) == 3:
                text = parts[2].strip()
        return text

    @staticmethod
    def _extract_latest_user_message(messages: list[Any]) -> str:
        for msg in reversed(messages):
            role = str(getattr(msg, "role", "")).strip().lower()
            if role == "user":
                content = str(getattr(msg, "content", "")).strip()
                if content:
                    return content
        return ""

    def _detect_novel_creation_intent(self, user_message: str) -> _NovelCreateIntent | None:
        normalized = (user_message or "").strip()
        if not normalized:
            return None

        lowered = normalized.lower()
        compact = re.sub(r"\s+", "", lowered)
        hit_keyword = any(keyword in lowered or keyword in compact for keyword in _INTENT_KEYWORDS)
        if not hit_keyword:
            hit_keyword = any(pattern.search(normalized) for pattern in _INTENT_PATTERNS)
        if not hit_keyword:
            return None

        question_like = any(lowered.startswith(prefix) for prefix in _QUESTION_PREFIXES)
        if question_like and "帮我" not in normalized and "please" not in lowered:
            return None

        prefill = self._extract_fields_from_message(normalized)
        return _NovelCreateIntent(raw_message=normalized, prefill=prefill)

    def _detect_novel_management_intent(self, user_message: str) -> bool:
        normalized = (user_message or "").strip()
        if not normalized:
            return False

        if any(keyword in normalized for keyword in _PROJECT_LIST_KEYWORDS):
            return True
        if any(keyword in normalized for keyword in _PROJECT_SWITCH_KEYWORDS):
            return True

        has_entity = any(keyword in normalized for keyword in _MANAGE_ENTITY_KEYWORDS)
        has_action = any(keyword in normalized for keyword in _MANAGE_ACTION_KEYWORDS)
        if has_entity and has_action:
            return True

        return any(pattern.search(normalized) for pattern in _MANAGE_INTENT_PATTERNS)

    def _extract_fields_from_message(self, text: str) -> dict[str, Any]:
        fields: dict[str, Any] = {}

        title = self._extract_title(text)
        if title:
            fields["title"] = title

        genre = self._extract_genre(text)
        if genre:
            fields["genre"] = genre

        theme = self._extract_theme(text)
        if theme:
            fields["theme"] = theme

        audience = self._extract_audience(text)
        if audience:
            fields["audience"] = audience

        target_words = self._extract_target_words(text)
        if target_words is not None:
            fields["target_words"] = target_words

        return fields

    @staticmethod
    def _extract_title(user_message: str) -> str | None:
        stripped = user_message.strip()
        for pattern in _TITLE_PATTERNS:
            match = pattern.search(stripped)
            if not match:
                continue
            candidate = (match.group(1) or "").strip()
            if not candidate:
                continue
            if candidate in {"小说", "一本小说", "一部小说"}:
                continue
            return candidate[:60]
        return None

    @staticmethod
    def _extract_genre(user_message: str) -> str | None:
        lowered = user_message.lower()
        for keyword, canonical in _GENRE_MAP:
            if keyword in lowered or keyword in user_message:
                return canonical
        return None

    @staticmethod
    def _extract_theme(user_message: str) -> str | None:
        match = _THEME_PATTERN.search(user_message)
        if not match:
            return None
        return match.group(1).strip()[:80]

    @staticmethod
    def _extract_audience(user_message: str) -> str | None:
        match = _AUDIENCE_PATTERN.search(user_message)
        if not match:
            return None
        return match.group(1).strip()[:60]

    @staticmethod
    def _extract_target_words(user_message: str) -> int | None:
        match = _TARGET_WORDS_PATTERN.search(user_message)
        if not match:
            return None

        number = int(match.group(1))
        has_wan = bool(match.group(2))
        if has_wan:
            number *= 10000

        return max(1000, number)

    def _update_session_fields_from_message(self, session: _NovelCreationSession, user_message: str) -> None:
        updates = self._extract_fields_from_message(user_message)

        if session.last_prompted_field and session.last_prompted_field not in updates:
            fallback = self._normalize_field_input(session.last_prompted_field, user_message)
            if fallback is not None:
                updates[session.last_prompted_field] = fallback

        for key, value in updates.items():
            if value is None:
                continue
            session.fields[key] = value

    def _normalize_field_input(self, field_name: str, raw: str) -> Any:
        text = raw.strip().strip("。！？!?，,")
        if not text:
            return None

        if field_name == "target_words":
            return self._extract_target_words(text)

        if field_name == "genre":
            return self._extract_genre(text) or text[:30]

        if field_name == "title":
            cleaned = text.strip('"“”《》')
            return cleaned[:60] if cleaned else None

        if field_name == "theme":
            return text[:80]

        if field_name == "audience":
            return text[:60]

        return text

    def _next_missing_field(self, session: _NovelCreationSession) -> str | None:
        for field_name in _FIELD_ORDER:
            value = session.fields.get(field_name)
            if field_name == "target_words":
                if not isinstance(value, int) or value <= 0:
                    return field_name
                continue
            if not isinstance(value, str) or not value.strip():
                return field_name
        return None

    def _build_confirmation_summary(self, session: _NovelCreationSession) -> str:
        title = str(session.fields.get("title") or "")
        genre = str(session.fields.get("genre") or _DEFAULT_GENRE)
        theme = str(session.fields.get("theme") or "")
        audience = str(session.fields.get("audience") or "")
        target_words = int(session.fields.get("target_words") or 0)

        return (
            "请确认创建信息：\n"
            f"- 书名：{title}\n"
            f"- 类型：{genre}\n"
            f"- 题材/主题：{theme}\n"
            f"- 目标受众：{audience}\n"
            f"- 目标字数：{target_words}\n\n"
            "回复“确认创建”后我才会真正创建项目（此时才落库）。\n"
            "如果要改，直接说“书名改成xxx / 类型改成xxx / 目标字数改成xx万字”。\n"
            "你也可以说“技能推荐”让我基于已启用主项目技能给你建议。"
        )

    @staticmethod
    def _compose_description(fields: dict[str, Any]) -> str:
        theme = str(fields.get("theme") or "").strip()
        audience = str(fields.get("audience") or "").strip()

        lines: list[str] = []
        if theme:
            lines.append(f"主题: {theme}")
        if audience:
            lines.append(f"目标受众: {audience}")

        return "\n".join(lines)

    @staticmethod
    def _resolve_session_key(request: Any, user_id: str) -> str:
        context = getattr(request, "context", None)
        return IntentRecognitionMiddleware._resolve_session_key_from_context(context, user_id)

    @staticmethod
    def _resolve_session_key_from_context(context: dict[str, Any] | None, user_id: str) -> str:
        if isinstance(context, dict):
            # Keep upstream-compatible thread first to avoid splitting main chat sessions.
            for key in _SESSION_CONTEXT_KEYS:
                value = context.get(key)
                if isinstance(value, str) and value.strip():
                    return f"{user_id}:{key}:{value.strip()}"
            if context:
                # Fallback: unknown context shape still gets a stable per-context key.
                digest = hashlib.sha1(
                    json.dumps(context, sort_keys=True, ensure_ascii=False).encode("utf-8")
                ).hexdigest()[:16]
                return f"{user_id}:ctx:{digest}"
        return f"{user_id}:default"

    @staticmethod
    def _is_skill_assist_request(lowered_message: str) -> bool:
        return any(keyword in lowered_message for keyword in _SKILL_REQUEST_KEYWORDS)

    @staticmethod
    def _resolve_field_from_text(text: str) -> str | None:
        lowered = text.lower()
        mapping = {
            "title": ("书名", "名字", "标题", "title"),
            "genre": ("类型", "genre", "风格"),
            "theme": ("题材", "主题", "theme", "设定"),
            "audience": ("受众", "读者", "audience"),
            "target_words": ("字数", "篇幅", "target_words"),
        }
        for field_name, keywords in mapping.items():
            if any(keyword in lowered for keyword in keywords):
                return field_name
        return None

    def _initialize_fields(self, prefill: dict[str, Any]) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "title": "",
            "genre": "",
            "theme": "",
            "audience": "",
            "target_words": 0,
        }
        for key, value in prefill.items():
            if key in fields and value is not None:
                fields[key] = value

        if isinstance(fields.get("genre"), str) and not fields["genre"]:
            fields["genre"] = ""

        return fields

    def _session_brief(self, session: _NovelCreationSession) -> dict[str, Any]:
        base = {
            "mode": session.mode,
            "status": "collecting" if not session.awaiting_confirm else "awaiting_confirmation",
            "active_project": {
                "id": session.active_project_id,
                "title": session.active_project_title,
            },
        }

        if session.idempotency_key:
            base["idempotency_key"] = session.idempotency_key

        if session.mode == "create":
            base["missing_field"] = self._next_missing_field(session)
            base["fields"] = {
                "title": session.fields.get("title") or "",
                "genre": session.fields.get("genre") or "",
                "theme": session.fields.get("theme") or "",
                "audience": session.fields.get("audience") or "",
                "target_words": session.fields.get("target_words") or 0,
            }
            return base

        base["pending_action"] = (
            {
                "action": session.pending_action.action,
                "entity": session.pending_action.entity,
                "target": session.pending_action.target_label,
                "missing_fields": session.pending_action.missing_fields,
            }
            if session.pending_action
            else None
        )
        return base

    @staticmethod
    def _resolve_session_store_path() -> Path:
        configured = (os.getenv(_SESSION_STORE_PATH_ENV) or "").strip()
        if configured:
            return Path(configured)
        return Path(__file__).resolve().parents[1] / "data" / "intent_sessions.json"

    @staticmethod
    def _resolve_storage_backend() -> str:
        configured = (os.getenv(_SESSION_BACKEND_ENV) or "").strip().lower()
        if configured in _FILE_STORAGE_BACKENDS:
            return "file"
        if configured in _DATABASE_STORAGE_BACKENDS:
            return "database"
        if configured:
            logger.warning(
                "unknown %s=%s, fallback to database backend",
                _SESSION_BACKEND_ENV,
                configured,
            )
        return "database"

    @staticmethod
    def _safe_parse_dt(raw: Any, *, fallback: datetime | None = None) -> datetime:
        if isinstance(raw, datetime):
            return raw
        if isinstance(raw, str):
            try:
                return datetime.fromisoformat(raw)
            except ValueError:
                pass
        return fallback or datetime.now()

    @staticmethod
    def _serialize_pending_action(action: _PendingAction | None) -> dict[str, Any] | None:
        if action is None:
            return None
        return {
            "action": action.action,
            "entity": action.entity,
            "operation": action.operation,
            "project_id": action.project_id,
            "target_id": action.target_id,
            "target_label": action.target_label,
            "payload": action.payload,
            "missing_fields": action.missing_fields,
        }

    @staticmethod
    def _deserialize_pending_action(raw: Any) -> _PendingAction | None:
        if not isinstance(raw, dict):
            return None
        payload = raw.get("payload")
        missing_fields = raw.get("missing_fields")
        return _PendingAction(
            action=str(raw.get("action") or ""),
            entity=str(raw.get("entity") or ""),
            operation=str(raw.get("operation") or ""),
            project_id=str(raw.get("project_id") or "") or None,
            target_id=str(raw.get("target_id") or "") or None,
            target_label=str(raw.get("target_label") or ""),
            payload=payload if isinstance(payload, dict) else {},
            missing_fields=[str(item) for item in missing_fields] if isinstance(missing_fields, list) else [],
        )

    def _serialize_session(self, session: _NovelCreationSession) -> dict[str, Any]:
        return {
            "session_key": session.session_key,
            "user_id": session.user_id,
            "started_at": session.started_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "mode": session.mode,
            "fields": session.fields,
            "awaiting_confirm": session.awaiting_confirm,
            "last_prompted_field": session.last_prompted_field,
            "skill_suggestions": session.skill_suggestions,
            "active_project_id": session.active_project_id,
            "active_project_title": session.active_project_title,
            "pending_action": self._serialize_pending_action(session.pending_action),
            "idempotency_key": session.idempotency_key,
        }

    def _deserialize_session(self, raw: Any) -> _NovelCreationSession | None:
        if not isinstance(raw, dict):
            return None
        session_key = str(raw.get("session_key") or "").strip()
        user_id = str(raw.get("user_id") or "").strip()
        if not session_key or not user_id:
            return None

        fields = raw.get("fields")
        skill_suggestions = raw.get("skill_suggestions")
        started_at = self._safe_parse_dt(raw.get("started_at"))
        updated_at = self._safe_parse_dt(raw.get("updated_at"), fallback=started_at)
        pending_action = self._deserialize_pending_action(raw.get("pending_action"))

        return _NovelCreationSession(
            session_key=session_key,
            user_id=user_id,
            started_at=started_at,
            updated_at=updated_at,
            mode=str(raw.get("mode") or "normal"),
            fields=fields if isinstance(fields, dict) else self._initialize_fields({}),
            awaiting_confirm=bool(raw.get("awaiting_confirm", False)),
            last_prompted_field=str(raw.get("last_prompted_field") or "") or None,
            skill_suggestions=(
                {str(k): str(v) for k, v in skill_suggestions.items()}
                if isinstance(skill_suggestions, dict)
                else {}
            ),
            active_project_id=str(raw.get("active_project_id") or "") or None,
            active_project_title=str(raw.get("active_project_title") or "") or None,
            pending_action=pending_action,
            idempotency_key=str(raw.get("idempotency_key") or "") or None,
        )

    def _load_state_from_disk(self) -> None:
        if self._storage_backend != "file":
            return
        if not self._session_store_path.exists():
            return
        try:
            payload = json.loads(self._session_store_path.read_text(encoding="utf-8"))
            sessions_payload = payload.get("sessions")
            idempotency_payload = payload.get("idempotency_keys")
            now = datetime.now()

            if isinstance(sessions_payload, dict):
                for key, raw in sessions_payload.items():
                    session = self._deserialize_session(raw)
                    if session is None:
                        continue
                    if now - session.updated_at > _SESSION_TTL:
                        continue
                    self._sessions[str(key)] = session

            if isinstance(idempotency_payload, dict):
                for key, raw_ts in idempotency_payload.items():
                    ts = self._safe_parse_dt(raw_ts)
                    if now - ts > _SESSION_TTL:
                        continue
                    self._used_idempotency_keys[str(key)] = ts
        except Exception:
            logger.exception("failed to load intent session state from %s", self._session_store_path)

    def _persist_state_locked(self) -> None:
        if self._storage_backend != "file":
            return
        self._session_store_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "sessions": {key: self._serialize_session(session) for key, session in self._sessions.items()},
            "idempotency_keys": {key: ts.isoformat() for key, ts in self._used_idempotency_keys.items()},
            "updated_at": datetime.now().isoformat(),
        }
        tmp_path = self._session_store_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(self._session_store_path)

    def _persist_state_best_effort_locked(self) -> None:
        try:
            self._persist_state_locked()
        except Exception:
            logger.exception("failed to persist intent session state to %s", self._session_store_path)

    async def _db_get_session(self, session_key: str) -> _NovelCreationSession | None:
        from sqlalchemy import select

        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.models.intent_session import IntentSessionState

        await init_db_schema()
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(IntentSessionState).where(IntentSessionState.session_key == session_key)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None

            updated_at = row.updated_at or datetime.now()
            if datetime.now() - updated_at > _SESSION_TTL:
                await db.delete(row)
                await db.commit()
                return None

            try:
                payload = json.loads(row.payload_json)
            except Exception:
                await db.delete(row)
                await db.commit()
                return None

            session = self._deserialize_session(payload)
            if session is None:
                await db.delete(row)
                await db.commit()
                return None
            return session

    async def _db_upsert_session(self, session: _NovelCreationSession) -> None:
        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.models.intent_session import IntentSessionState

        await init_db_schema()
        payload_json = json.dumps(self._serialize_session(session), ensure_ascii=False)

        async with AsyncSessionLocal() as db:
            existing = await db.get(IntentSessionState, session.session_key)
            if existing is None:
                db.add(
                    IntentSessionState(
                        session_key=session.session_key,
                        user_id=session.user_id,
                        payload_json=payload_json,
                        updated_at=session.updated_at,
                    )
                )
            else:
                existing.user_id = session.user_id
                existing.payload_json = payload_json
                existing.updated_at = session.updated_at
            await db.commit()

    async def _db_delete_session(self, session_key: str) -> None:
        from sqlalchemy import delete

        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.models.intent_session import IntentSessionState

        await init_db_schema()
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(IntentSessionState).where(IntentSessionState.session_key == session_key)
            )
            await db.commit()

    async def _db_prune_expired_sessions(self) -> None:
        from sqlalchemy import delete

        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.models.intent_session import IntentSessionState

        await init_db_schema()
        cutoff = datetime.now() - _SESSION_TTL
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(IntentSessionState).where(IntentSessionState.updated_at < cutoff)
            )
            await db.commit()

    async def _db_consume_idempotency_key(
        self,
        key: str,
        *,
        user_id: str | None = None,
        action: str | None = None,
    ) -> bool:
        from sqlalchemy.exc import IntegrityError

        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.models.intent_session import IntentIdempotencyKey

        await init_db_schema()
        async with AsyncSessionLocal() as db:
            db.add(IntentIdempotencyKey(key=key, user_id=user_id, action=action))
            try:
                await db.commit()
                return True
            except IntegrityError:
                await db.rollback()
                return False

    async def _db_prune_expired_idempotency_keys(self) -> None:
        from sqlalchemy import delete

        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.models.intent_session import IntentIdempotencyKey

        await init_db_schema()
        cutoff = datetime.now() - _SESSION_TTL
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(IntentIdempotencyKey).where(IntentIdempotencyKey.created_at < cutoff)
            )
            await db.commit()

    async def _get_session(self, session_key: str) -> _NovelCreationSession | None:
        async with self._lock:
            if self._storage_backend == "database":
                try:
                    return await self._db_get_session(session_key)
                except Exception:
                    logger.exception("failed to load intent session from database, fallback to memory cache")
            return self._sessions.get(session_key)

    async def _save_session(self, session: _NovelCreationSession) -> None:
        async with self._lock:
            if self._storage_backend == "database":
                try:
                    await self._db_upsert_session(session)
                    return
                except Exception:
                    logger.exception("failed to persist intent session to database, fallback to memory cache")
            self._sessions[session.session_key] = session
            self._persist_state_best_effort_locked()

    async def _remove_session(self, session_key: str) -> None:
        async with self._lock:
            if self._storage_backend == "database":
                try:
                    await self._db_delete_session(session_key)
                    return
                except Exception:
                    logger.exception("failed to delete intent session from database, fallback to memory cache")
            self._sessions.pop(session_key, None)
            self._persist_state_best_effort_locked()

    async def _prune_expired_sessions(self) -> None:
        now = datetime.now()
        async with self._lock:
            if self._storage_backend == "database":
                try:
                    await self._db_prune_expired_sessions()
                    return
                except Exception:
                    logger.exception("failed to prune expired intent sessions in database, fallback to memory cache")
            expired = [
                key
                for key, session in self._sessions.items()
                if now - session.updated_at > _SESSION_TTL
            ]
            for key in expired:
                self._sessions.pop(key, None)
            if expired:
                self._persist_state_best_effort_locked()

    def _is_feature_enabled(self, *, user_id: str | None = None) -> bool:
        try:
            from deerflow.config.extensions_config import get_extensions_config
            cfg = get_extensions_config()
            if hasattr(cfg, "is_feature_enabled_for_user"):
                return cfg.is_feature_enabled_for_user(
                    self._INTENT_FEATURE_FLAG,
                    user_id=user_id,
                    default=True,
                )
            return cfg.is_feature_enabled(self._INTENT_FEATURE_FLAG, default=True)
        except Exception:
            return True

    @staticmethod
    def _generate_idempotency_key(user_id: str, action: str) -> str:
        raw = f"{user_id}:{action}:{datetime.now().isoformat()}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    async def _consume_idempotency_key(
        self,
        key: str,
        *,
        user_id: str | None = None,
        action: str | None = None,
    ) -> bool:
        async with self._lock:
            if self._storage_backend == "database":
                try:
                    return await self._db_consume_idempotency_key(
                        key,
                        user_id=user_id,
                        action=action,
                    )
                except Exception:
                    logger.exception("failed to consume idempotency key in database, fallback to memory cache")
            if key in self._used_idempotency_keys:
                return False
            self._used_idempotency_keys[key] = datetime.now()
            self._persist_state_best_effort_locked()
            return True

    async def _prune_expired_idempotency_keys(self) -> None:
        now = datetime.now()
        async with self._lock:
            if self._storage_backend == "database":
                try:
                    await self._db_prune_expired_idempotency_keys()
                    return
                except Exception:
                    logger.exception("failed to prune idempotency keys in database, fallback to memory cache")
            expired = [
                key for key, ts in self._used_idempotency_keys.items()
                if now - ts > _SESSION_TTL
            ]
            for key in expired:
                self._used_idempotency_keys.pop(key, None)
            if expired:
                self._persist_state_best_effort_locked()

    async def _create_with_modern_projects(
        self,
        *,
        session: _NovelCreationSession,
        db_session: Any,
    ) -> dict[str, Any]:
        from app.gateway.novel_migrated.api.projects import ProjectCreateRequest, create_project

        req = ProjectCreateRequest(
            title=str(session.fields.get("title") or ""),
            description=self._compose_description(session.fields),
            theme=str(session.fields.get("theme") or ""),
            genre=str(session.fields.get("genre") or _DEFAULT_GENRE),
            target_words=int(session.fields.get("target_words") or 100000),
        )
        project = await create_project(req=req, user_id=session.user_id, db=db_session)

        return {
            "id": project.get("id"),
            "title": project.get("title", req.title),
            "genre": project.get("genre") or req.genre,
            "theme": project.get("theme") or req.theme,
            "target_words": project.get("target_words") or req.target_words,
            "source": "novel_migrated.projects",
        }

    async def _create_with_legacy_store(
        self,
        *,
        session: _NovelCreationSession,
    ) -> dict[str, Any]:
        from app.gateway.routers.novel import _novel_store

        novel = await _novel_store.create_novel(
            {
                "title": str(session.fields.get("title") or ""),
                "metadata": {
                    "genre": str(session.fields.get("genre") or _DEFAULT_GENRE),
                    "theme": str(session.fields.get("theme") or ""),
                    "audience": str(session.fields.get("audience") or ""),
                    "target_words": int(session.fields.get("target_words") or 100000),
                    "description": self._compose_description(session.fields),
                    "created_by": "intent_recognition_session",
                },
            }
        )
        metadata = novel.get("metadata") if isinstance(novel, dict) else {}

        normalized_genre = str(session.fields.get("genre") or _DEFAULT_GENRE)
        normalized_theme = str(session.fields.get("theme") or "")
        normalized_target_words = int(session.fields.get("target_words") or 100000)

        if isinstance(metadata, dict):
            normalized_genre = str(metadata.get("genre", normalized_genre))
            normalized_theme = str(metadata.get("theme", normalized_theme))
            meta_target_words = metadata.get("target_words")
            if isinstance(meta_target_words, int) and meta_target_words > 0:
                normalized_target_words = meta_target_words

        return {
            "id": novel.get("id"),
            "title": novel.get("title", session.fields.get("title", "")),
            "genre": normalized_genre,
            "theme": normalized_theme,
            "target_words": normalized_target_words,
            "source": "legacy.novel_store",
        }
