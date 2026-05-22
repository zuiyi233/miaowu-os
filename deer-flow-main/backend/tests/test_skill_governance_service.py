from __future__ import annotations

from app.gateway.novel_migrated.services.skill_governance_service import (
    SkillGovernanceConfig,
    SkillGovernanceRequest,
    SkillGovernanceService,
    normalize_workspace_skill_states,
    resolve_skill_governance,
)


def test_three_layer_strategy_merges_workspace_and_applies_session_filter() -> None:
    service = SkillGovernanceService()
    request = SkillGovernanceRequest(
        system_default_skills=["plot-planner", "character-arc", "world-building"],
        workspace_skill_states={
            "plot-planner": True,
            "character-arc": False,
            "foreshadow-engine": True,
        },
        session_candidate_skills=["foreshadow-engine", "character-arc", "plot-planner"],
        config=SkillGovernanceConfig(feature_enabled=True),
    )

    result = service.resolve(request)

    assert result.governance_mode == "three_layer"
    assert result.final_enabled_skills == ["plot-planner", "foreshadow-engine"]

    reason_map = result.reason_map()
    assert "workspace_disabled" in reason_map["character-arc"].reason_codes
    assert "session_not_selected" in reason_map["world-building"].reason_codes
    assert "workspace_enabled_extension" in reason_map["foreshadow-engine"].reason_codes


def test_workspace_disable_is_hard_constraint_for_session_selection() -> None:
    result = resolve_skill_governance(
        system_default_skills=["chapter-polish"],
        workspace_skill_states={"chapter-polish": False},
        session_candidate_skills=["chapter-polish"],
        feature_enabled=True,
    )

    assert result.final_enabled_skills == []
    reason = result.reason_map()["chapter-polish"]
    assert reason.final_enabled is False
    assert "workspace_disabled" in reason.reason_codes


def test_feature_flag_disabled_uses_workspace_only_fallback() -> None:
    result = resolve_skill_governance(
        system_default_skills=["outline-generator", "character-graph"],
        workspace_skill_states={
            "outline-generator": False,
            "chapter-qa": True,
        },
        session_candidate_skills=["character-graph", "chapter-qa"],
        feature_enabled=False,
        degraded_fallback_mode="workspace_only",
        default_workspace_enabled=False,
    )

    assert result.governance_mode == "degraded:workspace_only"
    assert result.final_enabled_skills == ["chapter-qa"]

    reason_map = result.reason_map()
    assert "feature_flag_disabled" in reason_map["chapter-qa"].reason_codes
    assert "fallback_workspace_only" in reason_map["chapter-qa"].reason_codes


def test_feature_flag_disabled_supports_system_only_fallback() -> None:
    result = resolve_skill_governance(
        system_default_skills=["outline-generator", "character-graph"],
        workspace_skill_states={
            "outline-generator": False,
            "character-graph": True,
            "chapter-qa": True,
        },
        session_candidate_skills=["chapter-qa"],
        feature_enabled=False,
        degraded_fallback_mode="system_only",
        default_workspace_enabled=False,
    )

    assert result.governance_mode == "degraded:system_only"
    assert result.final_enabled_skills == ["character-graph"]
    reason = result.reason_map()["character-graph"]
    assert "fallback_system_only" in reason.reason_codes


def test_normalize_workspace_skill_states_supports_extensions_config_shape() -> None:
    normalized = normalize_workspace_skill_states(
        {
            "skill-a": {"enabled": True},
            "skill-b": {"enabled": False},
            "skill-c": True,
            "skill-d": "",  # treated as False
        }
    )

    assert normalized == {
        "skill-a": True,
        "skill-b": False,
        "skill-c": True,
        "skill-d": False,
    }
