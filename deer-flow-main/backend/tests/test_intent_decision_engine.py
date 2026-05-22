from __future__ import annotations

from app.gateway.middleware.intent_components import IntentDecisionEngine


def test_decision_engine_auto_execute_when_authorized_and_slots_complete():
    engine = IntentDecisionEngine(exemplar_path=None)

    decision, ui_hints = engine.decide(
        user_message="可以，不用讨论了，直接帮我创建。",
        session_mode="create",
        slots_complete=True,
        execution_mode_active=True,
        pending_action_exists=True,
    )

    assert decision["should_execute_now"] is True
    assert decision["execute_confidence"] >= 0.62
    assert ui_hints["show_confirmation_card"] is False


def test_decision_engine_confirmation_fallback_when_not_authorized():
    engine = IntentDecisionEngine(exemplar_path=None)

    decision, ui_hints = engine.decide(
        user_message="直接创建小说项目",
        session_mode="create",
        slots_complete=True,
        execution_mode_active=False,
        pending_action_exists=True,
    )

    assert decision["should_execute_now"] is False
    assert decision["execute_confidence"] >= 0.55
    assert ui_hints["show_confirmation_card"] is True


def test_decision_engine_marks_clarification_for_low_confidence_text():
    engine = IntentDecisionEngine(exemplar_path=None)

    decision, ui_hints = engine.decide(
        user_message="嗯嗯",
        session_mode="manage",
        slots_complete=False,
        execution_mode_active=False,
        pending_action_exists=False,
    )

    assert decision["should_clarify"] is True
    assert ui_hints["clarification_required"] is True
