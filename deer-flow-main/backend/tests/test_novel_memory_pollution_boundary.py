import pytest

from app.gateway.novel_migrated.services.novel_context_assembler import (
    NovelContextAssembler,
    NovelContextRequest,
)
from app.gateway.novel_migrated.models.project import Project


@pytest.mark.asyncio
async def test_chapter_body_plot_facts_stay_in_novel_context_not_main_memory():
    project = Project(id="p1", user_id="u1", title="雾城")
    assembler = NovelContextAssembler()
    result = await assembler.assemble(
        request=NovelContextRequest(
            user_id="u1",
            project=project,
            recent_context={"chapter_body": "角色在第三章拿到铜钥匙"},
            main_memory_context="用户偏好第一人称紧张叙事",
            current_request="续写",
        )
    )

    assert "角色在第三章拿到铜钥匙" in result.prompt
    assert result.metadata["memory_policy"] == "main_user_memory_for_preferences__novel_rag_for_work_context"
    assert result.sections[0][0] == "user_long_term_memory"
    assert "铜钥匙" not in result.sections[0][1]
