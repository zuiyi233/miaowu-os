"""Thread-level execution gate for high-risk novel tool calls.

Protocol goals:
- Question-first: question-like turns default to answer-only.
- Explicit authorization for high-risk writes.
- Thread-scoped execution mode (enter / revoke).
- Blocked action replay after authorization.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Mapping
from typing import Any, cast, override

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.runtime import Runtime
from langgraph.types import Command

from deerflow.agents.thread_state import ThreadState
from deerflow.protocols.execution_protocol import (
    EXECUTION_MODE_ACTIVE,
    EXECUTION_MODE_AWAITING_AUTHORIZATION,
    EXECUTION_MODE_READONLY,
    EXECUTION_MODE_REVOKED,
    build_pending_action_payload,
    coerce_execution_gate_state,
    fingerprint_user_text,
    is_authorization_command,
    is_high_risk_tool_call,
    is_revoke_command,
    should_answer_only,
    update_execution_gate_state,
)

logger = logging.getLogger(__name__)

_SYSTEM_MESSAGE_NAMES = {
    "todo_reminder",
    "todo_completion_reminder",
    "execution_gate_notice",
}


def _extract_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                if item.strip():
                    chunks.append(item.strip())
            elif isinstance(item, Mapping):
                text_val = item.get("text")
                if isinstance(text_val, str) and text_val.strip():
                    chunks.append(text_val.strip())
        return "\n".join(chunks).strip()
    return ""


def _last_ai_message(messages: list[Any]) -> AIMessage | None:
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            return message
    return None


def _latest_user_message(messages: list[Any]) -> tuple[str, str]:
    for message in reversed(messages):
        if not isinstance(message, HumanMessage):
            continue
        if getattr(message, "name", None) in _SYSTEM_MESSAGE_NAMES:
            continue
        text = _extract_text_content(message.content)
        if text:
            message_id = str(getattr(message, "id", "") or "")
            return message_id, text
    return "", ""


def _clone_command_with_update(command: Command, *, update_patch: dict[str, Any]) -> Command:
    base_update = {}
    if isinstance(command.update, Mapping):
        base_update = dict(command.update)
    base_update.update(update_patch)
    kwargs: dict[str, Any] = {"update": base_update}
    command_goto = getattr(command, "goto", None)
    if command_goto is not None:
        kwargs["goto"] = command_goto
    command_resume = getattr(command, "resume", None)
    if command_resume is not None:
        kwargs["resume"] = command_resume
    return Command(**kwargs)


class ExecutionGateMiddleware(AgentMiddleware[ThreadState]):
    """Hard-gates high-risk tool calls unless execution authorization is active."""

    state_schema = ThreadState

    def _build_block_message(
        self,
        *,
        tool_name: str,
        pending_action: Mapping[str, Any],
        reason: str,
    ) -> str:
        pending_preview = cast(dict[str, Any], pending_action).get("args_summary", {}) or {}

        preview_text = "无"
        if pending_preview:
            try:
                preview_text = json.dumps(pending_preview, ensure_ascii=False)
            except Exception:
                preview_text = str(pending_preview)

        if reason == "question_priority":
            return f"检测到当前是问答请求，已阻止高风险写操作。\n- 拦截动作：{tool_name}\n- 执行草案：{preview_text}\n\n我会先给你解释方案；如果你要真正执行，请回复“确认执行”或“进入执行模式”。"

        return (
            f"当前线程尚未授权执行高风险写操作，已拦截本次调用。\n- 拦截动作：{tool_name}\n- 执行草案：{preview_text}\n\n回复“确认执行”会自动重放刚才动作；回复“进入执行模式”可在当前线程持续放行；回复“退出执行模式”或“取消授权”可恢复拦截。"
        )

    def _build_fallback_answer_only_text(self) -> str:
        return "这是问答请求，我先解释方案；若要执行高风险写操作，请回复“确认执行”或“进入执行模式”。"

    @override
    def before_model(self, state: ThreadState, runtime: Runtime) -> dict[str, Any] | None:
        messages = list(state.get("messages") or [])
        gate_state = coerce_execution_gate_state(state.get("execution_gate"))

        _, latest_user_text = _latest_user_message(messages)
        if not latest_user_text:
            if gate_state.get("answer_only_turn"):
                next_gate = update_execution_gate_state(gate_state, answer_only_turn=False, replay_requested=False)
                return {"execution_gate": next_gate}
            return None

        user_fp = fingerprint_user_text(latest_user_text)
        if user_fp and gate_state.get("last_user_fingerprint") == user_fp:
            return None

        updates: dict[str, Any] = {
            "last_user_fingerprint": user_fp or None,
            "answer_only_turn": False,
            "replay_requested": False,
        }

        if is_revoke_command(latest_user_text):
            updates.update(
                status=EXECUTION_MODE_REVOKED,
                execution_mode=False,
                pending_action=None,
                confirmation_required=False,
            )
            return {"execution_gate": update_execution_gate_state(gate_state, **updates)}

        if is_authorization_command(latest_user_text, include_legacy=False):
            pending_action = gate_state.get("pending_action")
            updates.update(
                status=EXECUTION_MODE_ACTIVE,
                execution_mode=True,
                confirmation_required=False,
            )
            if isinstance(pending_action, Mapping):
                updates["replay_requested"] = True
            return {"execution_gate": update_execution_gate_state(gate_state, **updates)}

        if should_answer_only(latest_user_text):
            updates.update(
                answer_only_turn=True,
                status=EXECUTION_MODE_ACTIVE if gate_state.get("execution_mode") else EXECUTION_MODE_READONLY,
            )
            return {"execution_gate": update_execution_gate_state(gate_state, **updates)}

        # For normal turns, keep existing authorization state but clear "revoked"
        # marker after acknowledging one user message.
        if gate_state.get("status") == EXECUTION_MODE_REVOKED:
            updates["status"] = EXECUTION_MODE_READONLY
        elif gate_state.get("execution_mode"):
            updates["status"] = EXECUTION_MODE_ACTIVE
        else:
            updates["status"] = EXECUTION_MODE_READONLY
        return {"execution_gate": update_execution_gate_state(gate_state, **updates)}

    @override
    async def abefore_model(self, state: ThreadState, runtime: Runtime) -> dict[str, Any] | None:
        return self.before_model(state, runtime)

    def _inject_replay_tool_call(self, state: ThreadState) -> dict[str, Any] | None:
        messages = list(state.get("messages") or [])
        gate_state = coerce_execution_gate_state(state.get("execution_gate"))
        if not gate_state.get("replay_requested"):
            return None

        pending_action = gate_state.get("pending_action")
        if not isinstance(pending_action, Mapping):
            next_gate = update_execution_gate_state(
                gate_state,
                replay_requested=False,
                confirmation_required=False,
                pending_action=None,
                status=EXECUTION_MODE_ACTIVE if gate_state.get("execution_mode") else EXECUTION_MODE_READONLY,
            )
            return {"execution_gate": next_gate}

        last_ai = _last_ai_message(messages)
        if last_ai is None:
            return None

        tool_name = str(pending_action.get("tool_name") or pending_action.get("action_type") or "").strip()
        tool_args_raw = pending_action.get("args")
        tool_args = dict(tool_args_raw) if isinstance(tool_args_raw, Mapping) else {}
        call_id = str(pending_action.get("tool_call_id") or f"call_execution_gate_{uuid.uuid4().hex[:12]}")

        forced_tool_call = {
            "name": tool_name,
            "args": tool_args,
            "id": call_id,
        }
        content = last_ai.content
        if not _extract_text_content(content):
            content = "已收到执行授权，正在自动执行刚才被拦截的动作。"

        updated_ai = last_ai.model_copy(update={"tool_calls": [forced_tool_call], "content": content})
        next_gate = update_execution_gate_state(
            gate_state,
            replay_requested=False,
            answer_only_turn=False,
            status=EXECUTION_MODE_ACTIVE,
            execution_mode=True,
            confirmation_required=False,
        )
        return {
            "messages": [updated_ai],
            "execution_gate": next_gate,
        }

    def _strip_high_risk_tool_calls_on_answer_only(self, state: ThreadState) -> dict[str, Any] | None:
        messages = list(state.get("messages") or [])
        gate_state = coerce_execution_gate_state(state.get("execution_gate"))
        if not gate_state.get("answer_only_turn"):
            return None

        last_ai = _last_ai_message(messages)
        if last_ai is None:
            return None

        tool_calls = list(getattr(last_ai, "tool_calls", []) or [])
        if not tool_calls:
            return {"execution_gate": update_execution_gate_state(gate_state, answer_only_turn=False)}

        high_risk_calls = [tc for tc in tool_calls if is_high_risk_tool_call(tc.get("name"), tc.get("args"))]
        if not high_risk_calls:
            return {"execution_gate": update_execution_gate_state(gate_state, answer_only_turn=False)}

        safe_calls = [tc for tc in tool_calls if not is_high_risk_tool_call(tc.get("name"), tc.get("args"))]
        next_content = last_ai.content
        if not safe_calls and not _extract_text_content(next_content):
            next_content = self._build_fallback_answer_only_text()

        updated_ai = last_ai.model_copy(update={"tool_calls": safe_calls, "content": next_content})
        next_gate = update_execution_gate_state(
            gate_state,
            answer_only_turn=False,
            replay_requested=False,
            status=EXECUTION_MODE_ACTIVE if gate_state.get("execution_mode") else EXECUTION_MODE_READONLY,
        )
        return {"messages": [updated_ai], "execution_gate": next_gate}

    @override
    def after_model(self, state: ThreadState, runtime: Runtime) -> dict[str, Any] | None:
        replay_patch = self._inject_replay_tool_call(state)
        if replay_patch is not None:
            return replay_patch
        return self._strip_high_risk_tool_calls_on_answer_only(state)

    @override
    async def aafter_model(self, state: ThreadState, runtime: Runtime) -> dict[str, Any] | None:
        return self.after_model(state, runtime)

    def _build_block_response(
        self,
        *,
        request: ToolCallRequest,
        gate_state: Mapping[str, Any],
        reason: str,
        pending_action: Mapping[str, Any],
    ) -> Command:
        tool_name = str(request.tool_call.get("name") or "unknown_tool")
        tool_call_id = str(request.tool_call.get("id") or "")
        blocked_message = ToolMessage(
            content=self._build_block_message(tool_name=tool_name, pending_action=pending_action, reason=reason),
            tool_call_id=tool_call_id,
            name=tool_name,
            status="error",
        )

        next_gate = update_execution_gate_state(
            gate_state,
            status=EXECUTION_MODE_AWAITING_AUTHORIZATION,
            execution_mode=False,
            pending_action=dict(pending_action),
            confirmation_required=True,
            replay_requested=False,
            answer_only_turn=(reason == "question_priority"),
        )
        return Command(
            update={
                "execution_gate": next_gate,
                "messages": [blocked_message],
            },
            goto=END,
        )

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        tool_name = str(request.tool_call.get("name") or "").strip()
        tool_args = request.tool_call.get("args")
        tool_args_mapping = dict(tool_args) if isinstance(tool_args, Mapping) else {}

        if not is_high_risk_tool_call(tool_name, tool_args_mapping):
            return handler(request)

        request_state = getattr(request, "state", None)
        request_gate_raw = request_state.get("execution_gate") if isinstance(request_state, Mapping) else None
        gate_state = coerce_execution_gate_state(request_gate_raw)
        answer_only_turn = bool(gate_state.get("answer_only_turn"))
        execution_mode_active = bool(gate_state.get("execution_mode"))

        if answer_only_turn or not execution_mode_active:
            pending_action = build_pending_action_payload(
                action_type=tool_name,
                tool_name=tool_name,
                args=tool_args_mapping,
                tool_call_id=str(request.tool_call.get("id") or "") or None,
                source="lead_agent_tool_call",
                note="blocked_by_execution_gate",
            )
            reason = "question_priority" if answer_only_turn else "authorization_required"
            return self._build_block_response(
                request=request,
                gate_state=gate_state,
                reason=reason,
                pending_action=pending_action,
            )

        result = handler(request)
        next_gate = update_execution_gate_state(
            gate_state,
            status=EXECUTION_MODE_ACTIVE,
            execution_mode=True,
            pending_action=None,
            confirmation_required=False,
            replay_requested=False,
            answer_only_turn=False,
        )
        if isinstance(result, Command):
            return _clone_command_with_update(result, update_patch={"execution_gate": next_gate})
        return Command(update={"execution_gate": next_gate, "messages": [result]})

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        tool_name = str(request.tool_call.get("name") or "").strip()
        tool_args = request.tool_call.get("args")
        tool_args_mapping = dict(tool_args) if isinstance(tool_args, Mapping) else {}

        if not is_high_risk_tool_call(tool_name, tool_args_mapping):
            return await handler(request)

        request_state = getattr(request, "state", None)
        request_gate_raw = request_state.get("execution_gate") if isinstance(request_state, Mapping) else None
        gate_state = coerce_execution_gate_state(request_gate_raw)
        answer_only_turn = bool(gate_state.get("answer_only_turn"))
        execution_mode_active = bool(gate_state.get("execution_mode"))

        if answer_only_turn or not execution_mode_active:
            pending_action = build_pending_action_payload(
                action_type=tool_name,
                tool_name=tool_name,
                args=tool_args_mapping,
                tool_call_id=str(request.tool_call.get("id") or "") or None,
                source="lead_agent_tool_call",
                note="blocked_by_execution_gate",
            )
            reason = "question_priority" if answer_only_turn else "authorization_required"
            return self._build_block_response(
                request=request,
                gate_state=gate_state,
                reason=reason,
                pending_action=pending_action,
            )

        result = await handler(request)

        # Clear pending action after successful authorized execution.
        next_gate = update_execution_gate_state(
            gate_state,
            status=EXECUTION_MODE_ACTIVE,
            execution_mode=True,
            pending_action=None,
            confirmation_required=False,
            replay_requested=False,
            answer_only_turn=False,
        )

        if isinstance(result, Command):
            return _clone_command_with_update(result, update_patch={"execution_gate": next_gate})

        return Command(
            update={
                "execution_gate": next_gate,
                "messages": [result],
            }
        )
