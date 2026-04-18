from __future__ import annotations

import json
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete

from app.gateway.novel_migrated.api import wizard_stream
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.project import Project


async def _clear_user_projects(user_id: str) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Project).where(Project.user_id == user_id))
        await session.commit()


def _extract_result_project_id(sse_text: str) -> str:
    for line in sse_text.splitlines():
        if not line.startswith('data: '):
            continue
        payload = json.loads(line[6:])
        if payload.get('type') == 'result':
            return str(payload.get('data', {}).get('project_id', ''))
    return ''


@pytest.mark.anyio
async def test_wizard_stream_world_building_and_project_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    user_id = f"wizard-test-{uuid.uuid4()}"
    await init_db_schema()
    await _clear_user_projects(user_id)

    app = FastAPI()
    app.include_router(wizard_stream.router)

    monkeypatch.setattr(wizard_stream, 'get_user_id', lambda request: user_id)

    async def fake_ensure_project_default_style(*, db, project_id: str) -> None:
        _ = (db, project_id)

    async def fake_generate_world(*, db, user_id: str, project: Project, progress_callback=None, progress_range=(0, 100), raise_on_error=False):
        _ = (db, user_id, raise_on_error)
        project.world_time_period = '未来纪元'
        project.world_location = '环城聚落'
        project.world_atmosphere = '压抑与希望并存'
        project.world_rules = '资源配额与职业等级制度'
        if progress_callback:
            await progress_callback('生成世界观中', progress_range[0] + 10, 'processing')
        return 1

    monkeypatch.setattr(wizard_stream.book_import_service, '_ensure_project_default_style', fake_ensure_project_default_style)
    monkeypatch.setattr(wizard_stream.book_import_service, '_generate_world_building_from_project', fake_generate_world)

    payload = {
        'title': '群星裂隙',
        'description': '旧城寻找真相',
        'theme': '成长与背叛',
        'genre': ['科幻', '悬疑'],
        'narrative_perspective': 'third_person',
        'target_words': 120000,
        'chapter_count': 36,
        'character_count': 8,
        'outline_mode': 'one-to-many',
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url='http://testserver') as client:
        response = await client.post('/api/wizard-stream/world-building', json=payload)
        assert response.status_code == 200
        assert '"type": "progress"' in response.text
        assert '"type": "result"' in response.text
        assert '"type": "complete"' in response.text

        project_id = _extract_result_project_id(response.text)
        assert project_id

        detail_response = await client.get(f'/api/projects/{project_id}')
        assert detail_response.status_code == 200
        detail = detail_response.json()
        assert detail['wizard_step'] == 1
        assert detail['world_time_period'] == '未来纪元'
        assert detail['outline_mode'] == 'one-to-many'

    await _clear_user_projects(user_id)
