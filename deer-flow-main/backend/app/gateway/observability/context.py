"""Request trace context utilities for gateway observability."""

from __future__ import annotations

import contextvars
import logging
import uuid
from collections.abc import Mapping
from typing import Any

TRACE_FIELDS: tuple[str, ...] = (
    "request_id",
    "thread_id",
    "project_id",
    "session_key",
    "idempotency_key",
    "lifecycle_state",
    "lifecycle_transition",
    "lifecycle_mode",
    "lifecycle_replay",
    "lifecycle_token",
)

_DEFAULT_TRACE_CONTEXT: dict[str, str | None] = {field: None for field in TRACE_FIELDS}
_TRACE_CONTEXT: contextvars.ContextVar[dict[str, str | None]] = contextvars.ContextVar(
    "gateway_trace_context",
    default=_DEFAULT_TRACE_CONTEXT.copy(),
)
_TRACE_LOG_FILTER_INSTALLED = False
_TRACE_LOG_FILTER_INSTANCE: logging.Filter | None = None

_CONTEXT_ALIAS_MAP: dict[str, tuple[str, ...]] = {
    "thread_id": ("thread_id", "threadId"),
    "project_id": ("project_id", "projectId"),
    "session_key": ("session_key", "sessionKey"),
    "idempotency_key": ("idempotency_key", "idempotencyKey"),
    "lifecycle_state": ("lifecycle_state", "lifecycleState"),
    "lifecycle_transition": ("lifecycle_transition", "lifecycleTransition"),
    "lifecycle_mode": ("lifecycle_mode", "lifecycleMode"),
    "lifecycle_replay": ("lifecycle_replay", "lifecycleReplay"),
    "lifecycle_token": ("lifecycle_token", "lifecycleToken"),
}
_HEADER_ALIAS_MAP: dict[str, tuple[str, ...]] = {
    "thread_id": ("x-thread-id",),
    "project_id": ("x-project-id",),
    "session_key": ("x-session-key",),
    "idempotency_key": ("idempotency-key", "x-idempotency-key"),
    "lifecycle_state": ("x-lifecycle-state",),
    "lifecycle_transition": ("x-lifecycle-transition",),
    "lifecycle_mode": ("x-lifecycle-mode",),
    "lifecycle_replay": ("x-lifecycle-replay",),
    "lifecycle_token": ("x-lifecycle-token",),
}


def _normalize_value(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def copy_trace_context() -> dict[str, str | None]:
    """Return a copy of current trace context."""
    current = _TRACE_CONTEXT.get()
    return {field: current.get(field) for field in TRACE_FIELDS}


def set_trace_context(**fields: Any) -> contextvars.Token[dict[str, str | None]]:
    """Replace trace context for current execution context."""
    next_context = _DEFAULT_TRACE_CONTEXT.copy()
    for field, raw in fields.items():
        if field not in next_context:
            continue
        next_context[field] = _normalize_value(raw)
    return _TRACE_CONTEXT.set(next_context)


def update_trace_context(**fields: Any) -> dict[str, str | None]:
    """Merge fields into current trace context and return merged context."""
    current = copy_trace_context()
    for field, raw in fields.items():
        if field not in current:
            continue
        normalized = _normalize_value(raw)
        if normalized is None:
            continue
        current[field] = normalized
    _TRACE_CONTEXT.set(current)
    return current


def reset_trace_context(token: contextvars.Token[dict[str, str | None]]) -> None:
    """Reset trace context to previous token state."""
    _TRACE_CONTEXT.reset(token)


def build_request_id(raw_request_id: str | None = None) -> str:
    """Return sanitized request id, fallback to generated UUID."""
    normalized = _normalize_value(raw_request_id)
    if normalized is not None:
        return normalized[:128]
    return uuid.uuid4().hex


def extract_trace_fields_from_context(context: Mapping[str, Any] | None) -> dict[str, str]:
    """Extract canonical trace fields from request context payload."""
    if not isinstance(context, Mapping):
        return {}

    extracted: dict[str, str] = {}
    for canonical, aliases in _CONTEXT_ALIAS_MAP.items():
        for alias in aliases:
            value = _normalize_value(context.get(alias))
            if value is not None:
                extracted[canonical] = value
                break
    return extracted


def extract_trace_fields_from_headers(headers: Mapping[str, Any] | None) -> dict[str, str]:
    """Extract canonical trace fields from HTTP headers."""
    if not isinstance(headers, Mapping):
        return {}

    extracted: dict[str, str] = {}
    for canonical, aliases in _HEADER_ALIAS_MAP.items():
        for alias in aliases:
            value = _normalize_value(headers.get(alias))
            if value is not None:
                extracted[canonical] = value
                break
    return extracted


class TraceContextLogFilter(logging.Filter):
    """Inject current trace context into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        current = _TRACE_CONTEXT.get()
        for field in TRACE_FIELDS:
            setattr(record, field, current.get(field))
        return True


def install_trace_log_filter() -> None:
    """Install one shared trace filter on root logger + handlers."""
    global _TRACE_LOG_FILTER_INSTALLED, _TRACE_LOG_FILTER_INSTANCE

    if _TRACE_LOG_FILTER_INSTALLED:
        return

    trace_filter = TraceContextLogFilter()
    root_logger = logging.getLogger()
    root_logger.addFilter(trace_filter)
    for handler in root_logger.handlers:
        handler.addFilter(trace_filter)

    _TRACE_LOG_FILTER_INSTANCE = trace_filter
    _TRACE_LOG_FILTER_INSTALLED = True


def ensure_trace_filter_on_handlers() -> None:
    """Re-attach installed trace filter to current root handlers.

    Some logger setup code may clear/rebuild handlers at runtime.
    """
    if not _TRACE_LOG_FILTER_INSTALLED or _TRACE_LOG_FILTER_INSTANCE is None:
        return

    root_logger = logging.getLogger()
    for handler in root_logger.handlers:
        if _TRACE_LOG_FILTER_INSTANCE not in handler.filters:
            handler.addFilter(_TRACE_LOG_FILTER_INSTANCE)
