from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.api.author_control import ContextPreviewRequest, context_preview
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.project import Project


@pytest.mark.asyncio
async def test_author_control_context_preview_returns_rag_character_foreshadow(monkeypatch, novel_main_sqlite_engine):
    await init_db_schema()
    async with AsyncSessionLocal() as db:
        project = Project(id="p1", user_id="u1", title="雾城", genre="悬疑")
        db.add(project)
        await db.commit()
        chapter = Chapter(id="c1", project_id="p1", chapter_number=1, title="暗门", content="旧正文")
        db.add_all([
            chapter,
            Character(id="char1", project_id="p1", name="林澈", current_state="怀疑同伴"),
            Foreshadow(id="f1", project_id="p1", title="铜钥匙", content="钥匙尚未回收", status="planted"),
        ])
        await db.commit()

        async def _search_memories(user_id, project_id, query, limit=8, **kwargs):
            return [{"content": "RAG: 钥匙在第一章出现", "metadata": {"title": "铜钥匙"}}]

        monkeypatch.setattr("app.gateway.novel_migrated.api.author_control.memory_service.search_memories", _search_memories)
        payload = await context_preview(
            "p1",
            ContextPreviewRequest(chapter_id="c1", task_kind="continue", user_instruction="继续写"),
            user_id="u1",
            db=db,
        )

    assert payload["context_hash"]
    assert payload["rag_hits"][0]["content"] == "RAG: 钥匙在第一章出现"
    assert payload["character_states"][0]["current_state"] == "怀疑同伴"
    assert payload["foreshadows"][0]["title"] == "铜钥匙"
    assert "主 DeerFlow" in payload["user_memory_summary"]
