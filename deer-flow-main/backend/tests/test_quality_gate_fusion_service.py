from __future__ import annotations

import pytest

from app.gateway.novel_migrated.services.quality_gate_fusion_service import QualityGateFusionService


@pytest.mark.parametrize(
    ("rule_level", "model_level", "expected"),
    [
        ("pass", "pass", "pass"),
        ("warn", "pass", "warn"),
        ("pass", "warn", "warn"),
        ("warn", "block", "block"),
        ("block", "pass", "block"),
    ],
)
def test_fuse_results_matrix(rule_level: str, model_level: str, expected: str) -> None:
    service = QualityGateFusionService()

    decision = service.fuse_results(
        rule_result={"level": rule_level, "evidence": ["rule-evidence"]},
        model_result={"level": model_level, "evidence": ["model-evidence"]},
        gate_key="novel:chapter:gate",
    )

    assert decision.final_level == expected
    assert decision.rule_level == rule_level
    assert decision.model_level == model_level
    assert "rule-evidence" in decision.merged_evidence["rule"]
    assert "model-evidence" in decision.merged_evidence["model"]


def test_feature_flag_disabled_falls_back_to_rule_only() -> None:
    service = QualityGateFusionService()

    decision = service.fuse_results(
        rule_result={"level": "pass", "evidence": ["rule-ok"]},
        model_result={"level": "block", "evidence": ["model-risk"]},
        gate_key="novel:project:finalize",
        feature_enabled=False,
        degraded_fallback_mode="rule_only",
    )

    assert decision.degraded_fallback is True
    assert decision.final_level == "pass"
    assert "feature_flag_disabled" in decision.decision_path
    assert "fallback=rule_only" in decision.decision_path


def test_feature_flag_disabled_can_fall_back_to_warn_only() -> None:
    service = QualityGateFusionService()

    decision = service.fuse_results(
        rule_result={"level": "pass", "evidence": ["rule-ok"]},
        model_result={"level": "block", "evidence": ["model-risk"]},
        gate_key="novel:project:warn-only",
        feature_enabled=False,
        degraded_fallback_mode="warn_only",
    )

    assert decision.degraded_fallback is True
    assert decision.final_level == "warn"
    assert "feature_flag_disabled" in decision.decision_path
    assert "fallback=warn_only" in decision.decision_path


def test_false_positive_feedback_can_relax_followup_decision_and_expose_backflow_view() -> None:
    service = QualityGateFusionService()
    gate_key = "novel:chapter:quality"
    evidence_key = "chapter-12:sensitive-word"

    first = service.fuse_results(
        rule_result={"level": "block", "evidence": ["sensitive_words:xxx"]},
        model_result={"level": "warn", "evidence": ["model_uncertain"]},
        gate_key=gate_key,
        feedback_evidence_key=evidence_key,
    )
    assert first.final_level == "block"
    assert first.feedback_adjusted is False

    feedback = service.record_false_positive_feedback(
        decision_id=first.decision_id,
        gate_key=gate_key,
        evidence_key=evidence_key,
        source="fusion",
        original_level="block",
        corrected_level="warn",
        reason="人工复核确认属于上下文误判",
        reporter="qa-user",
        note="保留告警但允许继续",
    )

    assert feedback.feedback_id == 1
    assert feedback.corrected_level == "warn"

    second = service.fuse_results(
        rule_result={"level": "block", "evidence": ["sensitive_words:xxx"]},
        model_result={"level": "warn", "evidence": ["model_uncertain"]},
        gate_key=gate_key,
        feedback_evidence_key=evidence_key,
        apply_feedback_backflow=True,
    )

    assert second.feedback_adjusted is True
    assert second.final_level == "warn"
    assert any(step.startswith("feedback_relaxed:block->warn") for step in second.decision_path)

    view = service.get_feedback_backflow_view(gate_key=gate_key, evidence_key=evidence_key)

    assert view["total"] == 1
    assert view["by_source"] == {"fusion": 1}
    assert view["by_corrected_level"] == {"warn": 1}
    assert view["records"][0]["reason"] == "人工复核确认属于上下文误判"


def test_feedback_backflow_persists_after_service_restart(tmp_path) -> None:
    persistence_file = tmp_path / "quality_gate_feedback.json"
    gate_key = "novel:chapter:persist"
    evidence_key = "chapter-99:entity-conflict"

    first_service = QualityGateFusionService(persistence_file=persistence_file)
    first_decision = first_service.fuse_results(
        rule_result={"level": "block", "evidence": ["entity_conflict"]},
        model_result={"level": "warn", "evidence": ["model_uncertain"]},
        gate_key=gate_key,
        feedback_evidence_key=evidence_key,
    )
    assert first_decision.feedback_adjusted is False

    first_service.record_false_positive_feedback(
        decision_id=first_decision.decision_id,
        gate_key=gate_key,
        evidence_key=evidence_key,
        source="fusion",
        original_level="block",
        corrected_level="warn",
        reason="人工复核后确认可降级",
        reporter="reviewer",
    )
    assert persistence_file.exists()

    reloaded_service = QualityGateFusionService(persistence_file=persistence_file)
    second_decision = reloaded_service.fuse_results(
        rule_result={"level": "block", "evidence": ["entity_conflict"]},
        model_result={"level": "warn", "evidence": ["model_uncertain"]},
        gate_key=gate_key,
        feedback_evidence_key=evidence_key,
    )

    assert second_decision.feedback_adjusted is True
    assert second_decision.final_level == "warn"
