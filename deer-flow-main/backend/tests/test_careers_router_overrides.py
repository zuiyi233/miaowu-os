from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import Request

from app.gateway.novel_migrated.api import careers


def _fake_request() -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "headers": [],
    }
    return Request(scope)


def test_generate_career_system_forwards_ai_overrides(monkeypatch):
    captured: dict[str, object] = {}

    async def _fake_get_service(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(generate_text_stream=AsyncMock(), _clean_json_response=lambda x: x)

    monkeypatch.setattr(careers, "get_user_ai_service_with_overrides", _fake_get_service)
    monkeypatch.setattr(careers, "create_sse_response", lambda generator: generator)

    fake_db = SimpleNamespace()
    stream = asyncio.run(
        careers.generate_career_system(
            project_id="proj-1",
            module_id="novel-careers",
            ai_provider_id="provider-1",
            ai_model="model-1",
            http_request=_fake_request(),
            db=fake_db,
            user_id="u-1",
        )
    )

    assert stream is not None
    assert captured["module_id"] == "novel-careers"
    assert captured["ai_provider_id"] == "provider-1"
    assert captured["ai_model"] == "model-1"
