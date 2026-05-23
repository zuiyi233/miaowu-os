import pytest

from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.novel_context_assembler import (
    NovelContextAssembler,
    NovelContextRequest,
)


@pytest.mark.asyncio
async def test_novel_context_assembler_orders_memory_project_recent_rag_request():
    async def _rag(user_id: str, project_id: str, query: str, limit: int):
        assert user_id == "u1"
        assert project_id == "p1"
        assert query == "find this"
        assert limit == 8
        return [{"id": "m1", "content": "伏笔：钥匙还未回收", "metadata": {"title": "伏笔"}}]

    project = Project(id="p1", user_id="u1", title="雾城", genre="悬疑", theme="身份")
    chapter = Chapter(id="c1", project_id="p1", chapter_number=2, title="暗门")
    assembler = NovelContextAssembler(rag_retriever=_rag)

    result = await assembler.assemble(
        request=NovelContextRequest(
            user_id="u1",
            project=project,
            chapter=chapter,
            main_memory_context="用户偏好第一人称紧张叙事",
            recent_context={"previous": "上一章发现脚印"},
            current_request="写第二章",
            rag_query="find this",
        )
    )

    prompt = result.prompt
    assert prompt.index("<user_long_term_memory>") < prompt.index("<project_metadata>")
    assert prompt.index("<project_metadata>") < prompt.index("<recent_novel_context>")
    assert prompt.index("<recent_novel_context>") < prompt.index("<novel_rag_results>")
    assert prompt.index("<novel_rag_results>") < prompt.index("<current_request>")
    assert "用户偏好第一人称紧张叙事" in prompt
    assert "伏笔：钥匙还未回收" in prompt
    assert result.metadata["project_id"] == "p1"
    assert result.metadata["chapter_id"] == "c1"
    assert result.metadata["memory_policy"] == "main_user_memory_for_preferences__novel_rag_for_work_context"


@pytest.mark.asyncio
async def test_novel_context_assembler_truncates_with_section_order_preserved():
    project = Project(id="p1", user_id="u1", title="长文项目")
    chapter = Chapter(id="c1", project_id="p1", chapter_number=1, title="开场")
    assembler = NovelContextAssembler()

    result = await assembler.assemble(
        request=NovelContextRequest(
            user_id="u1",
            project=project,
            chapter=chapter,
            main_memory_context="A" * 1500,
            current_request="B" * 1500,
            max_chars=1000,
        )
    )

    assert len(result.prompt) <= 1050
    assert result.prompt.startswith("<user_long_term_memory>")
    assert "[truncated]" in result.prompt
