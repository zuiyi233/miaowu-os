"""Quality gate fusion service (rule + model) for novel lifecycle workflows.

This module exposes pure-function style interfaces and a persisted false-positive
feedback loop so service restarts keep backflow behavior stable.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any, Literal

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)

GateLevel = Literal["pass", "warn", "block"]
FusionFallbackMode = Literal["rule_only", "warn_only"]
FeedbackSource = Literal["rule", "model", "fusion"]

_SEVERITY_RANK: dict[GateLevel, int] = {"pass": 0, "warn": 1, "block": 2}
_FEEDBACK_SOURCE_SET = {"rule", "model", "fusion"}
_DEFAULT_FEEDBACK_STATE_FILE = (
    Path(__file__).resolve().parents[4] / ".deer-flow" / "novel_state" / "quality_gate_feedback.json"
)


@dataclass(frozen=True, slots=True)
class GateSignal:
    """Normalized quality-gate signal from one source."""

    source: str
    level: GateLevel
    reasons: tuple[str, ...] = ()
    evidence: tuple[str, ...] = ()
    score: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class QualityGateFusionDecision:
    """Fusion output contract for downstream gate handling."""

    decision_id: str
    gate_key: str
    final_level: GateLevel
    rule_level: GateLevel
    model_level: GateLevel
    decision_path: tuple[str, ...]
    merged_evidence: dict[str, list[str]]
    degraded_fallback: bool = False
    feedback_adjusted: bool = False


@dataclass(frozen=True, slots=True)
class FalsePositiveFeedbackRecord:
    """False-positive record for backflow adaptation."""

    feedback_id: int
    decision_id: str
    gate_key: str
    evidence_key: str
    source: FeedbackSource
    original_level: GateLevel
    corrected_level: GateLevel
    reason: str
    reporter: str
    note: str
    recorded_at: str
    metadata: dict[str, Any] = field(default_factory=dict)


class QualityGateFusionService:
    """Fuse rule/model results to pass|warn|block and track false-positive loop.

    Rollback switch:
    - Disable `feature_enabled` to force deterministic degraded fallback while
      preserving API contracts for callers.
    """

    def __init__(self, *, persistence_file: str | Path | None = None) -> None:
        self._feedback_records: list[FalsePositiveFeedbackRecord] = []
        self._feedback_index: dict[str, list[int]] = {}
        self._feedback_id_seq = 0
        self._lock = Lock()
        self._persistence_file = Path(persistence_file) if persistence_file is not None else _DEFAULT_FEEDBACK_STATE_FILE
        self._load_feedback_records()

    def fuse_results(
        self,
        *,
        rule_result: GateSignal | Mapping[str, Any] | None,
        model_result: GateSignal | Mapping[str, Any] | None,
        gate_key: str,
        feature_enabled: bool = True,
        degraded_fallback_mode: FusionFallbackMode = "rule_only",
        feedback_evidence_key: str | None = None,
        apply_feedback_backflow: bool = True,
    ) -> QualityGateFusionDecision:
        """Fuse two gate sources into final severity and explainable path."""

        rule_signal = _normalize_gate_signal(source="rule", raw=rule_result)
        model_signal = _normalize_gate_signal(source="model", raw=model_result)
        decision_path: list[str] = []

        if feature_enabled:
            final_level = _max_severity([rule_signal.level, model_signal.level])
            decision_path.append(f"rule={rule_signal.level}")
            decision_path.append(f"model={model_signal.level}")
            degraded_fallback = False
        else:
            degraded_fallback = True
            decision_path.append("feature_flag_disabled")
            if degraded_fallback_mode == "warn_only":
                final_level = "warn" if _max_severity([rule_signal.level, model_signal.level]) != "pass" else "pass"
                decision_path.append("fallback=warn_only")
            else:
                final_level = rule_signal.level
                decision_path.append("fallback=rule_only")

        feedback_adjusted = False
        if apply_feedback_backflow and feedback_evidence_key and final_level != "pass":
            corrected_levels = self._collect_feedback_corrections(
                gate_key=gate_key,
                evidence_key=feedback_evidence_key,
            )
            if corrected_levels:
                relaxed_level = _min_severity([final_level, *corrected_levels])
                if _SEVERITY_RANK[relaxed_level] < _SEVERITY_RANK[final_level]:
                    decision_path.append(
                        f"feedback_relaxed:{final_level}->{relaxed_level}"
                    )
                    final_level = relaxed_level
                    feedback_adjusted = True

        decision_id = str(uuid.uuid4())
        merged_evidence = {
            "rule": list(rule_signal.evidence),
            "model": list(model_signal.evidence),
        }

        logger.info(
            "quality gate fused: gate_key=%s decision_id=%s final=%s rule=%s model=%s fallback=%s feedback_adjusted=%s",
            gate_key,
            decision_id,
            final_level,
            rule_signal.level,
            model_signal.level,
            degraded_fallback,
            feedback_adjusted,
        )

        return QualityGateFusionDecision(
            decision_id=decision_id,
            gate_key=gate_key,
            final_level=final_level,
            rule_level=rule_signal.level,
            model_level=model_signal.level,
            decision_path=tuple(decision_path),
            merged_evidence=merged_evidence,
            degraded_fallback=degraded_fallback,
            feedback_adjusted=feedback_adjusted,
        )

    def record_false_positive_feedback(
        self,
        *,
        decision_id: str,
        gate_key: str,
        evidence_key: str,
        source: FeedbackSource,
        original_level: GateLevel,
        corrected_level: GateLevel,
        reason: str,
        reporter: str,
        note: str = "",
        metadata: Mapping[str, Any] | None = None,
    ) -> FalsePositiveFeedbackRecord:
        """Record false-positive feedback for replay/backflow."""

        normalized_evidence_key = str(evidence_key or "").strip()
        if not normalized_evidence_key:
            raise ValueError("evidence_key is required for false-positive feedback")

        with self._lock:
            self._feedback_id_seq += 1
            record = FalsePositiveFeedbackRecord(
                feedback_id=self._feedback_id_seq,
                decision_id=str(decision_id or ""),
                gate_key=str(gate_key or ""),
                evidence_key=normalized_evidence_key,
                source=source,
                original_level=original_level,
                corrected_level=corrected_level,
                reason=str(reason or "").strip() or "未提供原因",
                reporter=str(reporter or "").strip() or "unknown",
                note=str(note or "").strip(),
                recorded_at=datetime.now(UTC).isoformat(),
                metadata=dict(metadata or {}),
            )
            self._feedback_records.append(record)
            self._feedback_index.setdefault(normalized_evidence_key, []).append(len(self._feedback_records) - 1)
            self._persist_feedback_records()

        logger.info(
            "quality gate false-positive recorded: feedback_id=%s gate_key=%s evidence_key=%s source=%s original=%s corrected=%s",
            record.feedback_id,
            record.gate_key,
            record.evidence_key,
            record.source,
            record.original_level,
            record.corrected_level,
        )
        return record

    def get_feedback_backflow_view(
        self,
        *,
        gate_key: str | None = None,
        evidence_key: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Read-only aggregate view for false-positive feedback backflow."""

        normalized_gate_key = (gate_key or "").strip()
        normalized_evidence_key = (evidence_key or "").strip()

        with self._lock:
            records = list(self._feedback_records)

        if normalized_gate_key:
            records = [record for record in records if record.gate_key == normalized_gate_key]
        if normalized_evidence_key:
            records = [record for record in records if record.evidence_key == normalized_evidence_key]

        records = sorted(records, key=lambda item: item.feedback_id, reverse=True)
        records = records[: max(limit, 0)]

        by_source = Counter(record.source for record in records)
        by_corrected_level = Counter(record.corrected_level for record in records)

        return {
            "total": len(records),
            "gate_key": normalized_gate_key or None,
            "evidence_key": normalized_evidence_key or None,
            "by_source": dict(by_source),
            "by_corrected_level": dict(by_corrected_level),
            "records": [asdict(record) for record in records],
        }

    def clear_feedback_records(self) -> None:
        """Test helper to reset feedback state."""

        with self._lock:
            self._feedback_records.clear()
            self._feedback_index.clear()
            self._feedback_id_seq = 0
            self._persist_feedback_records()

    def _collect_feedback_corrections(self, *, gate_key: str, evidence_key: str) -> list[GateLevel]:
        with self._lock:
            indexed_positions = list(self._feedback_index.get(evidence_key, []))
            if not indexed_positions:
                return []
            records = [self._feedback_records[position] for position in indexed_positions]

        if gate_key:
            records = [record for record in records if record.gate_key == gate_key]

        return [record.corrected_level for record in records]

    def _load_feedback_records(self) -> None:
        path = self._persistence_file
        if not path.exists():
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("failed to load quality gate feedback cache, fallback to memory: %s", exc)
            return

        records_payload: list[dict[str, Any]]
        if isinstance(payload, dict):
            maybe_records = payload.get("records")
            records_payload = maybe_records if isinstance(maybe_records, list) else []
        elif isinstance(payload, list):
            records_payload = payload
        else:
            records_payload = []

        loaded_records: list[FalsePositiveFeedbackRecord] = []
        loaded_index: dict[str, list[int]] = {}
        max_feedback_id = 0

        for item in records_payload:
            if not isinstance(item, dict):
                continue
            evidence_key = str(item.get("evidence_key") or "").strip()
            if not evidence_key:
                continue
            source_raw = str(item.get("source") or "").strip().lower()
            source: FeedbackSource = source_raw if source_raw in _FEEDBACK_SOURCE_SET else "fusion"
            feedback_id_raw = item.get("feedback_id")
            try:
                feedback_id = int(feedback_id_raw)
            except (TypeError, ValueError):
                feedback_id = len(loaded_records) + 1
            max_feedback_id = max(max_feedback_id, feedback_id)
            record = FalsePositiveFeedbackRecord(
                feedback_id=feedback_id,
                decision_id=str(item.get("decision_id") or ""),
                gate_key=str(item.get("gate_key") or ""),
                evidence_key=evidence_key,
                source=source,
                original_level=_coerce_level(item.get("original_level")),
                corrected_level=_coerce_level(item.get("corrected_level")),
                reason=str(item.get("reason") or "").strip() or "未提供原因",
                reporter=str(item.get("reporter") or "").strip() or "unknown",
                note=str(item.get("note") or "").strip(),
                recorded_at=str(item.get("recorded_at") or "").strip() or datetime.now(UTC).isoformat(),
                metadata=dict(item.get("metadata") or {}) if isinstance(item.get("metadata"), Mapping) else {},
            )
            loaded_records.append(record)
            loaded_index.setdefault(evidence_key, []).append(len(loaded_records) - 1)

        self._feedback_records = loaded_records
        self._feedback_index = loaded_index
        self._feedback_id_seq = max_feedback_id

    def _persist_feedback_records(self) -> None:
        path = self._persistence_file
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "records": [asdict(record) for record in self._feedback_records],
            }
            tmp_path = path.with_suffix(f"{path.suffix}.tmp")
            tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp_path.replace(path)
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("failed to persist quality gate feedback cache, fallback to memory: %s", exc)


def fuse_quality_gate_results(
    *,
    rule_result: GateSignal | Mapping[str, Any] | None,
    model_result: GateSignal | Mapping[str, Any] | None,
    gate_key: str,
    feature_enabled: bool = True,
    degraded_fallback_mode: FusionFallbackMode = "rule_only",
    feedback_evidence_key: str | None = None,
    apply_feedback_backflow: bool = True,
) -> QualityGateFusionDecision:
    """Pure-function facade for callers that do not need service state injection."""

    return quality_gate_fusion_service.fuse_results(
        rule_result=rule_result,
        model_result=model_result,
        gate_key=gate_key,
        feature_enabled=feature_enabled,
        degraded_fallback_mode=degraded_fallback_mode,
        feedback_evidence_key=feedback_evidence_key,
        apply_feedback_backflow=apply_feedback_backflow,
    )


def _normalize_gate_signal(*, source: str, raw: GateSignal | Mapping[str, Any] | None) -> GateSignal:
    if isinstance(raw, GateSignal):
        return GateSignal(
            source=source,
            level=_coerce_level(raw.level),
            reasons=tuple(raw.reasons),
            evidence=tuple(raw.evidence),
            score=raw.score,
            metadata=dict(raw.metadata),
        )

    if raw is None:
        return GateSignal(source=source, level="pass", reasons=(f"{source}_signal_missing",), evidence=())

    if not isinstance(raw, Mapping):
        return GateSignal(source=source, level=_coerce_level(raw), reasons=(f"{source}_signal_coerced",), evidence=())

    raw_level = raw.get("level", raw.get("result", "pass"))
    level = _coerce_level(raw_level)
    reasons = _coerce_text_list(raw.get("reasons", ()))
    if not reasons:
        reasons = [f"{source}_no_reasons"]

    raw_evidence = raw.get("evidence")
    if raw_evidence is None and "issues" in raw:
        raw_evidence = raw.get("issues")
    evidence = _coerce_text_list(raw_evidence)

    score = _coerce_score(raw.get("score"))
    metadata = dict(raw.get("metadata", {})) if isinstance(raw.get("metadata"), Mapping) else {}

    return GateSignal(
        source=source,
        level=level,
        reasons=tuple(reasons),
        evidence=tuple(evidence),
        score=score,
        metadata=metadata,
    )


def _coerce_level(raw: Any, default: GateLevel = "pass") -> GateLevel:
    normalized = str(raw or "").strip().lower()
    if normalized in _SEVERITY_RANK:
        return normalized  # type: ignore[return-value]
    return default


def _coerce_text_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        return [text] if text else []
    if isinstance(raw, Mapping):
        rendered = str(dict(raw)).strip()
        return [rendered] if rendered else []

    values: list[str] = []
    if isinstance(raw, list | tuple | set):
        for item in raw:
            text = str(item).strip()
            if text:
                values.append(text)
    return values


def _coerce_score(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _max_severity(levels: list[GateLevel]) -> GateLevel:
    return max(levels, key=lambda item: _SEVERITY_RANK[item])


def _min_severity(levels: list[GateLevel]) -> GateLevel:
    return min(levels, key=lambda item: _SEVERITY_RANK[item])


quality_gate_fusion_service = QualityGateFusionService()
