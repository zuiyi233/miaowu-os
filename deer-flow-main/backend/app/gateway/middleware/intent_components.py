"""Composable components for intent recognition middleware.

This module introduces explicit component boundaries for C-04:
- IntentDetector
- SessionPersistence
- SessionManager
- ManageActionRouter

The middleware can wire these components incrementally while preserving
existing external API behavior.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.gateway.cache_policy import TimedOrderedCache
from app.gateway.middleware.domain_protocol import ActionUiHints, IntentCandidate, IntentDecisionPayload
from deerflow.protocols.execution_protocol import (
    has_explicit_execution_intent,
    is_authorization_command,
    is_question_like,
    is_revoke_command,
    should_answer_only,
)

try:  # pragma: no cover - optional runtime dependency
    from sentence_transformers import SentenceTransformer  # type: ignore
except Exception:  # pragma: no cover
    SentenceTransformer = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_DEFAULT_DECISION_EXEMPLARS: dict[str, list[str]] = {
    "create": [
        "帮我创建一本小说",
        "现在直接创建项目",
        "不用讨论了，直接创建",
        "请创建一部科幻小说",
    ],
    "manage": [
        "修改第3章内容",
        "删除第2章",
        "新增角色林彻",
        "更新世界观设定",
    ],
    "qa": [
        "怎么创建小说",
        "如何写大纲",
        "为什么这个角色冲突",
        "这是什么意思",
    ],
    "authorize": [
        "进入执行模式",
        "确认执行",
        "开启自动执行",
        "__enter_execution_mode__",
    ],
    "revoke": [
        "退出执行模式",
        "取消授权",
        "先别执行",
        "__exit_execution_mode__",
    ],
}


@dataclass
class DecisionThresholds:
    auto_execute_min: float = 0.62
    execute_advantage_min: float = 0.12
    confirmation_min: float = 0.55
    clarify_min: float = 0.45
    ambiguity_clarify_min: float = 0.55


class IntentDecisionEngine:
    """Hybrid intent decision engine (rules + semantic similarity + slot completeness)."""

    def __init__(
        self,
        *,
        exemplar_path: Path | None = None,
        embedding_model_name: str = "paraphrase-multilingual-MiniLM-L12-v2",
        thresholds: DecisionThresholds | None = None,
    ) -> None:
        self._exemplar_path = exemplar_path
        self._embedding_model_name = embedding_model_name
        self._thresholds = thresholds or DecisionThresholds()
        self._exemplars = self._load_exemplars()
        self._embedding_model: Any | None = None
        self._embedding_failed = False
        self._embedding_cache = TimedOrderedCache[str, list[float]](
            name="intent decision embeddings",
            ttl_seconds=24 * 60 * 60,
            max_size=2048,
            logger=logger,
        )

    def _load_exemplars(self) -> dict[str, list[str]]:
        if self._exemplar_path is not None and self._exemplar_path.exists():
            try:
                raw = json.loads(self._exemplar_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    normalized: dict[str, list[str]] = {}
                    for key, value in raw.items():
                        if not isinstance(value, list):
                            continue
                        normalized_items = [str(item).strip() for item in value if str(item).strip()]
                        if normalized_items:
                            normalized[str(key)] = normalized_items
                    if normalized:
                        return normalized
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning("intent decision exemplar load failed: %s", exc)
        return dict(_DEFAULT_DECISION_EXEMPLARS)

    @staticmethod
    def _tokenize(text: str) -> set[str]:
        if not text:
            return set()
        parts = re.findall(r"[\u4e00-\u9fff]|[a-z0-9_]+", text.lower())
        return {item for item in parts if item}

    @classmethod
    def _lexical_similarity(cls, source: str, target: str) -> float:
        source_tokens = cls._tokenize(source)
        target_tokens = cls._tokenize(target)
        if not source_tokens or not target_tokens:
            return 0.0
        overlap = source_tokens.intersection(target_tokens)
        if not overlap:
            return 0.0
        union = source_tokens.union(target_tokens)
        return float(len(overlap) / len(union))

    @staticmethod
    def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
        if not vec_a or not vec_b or len(vec_a) != len(vec_b):
            return 0.0
        dot = sum(a * b for a, b in zip(vec_a, vec_b, strict=False))
        norm_a = math.sqrt(sum(a * a for a in vec_a))
        norm_b = math.sqrt(sum(b * b for b in vec_b))
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(dot / (norm_a * norm_b))

    def _get_embedding_model(self) -> Any | None:
        if SentenceTransformer is None or self._embedding_failed:
            return None
        if self._embedding_model is not None:
            return self._embedding_model
        try:
            self._embedding_model = SentenceTransformer(
                self._embedding_model_name,
                local_files_only=True,
            )
        except Exception as exc:  # pragma: no cover - runtime dependency issues
            self._embedding_failed = True
            logger.warning("intent decision embedding unavailable, fallback to lexical: %s", exc)
            return None
        return self._embedding_model

    def _get_embedding(self, text: str) -> list[float] | None:
        cached = self._embedding_cache.get(text)
        if cached is not None:
            return cached
        model = self._get_embedding_model()
        if model is None:
            return None
        try:
            vector = model.encode([text])[0]
            normalized = [float(v) for v in vector]
            self._embedding_cache.set(text, normalized)
            return normalized
        except Exception:  # pragma: no cover - runtime fallback
            self._embedding_failed = True
            return None

    def _semantic_score(self, text: str, categories: list[str], *, reason_codes: list[str]) -> float:
        candidates: list[str] = []
        for category in categories:
            candidates.extend(self._exemplars.get(category, []))
        if not candidates:
            return 0.0

        lexical_scores = [self._lexical_similarity(text, candidate) for candidate in candidates]
        lexical_best = max(lexical_scores) if lexical_scores else 0.0

        query_embedding = self._get_embedding(text)
        if query_embedding is None:
            reason_codes.append("semantic_fallback_lexical")
            return lexical_best

        embedding_best = 0.0
        for candidate in candidates:
            candidate_embedding = self._get_embedding(candidate)
            if candidate_embedding is None:
                continue
            embedding_best = max(embedding_best, self._cosine_similarity(query_embedding, candidate_embedding))
        if embedding_best == 0.0:
            reason_codes.append("semantic_embedding_zero")
            return lexical_best

        return max(lexical_best, embedding_best)

    @staticmethod
    def _clip01(value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    def decide(
        self,
        *,
        user_message: str,
        session_mode: str,
        slots_complete: bool,
        execution_mode_active: bool,
        pending_action_exists: bool,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        normalized = (user_message or "").strip()
        lowered = normalized.lower()
        reason_codes: list[str] = []
        slot_score = 1.0 if slots_complete else 0.0

        rule_execute = 0.0
        if has_explicit_execution_intent(normalized):
            rule_execute = 1.0
            reason_codes.append("rule_execute_explicit_intent")
        elif pending_action_exists and slots_complete:
            rule_execute = 0.72
            reason_codes.append("rule_execute_pending_complete")
        elif session_mode in {"create", "manage"} and any(keyword in lowered for keyword in ("创建", "新增", "更新", "修改", "删除", "导入", "生成", "执行")):
            rule_execute = 0.62
            reason_codes.append("rule_execute_action_keyword")

        rule_qa = 0.0
        if should_answer_only(normalized):
            rule_qa = 1.0
            reason_codes.append("rule_qa_question_priority")
        elif is_question_like(normalized):
            rule_qa = 0.25
            reason_codes.append("rule_qa_question_like")

        semantic_execute = self._semantic_score(
            normalized,
            ["create", "manage", "authorize"],
            reason_codes=reason_codes,
        )
        semantic_qa = self._semantic_score(
            normalized,
            ["qa"],
            reason_codes=reason_codes,
        )
        semantic_authorize = self._semantic_score(
            normalized,
            ["authorize"],
            reason_codes=reason_codes,
        )
        semantic_revoke = self._semantic_score(
            normalized,
            ["revoke"],
            reason_codes=reason_codes,
        )

        execute_confidence = self._clip01(0.50 * rule_execute + 0.35 * semantic_execute + 0.15 * slot_score)
        qa_confidence = self._clip01(0.60 * rule_qa + 0.40 * semantic_qa)
        ambiguity = self._clip01(1.0 - abs(execute_confidence - qa_confidence))

        authorize_score = 1.0 if is_authorization_command(normalized, include_legacy=True) else self._clip01(0.75 * semantic_authorize + 0.25 * rule_execute)
        revoke_score = 1.0 if is_revoke_command(normalized, include_legacy=True) else self._clip01(0.75 * semantic_revoke + 0.25 * rule_qa)

        candidates = [
            IntentCandidate(intent="execute", score=execute_confidence),
            IntentCandidate(intent="qa", score=qa_confidence),
            IntentCandidate(intent="authorize", score=authorize_score),
            IntentCandidate(intent="revoke", score=revoke_score),
        ]
        sorted_candidates = sorted(candidates, key=lambda item: item.score, reverse=True)
        top_intent = sorted_candidates[0].intent if sorted_candidates else "unknown"

        should_clarify = max(execute_confidence, qa_confidence) < self._thresholds.clarify_min or ambiguity >= self._thresholds.ambiguity_clarify_min
        should_execute_now = (
            execution_mode_active
            and slots_complete
            and execute_confidence >= self._thresholds.auto_execute_min
            and (execute_confidence - qa_confidence) >= self._thresholds.execute_advantage_min
        )
        show_confirmation_card = (
            not execution_mode_active
            and slots_complete
            and execute_confidence >= self._thresholds.confirmation_min
        )

        if should_execute_now:
            reason_codes.append("threshold_auto_execute")
        elif show_confirmation_card:
            reason_codes.append("threshold_confirmation_fallback")
        if should_clarify:
            reason_codes.append("threshold_clarification")

        decision = IntentDecisionPayload(
            intent=top_intent,
            candidates=sorted_candidates,
            execute_confidence=execute_confidence,
            qa_confidence=qa_confidence,
            ambiguity=ambiguity,
            slots_complete=slots_complete,
            should_execute_now=should_execute_now,
            reason_codes=reason_codes,
            should_clarify=should_clarify,
        ).to_dict()
        ui_hints = ActionUiHints(
            show_confirmation_card=show_confirmation_card,
            show_execution_toggle=True,
            quick_actions=[
                "__enter_execution_mode__",
                "__confirm_action__",
                "__cancel_action__",
            ]
            if show_confirmation_card
            else [],
            clarification_required=should_clarify,
        ).to_dict()
        return decision, ui_hints


class IntentDetector:
    """Pure intent detection and slot extraction component."""

    def __init__(
        self,
        *,
        question_prefixes: tuple[str, ...],
        creation_keywords: tuple[str, ...],
        creation_patterns: tuple[Any, ...],
        management_keywords: tuple[str, ...],
        management_action_keywords: tuple[str, ...],
        management_patterns: tuple[Any, ...],
        extract_title: Callable[[str], str | None],
        extract_genre: Callable[[str], str | None],
        extract_theme: Callable[[str], str | None],
        extract_audience: Callable[[str], str | None],
        extract_target_words: Callable[[str], int | None],
        intent_factory: Callable[[str, dict[str, Any]], Any],
    ) -> None:
        self._question_prefixes = question_prefixes
        self._creation_keywords = creation_keywords
        self._creation_patterns = creation_patterns
        self._management_keywords = management_keywords
        self._management_action_keywords = management_action_keywords
        self._management_patterns = management_patterns
        self._extract_title = extract_title
        self._extract_genre = extract_genre
        self._extract_theme = extract_theme
        self._extract_audience = extract_audience
        self._extract_target_words = extract_target_words
        self._intent_factory = intent_factory

    @staticmethod
    def extract_latest_user_message(messages: list[Any]) -> str:
        for message in reversed(messages):
            role = getattr(message, "role", None)
            if role != "user":
                continue
            content = getattr(message, "content", None)
            if isinstance(content, str):
                text = content.strip()
                if text:
                    return text
            elif content is not None:
                text = str(content).strip()
                if text:
                    return text
        return ""

    @staticmethod
    def _is_cjk_token(token: str) -> bool:
        return any("\u4e00" <= ch <= "\u9fff" for ch in token)

    @classmethod
    def _contains_keyword(cls, text: str, keyword: str) -> bool:
        normalized_text = (text or "").strip()
        normalized_keyword = (keyword or "").strip()
        if not normalized_text or not normalized_keyword:
            return False

        if cls._is_cjk_token(normalized_keyword):
            return normalized_keyword in normalized_text

        lowered_text = normalized_text.lower()
        lowered_keyword = normalized_keyword.lower()
        pattern = re.compile(rf"(?<![a-z0-9_]){re.escape(lowered_keyword)}(?![a-z0-9_])")
        return bool(pattern.search(lowered_text))

    def detect_creation_intent(self, user_message: str) -> Any | None:
        normalized = (user_message or "").strip()
        if not normalized:
            return None

        lowered = normalized.lower()
        compact = "".join(lowered.split())
        matched = any(keyword in lowered or keyword in compact for keyword in self._creation_keywords)
        if not matched:
            matched = any(pattern.search(normalized) for pattern in self._creation_patterns)
        if not matched:
            return None

        question_like = any(lowered.startswith(prefix) for prefix in self._question_prefixes)
        if question_like and "帮我" not in normalized and "please" not in lowered:
            return None

        prefill = self.extract_fields(normalized)
        return self._intent_factory(normalized, prefill)

    def detect_management_intent(self, user_message: str) -> bool:
        normalized = (user_message or "").strip()
        if not normalized:
            return False
        lowered = normalized.lower()
        if any(lowered.startswith(prefix) for prefix in self._question_prefixes):
            return False

        contains_action = any(self._contains_keyword(normalized, keyword) for keyword in self._management_action_keywords)
        contains_entity = any(self._contains_keyword(normalized, keyword) for keyword in self._management_keywords)
        if contains_action and contains_entity:
            return True
        return any(pattern.search(normalized) for pattern in self._management_patterns)

    def extract_fields(self, text: str) -> dict[str, Any]:
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
        if target_words:
            fields["target_words"] = target_words
        return fields


class SessionPersistence:
    """Persistence boundary for session/idempotency storage."""

    def __init__(
        self,
        *,
        get_session: Callable[[str], Awaitable[Any | None]],
        save_session: Callable[[Any], Awaitable[None]],
        remove_session: Callable[[str], Awaitable[None]],
        prune_expired_sessions: Callable[[], Awaitable[None]],
        consume_idempotency_key: Callable[..., Awaitable[bool]],
        prune_expired_idempotency_keys: Callable[[], Awaitable[None]],
    ) -> None:
        self._get_session = get_session
        self._save_session = save_session
        self._remove_session = remove_session
        self._prune_expired_sessions = prune_expired_sessions
        self._consume_idempotency_key = consume_idempotency_key
        self._prune_expired_idempotency_keys = prune_expired_idempotency_keys

    async def get_session(self, session_key: str) -> Any | None:
        return await self._get_session(session_key)

    async def save_session(self, session: Any) -> None:
        await self._save_session(session)

    async def remove_session(self, session_key: str) -> None:
        await self._remove_session(session_key)

    async def prune_expired_sessions(self) -> None:
        await self._prune_expired_sessions()

    async def consume_idempotency_key(
        self,
        key: str,
        *,
        user_id: str | None = None,
        action: str | None = None,
    ) -> bool:
        return await self._consume_idempotency_key(
            key,
            user_id=user_id,
            action=action,
        )

    async def prune_expired_idempotency_keys(self) -> None:
        await self._prune_expired_idempotency_keys()


class SessionManager:
    """Session lifecycle orchestration boundary."""

    def __init__(self, persistence: SessionPersistence) -> None:
        self._persistence = persistence

    async def get(self, session_key: str) -> Any | None:
        return await self._persistence.get_session(session_key)

    async def save(self, session: Any) -> None:
        await self._persistence.save_session(session)

    async def remove(self, session_key: str) -> None:
        await self._persistence.remove_session(session_key)

    async def prune(self) -> None:
        await self._persistence.prune_expired_sessions()
        await self._persistence.prune_expired_idempotency_keys()


class ManageActionRouter:
    """Manage action routing/dispatch boundary."""

    def __init__(
        self,
        *,
        owner: Any | None = None,
        pending_action_factory: Callable[..., Any] | None = None,
        build_pending_action: Callable[..., Awaitable[Any]] | None = None,
        merge_pending_action: Callable[..., Awaitable[None]] | None = None,
        dispatch_manage_action: Callable[..., Awaitable[dict[str, Any]]] | None = None,
    ) -> None:
        self._owner = owner
        self._pending_action_factory = pending_action_factory
        self._build_pending_action = build_pending_action
        self._merge_pending_action = merge_pending_action
        self._dispatch_manage_action = dispatch_manage_action

    def _require_owner(self) -> Any:
        if self._owner is None:
            raise RuntimeError("ManageActionRouter owner is required for component-managed build/merge flows")
        return self._owner

    def _make_action(self, **kwargs: Any) -> Any:
        if self._pending_action_factory is None:
            raise RuntimeError("pending_action_factory is required for component-managed build/merge flows")
        return self._pending_action_factory(**kwargs)

    async def build(self, **kwargs: Any) -> Any:
        if self._build_pending_action is not None:
            return await self._build_pending_action(**kwargs)
        return await self.build_pending_action(**kwargs)

    async def merge(self, **kwargs: Any) -> None:
        if self._merge_pending_action is not None:
            await self._merge_pending_action(**kwargs)
            return
        await self.merge_pending_action(**kwargs)

    async def dispatch(self, **kwargs: Any) -> dict[str, Any]:
        db_session = kwargs.get("db_session")
        action = kwargs.get("action")
        action_name = str(getattr(action, "action", "") or "")

        try:
            if self._dispatch_manage_action is not None:
                return await self._dispatch_manage_action(**kwargs)
            owner = self._require_owner()
            return await owner._dispatch_manage_action(**kwargs)
        except Exception:
            await self._rollback_on_dispatch_failure(
                db_session=db_session,
                action_name=action_name,
            )
            raise

    @staticmethod
    async def _rollback_on_dispatch_failure(*, db_session: Any, action_name: str) -> None:
        """Best-effort rollback for manage-action dispatch failures (H-06).

        The downstream API layer may commit internally, so we avoid forcing an
        explicit transaction boundary here. Instead, we rollback only when the
        caller session still has an active transaction.
        """
        if db_session is None:
            return

        rollback = getattr(db_session, "rollback", None)
        if not callable(rollback):
            return

        in_transaction = getattr(db_session, "in_transaction", None)
        has_tx = True
        if callable(in_transaction):
            try:
                has_tx = bool(in_transaction())
            except Exception:
                # Defensive fallback: if transaction state probing fails, still
                # try rollback as best effort.
                has_tx = True

        if not has_tx:
            return

        try:
            await rollback()
            logger.warning("manage action dispatch rolled back after failure: action=%s", action_name or "<unknown>")
        except Exception:
            logger.exception("manage action rollback failed: action=%s", action_name or "<unknown>")

    async def build_pending_action(
        self,
        *,
        session: Any,
        user_message: str,
        db_session: Any,
    ) -> Any | None:
        owner = self._require_owner()
        lowered = user_message.lower()
        project_id = session.active_project_id

        if not project_id:
            return None

        if owner._is_project_export_request(lowered):
            return self._make_action(
                action="export_project_archive",
                entity="project",
                operation="export",
                project_id=project_id,
                target_id=project_id,
                target_label=session.active_project_title or project_id,
                payload={},
            )

        if owner._is_outline_generate_request(lowered):
            payload = owner._extract_outline_generate_payload(user_message)
            return self._make_action(
                action="generate_outline",
                entity="outline",
                operation="generate",
                project_id=project_id,
                target_id=project_id,
                target_label="完整大纲",
                payload=payload,
            )

        if owner._is_character_generate_request(lowered):
            payload = owner._extract_character_generate_payload(user_message)
            return self._make_action(
                action="generate_characters",
                entity="character",
                operation="generate",
                project_id=project_id,
                target_id=project_id,
                target_label="角色与组织",
                payload=payload,
            )

        if owner._is_chapter_create_request(lowered):
            payload = owner._extract_chapter_create_payload(user_message)
            return self._make_action(
                action="create_chapter",
                entity="chapter",
                operation="create",
                project_id=project_id,
                target_label="新章节",
                payload=payload,
            )

        if owner._is_chapter_delete_request(lowered):
            chapter = await owner._resolve_chapter_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            return self._make_action(
                action="delete_chapter",
                entity="chapter",
                operation="delete",
                project_id=project_id,
                target_id=chapter.get("id") if chapter else None,
                target_label=owner._chapter_label(chapter) if chapter else "",
                payload={},
            )

        if owner._is_chapter_update_request(lowered):
            chapter = await owner._resolve_chapter_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            payload = owner._extract_chapter_update_payload(user_message)
            return self._make_action(
                action="update_chapter",
                entity="chapter",
                operation="update",
                project_id=project_id,
                target_id=chapter.get("id") if chapter else None,
                target_label=owner._chapter_label(chapter) if chapter else "",
                payload=payload,
            )

        if owner._is_outline_create_request(lowered):
            payload = owner._extract_outline_create_payload(user_message)
            return self._make_action(
                action="create_outline",
                entity="outline",
                operation="create",
                project_id=project_id,
                target_label="新大纲",
                payload=payload,
            )

        if owner._is_outline_delete_request(lowered):
            outline = await owner._resolve_outline_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            return self._make_action(
                action="delete_outline",
                entity="outline",
                operation="delete",
                project_id=project_id,
                target_id=outline.get("id") if outline else None,
                target_label=owner._outline_label(outline) if outline else "",
                payload={},
            )

        if owner._is_outline_update_request(lowered):
            outline = await owner._resolve_outline_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            payload = owner._extract_outline_update_payload(user_message)
            return self._make_action(
                action="update_outline",
                entity="outline",
                operation="update",
                project_id=project_id,
                target_id=outline.get("id") if outline else None,
                target_label=owner._outline_label(outline) if outline else "",
                payload=payload,
            )

        if owner._is_character_create_request(lowered):
            payload = owner._extract_character_create_payload(user_message)
            return self._make_action(
                action="create_character",
                entity="character",
                operation="create",
                project_id=project_id,
                target_label=payload.get("name") or "新角色",
                payload=payload,
            )

        if owner._is_character_delete_request(lowered):
            character = await owner._resolve_character_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
                allow_organization=True,
            )
            return self._make_action(
                action="delete_character",
                entity="character",
                operation="delete",
                project_id=project_id,
                target_id=character.get("id") if character else None,
                target_label=owner._character_label(character) if character else "",
                payload={},
            )

        if owner._is_character_update_request(lowered):
            character = await owner._resolve_character_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
                allow_organization=True,
            )
            payload = owner._extract_character_update_payload(user_message)
            return self._make_action(
                action="update_character",
                entity="character",
                operation="update",
                project_id=project_id,
                target_id=character.get("id") if character else None,
                target_label=owner._character_label(character) if character else "",
                payload=payload,
            )

        if owner._is_relationship_create_request(lowered):
            payload = owner._extract_relationship_payload(user_message)
            return self._make_action(
                action="create_relationship",
                entity="relationship",
                operation="create",
                project_id=project_id,
                target_label="角色关系",
                payload=payload,
            )

        if owner._is_relationship_update_request(lowered):
            payload = owner._extract_relationship_payload(user_message)
            return self._make_action(
                action="update_relationship",
                entity="relationship",
                operation="update",
                project_id=project_id,
                target_label="角色关系",
                payload=payload,
            )

        if owner._is_relationship_delete_request(lowered):
            payload = owner._extract_relationship_payload(user_message)
            return self._make_action(
                action="delete_relationship",
                entity="relationship",
                operation="delete",
                project_id=project_id,
                target_label="角色关系",
                payload=payload,
            )

        if owner._is_organization_create_request(lowered):
            payload = owner._extract_organization_create_payload(user_message)
            return self._make_action(
                action="create_organization",
                entity="organization",
                operation="create",
                project_id=project_id,
                target_label=payload.get("name") or "新组织",
                payload=payload,
            )

        if owner._is_organization_member_request(lowered):
            payload = owner._extract_organization_member_payload(user_message)
            return self._make_action(
                action="add_organization_member",
                entity="organization",
                operation="member_add",
                project_id=project_id,
                target_label=payload.get("organization_name") or "组织成员",
                payload=payload,
            )

        if owner._is_organization_update_request(lowered):
            org = await owner._resolve_organization_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            payload = owner._extract_organization_update_payload(user_message)
            return self._make_action(
                action="update_organization",
                entity="organization",
                operation="update",
                project_id=project_id,
                target_id=org.get("id") if org else None,
                target_label=owner._organization_label(org) if org else "",
                payload=payload,
            )

        if owner._is_organization_delete_request(lowered):
            org = await owner._resolve_organization_from_text(
                project_id=project_id,
                user_id=session.user_id,
                user_message=user_message,
                db_session=db_session,
            )
            return self._make_action(
                action="delete_organization",
                entity="organization",
                operation="delete",
                project_id=project_id,
                target_id=org.get("id") if org else None,
                target_label=owner._organization_label(org) if org else "",
                payload={},
            )

        if owner._is_item_create_request(lowered):
            payload = owner._extract_item_create_payload(user_message)
            return self._make_action(
                action="create_item",
                entity="item",
                operation="create",
                project_id=project_id,
                target_label=payload.get("title") or "新物品",
                payload=payload,
            )

        if owner._is_item_delete_request(lowered):
            item = await owner._resolve_item_from_text(project_id=project_id, user_message=user_message, db_session=db_session)
            return self._make_action(
                action="delete_item",
                entity="item",
                operation="delete",
                project_id=project_id,
                target_id=item.get("id") if item else None,
                target_label=item.get("title") if item else "",
                payload={},
            )

        if owner._is_item_update_request(lowered):
            item = await owner._resolve_item_from_text(project_id=project_id, user_message=user_message, db_session=db_session)
            payload = owner._extract_item_update_payload(user_message)
            return self._make_action(
                action="update_item",
                entity="item",
                operation="update",
                project_id=project_id,
                target_id=item.get("id") if item else None,
                target_label=item.get("title") if item else "",
                payload=payload,
            )

        if owner._is_project_update_request(lowered):
            payload = owner._extract_project_update_payload(user_message)
            return self._make_action(
                action="update_project",
                entity="project",
                operation="update",
                project_id=project_id,
                target_id=project_id,
                target_label=session.active_project_title or project_id,
                payload=payload,
            )

        if owner._is_project_delete_request(lowered):
            return self._make_action(
                action="delete_project",
                entity="project",
                operation="delete",
                project_id=project_id,
                target_id=project_id,
                target_label=session.active_project_title or project_id,
                payload={},
            )

        return None

    async def merge_pending_action(
        self,
        *,
        action: Any,
        user_message: str,
        session: Any,
        db_session: Any,
    ) -> None:
        owner = self._require_owner()
        project_id = action.project_id or session.active_project_id
        if not project_id:
            return

        if action.action == "update_project":
            action.payload.update(owner._extract_project_update_payload(user_message))
            return

        if action.action == "generate_outline":
            action.payload.update(owner._extract_outline_generate_payload(user_message))
            return

        if action.action == "generate_characters":
            action.payload.update(owner._extract_character_generate_payload(user_message))
            return

        if action.action == "create_chapter":
            action.payload.update(owner._extract_chapter_create_payload(user_message))
            return

        if action.action in {"update_chapter", "delete_chapter"}:
            if not action.target_id:
                chapter = await owner._resolve_chapter_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if chapter:
                    action.target_id = chapter.get("id")
                    action.target_label = owner._chapter_label(chapter)
            if action.action == "update_chapter":
                action.payload.update(owner._extract_chapter_update_payload(user_message))
            return

        if action.action == "create_outline":
            action.payload.update(owner._extract_outline_create_payload(user_message))
            return

        if action.action in {"update_outline", "delete_outline"}:
            if not action.target_id:
                outline = await owner._resolve_outline_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if outline:
                    action.target_id = outline.get("id")
                    action.target_label = owner._outline_label(outline)
            if action.action == "update_outline":
                action.payload.update(owner._extract_outline_update_payload(user_message))
            return

        if action.action == "create_character":
            action.payload.update(owner._extract_character_create_payload(user_message))
            return

        if action.action in {"update_character", "delete_character"}:
            if not action.target_id:
                character = await owner._resolve_character_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                    allow_organization=True,
                )
                if character:
                    action.target_id = character.get("id")
                    action.target_label = owner._character_label(character)
            if action.action == "update_character":
                action.payload.update(owner._extract_character_update_payload(user_message))
            return

        if action.action in {"create_relationship", "update_relationship", "delete_relationship"}:
            action.payload.update(owner._extract_relationship_payload(user_message))
            return

        if action.action == "create_organization":
            action.payload.update(owner._extract_organization_create_payload(user_message))
            if action.payload.get("name"):
                action.target_label = str(action.payload.get("name") or "")
            return

        if action.action == "update_organization":
            if not action.target_id:
                org = await owner._resolve_organization_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if org:
                    action.target_id = org.get("id")
                    action.target_label = owner._organization_label(org)
            action.payload.update(owner._extract_organization_update_payload(user_message))
            return

        if action.action == "delete_organization":
            if not action.target_id:
                org = await owner._resolve_organization_from_text(
                    project_id=project_id,
                    user_id=session.user_id,
                    user_message=user_message,
                    db_session=db_session,
                )
                if org:
                    action.target_id = org.get("id")
                    action.target_label = owner._organization_label(org)
            return

        if action.action == "add_organization_member":
            action.payload.update(owner._extract_organization_member_payload(user_message))
            return

        if action.action == "create_item":
            action.payload.update(owner._extract_item_create_payload(user_message))
            return

        if action.action in {"update_item", "delete_item"} and not action.target_id:
            item = await owner._resolve_item_from_text(project_id=project_id, user_message=user_message, db_session=db_session)
            if item:
                action.target_id = item.get("id")
                action.target_label = str(item.get("title") or "")

        if action.action == "update_item":
            action.payload.update(owner._extract_item_update_payload(user_message))

    def compute_missing_fields(self, action: Any) -> list[str]:
        missing: list[str] = []

        if not action.project_id:
            missing.append("project_selector")
            return missing

        if action.action == "update_project":
            if not action.payload:
                missing.append("project_updates")
            return missing

        if action.action in {"delete_project", "export_project_archive", "generate_outline", "generate_characters"}:
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

        if action.action in {"create_relationship", "update_relationship", "delete_relationship"}:
            if not action.payload.get("character_from_name") or not action.payload.get("character_to_name"):
                missing.append("relationship_pair")
            if action.action != "delete_relationship" and not action.payload.get("relationship_name"):
                missing.append("relationship_name")
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
            if not action.payload.get("title") or not action.payload.get("description"):
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

    async def dispatch_item_action(self, *, action: Any, db_session: Any) -> dict[str, Any]:
        from app.gateway.novel_migrated.services.foreshadow_service import foreshadow_service

        if action.action == "create_item":
            title = str(action.payload.get("title") or "").strip()
            if not title:
                raise ValueError("缺少物品名称")
            description = str(action.payload.get("description") or "").strip()
            if not description:
                raise ValueError("缺少物品描述")

            created = await foreshadow_service.create_foreshadow(
                db=db_session,
                project_id=action.project_id or "",
                chapter_id=None,
                title=title,
                content=description,
                category="item",
                source_type="manual",
                source_id=None,
                source_context=action.payload.get("source_context"),
                trigger_condition=action.payload.get("trigger_condition"),
                expected_payoff=action.payload.get("expected_payoff"),
                importance=int(action.payload.get("importance") or 5),
                is_long_term=bool(action.payload.get("is_long_term") or False),
                planned_chapter=int(action.payload.get("planned_chapter") or 0) or None,
                metadata={
                    "tags": action.payload.get("tags") or [],
                    "item_type": action.payload.get("item_type"),
                },
            )
            return created.to_dict()

        if action.action == "update_item":
            if not action.target_id:
                raise ValueError("缺少物品ID")
            updates = {key: value for key, value in action.payload.items() if key in {"title", "description", "status", "trigger_condition", "expected_payoff", "importance", "planned_chapter", "tags", "item_type"}}
            mapped_updates: dict[str, Any] = {}
            if "description" in updates:
                mapped_updates["content"] = updates.pop("description")
            mapped_updates.update(updates)
            updated = await foreshadow_service.update_foreshadow(db=db_session, foreshadow_id=action.target_id, **mapped_updates)
            if updated is None:
                raise ValueError("物品不存在")
            return updated.to_dict()

        if action.action == "delete_item":
            deleted = await foreshadow_service.delete_foreshadow(db=db_session, foreshadow_id=action.target_id or "")
            if not deleted:
                raise ValueError("物品不存在")
            return {"message": "Item deleted", "id": action.target_id}

        raise ValueError(f"unsupported item action: {action.action}")

    async def dispatch_manage_action(self, *, action: Any, session: Any, db_session: Any) -> dict[str, Any]:
        owner = self._require_owner()
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

            project = await owner._get_project_model(
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

            project = await owner._get_project_model(
                project_id=action.project_id or "",
                user_id=session.user_id,
                db_session=db_session,
            )
            if project is None:
                raise ValueError("项目不存在或无权限")

            chapter_count = max(5, min(int(action.payload.get("chapter_count") or project.chapter_count or 30), 300))
            narrative_perspective = str(action.payload.get("narrative_perspective") or project.narrative_perspective or "第三人称")
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

            project = await owner._get_project_model(
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

            from_char = await owner._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_from_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            to_char = await owner._resolve_character_by_name(
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

            from_char = await owner._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_from_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            to_char = await owner._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_to_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            rel_data = await list_relationships(project_id=action.project_id or "", user_id=session.user_id, db=db_session, character_id=None)
            relationships = rel_data.get("relationships", [])
            rel = owner._match_relationship(relationships, str(from_char.get("id") or ""), str(to_char.get("id") or ""))
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

            from_char = await owner._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_from_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            to_char = await owner._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("character_to_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            rel_data = await list_relationships(project_id=action.project_id or "", user_id=session.user_id, db=db_session, character_id=None)
            relationships = rel_data.get("relationships", [])
            rel = owner._match_relationship(relationships, str(from_char.get("id") or ""), str(to_char.get("id") or ""))
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

            org_updates = {key: value for key, value in action.payload.items() if key in {"organization_type", "purpose", "hierarchy", "power_level", "location"}}
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

            org_updates = {key: value for key, value in action.payload.items() if key in {"organization_type", "purpose", "hierarchy", "power_level", "location"}}
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
            from app.gateway.novel_migrated.api.organizations import MemberAddRequest, OrganizationUpdateRequest, add_member, update_organization

            org = await owner._resolve_organization_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("organization_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )
            member = await owner._resolve_character_by_name(
                project_id=action.project_id or "",
                name=str(action.payload.get("member_name") or ""),
                user_id=session.user_id,
                db_session=db_session,
            )

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
            return await self.dispatch_item_action(action=action, db_session=db_session)

        raise ValueError(f"unsupported action: {action_name}")
