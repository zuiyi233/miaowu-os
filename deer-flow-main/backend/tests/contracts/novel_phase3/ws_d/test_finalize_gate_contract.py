from __future__ import annotations

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.gateway.novel_migrated.api import polish
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.project import Project


async def _cleanup_project(project_id: str) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.commit()


@pytest.mark.anyio
async def test_finalize_gate_contract_shape() -> None:
    await init_db_schema()
    user_id = f"ws-d-contract-user-{uuid.uuid4()}"
    chapter_content = "主角在旧城区追查线索，章节完整且可读。"

    async with AsyncSessionLocal() as session:
        project = Project(user_id=user_id, title="WS-D 合约测试")
        session.add(project)
        await session.flush()

        chapter = Chapter(
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content=chapter_content,
            word_count=len(chapter_content),
            status="completed",
        )
        session.add(chapter)
        await session.flush()

        session.add(
            PlotAnalysis(
                project_id=project.id,
                chapter_id=chapter.id,
                overall_quality_score=8.0,
            )
        )
        await session.commit()

    app = FastAPI()
    app.include_router(polish.router)
    app.dependency_overrides[polish.get_user_id] = lambda: user_id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            f"/api/polish/projects/{project.id}/finalize-gate",
            json={
                "min_chapter_length_warn": 1,
                "min_chapter_length_block": 1,
            },
        )
        assert response.status_code == 200
        payload = response.json()

    try:
        for key in ("project_id", "checked_at", "result", "can_finalize", "summary", "checks", "config", "lifecycle"):
            assert key in payload
        assert payload["project_id"] == project.id
        assert isinstance(payload["checks"], list)
        assert isinstance(payload.get("gate_fusion"), dict)

        first_check = payload["checks"][0]
        for key in ("check_id", "title", "result", "message", "issue_count", "issues"):
            assert key in first_check
        assert "fusion" in first_check
    finally:
        await _cleanup_project(project.id)
