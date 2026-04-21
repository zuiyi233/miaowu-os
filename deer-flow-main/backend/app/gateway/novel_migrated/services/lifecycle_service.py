"""Novel lifecycle state machine helpers (WS-C / WP3+WP4)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Literal

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.observability.context import update_trace_context
from deerflow.config.extensions_config import get_extensions_config

logger = get_logger(__name__)

LifecycleStatus = Literal["draft", "analyzing", "revising", "gated", "finalized", "published"]
EntityType = Literal["chapter", "project", "analysis_task", "revision_task", "unknown"]

_LIFECYCLE_STATUSES: tuple[LifecycleStatus, ...] = ("draft", "analyzing", "revising", "gated", "finalized", "published")
_LIFECYCLE_STATUS_SET = set(_LIFECYCLE_STATUSES)
_DEFAULT_LIFECYCLE_STATE_FILE = (
    Path(__file__).resolve().parents[4] / ".deer-flow" / "novel_state" / "lifecycle_tokens.json"
)
_LEGACY_TO_LIFECYCLE: dict[str, LifecycleStatus] = {
    "draft": "draft",
    "planned": "draft",
    "planning": "draft",
    "analyzing": "analyzing",
    "revising": "revising",
    "writing": "revising",
    "completed": "revising",
    "gated": "gated",
    "finalized": "finalized",
    "published": "published",
}


@dataclass(slots=True)
class ReplayAssessment:
    accepted: bool
    replayed: bool
    reason: str
    token: str | None = None
    previous_target: LifecycleStatus | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "replayed": self.replayed,
            "reason": self.reason,
            "token": self.token,
            "previous_target": self.previous_target,
        }


@dataclass(slots=True)
class LifecycleTransitionDecision:
    entity_type: str
    entity_id: str
    enabled: bool
    current_status: str
    current_lifecycle_status: LifecycleStatus
    target_status: LifecycleStatus
    applied_status: str
    valid: bool
    applied: bool
    replayed: bool
    degraded: bool
    reason: str
    compensation: dict[str, Any]
    idempotency: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "enabled": self.enabled,
            "current_status": self.current_status,
            "current_lifecycle_status": self.current_lifecycle_status,
            "target_status": self.target_status,
            "applied_status": self.applied_status,
            "valid": self.valid,
            "applied": self.applied,
            "replayed": self.replayed,
            "degraded": self.degraded,
            "reason": self.reason,
            "compensation": self.compensation,
            "idempotency": self.idempotency,
        }


class NovelLifecycleService:
    """Lifecycle transition validator with idempotent replay and degraded fallback."""

    FEATURE_FLAG = "novel_lifecycle_v2"
    TOKEN_TTL = timedelta(hours=6)
    TRANSITION_MATRIX: dict[LifecycleStatus, set[LifecycleStatus]] = {
        "draft": {"analyzing", "revising", "gated"},
        "analyzing": {"draft", "revising"},
        "revising": {"draft", "analyzing", "gated", "finalized"},
        "gated": {"analyzing", "revising", "finalized"},
        "finalized": {"gated", "revising", "published"},
        "published": {"finalized", "revising"},
    }

    def __init__(self, *, persistence_file: str | Path | None = None) -> None:
        self._token_records: dict[tuple[str, str, LifecycleStatus], datetime] = {}
        self._token_lock = Lock()
        self._persistence_file = Path(persistence_file) if persistence_file is not None else _DEFAULT_LIFECYCLE_STATE_FILE
        self._load_token_records()

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.now(tz=UTC)

    @staticmethod
    def _normalize_text(value: Any) -> str:
        return str(value or "").strip()

    @staticmethod
    def _mask_token(token: str | None) -> str | None:
        normalized = (token or "").strip()
        if not normalized:
            return None
        if len(normalized) <= 10:
            return f"{normalized[:2]}***{normalized[-2:]}"
        return f"{normalized[:6]}***{normalized[-4:]}"

    def _coerce_lifecycle_status(self, raw_status: Any) -> tuple[LifecycleStatus, bool]:
        normalized = self._normalize_text(raw_status).lower()
        if normalized in _LIFECYCLE_STATUS_SET:
            return normalized, True
        mapped = _LEGACY_TO_LIFECYCLE.get(normalized)
        if mapped:
            return mapped, False
        return "draft", False

    def is_enabled(self, *, user_id: str | None = None) -> bool:
        normalized_user = (user_id or "").strip() or None
        try:
            config = get_extensions_config()
            if hasattr(config, "is_feature_enabled_for_user"):
                return bool(config.is_feature_enabled_for_user(self.FEATURE_FLAG, user_id=normalized_user, default=False))
            return bool(config.is_feature_enabled(self.FEATURE_FLAG, default=False))
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("lifecycle feature check failed, fallback disabled: %s", exc)
            return False

    def validate_transition(self, *, current_status: Any, target_status: LifecycleStatus) -> dict[str, Any]:
        current_lifecycle, current_is_explicit = self._coerce_lifecycle_status(current_status)
        if target_status not in _LIFECYCLE_STATUS_SET:
            return {
                "valid": False,
                "reason": "unsupported_target_status",
                "current_lifecycle_status": current_lifecycle,
                "target_status": target_status,
                "current_is_explicit": current_is_explicit,
                "allowed_targets": sorted(self.TRANSITION_MATRIX[current_lifecycle]),
            }
        if current_lifecycle == target_status:
            return {
                "valid": True,
                "reason": "noop",
                "current_lifecycle_status": current_lifecycle,
                "target_status": target_status,
                "current_is_explicit": current_is_explicit,
                "allowed_targets": sorted(self.TRANSITION_MATRIX[current_lifecycle]),
            }

        valid = target_status in self.TRANSITION_MATRIX[current_lifecycle]
        return {
            "valid": valid,
            "reason": "allowed" if valid else "invalid_transition",
            "current_lifecycle_status": current_lifecycle,
            "target_status": target_status,
            "current_is_explicit": current_is_explicit,
            "allowed_targets": sorted(self.TRANSITION_MATRIX[current_lifecycle]),
        }

    def _prune_token_records(self, now: datetime) -> bool:
        expired_keys: list[tuple[str, str, LifecycleStatus]] = []
        for key, ts in self._token_records.items():
            if now - ts > self.TOKEN_TTL:
                expired_keys.append(key)
        for key in expired_keys:
            self._token_records.pop(key, None)
        return bool(expired_keys)

    def _load_token_records(self) -> None:
        path = self._persistence_file
        if not path.exists():
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("failed to load lifecycle token cache, fallback to memory: %s", exc)
            return

        records: list[dict[str, Any]]
        if isinstance(payload, dict):
            maybe_records = payload.get("records")
            records = maybe_records if isinstance(maybe_records, list) else []
        elif isinstance(payload, list):
            records = payload
        else:
            records = []

        now = self._utcnow()
        loaded: dict[tuple[str, str, LifecycleStatus], datetime] = {}
        for item in records:
            if not isinstance(item, dict):
                continue
            entity_scope = self._normalize_text(item.get("entity_scope"))
            token = self._normalize_text(item.get("token"))
            target_status_raw = self._normalize_text(item.get("target_status")).lower()
            recorded_at_raw = self._normalize_text(item.get("recorded_at"))
            if not entity_scope or not token or target_status_raw not in _LIFECYCLE_STATUS_SET or not recorded_at_raw:
                continue
            try:
                recorded_at = datetime.fromisoformat(recorded_at_raw)
                if recorded_at.tzinfo is None:
                    recorded_at = recorded_at.replace(tzinfo=UTC)
            except ValueError:
                continue
            if now - recorded_at > self.TOKEN_TTL:
                continue
            loaded[(entity_scope, token, target_status_raw)] = recorded_at  # type: ignore[arg-type]

        self._token_records = loaded

    def _persist_token_records(self) -> None:
        path = self._persistence_file
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            records = sorted(
                self._token_records.items(),
                key=lambda item: item[1],
            )
            payload = {
                "records": [
                    {
                        "entity_scope": scope,
                        "token": token,
                        "target_status": target_status,
                        "recorded_at": ts.astimezone(UTC).isoformat(),
                    }
                    for (scope, token, target_status), ts in records
                ]
            }
            tmp_path = path.with_suffix(f"{path.suffix}.tmp")
            tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(path)
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("failed to persist lifecycle token cache, fallback to memory: %s", exc)

    def _read_status(self, *, status_holder: Any, status_attr: str) -> str:
        holder_dict = getattr(status_holder, "__dict__", None)
        if isinstance(holder_dict, dict) and status_attr in holder_dict:
            return self._normalize_text(holder_dict.get(status_attr))
        try:
            return self._normalize_text(getattr(status_holder, status_attr, ""))
        except Exception:
            return ""

    def assess_replay(
        self,
        *,
        entity_type: EntityType,
        entity_id: str,
        token: str | None,
        target_status: LifecycleStatus,
    ) -> ReplayAssessment:
        normalized_token = self._normalize_text(token)
        if not normalized_token:
            return ReplayAssessment(accepted=True, replayed=False, reason="token_missing")

        token_scope = (f"{entity_type}:{entity_id}", normalized_token, target_status)
        now = self._utcnow()
        with self._token_lock:
            changed = self._prune_token_records(now)
            existing = self._token_records.get(token_scope)
            if existing is None:
                self._token_records[token_scope] = now
                self._persist_token_records()
                return ReplayAssessment(
                    accepted=True,
                    replayed=False,
                    reason="token_registered",
                    token=self._mask_token(normalized_token),
                )
            if changed:
                self._persist_token_records()

            return ReplayAssessment(
                accepted=True,
                replayed=True,
                reason="idempotent_replay",
                token=self._mask_token(normalized_token),
                previous_target=target_status,
            )

    def build_compensation(
        self,
        *,
        current_lifecycle_status: LifecycleStatus,
        target_status: LifecycleStatus,
        reason: str,
        fallback_status: str | None,
    ) -> dict[str, Any]:
        return {
            "reason": reason,
            "current_lifecycle_status": current_lifecycle_status,
            "target_status": target_status,
            "fallback_status": fallback_status,
            "suggestions": [
                {
                    "action": "replay_same_token",
                    "condition": "如果此前请求可能已成功落库，使用相同 idempotency token 重放。",
                },
                {
                    "action": "retry_with_new_token",
                    "condition": "若确定前序请求未生效，生成新的 idempotency token 再重试。",
                },
                {
                    "action": "degraded_fallback",
                    "condition": "进入降级模式，保持 legacy 状态并记录补偿事件。",
                    "status": fallback_status,
                },
            ],
        }

    def _update_trace(
        self,
        *,
        current_lifecycle_status: LifecycleStatus,
        target_status: LifecycleStatus,
        enabled: bool,
        replayed: bool,
        token: str | None,
    ) -> None:
        update_trace_context(
            lifecycle_state=current_lifecycle_status,
            lifecycle_transition=f"{current_lifecycle_status}->{target_status}",
            lifecycle_mode="strict" if enabled else "legacy_fallback",
            lifecycle_replay="1" if replayed else "0",
            lifecycle_token=self._mask_token(token),
        )

    def transition_status(
        self,
        *,
        status_holder: Any,
        entity_type: EntityType,
        entity_id: str,
        target_status: LifecycleStatus,
        user_id: str | None = None,
        idempotency_token: str | None = None,
        legacy_target_status: str | None = None,
        allow_degraded_fallback: bool = True,
        status_attr: str = "status",
    ) -> LifecycleTransitionDecision:
        raw_current = self._read_status(status_holder=status_holder, status_attr=status_attr)
        normalized_current, _explicit = self._coerce_lifecycle_status(raw_current)
        enabled = self.is_enabled(user_id=user_id)

        validation = self.validate_transition(current_status=raw_current, target_status=target_status)
        replay = self.assess_replay(
            entity_type=entity_type,
            entity_id=entity_id,
            token=idempotency_token,
            target_status=target_status,
        )
        fallback_status = self._normalize_text(legacy_target_status) or raw_current

        if not replay.accepted:
            compensation = self.build_compensation(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                reason=replay.reason,
                fallback_status=fallback_status or raw_current,
            )
            decision = LifecycleTransitionDecision(
                entity_type=entity_type,
                entity_id=entity_id,
                enabled=enabled,
                current_status=raw_current,
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                applied_status=raw_current,
                valid=False,
                applied=False,
                replayed=False,
                degraded=False,
                reason=replay.reason,
                compensation=compensation,
                idempotency=replay.to_dict(),
            )
            self._update_trace(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                enabled=enabled,
                replayed=False,
                token=idempotency_token,
            )
            return decision

        if replay.replayed:
            decision = LifecycleTransitionDecision(
                entity_type=entity_type,
                entity_id=entity_id,
                enabled=enabled,
                current_status=raw_current,
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                applied_status=raw_current,
                valid=True,
                applied=False,
                replayed=True,
                degraded=False,
                reason="idempotent_replay_noop",
                compensation=self.build_compensation(
                    current_lifecycle_status=normalized_current,
                    target_status=target_status,
                    reason="replay_noop",
                    fallback_status=fallback_status or raw_current,
                ),
                idempotency=replay.to_dict(),
            )
            self._update_trace(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                enabled=enabled,
                replayed=True,
                token=idempotency_token,
            )
            return decision

        if not enabled:
            applied = False
            applied_status = raw_current
            if fallback_status and fallback_status != raw_current:
                setattr(status_holder, status_attr, fallback_status)
                applied = True
                applied_status = fallback_status

            decision = LifecycleTransitionDecision(
                entity_type=entity_type,
                entity_id=entity_id,
                enabled=False,
                current_status=raw_current,
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                applied_status=applied_status,
                valid=True,
                applied=applied,
                replayed=False,
                degraded=True,
                reason="feature_disabled_legacy_fallback",
                compensation=self.build_compensation(
                    current_lifecycle_status=normalized_current,
                    target_status=target_status,
                    reason="feature_disabled",
                    fallback_status=fallback_status or raw_current,
                ),
                idempotency=replay.to_dict(),
            )
            self._update_trace(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                enabled=False,
                replayed=False,
                token=idempotency_token,
            )
            return decision

        if not validation["valid"]:
            compensation = self.build_compensation(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                reason=validation["reason"],
                fallback_status=fallback_status or raw_current,
            )
            if allow_degraded_fallback and fallback_status:
                applied = fallback_status != raw_current
                if applied:
                    setattr(status_holder, status_attr, fallback_status)
                decision = LifecycleTransitionDecision(
                    entity_type=entity_type,
                    entity_id=entity_id,
                    enabled=True,
                    current_status=raw_current,
                    current_lifecycle_status=normalized_current,
                    target_status=target_status,
                    applied_status=fallback_status,
                    valid=False,
                    applied=applied,
                    replayed=False,
                    degraded=True,
                    reason="invalid_transition_degraded",
                    compensation=compensation,
                    idempotency=replay.to_dict(),
                )
                self._update_trace(
                    current_lifecycle_status=normalized_current,
                    target_status=target_status,
                    enabled=True,
                    replayed=False,
                    token=idempotency_token,
                )
                return decision

            decision = LifecycleTransitionDecision(
                entity_type=entity_type,
                entity_id=entity_id,
                enabled=True,
                current_status=raw_current,
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                applied_status=raw_current,
                valid=False,
                applied=False,
                replayed=False,
                degraded=False,
                reason="invalid_transition",
                compensation=compensation,
                idempotency=replay.to_dict(),
            )
            self._update_trace(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                enabled=True,
                replayed=False,
                token=idempotency_token,
            )
            return decision

        applied = raw_current != target_status
        if applied:
            setattr(status_holder, status_attr, target_status)

        decision = LifecycleTransitionDecision(
            entity_type=entity_type,
            entity_id=entity_id,
            enabled=True,
            current_status=raw_current,
            current_lifecycle_status=normalized_current,
            target_status=target_status,
            applied_status=target_status if applied else raw_current,
            valid=True,
            applied=applied,
            replayed=False,
            degraded=False,
            reason="transition_applied" if applied else "noop",
            compensation=self.build_compensation(
                current_lifecycle_status=normalized_current,
                target_status=target_status,
                reason="normal_path",
                fallback_status=fallback_status or raw_current,
            ),
            idempotency=replay.to_dict(),
        )
        self._update_trace(
            current_lifecycle_status=normalized_current,
            target_status=target_status,
            enabled=True,
            replayed=False,
            token=idempotency_token,
        )
        return decision

    def build_publish_strategy(self, *, current_status: Any) -> dict[str, Any]:
        validation = self.validate_transition(current_status=current_status, target_status="published")
        current_lifecycle_status = validation["current_lifecycle_status"]
        return {
            "current_status": self._normalize_text(current_status),
            "current_lifecycle_status": current_lifecycle_status,
            "target_status": "published",
            "can_publish": bool(validation["valid"]),
            "reason": validation["reason"],
            "required_previous_status": "finalized",
            "compensation": self.build_compensation(
                current_lifecycle_status=current_lifecycle_status,
                target_status="published",
                reason=validation["reason"],
                fallback_status=self._normalize_text(current_status),
            ),
        }


lifecycle_service = NovelLifecycleService()
