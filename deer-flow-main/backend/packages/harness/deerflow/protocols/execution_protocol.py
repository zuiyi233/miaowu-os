"""Shared execution-authorization protocol helpers.

This module is intentionally framework-agnostic so both gateway intent routing
and lead-agent runtime middleware can reuse exactly the same policy decisions.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

ExecutionModeStatus = Literal[
    "readonly",
    "awaiting_authorization",
    "execution_mode_active",
    "revoked",
]

EXECUTION_MODE_READONLY: ExecutionModeStatus = "readonly"
EXECUTION_MODE_AWAITING_AUTHORIZATION: ExecutionModeStatus = "awaiting_authorization"
EXECUTION_MODE_ACTIVE: ExecutionModeStatus = "execution_mode_active"
EXECUTION_MODE_REVOKED: ExecutionModeStatus = "revoked"

QUESTION_PREFIXES: tuple[str, ...] = (
    "怎么",
    "如何",
    "怎样",
    "为什么",
    "为何",
    "是什么",
    "是否",
    "能否",
    "可以",
    "请问",
    "what",
    "how",
    "why",
    "can",
    "could",
    "is",
    "are",
)

_QUESTION_MARKERS: tuple[str, ...] = ("？", "?")

PRIMARY_AUTHORIZATION_COMMANDS: frozenset[str] = frozenset(
    {
        "确认执行",
        "进入执行模式",
        "__enter_execution_mode__",
        "__confirm_action__",
    }
)

LEGACY_AUTHORIZATION_COMMANDS: frozenset[str] = frozenset(
    {
        "确认创建",
        "确认",
        "提交",
        "yes",
        "y",
        "ok",
        "好的",
    }
)

PRIMARY_REVOKE_COMMANDS: frozenset[str] = frozenset(
    {
        "退出执行模式",
        "取消授权",
        "__exit_execution_mode__",
    }
)

LEGACY_REVOKE_COMMANDS: frozenset[str] = frozenset(
    {
        "取消",
        "取消创建",
        "退出创建",
        "取消管理",
        "退出管理",
    }
)

_EXPLICIT_EXECUTION_PHRASES: tuple[str, ...] = (
    "请执行",
    "直接执行",
    "马上执行",
    "开始执行",
    "直接帮我",
    "帮我创建",
    "直接创建",
    "不用讨论",
    "执行刚才",
    "执行这个",
    "立即落库",
    "现在落库",
    "run it",
    "do it",
    "execute now",
    "apply now",
)

_HIGH_RISK_ACTIONS: frozenset[str] = frozenset(
    {
        "create_novel",
        "build_world",
        "finalize_project",
        "import_book",
        "manage_foreshadow",
    }
)

_MANAGE_FORESHADOW_READ_ACTIONS: frozenset[str] = frozenset(
    {
        "list",
        "context",
    }
)

_STRING_REDACTION_PATTERNS = (
    re.compile(r"api[-_ ]?key", re.IGNORECASE),
    re.compile(r"token", re.IGNORECASE),
    re.compile(r"secret", re.IGNORECASE),
    re.compile(r"password", re.IGNORECASE),
)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def normalize_user_text(text: Any) -> str:
    """Normalize user text for command matching."""
    if text is None:
        return ""
    normalized = str(text).strip()
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def fingerprint_user_text(text: Any) -> str:
    normalized = normalize_user_text(text).lower()
    if not normalized:
        return ""
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:16]


def is_question_like(text: Any) -> bool:
    normalized = normalize_user_text(text)
    if not normalized:
        return False

    lowered = normalized.lower()
    if any(lowered.startswith(prefix) for prefix in QUESTION_PREFIXES):
        return True
    if any(marker in normalized for marker in _QUESTION_MARKERS):
        return True
    return False


def has_explicit_execution_intent(text: Any) -> bool:
    normalized = normalize_user_text(text)
    if not normalized:
        return False
    lowered = normalized.lower()

    if is_authorization_command(normalized):
        return True
    return any(phrase in lowered for phrase in _EXPLICIT_EXECUTION_PHRASES)


def should_answer_only(text: Any) -> bool:
    """Question-priority rule.

    Questions default to answer-only unless the user gives explicit execution
    intent (e.g., "请执行" or authorization command).
    """
    return is_question_like(text) and not has_explicit_execution_intent(text)


def is_authorization_command(text: Any, *, include_legacy: bool = True) -> bool:
    normalized = normalize_user_text(text)
    if not normalized:
        return False
    lowered = normalized.lower()

    if normalized in PRIMARY_AUTHORIZATION_COMMANDS:
        return True
    if include_legacy and (normalized in LEGACY_AUTHORIZATION_COMMANDS or lowered in LEGACY_AUTHORIZATION_COMMANDS):
        return True
    return False


def is_revoke_command(text: Any, *, include_legacy: bool = True) -> bool:
    normalized = normalize_user_text(text)
    if not normalized:
        return False
    lowered = normalized.lower()
    if normalized in PRIMARY_REVOKE_COMMANDS:
        return True
    if include_legacy and (normalized in LEGACY_REVOKE_COMMANDS or lowered in LEGACY_REVOKE_COMMANDS):
        return True
    return False


def _extract_foreshadow_action(payload: Mapping[str, Any] | None) -> str:
    if not isinstance(payload, Mapping):
        return ""
    raw = payload.get("action")
    if raw is None:
        raw = payload.get("operation")
    return normalize_user_text(raw).lower()


def is_high_risk_action(action_type: Any, payload: Mapping[str, Any] | None = None) -> bool:
    action = normalize_user_text(action_type).lower()
    if not action:
        return False
    if action not in _HIGH_RISK_ACTIONS:
        return False
    if action == "manage_foreshadow":
        sub_action = _extract_foreshadow_action(payload)
        return sub_action not in _MANAGE_FORESHADOW_READ_ACTIONS
    return True


def is_high_risk_tool_call(tool_name: Any, args: Mapping[str, Any] | None = None) -> bool:
    return is_high_risk_action(tool_name, args)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.strip().lower()
    return any(pattern.search(lowered) for pattern in _STRING_REDACTION_PATTERNS)


def _truncate_value(value: Any, *, max_len: int = 160) -> Any:
    if isinstance(value, str):
        trimmed = value.strip()
        if len(trimmed) <= max_len:
            return trimmed
        return f"{trimmed[: max_len - 3]}..."
    return value


def summarize_args_for_protocol(args: Mapping[str, Any] | None, *, max_items: int = 8) -> dict[str, Any]:
    """Build a lightweight argument preview for protocol payloads."""
    if not isinstance(args, Mapping):
        return {}

    summary: dict[str, Any] = {}
    for index, (key, value) in enumerate(args.items()):
        if index >= max_items:
            summary["__truncated__"] = True
            break

        normalized_key = str(key)
        if _is_sensitive_key(normalized_key):
            summary[normalized_key] = "***"
            continue

        if isinstance(value, Mapping):
            nested = summarize_args_for_protocol(value, max_items=max_items)
            summary[normalized_key] = nested
            continue
        if isinstance(value, list):
            preview = [_truncate_value(item) for item in value[:4]]
            if len(value) > 4:
                preview.append("...")
            summary[normalized_key] = preview
            continue

        summary[normalized_key] = _truncate_value(value)
    return summary


def build_pending_action_payload(
    *,
    action_type: str,
    tool_name: str | None = None,
    args: Mapping[str, Any] | None = None,
    tool_call_id: str | None = None,
    source: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    normalized_action = normalize_user_text(action_type)
    payload: dict[str, Any] = {
        "action_type": normalized_action,
        "tool_name": normalize_user_text(tool_name or action_type),
        "args": dict(args) if isinstance(args, Mapping) else {},
        "args_summary": summarize_args_for_protocol(args),
        "captured_at": _now_iso(),
    }
    if tool_call_id:
        payload["tool_call_id"] = normalize_user_text(tool_call_id)
    if source:
        payload["source"] = normalize_user_text(source)
    if note:
        payload["note"] = normalize_user_text(note)
    return payload


def build_execution_mode_payload(
    *,
    status: ExecutionModeStatus,
    enabled: bool,
    updated_at: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "enabled": bool(enabled),
        "updated_at": updated_at or _now_iso(),
    }


def default_execution_gate_state() -> dict[str, Any]:
    return {
        "status": EXECUTION_MODE_READONLY,
        "execution_mode": False,
        "pending_action": None,
        "confirmation_required": False,
        "latest_decision": None,
        "ui_hints": None,
        "updated_at": _now_iso(),
        # Runtime-only hints
        "replay_requested": False,
        "answer_only_turn": False,
        "last_user_fingerprint": None,
    }


def coerce_execution_gate_state(raw: Any) -> dict[str, Any]:
    if isinstance(raw, Mapping):
        status_raw = normalize_user_text(raw.get("status"))
        status: ExecutionModeStatus
        if status_raw in {
            EXECUTION_MODE_READONLY,
            EXECUTION_MODE_AWAITING_AUTHORIZATION,
            EXECUTION_MODE_ACTIVE,
            EXECUTION_MODE_REVOKED,
        }:
            status = status_raw  # type: ignore[assignment]
        else:
            status = EXECUTION_MODE_READONLY

        pending_action = raw.get("pending_action")
        if pending_action is not None and not isinstance(pending_action, Mapping):
            pending_action = None
        latest_decision = raw.get("latest_decision")
        if latest_decision is not None and not isinstance(latest_decision, Mapping):
            latest_decision = None
        ui_hints = raw.get("ui_hints")
        if ui_hints is not None and not isinstance(ui_hints, Mapping):
            ui_hints = None

        return {
            "status": status,
            "execution_mode": bool(raw.get("execution_mode", False)),
            "pending_action": dict(pending_action) if isinstance(pending_action, Mapping) else None,
            "confirmation_required": bool(raw.get("confirmation_required", False)),
            "latest_decision": dict(latest_decision) if isinstance(latest_decision, Mapping) else None,
            "ui_hints": dict(ui_hints) if isinstance(ui_hints, Mapping) else None,
            "updated_at": normalize_user_text(raw.get("updated_at")) or _now_iso(),
            "replay_requested": bool(raw.get("replay_requested", False)),
            "answer_only_turn": bool(raw.get("answer_only_turn", False)),
            "last_user_fingerprint": normalize_user_text(raw.get("last_user_fingerprint")) or None,
        }
    return default_execution_gate_state()


def update_execution_gate_state(
    state: Mapping[str, Any] | None,
    **updates: Any,
) -> dict[str, Any]:
    next_state = coerce_execution_gate_state(state)
    next_state.update(updates)
    next_state["updated_at"] = _now_iso()
    return next_state


def serialize_execution_gate_for_log(state: Mapping[str, Any] | None) -> str:
    """Safe JSON serializer for debug logging."""
    safe = coerce_execution_gate_state(state)
    try:
        return json.dumps(safe, ensure_ascii=False, sort_keys=True)
    except Exception:
        return str(safe)
