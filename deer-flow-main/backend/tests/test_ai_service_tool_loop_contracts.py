from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from langchain_core.messages import HumanMessage, ToolMessage

from app.gateway.novel_migrated.services.ai_service import AIService


def _make_ai_service() -> AIService:
    return AIService(
        api_provider="openai",
        api_key="test-key",
        api_base_url="https://api.openai.com/v1",
        default_model="gpt-4o",
        default_temperature=0.7,
        default_max_tokens=2000,
    )


def test_handle_tool_calls_loop_generates_unique_fallback_tool_call_ids():
    ai_service = _make_ai_service()

    last_response = MagicMock()
    last_response.content = "tool-call"
    last_response.tool_calls = [
        {"name": "search", "args": {"q": "a"}},
        {"name": "search", "args": {"q": "b"}},
    ]

    final_response = MagicMock()
    final_response.content = "done"
    final_response.tool_calls = []

    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value=final_response)
    ai_service._execute_tool_call = AsyncMock(side_effect=["res-a", "res-b"])  # type: ignore[method-assign]

    content, _ = asyncio.run(
        ai_service._handle_tool_calls_loop(
            messages=[HumanMessage(content="hi")],
            last_response=last_response,
            tools=[],
            llm=llm,
            max_iterations=2,
        )
    )

    assert content == "done"
    sent_messages = llm.ainvoke.await_args.args[0]
    tool_messages = [message for message in sent_messages if isinstance(message, ToolMessage)]
    assert len(tool_messages) == 2
    assert tool_messages[0].tool_call_id != tool_messages[1].tool_call_id
    assert tool_messages[0].tool_call_id.startswith("call_0_0_")
    assert tool_messages[1].tool_call_id.startswith("call_0_1_")


def test_clean_json_response_public_wrapper_keeps_same_behavior():
    raw = '```json\n{"k": 1}\n```'
    assert AIService.clean_json_response(raw) == AIService._clean_json_response(raw)
