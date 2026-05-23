from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.api import novel_stream
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.novel_agent_run_service import NovelRunStreamEvent


class _ExplodingAIService:
    async def generate_text_stream(self, **kwargs):
        raise AssertionError("legacy AIService.generate_text_stream should not be called")
        yield ""


class _FakeNovelAgentRunService:
    def __init__(self, *, expected_task_type: str = "chapter_generate") -> None:
        self.expected_task_type = expected_task_type

    async def stream_task(self, *, request, task):
        assert request.marker == "http-request"
        assert task.user_id == "u1"
        assert task.project_id == "p1"
        assert task.chapter_id == "c1"
        assert task.task_type == self.expected_task_type
        yield NovelRunStreamEvent(type="metadata", run_id="run-1", thread_id="thread-1")
        yield NovelRunStreamEvent(type="content", run_id="run-1", thread_id="thread-1", content="新正文")
        yield NovelRunStreamEvent(type="end", run_id="run-1", thread_id="thread-1")


@pytest.mark.asyncio
async def test_generate_single_chapter_stream_uses_agent_adapter_not_ai_service(monkeypatch):
    project = Project(id="p1", user_id="u1", title="雾城", genre="悬疑")
    chapter = Chapter(id="c1", project_id="p1", chapter_number=1, title="暗门", content="", word_count=0)
    persisted = {}

    async def _none(*args, **kwargs):
        return None

    async def _characters(*args, **kwargs):
        return []

    async def _persist(**kwargs):
        persisted.update(kwargs)
        kwargs["chapter"].content = kwargs["generated_content"]
        kwargs["chapter"].word_count = len(kwargs["generated_content"])
        kwargs["chapter"].status = "completed"

    monkeypatch.setattr(novel_stream, "_resolve_outline_for_chapter", _none)
    monkeypatch.setattr(novel_stream, "_resolve_previous_chapter", _none)
    monkeypatch.setattr(novel_stream, "_build_style_content", _none)
    monkeypatch.setattr(novel_stream, "_collect_project_characters", _characters)
    monkeypatch.setattr(novel_stream, "_persist_generated_content", _persist)

    events = [
        item
        async for item in novel_stream._generate_single_chapter_stream(
            db=SimpleNamespace(),
            project=project,
            chapter=chapter,
            ai_service=_ExplodingAIService(),
            request=novel_stream.ChapterGenerateStreamRequest(target_word_count=500),
            append_mode=False,
            continue_mode=False,
            http_request=SimpleNamespace(marker="http-request"),
            novel_agent_run_service=_FakeNovelAgentRunService(),
            style_user_id_override="u1",
        )
    ]

    assert persisted["generated_content"] == "新正文"
    assert any('"content": "新正文"' in event for event in events)
    assert any('"run_id": "run-1"' in event for event in events)


@pytest.mark.asyncio
async def test_continue_single_chapter_stream_uses_agent_adapter_not_ai_service(monkeypatch):
    project = Project(id="p1", user_id="u1", title="雾城", genre="悬疑")
    chapter = Chapter(id="c1", project_id="p1", chapter_number=1, title="暗门", content="旧正文", word_count=3)
    persisted = {}

    async def _none(*args, **kwargs):
        return None

    async def _characters(*args, **kwargs):
        return []

    async def _persist(**kwargs):
        persisted.update(kwargs)
        kwargs["chapter"].content = f"{kwargs['chapter'].content}{kwargs['generated_content']}"
        kwargs["chapter"].word_count = len(kwargs["chapter"].content)
        kwargs["chapter"].status = "completed"

    monkeypatch.setattr(novel_stream, "_resolve_outline_for_chapter", _none)
    monkeypatch.setattr(novel_stream, "_resolve_previous_chapter", _none)
    monkeypatch.setattr(novel_stream, "_collect_project_characters", _characters)
    monkeypatch.setattr(novel_stream, "_persist_generated_content", _persist)

    events = [
        item
        async for item in novel_stream._generate_single_chapter_stream(
            db=SimpleNamespace(),
            project=project,
            chapter=chapter,
            ai_service=_ExplodingAIService(),
            request=novel_stream.ChapterContinueStreamRequest(target_word_count=500),
            append_mode=True,
            continue_mode=True,
            http_request=SimpleNamespace(marker="http-request"),
            novel_agent_run_service=_FakeNovelAgentRunService(expected_task_type="chapter_continue"),
            style_user_id_override="u1",
        )
    ]

    assert persisted["append_mode"] is True
    assert persisted["generated_content"] == "新正文"
    assert chapter.content == "旧正文新正文"
    assert any('"content": "新正文"' in event for event in events)
