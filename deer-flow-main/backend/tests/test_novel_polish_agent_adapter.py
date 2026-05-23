from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.api.polish import PolishRequest, polish_text
from app.gateway.novel_migrated.services.novel_agent_run_service import NovelRunResult


class _FakeNovelAgentRunService:
    def __init__(self) -> None:
        self.calls = []

    async def run_task(self, *, request, task):
        assert request.marker == "http-request"
        self.calls.append(task)
        return NovelRunResult(
            run_id="run-1",
            thread_id="thread-1",
            status="success",
            content="润色后的文本",
            state={},
            metadata={},
        )


@pytest.mark.asyncio
async def test_polish_text_uses_main_agent_adapter():
    service = _FakeNovelAgentRunService()

    response = await polish_text(
        PolishRequest(text="原文", instructions="更紧张", style="vivid"),
        request=SimpleNamespace(marker="http-request"),
        user_id="u1",
        novel_agent_run_service=service,
    )

    assert response.original_text == "原文"
    assert response.polished_text == "润色后的文本"
    assert service.calls
    task = service.calls[0]
    assert task.user_id == "u1"
    assert task.task_type == "polish"
    assert task.module_id == "novel-polish"
    assert task.metadata["style"] == "vivid"
    assert "更紧张" in task.prompt
