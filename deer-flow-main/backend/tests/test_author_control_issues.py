from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.api.author_control import (
    CritiqueRequest,
    IssueUpdateRequest,
    critique_chapter,
    update_issue,
)
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.novel_agent_run_service import NovelRunResult


class _FakeRunService:
    async def run_task(self, *, request, task):
        return NovelRunResult(
            run_id="run-critique",
            thread_id="thread-1",
            status="success",
            content=(
                '[{"issue_type":"fact","severity":"critical","title":"无证据严重问题",'
                '"description":"缺证据应降级","evidence_text":"","suggestion":"补证据"},'
                '{"issue_type":"timeline","severity":"high","title":"时间冲突",'
                '"description":"前后不一致","evidence_text":"他说昨日已离城",'
                '"conflicting_fact":"角色当天仍在城内","suggestion":"改为今日"}]'
            ),
            state={},
            metadata={},
        )


@pytest.mark.asyncio
async def test_critique_saves_evidence_based_issues_and_downgrades_high_without_evidence(novel_main_sqlite_engine):
    await init_db_schema()
    async with AsyncSessionLocal() as db:
        db.add(Project(id="p1", user_id="u1", title="雾城"))
        await db.commit()
        db.add(Chapter(id="c1", project_id="p1", chapter_number=1, title="暗门", content="他说昨日已离城"))
        await db.commit()

        result = await critique_chapter(
            "p1",
            "c1",
            CritiqueRequest(instruction="查一致性"),
            request=SimpleNamespace(),
            user_id="u1",
            db=db,
            novel_agent_run_service=_FakeRunService(),
        )
        first, second = result["items"]
        assert first["severity"] == "medium"
        assert second["severity"] == "high"
        assert second["evidence_text"] == "他说昨日已离城"

        updated = await update_issue(
            second["id"],
            IssueUpdateRequest(status="ignored"),
            user_id="u1",
            db=db,
        )
        assert updated["status"] == "ignored"
