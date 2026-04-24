"""Built-in novel tools for DeerFlow agents.

These tools are registered in the Agent tool chain (方案2: Tool Calling).
When the intent recognition middleware (方案1) has an active creation session,
the tool defers to the session flow rather than bypassing the confirmation gate.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from langchain.tools import tool
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg

from deerflow.tools.builtins.novel_tool_helpers import SESSION_CONTEXT_KEYS, USER_CONTEXT_KEYS, get_base_url, pick_non_empty_str, post_json

logger = logging.getLogger(__name__)


def _resolve_gate_scope(
    config: RunnableConfig | None,
) -> tuple[str | None, str | None]:
    raw_config = config if isinstance(config, dict) else {}
    configurable = raw_config.get("configurable")
    configurable_map = configurable if isinstance(configurable, dict) else {}
    context = raw_config.get("context")
    context_map = context if isinstance(context, dict) else {}

    user_id = pick_non_empty_str(context_map, *USER_CONTEXT_KEYS) or pick_non_empty_str(configurable_map, *USER_CONTEXT_KEYS)
    if not user_id:
        return None, None

    merged_context: dict[str, Any] = {}
    for key in (*SESSION_CONTEXT_KEYS, *USER_CONTEXT_KEYS):
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
                "message": ("当前有正在进行的小说创建会话，请勿重复调用 create_novel。请回到 /api/ai/chat 会话流程继续补充字段，或回复“确认”完成创建、回复“取消”放弃。仅在已取消当前会话且用户明确要求重新开始时，才应再次调用 create_novel。"),
            }
    else:
        logger.warning("create_novel session gate skipped: missing user/session context (fail-open)")

    normalized_title = (title or "").strip()
    if not normalized_title:
        return {
            "success": False,
            "error": "title is required",
            "source": "validation",
        }

    normalized_genre = (genre or "").strip() or "科幻"
    normalized_description = (description or "").strip()
    base_url = get_base_url()

    modern_payload = {
        "title": normalized_title,
        "genre": normalized_genre,
        "theme": normalized_genre,
        "description": normalized_description,
    }
    modern_url = f"{base_url}/projects"
    modern_error = ""

    try:
        project = await post_json(modern_url, modern_payload)
        legacy_payload = {
            "title": normalized_title,
            "metadata": {
                "genre": normalized_genre,
                "description": normalized_description,
                "created_by": "deerflow_create_novel_tool_dual_write",
                "modern_project_id": project.get("id"),
            },
        }
        if project.get("id"):
            legacy_payload["id"] = project["id"]
        try:
            await post_json(f"{base_url}/api/novels", legacy_payload)
        except Exception as legacy_sync_exc:
            logger.warning("create_novel dual-write to legacy endpoint failed: %s", legacy_sync_exc)
            try:
                from app.gateway.novel_migrated.services.dual_write_service import record_dual_write_failure

                await record_dual_write_failure(
                    modern_project_id=project.get("id", ""),
                    legacy_payload=legacy_payload,
                    error=str(legacy_sync_exc),
                )
            except Exception as record_exc:
                logger.warning("create_novel dual-write compensation record failed: %s", record_exc)
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
        novel = await post_json(legacy_url, legacy_payload)
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
            "error": (f"failed to create novel via both endpoints: modern={modern_error or 'unknown'}; legacy={legacy_exc}"),
        }
