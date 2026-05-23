from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.api.author_control import (
    SceneCardPayload,
    ScenePlanRequest,
    create_scene,
    list_scenes,
    plan_scenes,
    reorder_scenes,
    SceneReorderRequest,
)
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.novel_agent_run_service import NovelRunResult


class _FakeRunService:
    def __init__(self) -> None:
        self.calls = []

    async def run_task(self, *, request, task):
        self.calls.append(task)
        return NovelRunResult(
            run_id="run-1",
            thread_id="thread-1",
            status="success",
            content='[{"title":"开门","scene_goal":"主角进入暗门","conflict":"守卫阻拦","emotional_turn":"从犹豫到决断"}]',
            state={},
            metadata={},
        )


@pytest.mark.asyncio
async def test_scene_crud_reorder_and_plan_uses_agent(monkeypatch, novel_main_sqlite_engine):
    await init_db_schema()
    async with AsyncSessionLocal() as db:
        db.add(Project(id="p1", user_id="u1", title="雾城"))
        await db.commit()
        db.add(Chapter(id="c1", project_id="p1", chapter_number=1, title="暗门"))
        await db.commit()

        async def _noop(*args, **kwargs):
            return None

        monkeypatch.setattr("app.gateway.novel_migrated.api.author_control._sync_summary_to_workspace", _noop)
        service = _FakeRunService()
        planned = await plan_scenes(
            "p1",
            "c1",
            ScenePlanRequest(user_instruction="计划一场潜入戏", scene_count=3),
            request=SimpleNamespace(),
            user_id="u1",
            db=db,
            novel_agent_run_service=service,
        )
        assert service.calls[0].task_type == "plan_scenes"
        assert planned["items"][0]["title"] == "开门"

        created = await create_scene(
            SceneCardPayload(project_id="p1", chapter_id="c1", title="补一场", scene_goal="补足动机"),
            user_id="u1",
            db=db,
        )
        await reorder_scenes(
            SceneReorderRequest(items=[{"id": created["id"], "order_index": 9}]),
            user_id="u1",
            db=db,
        )
        listed = await list_scenes("p1", "c1", user_id="u1", db=db)

    assert any(item["id"] == created["id"] and item["order_index"] == 9 for item in listed["items"])
