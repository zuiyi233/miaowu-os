from __future__ import annotations

from deerflow.protocols.execution_protocol import (
    EXECUTION_MODE_READONLY,
    coerce_execution_gate_state,
    default_execution_gate_state,
    is_authorization_command,
    is_high_risk_action,
    is_high_risk_tool_call,
    is_revoke_command,
    should_answer_only,
)


def test_question_priority_blocks_question_even_with_action_words():
    assert should_answer_only("如何执行 build_world 才更稳妥？") is True
    assert should_answer_only("请执行 build_world") is False
    assert should_answer_only("可以，不用讨论了，直接帮我创建。") is False


def test_authorization_and_revoke_commands_cover_primary_phrases():
    assert is_authorization_command("确认执行", include_legacy=False) is True
    assert is_authorization_command("进入执行模式", include_legacy=False) is True
    assert is_authorization_command("__enter_execution_mode__", include_legacy=False) is True
    assert is_revoke_command("退出执行模式", include_legacy=False) is True
    assert is_revoke_command("取消授权", include_legacy=False) is True
    assert is_revoke_command("__exit_execution_mode__", include_legacy=False) is True
    assert is_revoke_command("__cancel_action__", include_legacy=False) is False


def test_manage_foreshadow_read_only_actions_not_high_risk():
    assert is_high_risk_tool_call("manage_foreshadow", {"action": "list"}) is False
    assert is_high_risk_tool_call("manage_foreshadow", {"action": "context"}) is False
    assert is_high_risk_tool_call("manage_foreshadow", {"action": "create"}) is True
    assert is_high_risk_action("manage_foreshadow", {"action": "resolve"}) is True


def test_default_execution_gate_state_roundtrip():
    baseline = default_execution_gate_state()
    normalized = coerce_execution_gate_state(baseline)
    assert normalized["status"] == EXECUTION_MODE_READONLY
    assert normalized["execution_mode"] is False
    assert normalized["pending_action"] is None
