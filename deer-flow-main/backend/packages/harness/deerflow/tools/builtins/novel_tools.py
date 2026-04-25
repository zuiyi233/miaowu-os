"""Built-in novel tools for DeerFlow agents.

These tools are registered in the Agent tool chain (方案2: Tool Calling).
When the intent recognition middleware (方案1) has an active creation session,
the tool defers to the session flow rather than bypassing the confirmation gate.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
import time
from collections.abc import Callable
from typing import Annotated, Any

from langchain.tools import InjectedToolCallId, tool
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg
from langgraph.config import get_stream_writer

from deerflow.tools.builtins.novel_tool_helpers import (
    SESSION_CONTEXT_KEYS,
    USER_CONTEXT_KEYS,
    get_base_url,
    pick_non_empty_str,
    post_json,
)

logger = logging.getLogger(__name__)

_CREATE_NOVEL_PROGRESS_EVENT_TYPE = "create_novel_progress"
_CREATE_NOVEL_PRIMARY_TIMEOUT_ENV = "DEERFLOW_CREATE_NOVEL_PRIMARY_TIMEOUT_SECONDS"
_CREATE_NOVEL_LEGACY_TIMEOUT_ENV = "DEERFLOW_CREATE_NOVEL_LEGACY_TIMEOUT_SECONDS"
_CREATE_NOVEL_ROUTE_FALLBACK_ENV = "DEERFLOW_CREATE_NOVEL_ENABLE_ROUTE_FALLBACK"
_CREATE_NOVEL_DUAL_WRITE_ASYNC_ENV = "DEERFLOW_CREATE_NOVEL_DUAL_WRITE_ASYNC"
_CREATE_NOVEL_MAX_ATTEMPTS_ENV = "DEERFLOW_CREATE_NOVEL_MAX_ATTEMPTS"
_CREATE_NOVEL_RETRY_BACKOFF_MS_ENV = "DEERFLOW_CREATE_NOVEL_RETRY_BACKOFF_MS"
_DEFAULT_PRIMARY_TIMEOUT_SECONDS = 12.0
_DEFAULT_LEGACY_TIMEOUT_SECONDS = 4.0
_DEFAULT_CREATE_NOVEL_MAX_ATTEMPTS = 2
_DEFAULT_CREATE_NOVEL_RETRY_BACKOFF_MS = 600

_StreamWriter = Callable[[dict[str, Any]], None]


def _load_optional_attr(module_path: str, attr_name: str) -> Any | None:
    try:
        module = importlib.import_module(module_path)
    except Exception as exc:
        logger.debug("create_novel optional import skipped: %s (%s)", module_path, exc)
        return None

    return getattr(module, attr_name, None)


def _parse_float_env(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return max(1.0, float(raw))
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to %.1fs", name, raw, default)
        return default


def _parse_bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    logger.warning("Invalid %s=%s, fallback to %s", name, raw, default)
    return default


def _parse_int_env(name: str, default: int, *, min_value: int = 1) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to %s", name, raw, default)
        return default
    return max(min_value, value)


def _safe_get_stream_writer() -> _StreamWriter | None:
    try:
        return get_stream_writer()
    except Exception:
        return None


def _emit_progress_event(
    *,
    writer: _StreamWriter | None,
    tool_call_id: str | None,
    stage: str,
    status: str,
    message: str,
    elapsed_ms: float | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    if writer is None:
        return

    payload: dict[str, Any] = {
        "type": _CREATE_NOVEL_PROGRESS_EVENT_TYPE,
        "stage": stage,
        "status": status,
        "message": message,
    }
    if tool_call_id:
        payload["tool_call_id"] = tool_call_id
    if elapsed_ms is not None:
        payload["elapsed_ms"] = round(elapsed_ms, 2)
    if extra:
        payload.update(extra)

    try:
        writer(payload)
    except Exception:
        logger.debug("create_novel progress event emit failed", exc_info=True)


class _ProgressTracer:
    def __init__(self, *, writer: _StreamWriter | None, tool_call_id: str | None) -> None:
        self.writer = writer
        self.tool_call_id = tool_call_id
        self._stage_started: dict[str, float] = {}
        self.stage_trace: list[dict[str, Any]] = []
        self.timings_ms: dict[str, float] = {}
        self._overall_started = time.perf_counter()

    def start(self, stage: str, message: str, *, extra: dict[str, Any] | None = None) -> None:
        self._stage_started[stage] = time.perf_counter()
        _emit_progress_event(
            writer=self.writer,
            tool_call_id=self.tool_call_id,
            stage=stage,
            status="running",
            message=message,
            extra=extra,
        )

    def finish(
        self,
        stage: str,
        status: str,
        message: str,
        *,
        extra: dict[str, Any] | None = None,
    ) -> float:
        started = self._stage_started.pop(stage, None)
        elapsed_ms = ((time.perf_counter() - started) * 1000.0) if started is not None else 0.0

        self.timings_ms[stage] = round(elapsed_ms, 2)
        trace_item: dict[str, Any] = {
            "stage": stage,
            "status": status,
            "message": message,
            "elapsed_ms": round(elapsed_ms, 2),
        }
        if extra:
            trace_item.update(extra)
        self.stage_trace.append(trace_item)

        _emit_progress_event(
            writer=self.writer,
            tool_call_id=self.tool_call_id,
            stage=stage,
            status=status,
            message=message,
            elapsed_ms=elapsed_ms,
            extra=extra,
        )
        return elapsed_ms

    def snapshot(self) -> dict[str, Any]:
        return {
            "elapsed_ms": round((time.perf_counter() - self._overall_started) * 1000.0, 2),
            "timings_ms": dict(self.timings_ms),
            "stages": list(self.stage_trace),
        }


def _resolve_user_id(raw_user_id: str | None) -> str:
    resolver = _load_optional_attr(
        "app.gateway.novel_migrated.core.user_context",
        "resolve_user_id",
    )
    if callable(resolver):
        try:
            resolved = resolver(raw_user_id)
            if isinstance(resolved, str) and resolved.strip():
                return resolved.strip()
        except Exception:
            logger.debug("create_novel resolve_user_id failed, fallback to local default", exc_info=True)

    normalized = (raw_user_id or "").strip()
    return normalized or "local_single_user"


def _resolve_intent_middleware() -> Any | None:
    return _load_optional_attr("app.gateway.api.ai_provider", "_INTENT_RECOGNITION_MIDDLEWARE")


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

    middleware = _resolve_intent_middleware()
    if middleware is None:
        logger.warning("create_novel session gate skipped: intent middleware is unavailable")
        return user_id, None

    build_session_key = getattr(middleware, "build_session_key_for_context", None)
    if not callable(build_session_key):
        logger.warning("create_novel session gate skipped: build_session_key_for_context is unavailable")
        return user_id, None

    try:
        session_key = build_session_key(
            user_id=user_id,
            context=merged_context or None,
        )
    except Exception:
        logger.exception("create_novel session gate failed to build session key")
        return user_id, None

    if isinstance(session_key, str) and session_key.strip():
        return user_id, session_key.strip()
    return user_id, None


async def _has_active_creation_session(*, user_id: str, session_key: str) -> bool:
    middleware = _resolve_intent_middleware()
    if middleware is None:
        return False

    checker = getattr(middleware, "has_active_creation_session", None)
    if not callable(checker):
        return False

    try:
        return bool(
            await checker(
                user_id=user_id,
                session_key=session_key,
            )
        )
    except Exception:
        logger.exception("create_novel session gate check failed, fallback to fail-open")
        return False


async def _create_project_via_internal(
    *,
    modern_payload: dict[str, Any],
    user_id: str | None,
) -> dict[str, Any]:
    init_db_schema = _load_optional_attr("app.gateway.novel_migrated.core.database", "init_db_schema")
    async_session_local = _load_optional_attr("app.gateway.novel_migrated.core.database", "AsyncSessionLocal")
    project_create_request_cls = _load_optional_attr("app.gateway.novel_migrated.api.projects", "ProjectCreateRequest")
    create_project = _load_optional_attr("app.gateway.novel_migrated.api.projects", "create_project")

    if not callable(init_db_schema) or async_session_local is None or project_create_request_cls is None or not callable(create_project):
        raise RuntimeError("internal modern project api unavailable")

    req = project_create_request_cls(
        title=str(modern_payload.get("title") or ""),
        description=str(modern_payload.get("description") or ""),
        theme=str(modern_payload.get("theme") or ""),
        genre=str(modern_payload.get("genre") or ""),
    )

    await init_db_schema()
    effective_user_id = _resolve_user_id(user_id)

    async with async_session_local() as db_session:
        project = await create_project(req=req, user_id=effective_user_id, db=db_session)

    if hasattr(project, "model_dump"):
        model_dump = getattr(project, "model_dump")
        if callable(model_dump):
            project = model_dump()

    if isinstance(project, dict):
        return project

    raise RuntimeError("internal modern project api returned non-dict payload")


async def _create_project_via_http(
    *,
    base_url: str,
    modern_payload: dict[str, Any],
    timeout_seconds: float,
    allow_route_fallback: bool,
) -> dict[str, Any]:
    return await post_json(
        f"{base_url}/projects",
        modern_payload,
        timeout_seconds=timeout_seconds,
        allow_route_fallback=allow_route_fallback,
    )


async def _create_legacy_via_internal(legacy_payload: dict[str, Any]) -> dict[str, Any]:
    novel_store = _load_optional_attr("app.gateway.routers.novel", "_novel_store")
    if novel_store is None:
        raise RuntimeError("legacy novel store is unavailable")

    create_novel = getattr(novel_store, "create_novel", None)
    if not callable(create_novel):
        raise RuntimeError("legacy novel store create_novel is unavailable")

    novel = await create_novel(legacy_payload)
    if isinstance(novel, dict):
        return novel
    raise RuntimeError("legacy novel store create_novel returned non-dict payload")


async def _create_legacy_via_http(
    *,
    base_url: str,
    legacy_payload: dict[str, Any],
    timeout_seconds: float,
    allow_route_fallback: bool,
) -> dict[str, Any]:
    return await post_json(
        f"{base_url}/api/novels",
        legacy_payload,
        timeout_seconds=timeout_seconds,
        allow_route_fallback=allow_route_fallback,
    )


async def _record_dual_write_failure(
    *,
    modern_project_id: str,
    legacy_payload: dict[str, Any],
    error: str,
) -> None:
    record_fn = _load_optional_attr(
        "app.gateway.novel_migrated.services.dual_write_service",
        "record_dual_write_failure",
    )
    if not callable(record_fn):
        return
    await record_fn(
        modern_project_id=modern_project_id,
        legacy_payload=legacy_payload,
        error=error,
    )


async def _dual_write_legacy(
    *,
    base_url: str,
    legacy_payload: dict[str, Any],
    legacy_timeout_seconds: float,
    allow_route_fallback: bool,
) -> str:
    internal_error = ""
    try:
        await _create_legacy_via_internal(legacy_payload)
        return "internal"
    except Exception as exc:
        internal_error = str(exc)
        logger.warning("create_novel dual-write internal sync failed: %s", internal_error)

    await _create_legacy_via_http(
        base_url=base_url,
        legacy_payload=legacy_payload,
        timeout_seconds=legacy_timeout_seconds,
        allow_route_fallback=allow_route_fallback,
    )
    return "http"


def _launch_background_task(coro: Any, *, task_label: str) -> bool:
    try:
        task = asyncio.create_task(coro)
    except RuntimeError:
        logger.debug("%s background task skipped: no running event loop", task_label)
        return False

    def _log_task_failure(done_task: asyncio.Task[Any]) -> None:
        if done_task.cancelled():
            return
        exc = done_task.exception()
        if exc is not None:
            logger.warning("%s background task failed: %s", task_label, exc)

    task.add_done_callback(_log_task_failure)
    return True


def _extract_legacy_genre(novel: dict[str, Any], *, default_genre: str) -> str:
    metadata = novel.get("metadata")
    if isinstance(metadata, dict):
        value = metadata.get("genre")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return default_genre


def _retry_backoff_seconds(*, attempt: int, base_backoff_ms: int) -> float:
    # attempt starts from 1.
    exponent = max(0, attempt - 1)
    return max(0.0, (base_backoff_ms / 1000.0) * (2**exponent))


@tool("create_novel", parse_docstring=True)
async def create_novel(
    title: str,
    genre: str = "科幻",
    description: str = "",
    config: Annotated[RunnableConfig | None, InjectedToolArg] = None,
    tool_call_id: Annotated[str | None, InjectedToolCallId] = None,
) -> dict[str, Any]:
    """Create a new novel project for the user.

    The tool first creates novel_migrated project data via an internal direct path
    (P2 optimization) and falls back to HTTP only when internal modules are
    unavailable or runtime errors occur.

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
    progress = _ProgressTracer(
        writer=_safe_get_stream_writer(),
        tool_call_id=tool_call_id,
    )

    progress.start("session_gate_check", "正在检查小说创建会话状态…")
    gate_user_id, gate_session_key = _resolve_gate_scope(config)
    if gate_user_id and gate_session_key:
        if await _has_active_creation_session(user_id=gate_user_id, session_key=gate_session_key):
            progress.finish(
                "session_gate_check",
                "failed",
                "检测到当前会话已有进行中的小说创建，请先完成或取消。",
            )
            progress.finish("failed", "failed", "小说创建已终止。")
            return {
                "success": False,
                "source": "session_gate",
                "error": "active_creation_session",
                "message": ("当前有正在进行的小说创建会话，请勿重复调用 create_novel。请回到 /api/ai/chat 会话流程继续补充字段，或回复“确认”完成创建、回复“取消”放弃。仅在已取消当前会话且用户明确要求重新开始时，才应再次调用 create_novel。"),
                "progress": progress.snapshot(),
            }
        progress.finish("session_gate_check", "completed", "会话检查通过。")
    else:
        logger.warning("create_novel session gate skipped: missing user/session context (fail-open)")
        progress.finish("session_gate_check", "skipped", "缺少用户/会话上下文，已按 fail-open 继续。")

    progress.start("validation", "正在校验创建参数…")
    normalized_title = (title or "").strip()
    if not normalized_title:
        progress.finish("validation", "failed", "小说标题不能为空。")
        progress.finish("failed", "failed", "小说创建失败。")
        return {
            "success": False,
            "error": "title is required",
            "source": "validation",
            "progress": progress.snapshot(),
        }

    normalized_genre = (genre or "").strip() or "科幻"
    normalized_description = (description or "").strip()
    progress.finish("validation", "completed", "参数校验通过。")

    base_url = get_base_url()
    primary_timeout_seconds = _parse_float_env(
        _CREATE_NOVEL_PRIMARY_TIMEOUT_ENV,
        _DEFAULT_PRIMARY_TIMEOUT_SECONDS,
    )
    legacy_timeout_seconds = _parse_float_env(
        _CREATE_NOVEL_LEGACY_TIMEOUT_ENV,
        _DEFAULT_LEGACY_TIMEOUT_SECONDS,
    )
    allow_route_fallback = _parse_bool_env(_CREATE_NOVEL_ROUTE_FALLBACK_ENV, True)
    dual_write_async_enabled = _parse_bool_env(_CREATE_NOVEL_DUAL_WRITE_ASYNC_ENV, False)
    max_attempts = _parse_int_env(
        _CREATE_NOVEL_MAX_ATTEMPTS_ENV,
        _DEFAULT_CREATE_NOVEL_MAX_ATTEMPTS,
        min_value=1,
    )
    retry_backoff_ms = _parse_int_env(
        _CREATE_NOVEL_RETRY_BACKOFF_MS_ENV,
        _DEFAULT_CREATE_NOVEL_RETRY_BACKOFF_MS,
        min_value=0,
    )

    modern_payload = {
        "title": normalized_title,
        "genre": normalized_genre,
        "theme": normalized_genre,
        "description": normalized_description,
    }

    progress.start("create_project", "正在创建小说项目（modern）…")
    project: dict[str, Any] | None = None
    modern_source = "internal"
    modern_error = ""
    for attempt in range(1, max_attempts + 1):
        try:
            project = await _create_project_via_internal(
                modern_payload=modern_payload,
                user_id=gate_user_id,
            )
            modern_source = "internal"
            progress.finish(
                "create_project",
                "completed",
                "已通过内部服务直连创建项目。",
                extra={"source_detail": modern_source, "attempt": attempt},
            )
            break
        except Exception as internal_exc:
            internal_error = str(internal_exc)
            logger.warning("create_novel internal modern path failed: %s", internal_error)
            modern_source = "http_fallback"
            try:
                project = await _create_project_via_http(
                    base_url=base_url,
                    modern_payload=modern_payload,
                    timeout_seconds=primary_timeout_seconds,
                    allow_route_fallback=allow_route_fallback,
                )
                progress.finish(
                    "create_project",
                    "completed",
                    "内部直连失败，已通过 HTTP 回退创建项目。",
                    extra={
                        "source_detail": modern_source,
                        "timeout_seconds": primary_timeout_seconds,
                        "allow_route_fallback": allow_route_fallback,
                        "attempt": attempt,
                    },
                )
                break
            except Exception as http_exc:
                modern_error = f"internal={internal_error}; http={http_exc}"
                logger.warning("create_novel modern endpoint failed: %s", modern_error)
                if attempt < max_attempts:
                    retry_delay = _retry_backoff_seconds(
                        attempt=attempt,
                        base_backoff_ms=retry_backoff_ms,
                    )
                    _emit_progress_event(
                        writer=progress.writer,
                        tool_call_id=tool_call_id,
                        stage="create_project",
                        status="retrying",
                        message=f"modern 创建失败，准备第{attempt + 1}次重试…",
                        extra={
                            "attempt": attempt,
                            "next_attempt": attempt + 1,
                            "max_attempts": max_attempts,
                            "retry_delay_ms": int(retry_delay * 1000),
                        },
                    )
                    if retry_delay > 0:
                        await asyncio.sleep(retry_delay)
                    continue
                progress.finish(
                    "create_project",
                    "failed",
                    "modern 创建失败，将回退到 legacy 创建链路。",
                    extra={
                        "source_detail": modern_source,
                        "timeout_seconds": primary_timeout_seconds,
                        "allow_route_fallback": allow_route_fallback,
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                    },
                )
                break

    if project is not None:
        project_id = str(project.get("id") or "").strip()
        legacy_payload = {
            "title": normalized_title,
            "metadata": {
                "genre": normalized_genre,
                "description": normalized_description,
                "created_by": "deerflow_create_novel_tool_dual_write",
                "modern_project_id": project_id,
            },
        }
        if project_id:
            legacy_payload["id"] = project_id

        # P1: modern success path should return quickly; legacy sync runs async in
        # interactive stream mode. In non-stream contexts we keep sync behavior
        # for deterministic semantics.
        should_async_dual_write = (
            progress.writer is not None and dual_write_async_enabled
        )

        if should_async_dual_write:
            progress.start("legacy_dual_write", "已创建主项目，正在排队同步 legacy 索引…")

            async def _run_dual_write_in_background() -> None:
                bg_started = time.perf_counter()
                _emit_progress_event(
                    writer=progress.writer,
                    tool_call_id=tool_call_id,
                    stage="legacy_dual_write",
                    status="running",
                    message="正在后台同步 legacy 索引…",
                )
                try:
                    dual_write_source = await _dual_write_legacy(
                        base_url=base_url,
                        legacy_payload=legacy_payload,
                        legacy_timeout_seconds=legacy_timeout_seconds,
                        allow_route_fallback=allow_route_fallback,
                    )
                    _emit_progress_event(
                        writer=progress.writer,
                        tool_call_id=tool_call_id,
                        stage="legacy_dual_write",
                        status="completed",
                        message="legacy 索引同步完成。",
                        elapsed_ms=(time.perf_counter() - bg_started) * 1000.0,
                        extra={"source_detail": dual_write_source},
                    )
                except Exception as legacy_sync_exc:
                    logger.warning("create_novel dual-write to legacy endpoint failed: %s", legacy_sync_exc)
                    try:
                        await _record_dual_write_failure(
                            modern_project_id=project_id,
                            legacy_payload=legacy_payload,
                            error=str(legacy_sync_exc),
                        )
                    except Exception as record_exc:
                        logger.warning("create_novel dual-write compensation record failed: %s", record_exc)
                    _emit_progress_event(
                        writer=progress.writer,
                        tool_call_id=tool_call_id,
                        stage="legacy_dual_write",
                        status="failed",
                        message="legacy 索引同步失败，已写入补偿记录。",
                        elapsed_ms=(time.perf_counter() - bg_started) * 1000.0,
                        extra={"error": str(legacy_sync_exc)},
                    )

            launched = _launch_background_task(
                _run_dual_write_in_background(),
                task_label="create_novel dual-write",
            )
            if launched:
                progress.finish(
                    "legacy_dual_write",
                    "queued",
                    "legacy 索引已进入后台同步队列。",
                    extra={"mode": "async"},
                )
                legacy_sync_summary: dict[str, Any] = {
                    "status": "queued",
                    "mode": "async",
                    "timeout_seconds": legacy_timeout_seconds,
                }
            else:
                should_async_dual_write = False

        if not should_async_dual_write:
            progress.start("legacy_dual_write", "正在同步 legacy 索引…")
            legacy_sync_summary = {
                "status": "unknown",
                "mode": "sync",
                "timeout_seconds": legacy_timeout_seconds,
            }
            try:
                dual_write_source = await _dual_write_legacy(
                    base_url=base_url,
                    legacy_payload=legacy_payload,
                    legacy_timeout_seconds=legacy_timeout_seconds,
                    allow_route_fallback=allow_route_fallback,
                )
                progress.finish(
                    "legacy_dual_write",
                    "completed",
                    "legacy 索引同步完成。",
                    extra={"mode": "sync", "source_detail": dual_write_source},
                )
                legacy_sync_summary["status"] = "completed"
                legacy_sync_summary["source_detail"] = dual_write_source
            except Exception as legacy_sync_exc:
                logger.warning("create_novel dual-write to legacy endpoint failed: %s", legacy_sync_exc)
                try:
                    await _record_dual_write_failure(
                        modern_project_id=project_id,
                        legacy_payload=legacy_payload,
                        error=str(legacy_sync_exc),
                    )
                except Exception as record_exc:
                    logger.warning("create_novel dual-write compensation record failed: %s", record_exc)
                progress.finish(
                    "legacy_dual_write",
                    "failed",
                    "legacy 索引同步失败，已写入补偿记录。",
                    extra={"mode": "sync", "error": str(legacy_sync_exc)},
                )
                legacy_sync_summary["status"] = "failed"
                legacy_sync_summary["error"] = str(legacy_sync_exc)

        progress.finish("completed", "completed", "小说创建成功。")
        return {
            "success": True,
            "source": "novel_migrated.projects",
            "source_detail": modern_source,
            "id": project.get("id"),
            "title": project.get("title", normalized_title),
            "genre": project.get("genre", normalized_genre),
            "raw": project,
            "legacy_sync": legacy_sync_summary,
            "progress": progress.snapshot(),
        }

    # modern 全部失败，回退 legacy 主创建链路
    legacy_payload = {
        "title": normalized_title,
        "metadata": {
            "genre": normalized_genre,
            "description": normalized_description,
            "created_by": "deerflow_create_novel_tool",
        },
    }

    progress.start("legacy_create_fallback", "正在回退到 legacy 创建链路…")
    legacy_error = ""
    legacy_source_detail = "internal"
    novel: dict[str, Any] | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            novel = await _create_legacy_via_internal(legacy_payload)
            legacy_source_detail = "internal"
            progress.finish(
                "legacy_create_fallback",
                "completed",
                "已通过 legacy 内部存储创建小说。",
                extra={"source_detail": legacy_source_detail, "attempt": attempt},
            )
            break
        except Exception as internal_legacy_exc:
            legacy_internal_error = str(internal_legacy_exc)
            logger.warning("create_novel legacy internal fallback failed: %s", legacy_internal_error)
            legacy_source_detail = "http_fallback"
            try:
                novel = await _create_legacy_via_http(
                    base_url=base_url,
                    legacy_payload=legacy_payload,
                    timeout_seconds=legacy_timeout_seconds,
                    allow_route_fallback=allow_route_fallback,
                )
                progress.finish(
                    "legacy_create_fallback",
                    "completed",
                    "legacy 内部存储不可用，已通过 HTTP 回退创建小说。",
                    extra={
                        "source_detail": legacy_source_detail,
                        "timeout_seconds": legacy_timeout_seconds,
                        "allow_route_fallback": allow_route_fallback,
                        "attempt": attempt,
                    },
                )
                break
            except Exception as http_legacy_exc:
                legacy_error = f"internal={legacy_internal_error}; http={http_legacy_exc}"
                logger.error("create_novel legacy endpoint failed: %s", legacy_error)
                if attempt < max_attempts:
                    retry_delay = _retry_backoff_seconds(
                        attempt=attempt,
                        base_backoff_ms=retry_backoff_ms,
                    )
                    _emit_progress_event(
                        writer=progress.writer,
                        tool_call_id=tool_call_id,
                        stage="legacy_create_fallback",
                        status="retrying",
                        message=f"legacy 创建失败，准备第{attempt + 1}次重试…",
                        extra={
                            "attempt": attempt,
                            "next_attempt": attempt + 1,
                            "max_attempts": max_attempts,
                            "retry_delay_ms": int(retry_delay * 1000),
                        },
                    )
                    if retry_delay > 0:
                        await asyncio.sleep(retry_delay)
                    continue
                progress.finish(
                    "legacy_create_fallback",
                    "failed",
                    "legacy 创建链路执行失败。",
                    extra={
                        "source_detail": legacy_source_detail,
                        "timeout_seconds": legacy_timeout_seconds,
                        "allow_route_fallback": allow_route_fallback,
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                    },
                )
                break

    if novel is not None:
        progress.finish("completed", "completed", "小说创建成功（legacy 回退）。")
        return {
            "success": True,
            "source": "legacy.novel_api",
            "source_detail": legacy_source_detail,
            "id": novel.get("id"),
            "title": novel.get("title", normalized_title),
            "genre": _extract_legacy_genre(novel, default_genre=normalized_genre),
            "raw": novel,
            "progress": progress.snapshot(),
        }

    progress.finish("failed", "failed", "小说创建失败。")
    return {
        "success": False,
        "source": "network",
        "error": (f"failed to create novel via both endpoints: modern={modern_error or 'unknown'}; legacy={legacy_error or 'unknown'}"),
        "progress": progress.snapshot(),
    }
