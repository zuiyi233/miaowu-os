"""Run lifecycle service layer.

Centralizes the business logic for creating runs, formatting SSE
frames, and consuming stream bridge events.  Router modules
(``thread_runs``, ``runs``) are thin HTTP handlers that delegate here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Mapping
from functools import partial
from typing import Any

from fastapi import HTTPException, Request
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from sqlalchemy import select

from app.gateway.deps import get_checkpointer, get_run_manager, get_store, get_stream_bridge
from app.gateway.novel_migrated.core.crypto import safe_decrypt
from app.gateway.novel_migrated.core.database import AsyncSessionLocal
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.ai_settings_service import resolve_user_ai_runtime_config
from deerflow.runtime import (
    END_SENTINEL,
    HEARTBEAT_SENTINEL,
    ConflictError,
    DisconnectMode,
    RunManager,
    RunRecord,
    RunStatus,
    StreamBridge,
    UnsupportedStrategyError,
    run_agent,
)

logger = logging.getLogger(__name__)


def _log_fire_and_forget_failure(task: asyncio.Task[Any], *, label: str) -> None:
    """Consume exceptions from fire-and-forget tasks and log them once."""

    if task.cancelled():
        return

    try:
        exc = task.exception()
    except asyncio.CancelledError:
        return
    except Exception:
        logger.debug("%s finished but its exception could not be inspected", label, exc_info=True)
        return

    if exc is not None:
        logger.debug("%s failed: %s", label, exc)


# ---------------------------------------------------------------------------
# SSE formatting
# ---------------------------------------------------------------------------


def format_sse(event: str, data: Any, *, event_id: str | None = None) -> str:
    """Format a single SSE frame.

    Field order: ``event:`` -> ``data:`` -> ``id:`` (optional) -> blank line.
    This matches the LangGraph Platform wire format consumed by the
    ``useStream`` React hook and the Python ``langgraph-sdk`` SSE decoder.
    """
    payload = json.dumps(data, default=str, ensure_ascii=False)
    parts = [f"event: {event}", f"data: {payload}"]
    if event_id:
        parts.append(f"id: {event_id}")
    parts.append("")
    parts.append("")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Input / config helpers
# ---------------------------------------------------------------------------


def normalize_stream_modes(raw: list[str] | str | None) -> list[str]:
    """Normalize the stream_mode parameter to a list.

    Default matches what ``useStream`` expects: values + messages-tuple.
    """
    if raw is None:
        return ["values"]
    if isinstance(raw, str):
        return [raw]
    return raw if raw else ["values"]


def normalize_input(raw_input: dict[str, Any] | None) -> dict[str, Any]:
    """Convert LangGraph Platform input format to LangChain state dict."""
    if raw_input is None:
        return {}
    messages = raw_input.get("messages")
    if messages and isinstance(messages, list):
        converted = []
        for msg in messages:
            if isinstance(msg, dict):
                role = msg.get("role", msg.get("type", "user"))
                content = msg.get("content", "")
                if role in ("user", "human"):
                    converted.append(HumanMessage(content=content))
                elif role in ("system",):
                    converted.append(SystemMessage(content=content))
                elif role in ("ai", "assistant"):
                    converted.append(AIMessage(content=content))
                elif role in ("tool",):
                    tool_call_id = msg.get("tool_call_id", "")
                    name = msg.get("name", "")
                    converted.append(ToolMessage(content=content, tool_call_id=tool_call_id, name=name))
                else:
                    converted.append(HumanMessage(content=content))
            else:
                converted.append(msg)
        return {**raw_input, "messages": converted}
    return raw_input


_DEFAULT_ASSISTANT_ID = "lead_agent"


_CONTEXT_CONFIGURABLE_KEYS: frozenset[str] = frozenset(
    {
        "model_name",
        "mode",
        "thinking_enabled",
        "reasoning_effort",
        "is_plan_mode",
        "subagent_enabled",
        "max_concurrent_subagents",
        "agent_name",
        "is_bootstrap",
        "media_draft_retention",
        "provider_id",
    }
)


def merge_run_context_overrides(config: dict[str, Any], context: Mapping[str, Any] | None) -> None:
    if not context:
        return
    configurable = config.setdefault("configurable", {})
    runtime_context = config.setdefault("context", {})
    for key in _CONTEXT_CONFIGURABLE_KEYS:
        if key in context:
            if isinstance(configurable, dict):
                configurable.setdefault(key, context[key])
            if isinstance(runtime_context, dict):
                runtime_context.setdefault(key, context[key])


def _as_non_empty_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _extract_module_id(context: dict[str, Any] | None) -> str | None:
    if not isinstance(context, dict):
        return None

    for key in ("module_id", "moduleId", "module"):
        value = context.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _apply_runtime_provider_overrides(
    configurable: dict[str, Any],
    *,
    runtime_model: str | None,
    runtime_provider: str | None,
    runtime_base_url: str | None,
    runtime_api_key: str | None,
) -> bool:
    """Inject runtime provider/model overrides into run configurable.

    Returns True when at least one override field is written.
    """
    changed = False
    if runtime_model:
        configurable["runtime_model"] = runtime_model
        changed = True
    if runtime_provider:
        configurable["runtime_provider"] = runtime_provider
        changed = True
    if runtime_base_url:
        configurable["runtime_base_url"] = runtime_base_url
        changed = True
    if runtime_api_key:
        configurable["runtime_api_key"] = runtime_api_key
        changed = True
    return changed


async def _resolve_runtime_provider_overrides_for_thread(
    request: Request,
    *,
    requested_model_name: str | None,
    module_id: str | None = None,
) -> dict[str, str] | None:
    """Resolve per-user provider credentials for LangGraph runtime calls.

    Source of truth is `Settings` / `ai_provider_settings` persistence layer.
    We intentionally do NOT read `.env`/`config.yaml` here so frontend-saved
    user settings can take effect immediately for thread runs.
    """
    user_id = get_request_user_id(request)
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Settings).where(Settings.user_id == user_id))
            settings = result.scalar_one_or_none()
    except Exception:
        logger.warning(
            "Failed to load user settings for runtime provider overrides: user=%s",
            user_id,
            exc_info=True,
        )
        return None

    if settings is None:
        return None

    runtime, _ = resolve_user_ai_runtime_config(
        settings,
        ai_model=requested_model_name,
        module_id=module_id,
    )

    resolved: dict[str, str] = {"runtime_model": runtime["model_name"]}
    if runtime["api_provider"]:
        resolved["runtime_provider"] = runtime["api_provider"]
    if runtime["api_base_url"]:
        resolved["runtime_base_url"] = runtime["api_base_url"]
    if runtime["api_key"]:
        resolved["runtime_api_key"] = runtime["api_key"]
    return resolved


def _resolve_feature_model_from_routing(
    feature_module_id: str,
    ai_settings: dict[str, Any],
) -> dict[str, str] | None:
    """Resolve model overrides for a feature from ai-settings feature routing.

    Returns runtime override fields:
    - runtime_model: provider-side model id (may not exist in config.yaml)
    - runtime_base_url / runtime_api_key: provider credential overrides
    """
    feature_routing = ai_settings.get("feature_routing_settings")
    if not isinstance(feature_routing, dict):
        return None

    modules = feature_routing.get("modules")
    if not isinstance(modules, list):
        return None

    target_module = None
    for mod in modules:
        if isinstance(mod, dict) and mod.get("moduleId") == feature_module_id:
            target_module = mod
            break

    if target_module is None:
        return None

    active_mode = target_module.get("currentMode", "primary")
    if active_mode == "backup":
        target = target_module.get("backupTarget")
    else:
        target = target_module.get("primaryTarget")

    if not isinstance(target, dict) or not target.get("model"):
        target = target_module.get("primaryTarget")
        if not isinstance(target, dict) or not target.get("model"):
            return None

    model_name = _as_non_empty_str(target.get("model"))
    provider_id = _as_non_empty_str(target.get("providerId"))
    if not model_name:
        return None

    providers = ai_settings.get("providers")
    if not isinstance(providers, list):
        return {"runtime_model": model_name}

    provider_record = None
    if provider_id:
        for p in providers:
            if isinstance(p, dict) and p.get("id") == provider_id:
                provider_record = p
                break

    result: dict[str, str] = {"runtime_model": model_name}
    if provider_record:
        base_url = _as_non_empty_str(provider_record.get("base_url"))
        api_key_encrypted = _as_non_empty_str(provider_record.get("api_key_encrypted"))
        if not api_key_encrypted:
            api_key_encrypted = _as_non_empty_str(provider_record.get("api_key"))
        api_key = _as_non_empty_str(safe_decrypt(api_key_encrypted)) if api_key_encrypted else None
        if base_url:
            result["runtime_base_url"] = base_url
        if api_key:
            result["runtime_api_key"] = api_key

    return result


async def _resolve_feature_model_overrides_for_thread(
    request: Request,
    *,
    active_provider_overrides: dict[str, str] | None,
) -> dict[str, str]:
    """Resolve per-feature model overrides from user ai-settings feature routing.

    For each feature (title, memory, summarization), checks if the user has
    configured a specific model in feature_routing_settings. If not, falls back
    to the active provider's model (same as main chat).

    Returns a flat dict with keys like:
      title_runtime_model, title_runtime_base_url, title_runtime_api_key,
      memory_runtime_model, memory_runtime_base_url, memory_runtime_api_key,
      summarization_runtime_model, summarization_runtime_base_url, summarization_runtime_api_key
    """
    user_id = get_request_user_id(request)
    ai_settings: dict[str, Any] = {}

    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Settings).where(Settings.user_id == user_id))
            settings = result.scalar_one_or_none()
            if settings is None:
                return {}

            preferences_raw = settings.preferences or "{}"
            if isinstance(preferences_raw, str):
                try:
                    preferences = json.loads(preferences_raw)
                except Exception:
                    preferences = {}
            else:
                preferences = preferences_raw

            if not isinstance(preferences, dict):
                preferences = {}

            ai_provider_settings = preferences.get("ai_provider_settings", {})
            if isinstance(ai_provider_settings, dict):
                providers_raw = ai_provider_settings.get("providers", [])
                public_providers = []
                if isinstance(providers_raw, list):
                    for p in providers_raw:
                        if isinstance(p, dict):
                            public_providers.append(p)

                ai_settings = {
                    "providers": public_providers,
                    "feature_routing_settings": ai_provider_settings.get("feature_routing_settings"),
                }
    except Exception:
        logger.debug("Failed to load feature routing settings for user %s", user_id, exc_info=True)
        return {}

    fallback_runtime_model = active_provider_overrides.get("runtime_model") if active_provider_overrides else None
    fallback_base_url = active_provider_overrides.get("runtime_base_url") if active_provider_overrides else None
    fallback_api_key = active_provider_overrides.get("runtime_api_key") if active_provider_overrides else None

    result: dict[str, str] = {}

    for feature_id, prefix in [
        ("title-ai", "title"),
        ("memory-ai", "memory"),
        ("summarization-ai", "summarization"),
    ]:
        feature_overrides = _resolve_feature_model_from_routing(feature_id, ai_settings)

        if feature_overrides:
            runtime_model = feature_overrides.get("runtime_model")
            base_url = feature_overrides.get("runtime_base_url")
            api_key = feature_overrides.get("runtime_api_key")
        else:
            runtime_model = fallback_runtime_model
            base_url = fallback_base_url
            api_key = fallback_api_key

        if not any((runtime_model, base_url, api_key)):
            continue

        if runtime_model:
            result[f"{prefix}_runtime_model"] = runtime_model
        if base_url:
            result[f"{prefix}_runtime_base_url"] = base_url
        if api_key:
            result[f"{prefix}_runtime_api_key"] = api_key

    return result


def resolve_agent_factory(assistant_id: str | None):
    """Resolve the agent factory callable from config.

    Custom agents are implemented as ``lead_agent`` + an ``agent_name``
    injected into ``configurable`` or ``context`` — see
    :func:`build_run_config`.  All ``assistant_id`` values therefore map to the
    same factory; the routing happens inside ``make_lead_agent`` when it reads
    ``cfg["agent_name"]``.
    """
    from deerflow.agents.lead_agent.agent import make_lead_agent

    return make_lead_agent


def build_run_config(
    thread_id: str,
    request_config: dict[str, Any] | None,
    metadata: dict[str, Any] | None,
    *,
    assistant_id: str | None = None,
) -> dict[str, Any]:
    """Build a RunnableConfig dict for the agent.

    When *assistant_id* refers to a custom agent (anything other than
    ``"lead_agent"`` / ``None``), the name is forwarded as ``agent_name`` in
    whichever runtime options container is active: ``context`` for
    LangGraph >= 0.6.0 requests, otherwise ``configurable``.
    ``make_lead_agent`` reads this key to load the matching
    ``agents/<name>/SOUL.md`` and per-agent config — without it the agent
    silently runs as the default lead agent.

    This mirrors the channel manager's ``_resolve_run_params`` logic so that
    the LangGraph Platform-compatible HTTP API and the IM channel path behave
    identically.
    """
    config: dict[str, Any] = {"recursion_limit": 100}
    if request_config:
        # LangGraph >= 0.6.0 introduced ``context`` as the preferred way to
        # pass thread-level data and rejects requests that include both
        # ``configurable`` and ``context``.  If the caller already sends
        # ``context``, honour it and skip our own ``configurable`` dict.
        if "context" in request_config:
            if "configurable" in request_config:
                logger.warning(
                    "build_run_config: client sent both 'context' and 'configurable'; preferring 'context' (LangGraph >= 0.6.0). thread_id=%s, caller_configurable keys=%s",
                    thread_id,
                    list(request_config.get("configurable", {}).keys()),
                )
            context_value = request_config["context"]
            if context_value is None:
                context = {}
            elif isinstance(context_value, Mapping):
                context = dict(context_value)
            else:
                raise ValueError("request config 'context' must be a mapping or null.")
            config["context"] = context
        else:
            configurable = {"thread_id": thread_id}
            configurable.update(request_config.get("configurable", {}))
            config["configurable"] = configurable
        for k, v in request_config.items():
            if k not in ("configurable", "context"):
                config[k] = v
    else:
        config["configurable"] = {"thread_id": thread_id}

    # Inject custom agent name when the caller specified a non-default assistant.
    # Honour an explicit agent_name in the active runtime options container.
    if assistant_id and assistant_id != _DEFAULT_ASSISTANT_ID:
        normalized = assistant_id.strip().lower().replace("_", "-")
        if not normalized or not re.fullmatch(r"[a-z0-9-]+", normalized):
            raise ValueError(f"Invalid assistant_id {assistant_id!r}: must contain only letters, digits, and hyphens after normalization.")
        if "configurable" in config:
            target = config["configurable"]
        elif "context" in config:
            target = config["context"]
        else:
            target = config.setdefault("configurable", {})
        if target is not None and "agent_name" not in target:
            target["agent_name"] = normalized
    if "configurable" in config and "include_novel" not in config["configurable"]:
        config["configurable"]["include_novel"] = True
    elif "context" in config and "include_novel" not in config["context"]:
        config["context"]["include_novel"] = True
    if metadata:
        config.setdefault("metadata", {}).update(metadata)
    return config


# ---------------------------------------------------------------------------
# Run lifecycle
# ---------------------------------------------------------------------------


async def start_run(
    body: Any,
    thread_id: str,
    request: Request,
) -> RunRecord:
    """Create a RunRecord and launch the background agent task.

    Parameters
    ----------
    body : RunCreateRequest
        The validated request body (typed as Any to avoid circular import
        with the router module that defines the Pydantic model).
    thread_id : str
        Target thread.
    request : Request
        FastAPI request — used to retrieve singletons from ``app.state``.
    """
    bridge = get_stream_bridge(request)
    run_mgr = get_run_manager(request)
    run_ctx = get_run_context(request)

    disconnect = DisconnectMode.cancel if body.on_disconnect == "cancel" else DisconnectMode.continue_

    try:
        record = await run_mgr.create_or_reject(
            thread_id,
            body.assistant_id,
            on_disconnect=disconnect,
            metadata=body.metadata or {},
            kwargs={"input": body.input, "config": body.config},
            multitask_strategy=body.multitask_strategy,
        )
    except ConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UnsupportedStrategyError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    # Upsert thread metadata so the thread appears in /threads/search,
    # even for threads that were never explicitly created via POST /threads
    # (e.g. stateless runs).
    try:
        existing = await run_ctx.thread_store.get(thread_id)
        if existing is None:
            await run_ctx.thread_store.create(
                thread_id,
                assistant_id=body.assistant_id,
                metadata=body.metadata,
            )
        else:
            await run_ctx.thread_store.update_status(thread_id, "running")
    except Exception:
        logger.warning("Failed to upsert thread_meta for %s (non-fatal)", sanitize_log_param(thread_id))

    agent_factory = resolve_agent_factory(body.assistant_id)
    graph_input = normalize_input(body.input)
    config = build_run_config(thread_id, body.config, body.metadata, assistant_id=body.assistant_id)

    # Merge DeerFlow-specific context overrides into both configurable and context.
    # The ``context`` field is a custom extension for the langgraph-compat layer
    # that carries agent configuration (model_name, thinking_enabled, etc.).
    # Only agent-relevant keys are forwarded; unknown keys (e.g. thread_id) are ignored.
    context = getattr(body, "context", None)
    module_id = _extract_module_id(context)
    merge_run_context_overrides(config, context)

    configurable = config.setdefault("configurable", {})
    requested_model_name = _as_non_empty_str(configurable.get("model_name") or configurable.get("model"))
    runtime_overrides = await _resolve_runtime_provider_overrides_for_thread(
        request,
        requested_model_name=requested_model_name,
        module_id=module_id,
    )
    if runtime_overrides:
        _apply_runtime_provider_overrides(
            configurable,
            runtime_model=runtime_overrides.get("runtime_model"),
            runtime_provider=runtime_overrides.get("runtime_provider"),
            runtime_base_url=runtime_overrides.get("runtime_base_url"),
            runtime_api_key=runtime_overrides.get("runtime_api_key"),
        )

    feature_overrides = await _resolve_feature_model_overrides_for_thread(
        request,
        active_provider_overrides=runtime_overrides,
    )
    if feature_overrides:
        configurable.update(feature_overrides)

    stream_modes = normalize_stream_modes(body.stream_mode)

    task = asyncio.create_task(
        run_agent(
            bridge,
            run_mgr,
            record,
            ctx=run_ctx,
            agent_factory=agent_factory,
            graph_input=graph_input,
            config=config,
            stream_modes=stream_modes,
            stream_subgraphs=body.stream_subgraphs,
            interrupt_before=body.interrupt_before,
            interrupt_after=body.interrupt_after,
        )
    )
    record.task = task

    # After the run completes, sync the title generated by TitleMiddleware from
    # the checkpointer into the Store record so that /threads/search returns the
    # correct title instead of an empty values dict.
    if store is not None:
        title_sync_task = asyncio.create_task(
            _sync_thread_title_after_run(task, thread_id, checkpointer, store),
            name=f"thread-title-sync:{thread_id}",
        )
        title_sync_task.add_done_callback(
            partial(
                _log_fire_and_forget_failure,
                label=f"thread title sync for {thread_id}",
            )
        )

    return record


async def sse_consumer(
    bridge: StreamBridge,
    record: RunRecord,
    request: Request,
    run_mgr: RunManager,
):
    """Async generator that yields SSE frames from the bridge.

    The ``finally`` block implements ``on_disconnect`` semantics:
    - ``cancel``: abort the background task on client disconnect.
    - ``continue``: let the task run; events are discarded.
    """
    last_event_id = request.headers.get("Last-Event-ID")
    try:
        async for entry in bridge.subscribe(record.run_id, last_event_id=last_event_id):
            if await request.is_disconnected():
                break

            if entry is HEARTBEAT_SENTINEL:
                yield ": heartbeat\n\n"
                continue

            if entry is END_SENTINEL:
                yield format_sse("end", None, event_id=entry.id or None)
                return

            yield format_sse(entry.event, entry.data, event_id=entry.id or None)

    finally:
        if record.status in (RunStatus.pending, RunStatus.running):
            if record.on_disconnect == DisconnectMode.cancel:
                await run_mgr.cancel(record.run_id)
