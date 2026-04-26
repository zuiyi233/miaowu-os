from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.gateway.novel_migrated.services import book_import_service as book_import_service_module
from app.gateway.novel_migrated.schemas.book_import import (
    BookImportApplyRequest,
    BookImportChapter,
    BookImportOutline,
    BookImportPreviewResponse,
    BookImportRetryRequest,
    ProjectSuggestion,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


class _FakeDB:
    def __init__(self, settings, mcp_plugins):
        self._settings = settings
        self._mcp_plugins = mcp_plugins
        self._execute_calls = 0

    async def execute(self, _stmt):
        self._execute_calls += 1
        if self._execute_calls == 1:
            return _ScalarResult(self._settings)
        return _ScalarsResult(self._mcp_plugins)

    def add(self, _obj):
        raise AssertionError("unexpected db.add call in this test")

    async def flush(self):
        raise AssertionError("unexpected db.flush call in this test")


@pytest.mark.asyncio
async def test_build_user_ai_service_uses_provider_override_and_explicit_model(monkeypatch):
    settings = SimpleNamespace(
        user_id="u-1",
        api_provider="openai",
        api_key="enc-top-level",
        api_base_url="https://api.openai.com/v1",
        llm_model="gpt-4o-mini",
        temperature=0.7,
        max_tokens=2000,
        system_prompt="hello",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "providers": [
                        {
                            "id": "p-openai",
                            "provider": "openai",
                            "base_url": "https://api.openai.com/v1",
                            "models": ["gpt-4o-mini"],
                            "api_key_encrypted": "enc-openai",
                            "temperature": 0.2,
                            "max_tokens": 512,
                        },
                        {
                            "id": "p-deepseek",
                            "provider": "custom",
                            "base_url": "https://api.deepseek.com/v1",
                            "models": ["deepseek-chat", "deepseek-reasoner"],
                            "api_key_encrypted": "enc-deepseek",
                            "temperature": 0.1,
                            "max_tokens": 8192,
                        },
                    ]
                }
            }
        ),
    )
    fake_db = _FakeDB(settings=settings, mcp_plugins=[])
    captured_kwargs: dict[str, object] = {}

    monkeypatch.setattr(
        book_import_service_module,
        "safe_decrypt",
        lambda value: f"dec:{value}" if value else "",
    )

    def _fake_create_user_ai_service_with_mcp(**kwargs):
        captured_kwargs.update(kwargs)
        return object()

    monkeypatch.setattr(
        book_import_service_module,
        "create_user_ai_service_with_mcp",
        _fake_create_user_ai_service_with_mcp,
    )

    await book_import_service_module.book_import_service._build_user_ai_service(
        db=fake_db,
        user_id="u-1",
        ai_provider_id="p-deepseek",
        ai_model="deepseek-r1",
    )

    assert captured_kwargs["api_provider"] == "custom"
    assert captured_kwargs["api_base_url"] == "https://api.deepseek.com/v1"
    assert captured_kwargs["api_key"] == "dec:enc-deepseek"
    assert captured_kwargs["model_name"] == "deepseek-r1"
    assert captured_kwargs["temperature"] == 0.1
    assert captured_kwargs["max_tokens"] == 8192


@pytest.mark.asyncio
async def test_build_user_ai_service_uses_provider_default_model_when_ai_model_absent(monkeypatch):
    settings = SimpleNamespace(
        user_id="u-2",
        api_provider="openai",
        api_key="enc-top-level",
        api_base_url="https://api.openai.com/v1",
        llm_model="gpt-4o-mini",
        temperature=0.7,
        max_tokens=2000,
        system_prompt="hello",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "providers": [
                        {
                            "id": "p-custom",
                            "provider": "custom",
                            "base_url": "https://api.example.com/v1",
                            "models": ["custom-fast", "custom-strong"],
                            "api_key_encrypted": "enc-custom",
                        }
                    ]
                }
            }
        ),
    )
    fake_db = _FakeDB(settings=settings, mcp_plugins=[])
    captured_kwargs: dict[str, object] = {}

    monkeypatch.setattr(
        book_import_service_module,
        "safe_decrypt",
        lambda value: f"dec:{value}" if value else "",
    )

    def _fake_create_user_ai_service_with_mcp(**kwargs):
        captured_kwargs.update(kwargs)
        return object()

    monkeypatch.setattr(
        book_import_service_module,
        "create_user_ai_service_with_mcp",
        _fake_create_user_ai_service_with_mcp,
    )

    await book_import_service_module.book_import_service._build_user_ai_service(
        db=fake_db,
        user_id="u-2",
        ai_provider_id="p-custom",
        ai_model=None,
    )

    assert captured_kwargs["api_provider"] == "custom"
    assert captured_kwargs["model_name"] == "custom-fast"
    assert captured_kwargs["api_key"] == "dec:enc-custom"


@pytest.mark.asyncio
async def test_apply_import_stream_forwards_ai_overrides_to_generation_steps(monkeypatch):
    service = book_import_service_module.book_import_service

    task = SimpleNamespace(
        status="completed",
        preview=BookImportPreviewResponse(
            task_id="task-1",
            project_suggestion=ProjectSuggestion(title="书名"),
            chapters=[],
            outlines=[],
            warnings=[],
        ),
        extract_mode="tail",
        tail_chapter_count=10,
        imported_project_id=None,
        failed_steps=[],
    )

    monkeypatch.setattr(service, "_get_task", AsyncMock(return_value=task))
    monkeypatch.setattr(service, "_select_chapters_for_import", lambda **kwargs: (kwargs["chapters"], kwargs["outlines"], False))
    monkeypatch.setattr(service, "_prepare_project", AsyncMock(return_value=SimpleNamespace(id="proj-1", current_words=0, character_count=8, wizard_step=0, wizard_status="", status="")))
    monkeypatch.setattr(service, "_import_outlines", AsyncMock(return_value={}))
    monkeypatch.setattr(service, "_import_chapters", AsyncMock(return_value=(1, 2000)))

    captured: dict[str, list[tuple[str | None, str | None, str | None]]] = {"calls": []}

    async def _capture_world(*, module_id=None, ai_provider_id=None, ai_model=None, **kwargs):
        captured["calls"].append((module_id, ai_provider_id, ai_model))
        return 1

    async def _capture_career(*, module_id=None, ai_provider_id=None, ai_model=None, **kwargs):
        captured["calls"].append((module_id, ai_provider_id, ai_model))
        return 2

    async def _capture_characters(*, module_id=None, ai_provider_id=None, ai_model=None, **kwargs):
        captured["calls"].append((module_id, ai_provider_id, ai_model))
        return 3

    monkeypatch.setattr(service, "_generate_world_building_from_project", _capture_world)
    monkeypatch.setattr(service, "_generate_career_system_from_project", _capture_career)
    monkeypatch.setattr(service, "_generate_characters_and_organizations_from_project", _capture_characters)

    fake_db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    payload = BookImportApplyRequest(
        project_suggestion=ProjectSuggestion(title="书名"),
        chapters=[BookImportChapter(title="第一章", chapter_number=1, content="正文")],
        outlines=[BookImportOutline(title="大纲1", order_index=1)],
        module_id="novel-book-import",
        ai_provider_id="provider-1",
        ai_model="model-1",
    )

    result = await service.apply_import_stream(
        task_id="task-1",
        user_id="u-1",
        payload=payload,
        db=fake_db,
        module_id=payload.module_id,
        ai_provider_id=payload.ai_provider_id,
        ai_model=payload.ai_model,
    )

    assert result.success is True
    assert captured["calls"] == [
        ("novel-book-import", "provider-1", "model-1"),
        ("novel-book-import", "provider-1", "model-1"),
        ("novel-book-import", "provider-1", "model-1"),
    ]


@pytest.mark.asyncio
async def test_retry_failed_steps_stream_forwards_ai_overrides(monkeypatch):
    service = book_import_service_module.book_import_service
    step_failure = book_import_service_module._StepFailure(
        step_name="world_building",
        step_label="世界观生成",
        error_message="failed",
    )
    task = SimpleNamespace(
        imported_project_id="proj-1",
        failed_steps=[step_failure],
    )

    monkeypatch.setattr(service, "_get_task", AsyncMock(return_value=task))

    async def _fake_verify_project_access(_project_id, _user_id, _db):
        return SimpleNamespace(character_count=8)

    monkeypatch.setattr("app.gateway.novel_migrated.api.common.verify_project_access", _fake_verify_project_access)

    captured: list[tuple[str | None, str | None, str | None]] = []

    async def _capture_world(*, module_id=None, ai_provider_id=None, ai_model=None, **kwargs):
        captured.append((module_id, ai_provider_id, ai_model))
        return 1

    monkeypatch.setattr(service, "_generate_world_building_from_project", _capture_world)
    monkeypatch.setattr(service, "_generate_career_system_from_project", AsyncMock(return_value=0))
    monkeypatch.setattr(service, "_generate_characters_and_organizations_from_project", AsyncMock(return_value=0))

    fake_db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

    result = await service.retry_failed_steps_stream(
        task_id="task-1",
        user_id="u-1",
        steps_to_retry=["world_building"],
        db=fake_db,
        module_id="novel-book-import",
        ai_provider_id="provider-2",
        ai_model="model-2",
    )

    assert result["success"] is True
    assert captured == [("novel-book-import", "provider-2", "model-2")]
