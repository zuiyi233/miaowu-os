from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.graph import END
from langgraph.types import Command

from deerflow.agents.middlewares.execution_gate_middleware import ExecutionGateMiddleware


def _make_tool_call_request(
    *,
    name: str,
    args: dict,
    state: dict,
    call_id: str = "call_1",
):
    req = MagicMock()
    req.tool_call = {"name": name, "args": args, "id": call_id}
    req.state = state
    return req


def test_unauthorized_high_risk_tool_is_blocked():
    mw = ExecutionGateMiddleware()
    runtime = MagicMock()

    state = {
        "messages": [HumanMessage(content="请帮我构建世界观")],
    }
    before_patch = mw.before_model(state, runtime)
    assert before_patch is not None
    state.update(before_patch)

    req = _make_tool_call_request(
        name="build_world",
        args={"project_id": "proj-1", "style": "xianxia"},
        state=state,
    )

    async def _handler(_):
        raise AssertionError("unauthorized request should not execute handler")

    result = asyncio.run(mw.awrap_tool_call(req, _handler))
    assert isinstance(result, Command)
    assert result.goto == END
    assert result.update is not None

    gate = result.update["execution_gate"]
    assert gate["status"] == "awaiting_authorization"
    assert gate["confirmation_required"] is True
    assert gate["pending_action"]["action_type"] == "build_world"


def test_confirm_command_replays_pending_action_and_keeps_execution_mode_active():
    mw = ExecutionGateMiddleware()
    runtime = MagicMock()

    # Step 1: blocked high-risk call to capture pending action.
    first_state = {
        "messages": [HumanMessage(content="请帮我构建世界观")],
    }
    before_patch = mw.before_model(first_state, runtime)
    assert before_patch is not None
    first_state.update(before_patch)

    blocked_request = _make_tool_call_request(
        name="build_world",
        args={"project_id": "proj-2", "world_type": "xianxia"},
        state=first_state,
        call_id="call_blocked",
    )

    async def _blocked_handler(_):
        raise AssertionError("blocked action should not execute")

    blocked_result = asyncio.run(mw.awrap_tool_call(blocked_request, _blocked_handler))
    assert isinstance(blocked_result, Command)
    blocked_gate = blocked_result.update["execution_gate"]

    # Step 2: user confirms; middleware marks replay_requested.
    confirm_state = {
        "messages": [
            HumanMessage(content="确认执行"),
            AIMessage(content="收到，开始执行"),
        ],
        "execution_gate": blocked_gate,
    }
    confirm_before_patch = mw.before_model(confirm_state, runtime)
    assert confirm_before_patch is not None
    confirm_state.update(confirm_before_patch)
    assert confirm_state["execution_gate"]["replay_requested"] is True

    after_patch = mw.after_model(confirm_state, runtime)
    assert after_patch is not None
    forced_ai = after_patch["messages"][0]
    assert forced_ai.tool_calls[0]["name"] == "build_world"
    assert forced_ai.tool_calls[0]["args"]["project_id"] == "proj-2"

    execution_gate = after_patch["execution_gate"]
    assert execution_gate["execution_mode"] is True
    assert execution_gate["status"] == "execution_mode_active"
    assert execution_gate["replay_requested"] is False

    # Step 3: tool executes under active execution mode and pending action is cleared.
    execute_request = _make_tool_call_request(
        name="build_world",
        args=forced_ai.tool_calls[0]["args"],
        state={"execution_gate": execution_gate},
        call_id=forced_ai.tool_calls[0]["id"],
    )

    async def _execute_handler(_):
        return ToolMessage(
            content='{"ok": true}',
            tool_call_id=forced_ai.tool_calls[0]["id"],
            name="build_world",
        )

    execute_result = asyncio.run(mw.awrap_tool_call(execute_request, _execute_handler))
    assert isinstance(execute_result, Command)
    assert execute_result.update["execution_gate"]["pending_action"] is None
    assert execute_result.update["execution_gate"]["execution_mode"] is True


def test_revoke_command_disables_execution_mode_and_blocks_again():
    mw = ExecutionGateMiddleware()
    runtime = MagicMock()

    active_gate = {
        "status": "execution_mode_active",
        "execution_mode": True,
        "pending_action": None,
        "confirmation_required": False,
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    revoke_state = {
        "messages": [HumanMessage(content="退出执行模式")],
        "execution_gate": active_gate,
    }

    revoke_patch = mw.before_model(revoke_state, runtime)
    assert revoke_patch is not None
    revoke_gate = revoke_patch["execution_gate"]
    assert revoke_gate["status"] == "revoked"
    assert revoke_gate["execution_mode"] is False

    req = _make_tool_call_request(
        name="finalize_project",
        args={"project_id": "proj-3"},
        state={"execution_gate": revoke_gate},
    )

    async def _handler(_):
        raise AssertionError("revoked state should block high-risk call")

    result = asyncio.run(mw.awrap_tool_call(req, _handler))
    assert isinstance(result, Command)
    assert result.goto == END
    assert result.update["execution_gate"]["status"] == "awaiting_authorization"


def test_planning_request_strips_write_like_tool_calls():
    mw = ExecutionGateMiddleware()
    runtime = MagicMock()

    state = {
        "messages": [
            HumanMessage(content="我想写一本小说，书名是没钱修什么仙，请先帮我构思。"),
            AIMessage(
                content="",
                tool_calls=[
                    {"name": "write_file", "args": {"path": "../outputs/chapter_1.md", "content": "..."}, "id": "call_write"},
                    {"name": "present_files", "args": {"paths": ["../outputs/chapter_1.md"]}, "id": "call_present"},
                ],
            ),
        ],
    }

    before_patch = mw.before_model(state, runtime)
    assert before_patch is not None
    state.update(before_patch)
    assert state["execution_gate"]["planning_only_turn"] is True

    after_patch = mw.after_model(state, runtime)
    assert after_patch is not None
    updated_ai = after_patch["messages"][0]
    assert updated_ai.tool_calls == []
    assert "构思" in str(updated_ai.content)
    assert after_patch["execution_gate"]["planning_only_turn"] is False


def test_planning_request_appends_fallback_when_blocked_tool_removed_from_non_empty_reply():
    mw = ExecutionGateMiddleware()
    runtime = MagicMock()

    state = {
        "messages": [
            HumanMessage(content="我想写一本小说，书名是没钱修什么仙，帮我构思一下"),
            AIMessage(
                content=(
                    "我来帮您构思《没钱修什么仙》这部小说！从您的书名可以看出，这是一个反传统的修仙题材，很有创意。"
                    "让我先为您创建一个小说项目，然后我们一起构建这个世界。"
                ),
                tool_calls=[
                    {"name": "create_novel", "args": {"title": "没钱修什么仙", "genre": "仙侠"}, "id": "call_create"},
                ],
            ),
        ],
    }

    before_patch = mw.before_model(state, runtime)
    assert before_patch is not None
    state.update(before_patch)
    assert state["execution_gate"]["planning_only_turn"] is True

    after_patch = mw.after_model(state, runtime)
    assert after_patch is not None
    updated_ai = after_patch["messages"][0]
    assert updated_ai.tool_calls == []
    content_text = str(updated_ai.content)
    assert "反传统的修仙题材" in content_text
    assert "不会直接创建项目或生成章节" in content_text
    assert after_patch["execution_gate"]["planning_only_turn"] is False


def test_answer_only_turn_appends_fallback_when_blocked_tool_removed_from_non_empty_reply():
    mw = ExecutionGateMiddleware()
    runtime = MagicMock()

    state = {
        "messages": [
            HumanMessage(content="如何开始写一本修仙小说？"),
            AIMessage(
                content="好的，我先帮你创建一个小说项目。",
                tool_calls=[
                    {"name": "create_novel", "args": {"title": "测试小说", "genre": "仙侠"}, "id": "call_create"},
                ],
            ),
        ],
    }

    before_patch = mw.before_model(state, runtime)
    assert before_patch is not None
    state.update(before_patch)
    assert state["execution_gate"]["answer_only_turn"] is True

    after_patch = mw.after_model(state, runtime)
    assert after_patch is not None
    updated_ai = after_patch["messages"][0]
    assert updated_ai.tool_calls == []
    content_text = str(updated_ai.content)
    assert "先帮你创建一个小说项目" in content_text
    assert "这是问答请求" in content_text
    assert after_patch["execution_gate"]["answer_only_turn"] is False


def test_planning_request_blocks_write_tool_at_wrap_stage():
    mw = ExecutionGateMiddleware()
    req = _make_tool_call_request(
        name="write_file",
        args={"path": "../outputs/chapter_1.md", "content": "test"},
        state={
            "execution_gate": {
                "status": "readonly",
                "execution_mode": False,
                "planning_only_turn": True,
            }
        },
    )

    async def _handler(_):
        raise AssertionError("planning-only turn should block write tool")

    result = asyncio.run(mw.awrap_tool_call(req, _handler))
    assert isinstance(result, Command)
    assert result.goto == END
    assert result.update["execution_gate"]["confirmation_required"] is False
    assert result.update["execution_gate"]["pending_action"] is None
    assert "构思" in str(result.update["messages"][0].content)
