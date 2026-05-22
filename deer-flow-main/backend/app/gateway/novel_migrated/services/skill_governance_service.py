"""Skill governance policy service for novel lifecycle workflows.

This module is intentionally integration-light and pure-function friendly so it can
be wired by middleware/router layers later without touching shared entry files now.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)

DegradedFallbackMode = Literal["workspace_only", "system_only", "intersection"]

_REASON_TEXTS = {
    "system_default_seed": "来自系统默认技能集",
    "workspace_enabled": "工作区技能开关允许",
    "workspace_disabled": "被工作区技能开关禁用",
    "workspace_enabled_extension": "由工作区启用集补充",
    "session_selected": "被会话动态选择命中",
    "session_not_selected": "未被会话动态选择命中",
    "feature_flag_disabled": "治理融合功能关闭，进入降级模式",
    "fallback_workspace_only": "降级策略：仅工作区白名单",
    "fallback_system_only": "降级策略：系统默认并受工作区约束",
    "fallback_intersection": "降级策略：系统/会话交集并受工作区约束",
    "final_enabled": "最终生效",
    "final_disabled": "最终未生效",
}


@dataclass(frozen=True, slots=True)
class SkillGovernanceConfig:
    """Runtime switches for governance and rollback."""

    feature_enabled: bool = True
    degraded_fallback_mode: DegradedFallbackMode = "workspace_only"
    default_workspace_enabled: bool = True


@dataclass(frozen=True, slots=True)
class SkillGovernanceRequest:
    """Input contract for three-layer governance evaluation."""

    system_default_skills: list[str]
    workspace_skill_states: Mapping[str, bool] = field(default_factory=dict)
    session_candidate_skills: list[str] | None = None
    config: SkillGovernanceConfig = field(default_factory=SkillGovernanceConfig)


@dataclass(frozen=True, slots=True)
class SkillDecisionReason:
    """Per-skill explainability payload."""

    skill_name: str
    final_enabled: bool
    reason_codes: tuple[str, ...]
    reason_text: str


@dataclass(frozen=True, slots=True)
class SkillGovernanceResult:
    """Output contract for governance decision."""

    final_enabled_skills: list[str]
    governance_mode: str
    reasons: list[SkillDecisionReason]

    def reason_map(self) -> dict[str, SkillDecisionReason]:
        return {item.skill_name: item for item in self.reasons}


class SkillGovernanceService:
    """Resolve final skill set from system/workspace/session layers.

    Three-layer policy:
    1. System defaults seed baseline skill order.
    2. Workspace enabled states are a hard gate and optional extension source.
    3. Session dynamic selection narrows down execution scope.

    Rollback switch:
    - Disable `feature_enabled` to enter degraded fallback mode without changing
      integration callers.
    """

    def resolve(self, request: SkillGovernanceRequest) -> SkillGovernanceResult:
        return self.resolve_from_layers(
            system_default_skills=request.system_default_skills,
            workspace_skill_states=request.workspace_skill_states,
            session_candidate_skills=request.session_candidate_skills,
            feature_enabled=request.config.feature_enabled,
            degraded_fallback_mode=request.config.degraded_fallback_mode,
            default_workspace_enabled=request.config.default_workspace_enabled,
        )

    def resolve_from_layers(
        self,
        *,
        system_default_skills: Sequence[str],
        workspace_skill_states: Mapping[str, bool] | None,
        session_candidate_skills: Sequence[str] | None,
        feature_enabled: bool = True,
        degraded_fallback_mode: DegradedFallbackMode = "workspace_only",
        default_workspace_enabled: bool = True,
    ) -> SkillGovernanceResult:
        system_defaults = _normalize_skill_list(system_default_skills)
        workspace_states = normalize_workspace_skill_states(workspace_skill_states)
        session_candidates = _normalize_skill_list(session_candidate_skills or [])
        session_set = set(session_candidates)

        inspected_skills = _ordered_union(system_defaults, list(workspace_states.keys()), session_candidates)

        if feature_enabled:
            governance_mode = "three_layer"
            final_skills = self._resolve_three_layer(
                system_defaults=system_defaults,
                workspace_states=workspace_states,
                session_candidates=session_candidates,
                default_workspace_enabled=default_workspace_enabled,
            )
        else:
            governance_mode = f"degraded:{degraded_fallback_mode}"
            final_skills = self._resolve_degraded_fallback(
                degraded_fallback_mode=degraded_fallback_mode,
                system_defaults=system_defaults,
                workspace_states=workspace_states,
                session_candidates=session_candidates,
                inspected_skills=inspected_skills,
                default_workspace_enabled=default_workspace_enabled,
            )

        final_set = set(final_skills)

        reasons: list[SkillDecisionReason] = []
        for skill_name in inspected_skills:
            codes: list[str] = []

            if feature_enabled:
                if skill_name in system_defaults:
                    codes.append("system_default_seed")

                workspace_enabled = _is_workspace_enabled(
                    skill_name,
                    workspace_states=workspace_states,
                    default_workspace_enabled=default_workspace_enabled,
                )
                codes.append("workspace_enabled" if workspace_enabled else "workspace_disabled")

                if skill_name in workspace_states and workspace_states[skill_name] and skill_name not in system_defaults:
                    codes.append("workspace_enabled_extension")

                if session_candidates:
                    codes.append("session_selected" if skill_name in session_set else "session_not_selected")
            else:
                codes.append("feature_flag_disabled")
                codes.append(_fallback_code(degraded_fallback_mode))

            codes.append("final_enabled" if skill_name in final_set else "final_disabled")
            reasons.append(
                SkillDecisionReason(
                    skill_name=skill_name,
                    final_enabled=skill_name in final_set,
                    reason_codes=tuple(codes),
                    reason_text="；".join(_REASON_TEXTS.get(code, code) for code in codes),
                )
            )

        logger.info(
            "skill governance resolved: mode=%s defaults=%s workspace_states=%s session_candidates=%s final=%s",
            governance_mode,
            len(system_defaults),
            len(workspace_states),
            len(session_candidates),
            len(final_skills),
        )

        return SkillGovernanceResult(
            final_enabled_skills=final_skills,
            governance_mode=governance_mode,
            reasons=reasons,
        )

    def _resolve_three_layer(
        self,
        *,
        system_defaults: list[str],
        workspace_states: Mapping[str, bool],
        session_candidates: list[str],
        default_workspace_enabled: bool,
    ) -> list[str]:
        # Layer 1 + Layer 2: system defaults filtered by workspace gate.
        seeded = [
            skill_name
            for skill_name in system_defaults
            if _is_workspace_enabled(
                skill_name,
                workspace_states=workspace_states,
                default_workspace_enabled=default_workspace_enabled,
            )
        ]

        # Layer 2 extension: workspace-only enabled skills can be added.
        for skill_name, enabled in workspace_states.items():
            if enabled and skill_name not in seeded:
                seeded.append(skill_name)

        # Layer 3: session dynamic selection narrows candidate set.
        if session_candidates:
            session_set = set(session_candidates)
            seeded = [skill_name for skill_name in seeded if skill_name in session_set]

        return seeded

    def _resolve_degraded_fallback(
        self,
        *,
        degraded_fallback_mode: DegradedFallbackMode,
        system_defaults: list[str],
        workspace_states: Mapping[str, bool],
        session_candidates: list[str],
        inspected_skills: list[str],
        default_workspace_enabled: bool,
    ) -> list[str]:
        if degraded_fallback_mode == "system_only":
            return [
                skill_name
                for skill_name in system_defaults
                if _is_workspace_enabled(
                    skill_name,
                    workspace_states=workspace_states,
                    default_workspace_enabled=default_workspace_enabled,
                )
            ]

        if degraded_fallback_mode == "intersection":
            if session_candidates:
                session_set = set(session_candidates)
                candidates = [skill_name for skill_name in system_defaults if skill_name in session_set]
            else:
                candidates = list(system_defaults)
            return [
                skill_name
                for skill_name in candidates
                if _is_workspace_enabled(
                    skill_name,
                    workspace_states=workspace_states,
                    default_workspace_enabled=default_workspace_enabled,
                )
            ]

        # default: workspace_only
        return [
            skill_name
            for skill_name in inspected_skills
            if _is_workspace_enabled(
                skill_name,
                workspace_states=workspace_states,
                default_workspace_enabled=default_workspace_enabled,
            )
        ]


def resolve_skill_governance(
    *,
    system_default_skills: Sequence[str],
    workspace_skill_states: Mapping[str, bool] | None,
    session_candidate_skills: Sequence[str] | None,
    feature_enabled: bool = True,
    degraded_fallback_mode: DegradedFallbackMode = "workspace_only",
    default_workspace_enabled: bool = True,
) -> SkillGovernanceResult:
    """Pure-function facade for easy integration and testing."""

    return skill_governance_service.resolve_from_layers(
        system_default_skills=system_default_skills,
        workspace_skill_states=workspace_skill_states,
        session_candidate_skills=session_candidate_skills,
        feature_enabled=feature_enabled,
        degraded_fallback_mode=degraded_fallback_mode,
        default_workspace_enabled=default_workspace_enabled,
    )


def normalize_workspace_skill_states(raw: Mapping[str, Any] | None) -> dict[str, bool]:
    """Normalize workspace skill toggle mapping from extensions config payload.

    Accepted value formats:
    - {"skill-a": True}
    - {"skill-a": {"enabled": True}}
    """

    if not raw:
        return {}

    normalized: dict[str, bool] = {}
    for raw_name, raw_value in raw.items():
        skill_name = _normalize_skill_name(raw_name)
        if not skill_name:
            continue

        enabled: bool
        if isinstance(raw_value, bool):
            enabled = raw_value
        elif isinstance(raw_value, Mapping):
            enabled = bool(raw_value.get("enabled", True))
        else:
            enabled = bool(raw_value)

        normalized[skill_name] = enabled

    return normalized


def _normalize_skill_name(raw_name: Any) -> str:
    return str(raw_name or "").strip()


def _normalize_skill_list(raw_names: Sequence[str] | None) -> list[str]:
    if not raw_names:
        return []

    deduped: list[str] = []
    seen: set[str] = set()
    for raw_name in raw_names:
        name = _normalize_skill_name(raw_name)
        if not name or name in seen:
            continue
        seen.add(name)
        deduped.append(name)
    return deduped


def _ordered_union(*skill_lists: Sequence[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for skill_list in skill_lists:
        for skill_name in skill_list:
            if skill_name in seen:
                continue
            seen.add(skill_name)
            merged.append(skill_name)
    return merged


def _is_workspace_enabled(
    skill_name: str,
    *,
    workspace_states: Mapping[str, bool],
    default_workspace_enabled: bool,
) -> bool:
    if skill_name in workspace_states:
        return bool(workspace_states[skill_name])
    return default_workspace_enabled


def _fallback_code(mode: DegradedFallbackMode) -> str:
    if mode == "system_only":
        return "fallback_system_only"
    if mode == "intersection":
        return "fallback_intersection"
    return "fallback_workspace_only"


skill_governance_service = SkillGovernanceService()
