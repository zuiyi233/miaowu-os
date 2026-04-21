"""Built-in novel tools for DeerFlow agents.

These tools are registered in the Agent tool chain (方案2: Tool Calling).
When the intent recognition middleware (方案1) has an active creation session,
the tool defers to the session flow rather than bypassing the confirmation gate.
"""

from __future__ import annotations

import logging
import os
from typing import Annotated
from typing import Any

import httpx
from langchain.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg

logger = logging.getLogger(__name__)

_NOVEL_TOOL_BASE_URL_ENV = "DEERFLOW_NOVEL_TOOL_BASE_URL"
_DEFAULT_NOVEL_TOOL_BASE_URL = "http://127.0.0.1:8001"
_NOVEL_TOOL_TIMEOUT_ENV = "DEERFLOW_NOVEL_TOOL_TIMEOUT_SECONDS"
_ACCESS_TOKEN_ENV = "DEERFLOW_AI_PROVIDER_API_TOKEN"
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
_USER_CONTEXT_KEYS: tuple[str, ...] = ("user_id", "userId")


def _get_base_url() -> str:
    raw = (os.getenv(_NOVEL_TOOL_BASE_URL_ENV) or "").strip()
    return raw.rstrip("/") or _DEFAULT_NOVEL_TOOL_BASE_URL


def _get_timeout_seconds() -> float:
    raw = (os.getenv(_NOVEL_TOOL_TIMEOUT_ENV) or "").strip()
    if not raw:
        return 10.0
    try:
        return max(1.0, float(raw))
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to 10s", _NOVEL_TOOL_TIMEOUT_ENV, raw)
        return 10.0


def _build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = (os.getenv(_ACCESS_TOKEN_ENV) or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    timeout = httpx.Timeout(_get_timeout_seconds())
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=_build_headers())
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            return data
        return {"raw": data}


def _pick_non_empty_str(source: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _resolve_gate_scope(
    config: RunnableConfig | None,
) -> tuple[str | None, str | None]:
    raw_config = config if isinstance(config, dict) else {}
    configurable = raw_config.get("configurable")
    configurable_map = configurable if isinstance(configurable, dict) else {}
    context = raw_config.get("context")
    context_map = context if isinstance(context, dict) else {}

    user_id = (
        _pick_non_empty_str(context_map, *_USER_CONTEXT_KEYS)
        or _pick_non_empty_str(configurable_map, *_USER_CONTEXT_KEYS)
    )
    if not user_id:
        return None, None

    merged_context: dict[str, Any] = {}
    for key in (*_SESSION_CONTEXT_KEYS, *_USER_CONTEXT_KEYS):
        value = context_map.get(key)
        if isinstance(value, str) and value.strip():
            merged_context[key] = value.strip()
            continue
        fallback_value = configurable_map.get(key)
        if isinstance(fallback_value, str) and fallback_value.strip():
            merged_context[key] = fallback_value.strip()

    try:
        from app.gateway.api.ai_provider import _INTENT_RECOGNITION_MIDDLEWARE
    except Exception:
        logger.warning("create_novel session gate skipped: intent middleware is unavailable")
        return user_id, None

    try:
        session_key = _INTENT_RECOGNITION_MIDDLEWARE.build_session_key_for_context(
            user_id=user_id,
            context=merged_context or None,
        )
    except Exception:
        logger.exception("create_novel session gate failed to build session key")
        return user_id, None

    return user_id, session_key


async def _has_active_creation_session(*, user_id: str, session_key: str) -> bool:
    try:
        from app.gateway.api.ai_provider import _INTENT_RECOGNITION_MIDDLEWARE

        return await _INTENT_RECOGNITION_MIDDLEWARE.has_active_creation_session(
            user_id=user_id,
            session_key=session_key,
        )
    except Exception:
        logger.exception("create_novel session gate check failed, fallback to fail-open")
        return False


@tool("create_novel", parse_docstring=True)
async def create_novel(
    title: str,
    genre: str = "科幻",
    description: str = "",
    config: Annotated[RunnableConfig | None, InjectedToolArg] = None,
) -> dict[str, Any]:
    """Create a new novel project for the user.

    The tool first tries the modern `novel_migrated` projects API (`/projects`).
    If unavailable, it falls back to the legacy novel endpoint (`/api/novels`)
    for compatibility with older flows.

    If an active creation session exists in the intent recognition middleware,
    the tool returns a guidance message instead of creating directly, ensuring
    the confirmation gate is respected.

    Args:
        title: Novel title. Keep it concise and specific.
        genre: Novel genre, defaults to `科幻`.
        description: Optional brief description for the novel idea.

    Returns:
        A result dictionary with `success`, `source`, and created novel identifiers.
    """
    gate_user_id, gate_session_key = _resolve_gate_scope(config)
    if gate_user_id and gate_session_key:
        if await _has_active_creation_session(user_id=gate_user_id, session_key=gate_session_key):
            return {
                "success": False,
                "source": "session_gate",
                "error": "active_creation_session",
                "message": (
                    "当前有正在进行的小说创建会话，请勿重复调用 create_novel。"
                    "请回到 /api/ai/chat 会话流程继续补充字段，"
                    "或回复“确认”完成创建、回复“取消”放弃。"
                    "仅在已取消当前会话且用户明确要求重新开始时，才应再次调用 create_novel。"
                ),
            }
    else:
        logger.warning(
            "create_novel session gate skipped: missing user/session context (fail-open)"
        )

    normalized_title = (title or "").strip()
    if not normalized_title:
        return {
            "success": False,
            "error": "title is required",
            "source": "validation",
        }

    normalized_genre = (genre or "").strip() or "科幻"
    normalized_description = (description or "").strip()
    base_url = _get_base_url()

    modern_payload = {
        "title": normalized_title,
        "genre": normalized_genre,
        "theme": normalized_genre,
        "description": normalized_description,
    }
    modern_url = f"{base_url}/projects"
    modern_error = ""

    try:
        project = await _post_json(modern_url, modern_payload)
        return {
            "success": True,
            "source": "novel_migrated.projects",
            "id": project.get("id"),
            "title": project.get("title", normalized_title),
            "genre": project.get("genre", normalized_genre),
            "raw": project,
        }
    except Exception as modern_exc:
        modern_error = str(modern_exc)
        logger.warning("create_novel modern endpoint failed: %s", modern_error)

    legacy_payload = {
        "title": normalized_title,
        "metadata": {
            "genre": normalized_genre,
            "description": normalized_description,
            "created_by": "deerflow_create_novel_tool",
        },
    }
    legacy_url = f"{base_url}/api/novels"
    try:
        novel = await _post_json(legacy_url, legacy_payload)
        metadata = novel.get("metadata", {}) if isinstance(novel, dict) else {}
        genre_value = normalized_genre
        if isinstance(metadata, dict) and metadata.get("genre"):
            genre_value = str(metadata["genre"])
        return {
            "success": True,
            "source": "legacy.novel_api",
            "id": novel.get("id"),
            "title": novel.get("title", normalized_title),
            "genre": genre_value,
            "raw": novel,
        }
    except Exception as legacy_exc:
        logger.error("create_novel legacy endpoint failed: %s", legacy_exc)
        return {
            "success": False,
            "source": "network",
            "error": (
                "failed to create novel via both endpoints: "
                f"modern={modern_error or 'unknown'}; legacy={legacy_exc}"
            ),
        }
