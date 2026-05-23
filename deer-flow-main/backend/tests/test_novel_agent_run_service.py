from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.services.novel_agent_run_service import (
    NovelAgentRunService,
    NovelAgentTask,
)
from deerflow.runtime import END_SENTINEL, DisconnectMode, RunRecord, RunStatus


class _FakeBridge:
    async def subscribe(self, run_id: str, last_event_id=None):
        del last_event_id
        assert run_id == "run-1"
        yield SimpleNamespace(
            event="messages",
            data=[{"type": "AIMessageChunk", "content": "第一段"}, {"langgraph_node": "lead_agent"}],
        )
        yield SimpleNamespace(
            event="messages",
            data=[{"type": "tool", "content": "tool output"}, {}],
        )
        yield SimpleNamespace(
            event="messages",
            data=[{"type": "AIMessageChunk", "content": [{"text": "第二段"}]}, {}],
        )
        yield END_SENTINEL


@pytest.mark.asyncio
async def test_stream_task_builds_main_run_request_and_extracts_content():
    captured = {}

    async def _start_run(body, thread_id, request):
        del request
        captured["body"] = body
        captured["thread_id"] = thread_id
        return RunRecord(
            run_id="run-1",
            thread_id=thread_id,
            assistant_id=body.assistant_id,
            status=RunStatus.success,
            on_disconnect=DisconnectMode.continue_,
            metadata=body.metadata or {},
        )

    service = NovelAgentRunService(
        start_run_func=_start_run,
        stream_bridge_getter=lambda request: _FakeBridge(),
    )
    task = NovelAgentTask(
        prompt="写一个章节",
        user_id="u1",
        project_id="p1",
        chapter_id="c1",
        task_type="chapter_generate",
        model="model-a",
        runtime_provider="openai-compatible",
        runtime_base_url="http://127.0.0.1:8551/v1",
        runtime_api_key="sk-test",
        metadata={"context_sections": ["project_metadata"]},
        requested_skills=["novel-control-station"],
    )

    events = [event async for event in service.stream_task(request=SimpleNamespace(), task=task)]

    assert captured["thread_id"] == "novel-chapter_generate-c1"
    body = captured["body"]
    assert body.assistant_id == "lead_agent"
    assert body.input["messages"][0]["content"] == "写一个章节"
    assert body.config["configurable"]["include_novel"] is True
    assert body.config["configurable"]["model_name"] == "model-a"
    assert body.context["user_id"] == "u1"
    assert body.context["project_id"] == "p1"
    assert body.context["chapter_id"] == "c1"
    assert body.context["runtime_provider"] == "openai-compatible"
    assert body.context["runtime_base_url"] == "http://127.0.0.1:8551/v1"
    assert body.context["runtime_api_key"] == "sk-test"
    assert body.context["requested_novel_skills"] == ["novel-control-station"]
    assert body.metadata["source"] == "novel_migrated"
    assert body.metadata["context_sections"] == ["project_metadata"]
    assert [event.content for event in events if event.type == "content"] == ["第一段", "第二段"]


def test_extract_stream_content_ignores_non_assistant_chunks():
    assert NovelAgentRunService.extract_stream_content([{"type": "tool", "content": "nope"}, {}]) == ""
    assert NovelAgentRunService.extract_stream_content([{"role": "user", "content": "nope"}, {}]) == ""
    assert NovelAgentRunService.extract_stream_content([{"type": "AIMessageChunk", "content": "ok"}, {}]) == "ok"
