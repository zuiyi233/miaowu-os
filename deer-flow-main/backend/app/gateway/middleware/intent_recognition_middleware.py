"""Intent recognition middleware for global AI chat routing.

This middleware focuses on lightweight intent detection for novel creation:
- detect "create novel" intent from the latest user message
- extract title/genre from natural language
- execute novel creation flow (prefer novel_migrated, fallback to legacy novel store)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


_DEFAULT_GENRE = "科幻"
_DEFAULT_TITLE_PREFIX = "未命名小说"

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
    "create novel",
    "new novel",
    "create a novel",
    "create novel project",
)

_INTENT_PATTERNS = (
    re.compile(r"(创建|新建|建立|写|帮我写).{0,24}(小说|小说项目)"),
    re.compile(r"(create|new|write).{0,24}(novel|novel\s+project)"),
)

_QUESTION_PREFIXES = ("怎么", "如何", "怎样", "可以", "能否", "是否", "what", "how")

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
    re.compile(r"(?:创建|新建|写|写一部|写一本)(?:一(?:本|部))?([^，。,.!?]{1,40})小说"),
)


@dataclass
class IntentRecognitionResult:
    handled: bool
    content: str = ""
    tool_calls: list[dict[str, Any]] | None = None
    novel: dict[str, Any] | None = None


@dataclass
class _NovelCreateIntent:
    raw_message: str
    title: str
    genre: str


class IntentRecognitionMiddleware:
    """Lightweight intent recognition for the global /api/ai/chat endpoint."""

    async def process_request(
        self,
        request: Any,
        *,
        user_id: str,
        db_session: Any | None,
    ) -> IntentRecognitionResult:
        messages = list(getattr(request, "messages", []) or [])
        user_message = self._extract_latest_user_message(messages)
        intent = self._detect_novel_creation_intent(user_message)

        if intent is None:
            return IntentRecognitionResult(handled=False)

        return await self._handle_novel_creation(
            intent=intent,
            user_id=user_id,
            db_session=db_session,
        )

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

        # Avoid turning "how to create a novel?" style questions into side effects.
        question_like = any(lowered.startswith(prefix) for prefix in _QUESTION_PREFIXES)
        if question_like and "帮我" not in normalized and "please" not in lowered:
            return None

        title = self._extract_title(normalized)
        genre = self._extract_genre(normalized)
        return _NovelCreateIntent(
            raw_message=normalized,
            title=title,
            genre=genre,
        )

    @staticmethod
    def _extract_title(user_message: str) -> str:
        for pattern in _TITLE_PATTERNS:
            match = pattern.search(user_message)
            if not match:
                continue
            candidate = (match.group(1) or "").strip()
            if not candidate:
                continue
            if candidate in {"小说", "一本小说", "一部小说"}:
                continue
            if len(candidate) > 60:
                candidate = candidate[:60]
            return candidate

        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        return f"{_DEFAULT_TITLE_PREFIX}{ts}"

    @staticmethod
    def _extract_genre(user_message: str) -> str:
        lowered = user_message.lower()
        for keyword, canonical in _GENRE_MAP:
            if keyword in lowered or keyword in user_message:
                return canonical
        return _DEFAULT_GENRE

    async def _handle_novel_creation(
        self,
        *,
        intent: _NovelCreateIntent,
        user_id: str,
        db_session: Any | None,
    ) -> IntentRecognitionResult:
        payload: dict[str, Any] | None = None
        errors: list[str] = []

        if db_session is not None:
            try:
                payload = await self._create_with_modern_projects(
                    title=intent.title,
                    genre=intent.genre,
                    raw_message=intent.raw_message,
                    user_id=user_id,
                    db_session=db_session,
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning("modern project creation failed: %s", exc, exc_info=True)
                errors.append(f"modern:{exc}")

        if payload is None:
            try:
                payload = await self._create_with_legacy_store(
                    title=intent.title,
                    genre=intent.genre,
                    raw_message=intent.raw_message,
                )
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.error("legacy novel creation failed: %s", exc, exc_info=True)
                errors.append(f"legacy:{exc}")

        if payload is None:
            error_summary = "; ".join(errors) if errors else "unknown error"
            content = "已识别到创建小说意图，但创建失败。请稍后重试或手动在小说页面创建项目。"
            return IntentRecognitionResult(
                handled=True,
                content=content,
                tool_calls=[
                    {
                        "id": "call_create_novel_error",
                        "type": "function",
                        "function": {
                            "name": "create_novel",
                            "arguments": json.dumps(
                                {"title": intent.title, "genre": intent.genre},
                                ensure_ascii=False,
                            ),
                        },
                        "status": "error",
                        "error": error_summary,
                    }
                ],
                novel={"status": "error", "error": error_summary},
            )

        content = (
            f"已帮你创建小说《{payload.get('title', intent.title)}》"
            f"（类型：{payload.get('genre', intent.genre)}），"
            f"ID：{payload.get('id', 'unknown')}。"
        )
        tool_call = {
            "id": "call_create_novel",
            "type": "function",
            "function": {
                "name": "create_novel",
                "arguments": json.dumps(
                    {"title": intent.title, "genre": intent.genre},
                    ensure_ascii=False,
                ),
            },
            "status": "success",
            "result": payload,
        }
        return IntentRecognitionResult(
            handled=True,
            content=content,
            tool_calls=[tool_call],
            novel=payload,
        )

    @staticmethod
    async def _create_with_modern_projects(
        *,
        title: str,
        genre: str,
        raw_message: str,
        user_id: str,
        db_session: Any,
    ) -> dict[str, Any]:
        from app.gateway.novel_migrated.api.projects import ProjectCreateRequest, create_project

        req = ProjectCreateRequest(
            title=title,
            description=f"由全局AI对话自动创建：{raw_message[:180]}",
            theme=genre,
            genre=genre,
        )
        project = await create_project(req=req, user_id=user_id, db=db_session)

        return {
            "id": project.get("id"),
            "title": project.get("title", title),
            "genre": project.get("genre") or genre,
            "source": "novel_migrated.projects",
        }

    @staticmethod
    async def _create_with_legacy_store(
        *,
        title: str,
        genre: str,
        raw_message: str,
    ) -> dict[str, Any]:
        from app.gateway.routers.novel import _novel_store

        novel = await _novel_store.create_novel(
            {
                "title": title,
                "metadata": {
                    "genre": genre,
                    "created_by": "intent_recognition",
                    "raw_message": raw_message[:180],
                },
            }
        )
        metadata = novel.get("metadata") if isinstance(novel, dict) else {}
        normalized_genre = genre
        if isinstance(metadata, dict):
            normalized_genre = str(metadata.get("genre", genre))

        return {
            "id": novel.get("id"),
            "title": novel.get("title", title),
            "genre": normalized_genre,
            "source": "legacy.novel_store",
        }
