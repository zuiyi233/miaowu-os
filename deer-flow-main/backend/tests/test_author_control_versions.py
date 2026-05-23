from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.api.author_control import (
    ReviseRequest,
    accept_version,
    list_versions,
    reject_version,
    revise_chapter,
    rollback_version,
)
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.novel_agent_run_service import NovelRunResult


class _FakeRunService:
    async def run_task(self, *, request, task):
        return NovelRunResult(
            run_id="run-revise",
            thread_id="thread-1",
            status="success",
            content="新正文\n第二段",
            state={},
            metadata={},
        )


@pytest.mark.asyncio
async def test_revise_accept_reject_and_rollback(monkeypatch, novel_main_sqlite_engine):
    await init_db_schema()
    async with AsyncSessionLocal() as db:
        db.add(Project(id="p1", user_id="u1", title="雾城"))
        await db.commit()
        db.add(Chapter(id="c1", project_id="p1", chapter_number=1, title="暗门", content="旧正文"))
        await db.commit()

        async def _noop(*args, **kwargs):
            return None

        monkeypatch.setattr("app.gateway.novel_migrated.api.author_control._sync_chapter_document", _noop)
        monkeypatch.setattr("app.gateway.novel_migrated.api.author_control._sync_summary_to_workspace", _noop)

        result = await revise_chapter(
            "c1",
            ReviseRequest(instruction="加强冲突"),
            request=SimpleNamespace(),
            user_id="u1",
            db=db,
            novel_agent_run_service=_FakeRunService(),
        )
        version_id = result["version"]["id"]
        versions = await list_versions("c1", user_id="u1", db=db)
        assert versions["items"][0]["status"] == "candidate"

        rejected = await reject_version(version_id, user_id="u1", db=db)
        assert rejected["version"]["status"] == "rejected"

        result2 = await revise_chapter(
            "c1",
            ReviseRequest(instruction="重新修订"),
            request=SimpleNamespace(),
            user_id="u1",
            db=db,
            novel_agent_run_service=_FakeRunService(),
        )
        accepted = await accept_version(result2["version"]["id"], user_id="u1", db=db)
        assert accepted["version"]["status"] == "accepted"
        chapter = await db.get(Chapter, "c1")
        assert chapter.content == "新正文\n第二段"

        rolled_back = await rollback_version(result2["version"]["id"], user_id="u1", db=db)
        assert rolled_back["version"]["status"] == "rolled_back"
        await db.refresh(chapter)
        assert chapter.content == "旧正文"
