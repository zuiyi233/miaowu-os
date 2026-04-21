from __future__ import annotations

import logging
import os
from typing import Annotated

from langchain.tools import InjectedToolCallId, ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.config import get_config
from langgraph.types import Command
from langgraph.typing import ContextT

from deerflow.agents.thread_state import ThreadState
from deerflow.media import draft_media_store

logger = logging.getLogger(__name__)

_RETENTION_ENV = "DEERFLOW_MEDIA_DRAFT_RETENTION"


def _get_thread_id(runtime: ToolRuntime[ContextT, ThreadState]) -> str | None:
    thread_id = runtime.context.get("thread_id") if runtime.context else None
    if thread_id:
        return thread_id

    runtime_config = getattr(runtime, "config", None) or {}
    thread_id = runtime_config.get("configurable", {}).get("thread_id")
    if thread_id:
        return thread_id

    try:
        return get_config().get("configurable", {}).get("thread_id")
    except RuntimeError:
        return None


def _get_configurable(runtime: ToolRuntime[ContextT, ThreadState]) -> dict:
    runtime_config = getattr(runtime, "config", None) or {}
    configurable = runtime_config.get("configurable")
    return configurable if isinstance(configurable, dict) else {}


def _resolve_retention(configurable: dict) -> DraftMediaRetention | str:
    raw = configurable.get("media_draft_retention")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    env_raw = (os.getenv(_RETENTION_ENV) or "").strip()
    return env_raw or "7d"


def _build_draft_media_deletions(removed_ids: list[str]) -> dict[str, None]:
    return {draft_id: None for draft_id in removed_ids if draft_id}


@tool("generate_image_draft", parse_docstring=True)
async def generate_image_draft(
    runtime: ToolRuntime[ContextT, ThreadState],
    prompt: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    model: str | None = None,
) -> Command:
    """Generate an image draft (chat-first, confirm before attaching).

    Use this when the user asks to generate an image (e.g. character portrait, illustration).
    The output is stored as a *draft* and must be confirmed by the user in the UI
    before attaching to a project/character/scene.

    Args:
        prompt: Image prompt for generation.
        model: Optional model identifier (passthrough string to OpenAI-compatible relay).
    """
    thread_id = _get_thread_id(runtime)
    if not thread_id:
        return Command(update={"messages": [ToolMessage("Error: Thread ID is not available", tool_call_id=tool_call_id)]})

    configurable = _get_configurable(runtime)
    retention = _resolve_retention(configurable)
    model_name = configurable.get("model_name") if isinstance(configurable.get("model_name"), str) else None

    update: dict = {}
    try:
        removed = draft_media_store.cleanup_expired(thread_id=thread_id)
        if removed:
            update["draft_media"] = _build_draft_media_deletions(removed)
    except Exception:
        logger.debug("Draft media cleanup failed (non-fatal): thread_id=%s", thread_id, exc_info=True)

    try:
        base_url, api_key = draft_media_store.resolve_openai_client_for_model(model_name)
        item = await draft_media_store.generate_openai_image_draft(
            thread_id=thread_id,
            base_url=base_url,
            api_key=api_key,
            prompt=(prompt or "").strip(),
            model=(model or "").strip() or None,
            retention=retention,
        )
    except Exception as exc:
        logger.warning("generate_image_draft failed: thread_id=%s error=%s", thread_id, exc)
        return Command(update={**update, "messages": [ToolMessage(f"Error generating image draft: {exc}", tool_call_id=tool_call_id)]})

    update.setdefault("draft_media", {})
    update["draft_media"][item["id"]] = item
    update.setdefault("messages", []).append(ToolMessage("Image draft generated", tool_call_id=tool_call_id))
    return Command(update=update)


@tool("generate_tts_draft", parse_docstring=True)
async def generate_tts_draft(
    runtime: ToolRuntime[ContextT, ThreadState],
    text: str,
    tool_call_id: Annotated[str, InjectedToolCallId],
    voice: str | None = None,
    model: str | None = None,
    format: str | None = None,
) -> Command:
    """Generate a TTS (audio) draft for quick playback in chat.

    Use this when the user asks to "read a line" / "试听" / generate a voice preview.
    The output is stored as a *draft* and must be confirmed by the user in the UI
    before attaching to a project/character/scene.

    Args:
        text: The text to synthesize.
        voice: Optional voice identifier (passthrough string).
        model: Optional model identifier (passthrough string).
        format: Optional response format (e.g. mp3/wav/flac/aac/opus).
    """
    thread_id = _get_thread_id(runtime)
    if not thread_id:
        return Command(update={"messages": [ToolMessage("Error: Thread ID is not available", tool_call_id=tool_call_id)]})

    configurable = _get_configurable(runtime)
    retention = _resolve_retention(configurable)
    model_name = configurable.get("model_name") if isinstance(configurable.get("model_name"), str) else None

    update: dict = {}
    try:
        removed = draft_media_store.cleanup_expired(thread_id=thread_id)
        if removed:
            update["draft_media"] = _build_draft_media_deletions(removed)
    except Exception:
        logger.debug("Draft media cleanup failed (non-fatal): thread_id=%s", thread_id, exc_info=True)

    try:
        base_url, api_key = draft_media_store.resolve_openai_client_for_model(model_name)
        item = await draft_media_store.generate_openai_tts_draft(
            thread_id=thread_id,
            base_url=base_url,
            api_key=api_key,
            text=(text or "").strip(),
            model=(model or "").strip() or None,
            voice=(voice or "").strip() or None,
            fmt=(format or "").strip() or None,
            retention=retention,
        )
    except Exception as exc:
        logger.warning("generate_tts_draft failed: thread_id=%s error=%s", thread_id, exc)
        return Command(update={**update, "messages": [ToolMessage(f"Error generating TTS draft: {exc}", tool_call_id=tool_call_id)]})

    update.setdefault("draft_media", {})
    update["draft_media"][item["id"]] = item
    update.setdefault("messages", []).append(ToolMessage("TTS draft generated", tool_call_id=tool_call_id))
    return Command(update=update)
