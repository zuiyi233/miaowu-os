from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.gateway.middleware.domain_protocol import DomainToolCall
from app.gateway.novel_migrated.api import prompt_workshop
from app.gateway.novel_migrated.services import prompt_service as prompt_service_module
from app.gateway.novel_migrated.services.json_helper import JSONHelper
from app.gateway.novel_migrated.services.prompt_service import PromptService
from deerflow.tools.builtins import novel_creation_tools


def test_prompt_workshop_config_import_is_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    call_counter = {"count": 0}
    fake_config = SimpleNamespace(WORKSHOP_MODE="server", INSTANCE_ID="instance-a")

    def _fake_import(name: str):
        assert name == "app.gateway.novel_migrated.core.config"
        call_counter["count"] += 1
        return fake_config

    monkeypatch.setattr(prompt_workshop.importlib, "import_module", _fake_import)
    prompt_workshop._get_runtime_config_module.cache_clear()

    assert prompt_workshop._is_workshop_server() is True
    assert prompt_workshop._get_user_identifier("user-1") == "instance-a:user-1"
    assert call_counter["count"] == 1


@pytest.mark.anyio
async def test_prompt_service_skips_db_lookup_for_inspiration_templates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(prompt_service_module, "_ENABLE_INSPIRATION_DB_LOOKUP", False)
    monkeypatch.setattr(PromptService, "_ensure_system_templates_loaded", classmethod(lambda cls: None))
    setattr(PromptService, "INSPIRATION_TITLE_SYSTEM", "system-template")

    class _FakeDB:
        async def execute(self, *_args, **_kwargs):
            raise AssertionError("should not query DB for inspiration template by default")

    result = await PromptService.get_template(
        template_key="INSPIRATION_TITLE_SYSTEM",
        user_id="user-1",
        db=_FakeDB(),
    )
    assert result == "system-template"


def test_json_helper_reuses_ai_service_cleaner(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def _fake_cleaner(text: str) -> str:
        calls.append(text)
        return '{"ok": true}'

    monkeypatch.setattr("app.gateway.novel_migrated.services.json_helper.AIService.clean_json_response", _fake_cleaner)

    result = JSONHelper.clean_and_parse("```json\n{\"ok\": true}\n```")
    assert result == {"ok": True}
    assert calls == ["```json\n{\"ok\": true}\n```"]


def test_domain_tool_call_from_dict_normalizes_invalid_fields() -> None:
    tool_call = DomainToolCall.from_dict({"name": 123, "args": None, "id": "   "})
    assert tool_call.name == "123"
    assert tool_call.args == {}
    assert tool_call.id.startswith("call_")


def test_generate_outline_reuses_common_endpoint_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def _fake_post_json(url: str, payload: dict):
        captured["url"] = url
        captured["payload"] = payload
        return {"task_id": "t-1"}

    monkeypatch.setattr(novel_creation_tools, "check_idempotency", lambda *_args, **_kwargs: {"is_duplicate": False})
    monkeypatch.setattr(novel_creation_tools, "get_base_url", lambda: "http://example.local")
    monkeypatch.setattr(novel_creation_tools, "post_json", _fake_post_json)

    create_result = asyncio.run(
        novel_creation_tools.generate_outline.coroutine(
            project_id="p-1",
            chapter_count=8,
            requirements="需高潮",
            continue_from="",
        )
    )
    assert captured["url"] == "http://example.local/outlines/project/p-1"
    assert captured["payload"] == {
        "project_id": "p-1",
        "title": "",
        "content": "",
        "chapter_count": 8,
        "requirements": "需高潮",
    }
    assert create_result["source"] == "novel_migrated.outline_create"

    continue_result = asyncio.run(
        novel_creation_tools.generate_outline.coroutine(
            project_id="p-1",
            chapter_count=8,
            requirements="需高潮",
            continue_from="chapter 5",
        )
    )
    assert captured["url"] == "http://example.local/outlines/continue"
    assert captured["payload"] == {
        "project_id": "p-1",
        "chapter_count": 8,
        "requirements": "需高潮",
    }
    assert continue_result["source"] == "novel_migrated.outline_continue"
