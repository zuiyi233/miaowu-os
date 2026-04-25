from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.gateway.novel_migrated.services import book_import_service as book_import_service_module


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
