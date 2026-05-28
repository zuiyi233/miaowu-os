from __future__ import annotations

import json

from cryptography.fernet import Fernet
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.gateway.novel_migrated.api import settings as legacy_settings
from app.gateway.novel_migrated.api import user_settings
from app.gateway.novel_migrated.core import crypto
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.ai_settings_service import (
    get_ai_settings_service,
    resolve_user_ai_runtime_config,
)


def _enable_encryption_for_test() -> None:
    crypto._FERNET_KEY = Fernet.generate_key().decode()
    crypto._fernet = None


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self):
        self.settings = None
        self.commit_calls = 0
        self.refresh_calls = 0

    async def execute(self, _stmt):
        return _ScalarResult(self.settings)

    def add(self, obj):
        self.settings = obj

    async def commit(self):
        self.commit_calls += 1

    async def refresh(self, _obj):
        self.refresh_calls += 1


def _build_user_settings_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _inject_user(request: Request, call_next):
        request.state.user_id = "default_user"
        return await call_next(request)

    app.include_router(user_settings.router)
    app.dependency_overrides[user_settings.get_db] = lambda: fake_db
    return app


def _build_legacy_settings_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def _inject_user(request: Request, call_next):
        request.state.user_id = "default_user"
        return await call_next(request)

    app.include_router(legacy_settings.router)
    app.dependency_overrides[legacy_settings.get_db] = lambda: fake_db
    return app


def test_get_ai_settings_defaults_when_no_record() -> None:
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["providers"], list)
    assert data["client_settings"]["request_timeout"] == 660000
    assert data["api_provider"] == "openai"
    assert data["llm_model"] == "gpt-4"
    assert "api_key" not in json.dumps(data, ensure_ascii=False)

    # DB side effects: record + seeded bundle persisted.
    assert fake_db.settings is not None
    prefs = json.loads(fake_db.settings.preferences or "{}")
    if data["providers"]:
        assert data["default_provider_id"] is not None
        assert "ai_provider_settings" in prefs


def test_get_ai_settings_injects_managed_newapi_provider(monkeypatch) -> None:
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://newapi:3000/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-newapi-managed")
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    provider = data["providers"][0]
    assert provider["id"] == "newapi-managed"
    assert provider["name"] == "NewAPI（默认分组）"
    assert provider["is_managed"] is True
    assert provider["managed_by"] == "newapi"
    assert provider["has_api_key"] is True
    assert provider["managed_group"] == "default"
    assert "sk-newapi-managed" not in json.dumps(data, ensure_ascii=False)
    assert data["default_provider_id"] == "newapi-managed"


def test_get_ai_settings_auto_syncs_managed_newapi_models(monkeypatch) -> None:
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://newapi:3000/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-newapi-managed")

    async def _fake_fetch_managed_newapi_models(provider_id=None):
        assert provider_id == "newapi-managed"
        return ["newapi-model-a", "newapi-model-b"], {
            "default": ["newapi-model-a", "newapi-model-b"],
        }

    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.ai_settings_service.fetch_managed_newapi_models",
        _fake_fetch_managed_newapi_models,
    )

    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    provider = data["providers"][0]
    assert provider["id"] == "newapi-managed"
    assert provider["models"] == ["newapi-model-a", "newapi-model-b"]
    assert provider["model_groups"] == {"default": ["newapi-model-a", "newapi-model-b"]}
    assert provider["model_sync_status"] == "synced"
    assert provider["model_sync_error"] is None


def test_get_ai_settings_reports_managed_newapi_model_sync_empty(monkeypatch) -> None:
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://newapi:3000/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-newapi-managed")

    async def _fake_fetch_managed_newapi_models(provider_id=None):
        return [], {}

    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.ai_settings_service.fetch_managed_newapi_models",
        _fake_fetch_managed_newapi_models,
    )

    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    provider = resp.json()["providers"][0]
    assert provider["models"] == []
    assert provider["model_sync_status"] == "empty"
    assert "没有返回可用模型" in provider["model_sync_error"]


def test_get_ai_settings_preserves_synced_managed_newapi_models(monkeypatch) -> None:
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://newapi:3000/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-newapi-managed")

    async def _unexpected_fetch_managed_newapi_models(provider_id=None):
        raise AssertionError("synced NewAPI model list should not be overwritten by fallback sync")

    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.ai_settings_service.fetch_managed_newapi_models",
        _unexpected_fetch_managed_newapi_models,
    )

    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（默认分组）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["newapi-model-a"],
                            "is_active": True,
                            "api_key_encrypted": "sk-user-token",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["newapi-model-a"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        }
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            }
        ),
    )
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    provider = resp.json()["providers"][0]
    assert provider["models"] == ["newapi-model-a"]
    assert provider["model_sync_status"] == "synced"
    assert provider["model_sync_error"] is None


def test_get_ai_settings_preserves_oauth_newapi_group_providers_against_env_fallback(monkeypatch) -> None:
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://newapi:3000/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "env-default-key")

    async def _unexpected_fetch_managed_newapi_models(provider_id=None):
        raise AssertionError("OAuth NewAPI group providers must not be collapsed by env fallback")

    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.ai_settings_service.fetch_managed_newapi_models",
        _unexpected_fetch_managed_newapi_models,
    )

    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["default-model"],
                            "is_active": True,
                            "api_key_encrypted": "user-default-key",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["default-model"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                        {
                            "id": "newapi-managed-vip",
                            "name": "NewAPI（vip）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["vip-model"],
                            "is_active": False,
                            "api_key_encrypted": "user-vip-key",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "vip",
                            "model_groups": {"vip": ["vip-model"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                        {
                            "id": "newapi-managed-svip",
                            "name": "NewAPI（svip）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": [],
                            "is_active": False,
                            "api_key_encrypted": "user-svip-key",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "svip",
                            "model_groups": {},
                            "model_sync_status": "empty",
                            "model_sync_error": "NewAPI 分组 svip 没有返回可用模型",
                        },
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    providers = {provider["id"]: provider for provider in resp.json()["providers"]}
    assert set(providers) == {"newapi-managed", "newapi-managed-vip", "newapi-managed-svip"}
    assert providers["newapi-managed-vip"]["managed_group"] == "vip"
    assert providers["newapi-managed-vip"]["models"] == ["vip-model"]
    assert providers["newapi-managed-svip"]["managed_group"] == "svip"
    assert providers["newapi-managed-svip"]["models"] == []
    assert "env-default-key" not in json.dumps(resp.json(), ensure_ascii=False)


def test_get_ai_settings_injects_newapi_group_providers(monkeypatch) -> None:
    monkeypatch.setenv(
        "MIAOWU_NEWAPI_GROUPS_JSON",
        json.dumps(
            [
                {"id": "basic", "name": "基础组", "base_url": "http://newapi:3000/v1", "api_key": "sk-basic"},
                {"id": "vip", "name": "VIP组", "base_url": "http://newapi:3000/v1", "api_key": "sk-vip"},
            ],
            ensure_ascii=False,
        ),
    )
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    providers = {p["id"]: p for p in data["providers"]}
    assert providers["newapi-managed-basic"]["managed_group"] == "basic"
    assert providers["newapi-managed-vip"]["managed_group"] == "vip"
    assert providers["newapi-managed-basic"]["name"] == "NewAPI（基础组）"
    assert providers["newapi-managed-vip"]["name"] == "NewAPI（VIP组）"
    dumped = json.dumps(data, ensure_ascii=False)
    assert "sk-basic" not in dumped
    assert "sk-vip" not in dumped


def test_apply_managed_newapi_group_bootstrap_creates_group_scoped_providers() -> None:
    fake_db = _FakeDB()
    service = get_ai_settings_service()

    import anyio

    async def _run() -> dict:
        return await service.apply_managed_newapi_group_bootstrap(
            user_id="default_user",
            groups=[
                {
                    "group_id": "basic",
                    "name": "基础组",
                    "base_url": "http://127.0.0.1:3000/v1",
                    "api_key": "token-basic",
                    "models": ["basic-model"],
                    "model_groups": {"basic": ["basic-model"]},
                    "model_sync_status": "synced",
                    "model_sync_error": None,
                },
                {
                    "group_id": "vip",
                    "name": "VIP组",
                    "base_url": "http://127.0.0.1:3000/v1",
                    "api_key": "token-vip",
                    "models": ["vip-model-a", "vip-model-b"],
                    "model_groups": {"vip": ["vip-model-a", "vip-model-b"]},
                    "model_sync_status": "synced",
                    "model_sync_error": None,
                },
            ],
            db=fake_db,
        )

    data = anyio.run(_run)

    providers = {provider["id"]: provider for provider in data["providers"]}
    assert providers["newapi-managed-basic"]["managed_group"] == "basic"
    assert providers["newapi-managed-basic"]["models"] == ["basic-model"]
    assert providers["newapi-managed-basic"]["has_api_key"] is True
    assert providers["newapi-managed-vip"]["managed_group"] == "vip"
    assert providers["newapi-managed-vip"]["models"] == ["vip-model-a", "vip-model-b"]
    assert providers["newapi-managed-vip"]["has_api_key"] is True
    assert data["default_provider_id"] == "newapi-managed-basic"
    dumped = json.dumps(data, ensure_ascii=False)
    assert "token-basic" not in dumped
    assert "token-vip" not in dumped

    prefs = json.loads(fake_db.settings.preferences or "{}")
    stored = {provider["id"]: provider for provider in prefs["ai_provider_settings"]["providers"]}
    assert stored["newapi-managed-basic"]["api_key_encrypted"] == "token-basic"
    assert stored["newapi-managed-vip"]["api_key_encrypted"] == "token-vip"


def test_resolve_runtime_matches_explicit_model_to_synced_newapi_group_provider() -> None:
    settings = Settings(
        user_id="default_user",
        api_provider="openai",
        api_base_url="http://newapi:3000/v1",
        api_key="default-token",
        llm_model="default-model",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["default-model"],
                            "is_active": True,
                            "api_key_encrypted": "default-token",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["default-model"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                        {
                            "id": "newapi-managed-mimo",
                            "name": "NewAPI（MiMo）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["mimo-v2.5-pro"],
                            "is_active": False,
                            "api_key_encrypted": "mimo-token",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "mimo",
                            "model_groups": {"mimo": ["mimo-v2.5-pro"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )

    runtime, source = resolve_user_ai_runtime_config(settings, ai_model="mimo-v2.5-pro")

    assert source == "explicit-model-provider-match"
    assert runtime["model_name"] == "mimo-v2.5-pro"
    assert runtime["api_key"] == "mimo-token"


def test_resolve_runtime_module_routing_ignores_bare_explicit_model() -> None:
    settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["mimo-v2.5-pro"],
                            "is_active": True,
                            "api_key_encrypted": "global-pro-token",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["mimo-v2.5-pro"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                        {
                            "id": "newapi-managed-mimo25",
                            "name": "NewAPI（国产）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["mimo-v2.5"],
                            "is_active": False,
                            "api_key_encrypted": "suggestions-token",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "国产",
                            "model_groups": {"国产": ["mimo-v2.5"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": {
                        "defaultTarget": {"providerId": "newapi-managed", "model": "mimo-v2.5-pro"},
                        "modules": [
                            {
                                "moduleId": "chat-suggestions",
                                "currentMode": "primary",
                                "primaryTarget": {"providerId": "newapi-managed-mimo25", "model": "mimo-v2.5"},
                            }
                        ],
                    },
                }
            },
            ensure_ascii=False,
        ),
    )

    runtime, source = resolve_user_ai_runtime_config(
        settings,
        module_id="chat-suggestions",
        ai_model="mimo-v2.5-pro",
    )

    assert source == "feature-routing:chat-suggestions"
    assert runtime["model_name"] == "mimo-v2.5"
    assert runtime["api_key"] == "suggestions-token"


def test_apply_managed_newapi_group_bootstrap_replaces_stale_managed_providers() -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed-old",
                    "providers": [
                        {
                            "id": "newapi-managed-old",
                            "name": "NewAPI（old）",
                            "provider": "openai",
                            "base_url": "http://127.0.0.1:3000/v1",
                            "models": ["old-model"],
                            "is_active": True,
                            "api_key_encrypted": "token-old",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "old",
                            "model_groups": {"old": ["old-model"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        },
                        {
                            "id": "manual-provider",
                            "name": "Manual Provider",
                            "provider": "custom",
                            "base_url": "https://manual.example/v1",
                            "models": ["manual-model"],
                            "is_active": False,
                            "api_key_encrypted": "manual-token",
                            "is_managed": False,
                            "managed_by": None,
                            "managed_group": None,
                            "model_groups": {},
                            "model_sync_status": None,
                            "model_sync_error": None,
                        },
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )
    service = get_ai_settings_service()

    import anyio

    async def _run() -> dict:
        return await service.apply_managed_newapi_group_bootstrap(
            user_id="default_user",
            groups=[
                {
                    "group_id": "fresh",
                    "name": "Fresh",
                    "base_url": "http://127.0.0.1:3000/v1",
                    "api_key": "token-fresh",
                    "models": ["fresh-model"],
                    "model_groups": {"fresh": ["fresh-model"]},
                    "model_sync_status": "synced",
                    "model_sync_error": None,
                }
            ],
            db=fake_db,
        )

    data = anyio.run(_run)

    provider_ids = [provider["id"] for provider in data["providers"]]
    assert provider_ids == ["newapi-managed-fresh", "manual-provider"]
    assert data["default_provider_id"] == "newapi-managed-fresh"
    assert data["providers"][0]["is_active"] is True
    assert data["providers"][1]["is_active"] is False

    prefs = json.loads(fake_db.settings.preferences or "{}")
    stored_ids = [provider["id"] for provider in prefs["ai_provider_settings"]["providers"]]
    assert stored_ids == provider_ids
    dumped = json.dumps(prefs, ensure_ascii=False)
    assert "newapi-managed-old" not in dumped
    assert "token-old" not in dumped
    assert "manual-token" in dumped


def test_put_ai_settings_encrypts_key_and_mirrors_active_provider() -> None:
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    payload = {
        "default_provider_id": "p1",
        "client_settings": {
            "enable_stream_mode": False,
            "request_timeout": 123456,
            "max_retries": 3,
        },
        "feature_routing_settings": {
            "create_novel": {"provider_id": "p1", "model": "gpt-4o-mini"},
            "novel_tools": {"provider_id": "p2"},
        },
        "providers": [
            {
                "id": "p1",
                "name": "OpenAI",
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "models": ["gpt-4o-mini"],
                "is_active": True,
                "temperature": 0.2,
                "max_tokens": 55,
                "api_key": "sk-test-plaintext",
            },
            {
                "id": "p2",
                "name": "DeepSeek",
                "provider": "custom",
                "base_url": "https://api.deepseek.com/v1",
                "models": ["deepseek-chat"],
                "is_active": False,
                "temperature": 0.3,
                "max_tokens": 77,
            },
        ],
        "system_prompt": "hello",
    }

    with TestClient(app) as client:
        resp = client.put("/api/user/ai-settings", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["default_provider_id"] == "p1"
    assert data["client_settings"]["max_retries"] == 3
    assert data["feature_routing_settings"] == payload["feature_routing_settings"]
    assert data["api_provider"] == "openai"
    assert data["api_base_url"] == "https://api.openai.com/v1"
    assert data["llm_model"] == "gpt-4o-mini"
    assert data["system_prompt"] == "hello"

    providers = {p["id"]: p for p in data["providers"]}
    assert providers["p1"]["has_api_key"] is True
    assert "api_key" not in providers["p1"]

    # DB side effects: encrypted key persisted (not leaked back).
    assert fake_db.settings is not None
    assert fake_db.settings.api_provider == "openai"
    assert fake_db.settings.api_base_url == "https://api.openai.com/v1"
    assert fake_db.settings.llm_model == "gpt-4o-mini"
    assert fake_db.settings.api_key is not None
    assert fake_db.settings.api_key != "sk-test-plaintext"

    prefs = json.loads(fake_db.settings.preferences or "{}")
    stored = prefs["ai_provider_settings"]["providers"]
    stored_p1 = next(item for item in stored if item["id"] == "p1")
    assert stored_p1["api_key_encrypted"] == fake_db.settings.api_key
    assert prefs["ai_provider_settings"]["feature_routing_settings"] == payload["feature_routing_settings"]


def test_put_ai_settings_persists_provider_model_groups() -> None:
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    payload = {
        "default_provider_id": "newapi-managed",
        "providers": [
            {
                "id": "newapi-managed",
                "name": "NewAPI",
                "provider": "newapi",
                "base_url": "http://127.0.0.1:3000/v1",
                "models": ["default-model", "vip-model"],
                "model_groups": {
                    "default": ["default-model"],
                    "vip": ["vip-model"],
                },
                "is_active": True,
            }
        ],
    }

    with TestClient(app) as client:
        resp = client.put("/api/user/ai-settings", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    provider = data["providers"][0]
    assert provider["model_groups"] == {
        "default": ["default-model"],
        "vip": ["vip-model"],
    }

    prefs = json.loads(fake_db.settings.preferences or "{}")
    stored = prefs["ai_provider_settings"]["providers"][0]
    assert stored["model_groups"] == {
        "default": ["default-model"],
        "vip": ["vip-model"],
    }


def test_newapi_sync_groups_lists_catalog_and_existing_managed_provider(monkeypatch) -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": ["default-model"],
                            "is_active": True,
                            "api_key_encrypted": "token-default",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["default-model"]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        }
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )

    async def _fake_catalog(*, user_id, db):
        assert user_id == "default_user"
        assert db is fake_db
        return {
            "default": {"name": "默认分组", "models": ["default-model"]},
            "vip": {"name": "VIP分组", "models": ["vip-model"]},
        }, []

    monkeypatch.setattr(user_settings, "get_newapi_group_catalog_for_user", _fake_catalog)
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/newapi-sync/groups")

    assert resp.status_code == 200
    data = resp.json()
    groups = {item["group_id"]: item for item in data["groups"]}
    assert groups["default"]["already_synced"] is True
    assert groups["default"]["has_api_key"] is True
    assert groups["default"]["model_sync_status"] == "synced"
    assert groups["vip"]["already_synced"] is False
    assert groups["vip"]["model_count"] == 1
    assert "token-default" not in json.dumps(data, ensure_ascii=False)


def test_newapi_sync_groups_merges_catalog_display_name_with_existing_provider(monkeypatch) -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed-svip--pro-plus",
                    "providers": [
                        {
                            "id": "newapi-managed-svip--pro-plus",
                            "name": "NewAPI（svip-稳定渠道+Pro+plus+正规渠道）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": [f"svip-model-{index}" for index in range(6)],
                            "is_active": True,
                            "api_key_encrypted": "token-svip",
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "svip--pro-plus",
                            "model_groups": {"svip--pro-plus": [f"svip-model-{index}" for index in range(6)]},
                            "model_sync_status": "synced",
                            "model_sync_error": None,
                        }
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )

    async def _fake_catalog(*, user_id, db):
        assert user_id == "default_user"
        assert db is fake_db
        return {
            "svip-稳定渠道+Pro+plus+正规渠道": {
                "name": "svip-稳定渠道+Pro+plus+正规渠道",
                "models": [],
            },
        }, []

    monkeypatch.setattr(user_settings, "get_newapi_group_catalog_for_user", _fake_catalog)
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/newapi-sync/groups")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["groups"]) == 1
    group = data["groups"][0]
    assert group["group_id"] == "svip-稳定渠道+Pro+plus+正规渠道"
    assert group["name"] == "svip-稳定渠道+Pro+plus+正规渠道"
    assert group["already_synced"] is True
    assert group["has_api_key"] is True
    assert group["model_sync_status"] == "synced"
    assert group["model_count"] == 6
    assert "token-svip" not in json.dumps(data, ensure_ascii=False)


def test_newapi_sync_groups_omits_stale_managed_provider_when_catalog_changed(monkeypatch) -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed-svip--pro-plus",
                    "providers": [
                        {
                            "id": "newapi-managed-svip--pro-plus",
                            "name": "NewAPI（svip-稳定渠道+Pro+plus+正规渠道）",
                            "provider": "openai",
                            "base_url": "http://newapi:3000/v1",
                            "models": [],
                            "is_active": True,
                            "api_key_encrypted": None,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "svip--pro-plus",
                            "model_groups": {},
                            "model_sync_status": "error",
                            "model_sync_error": "NewAPI Hub 没有返回该分组的 API Token",
                        }
                    ],
                    "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )

    async def _fake_catalog(*, user_id, db):
        assert user_id == "default_user"
        assert db is fake_db
        return {
            "svip-稳定渠道+pro+plus+正规渠道": {
                "name": "svip-稳定渠道+pro+plus+正规渠道",
                "models": ["svip-model"],
            },
        }, []

    monkeypatch.setattr(user_settings, "get_newapi_group_catalog_for_user", _fake_catalog)
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/newapi-sync/groups")

    assert resp.status_code == 200
    data = resp.json()
    assert [item["group_id"] for item in data["groups"]] == ["svip-稳定渠道+pro+plus+正规渠道"]
    assert data["groups"][0]["already_synced"] is False
    assert data["groups"][0]["model_sync_status"] is None
    assert data["groups"][0]["model_sync_error"] is None
    dumped = json.dumps(data, ensure_ascii=False)
    assert "NewAPI Hub 没有返回该分组的 API Token" not in dumped


def test_newapi_sync_groups_applies_selected_and_manual_groups(monkeypatch) -> None:
    from app.gateway.auth.newapi_oauth import NewAPIManualGroupSyncItem, NewAPIManualGroupSyncResult

    fake_db = _FakeDB()

    async def _fake_sync(*, user_id, groups, manual_groups, db):
        assert user_id == "default_user"
        assert groups == ["default"]
        assert manual_groups == ["vip"]
        assert db is fake_db
        return NewAPIManualGroupSyncResult(
            results=(
                NewAPIManualGroupSyncItem(
                    group_id="default",
                    provider_id="newapi-managed",
                    model_count=1,
                    has_api_key=True,
                    status="synced",
                    error=None,
                ),
                NewAPIManualGroupSyncItem(
                    group_id="vip",
                    provider_id="newapi-managed-vip",
                    model_count=2,
                    has_api_key=True,
                    status="synced",
                    error=None,
                ),
            ),
            group_items=(),
        )

    monkeypatch.setattr(user_settings, "sync_newapi_groups_for_user", _fake_sync)
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/newapi-sync/groups",
            json={"groups": ["default"], "manual_groups": ["vip"]},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert [item["group_id"] for item in data["results"]] == ["default", "vip"]
    assert data["results"][1]["provider_id"] == "newapi-managed-vip"
    dumped = json.dumps(data, ensure_ascii=False)
    assert "token-default" not in dumped
    assert "token-vip" not in dumped


def test_newapi_sync_groups_empty_request_falls_back_to_discovered_groups(monkeypatch) -> None:
    from app.gateway.auth import newapi_oauth

    monkeypatch.setattr(
        newapi_oauth,
        "require_newapi_settings",
        lambda: newapi_oauth.NewAPIOAuthSettings(
            enabled=True,
            issuer="https://xg.example.test",
            client_id="miaowu",
            client_secret="secret",
        ),
    )

    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "newapi_sync": {
                    "system_access_token_encrypted": "system-token",
                }
            }
        ),
    )

    async def _fake_catalog(*, settings, system_access_token):
        assert system_access_token == "system-token"
        return {
            "半公益渠道": {"name": "半公益渠道", "models": ["charity-model"]},
            "国产": {"name": "国产", "models": ["domestic-model"]},
        }

    async def _fake_bootstrap(*, settings, authorization_token, groups):
        assert authorization_token == "system-token"
        assert groups == ["半公益渠道", "国产"]
        return {
            "半公益渠道": {"hub_api_token": {"sk_key": "token-charity"}, "model_sync_status": "synced"},
            "国产": {"hub_api_token": {"sk_key": "token-domestic"}, "model_sync_status": "synced"},
        }

    monkeypatch.setattr(newapi_oauth, "_fetch_newapi_hub_group_catalog", _fake_catalog)
    monkeypatch.setattr(newapi_oauth, "_bootstrap_newapi_group_tokens", _fake_bootstrap)

    import anyio

    async def _run():
        return await newapi_oauth.sync_newapi_groups_for_user(
            user_id="default_user",
            groups=[],
            manual_groups=[],
            db=fake_db,
        )

    result = anyio.run(_run)

    assert [item.group_id for item in result.results] == ["半公益渠道", "国产"]
    assert [item.status for item in result.results] == ["synced", "synced"]
    assert [item["group_id"] for item in result.group_items] == ["半公益渠道", "国产"]
    dumped = json.dumps([item.__dict__ for item in result.results], ensure_ascii=False)
    assert "token-charity" not in dumped
    assert "token-domestic" not in dumped


def test_newapi_group_bootstrap_stops_after_rate_limit(monkeypatch) -> None:
    import anyio
    import httpx

    from app.gateway.auth import newapi_oauth

    calls: list[str] = []

    class _FakeResponse:
        def __init__(self, status_code: int, group: str) -> None:
            self.status_code = status_code
            self.headers = {"Retry-After": "1200"} if status_code == 429 else {}
            self._group = group

        def json(self):
            return {
                "data": {
                    "group": self._group,
                    "hub_api_token": {"key": f"token-{self._group}"},
                    "model_sync_status": "synced",
                }
            }

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def post(self, _url, *, json, headers):
            group = json["group"]
            calls.append(group)
            return _FakeResponse(429 if group == "g3" else 200, group)

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr(newapi_oauth, "NEWAPI_GROUP_BOOTSTRAP_DELAY_SECONDS", 0)

    async def _run():
        return await newapi_oauth._bootstrap_newapi_group_tokens(
            settings=newapi_oauth.NewAPIOAuthSettings(enabled=True, issuer="https://xg.example.test", client_id="miaowu"),
            authorization_token="system-token",
            groups=["g1", "g2", "g3", "g4"],
        )

    results = anyio.run(_run)

    assert calls == ["g1", "g2", "g3"]
    assert results["g1"]["model_sync_status"] == "synced"
    assert results["g2"]["model_sync_status"] == "synced"
    assert results["g3"]["model_sync_status"] == "error"
    assert "1200" in results["g3"]["model_sync_error"]
    assert results["g4"]["model_sync_status"] == "error"
    assert "限流暂停" in results["g4"]["model_sync_error"]
    dumped = json.dumps(results, ensure_ascii=False)
    assert "system-token" not in dumped


def test_newapi_group_items_keep_requested_group_when_bootstrap_reports_default() -> None:
    import anyio

    from app.gateway.auth.newapi_oauth import (
        NewAPIOAuthSettings,
        _build_newapi_managed_group_items,
    )

    async def _run() -> list[dict]:
        return await _build_newapi_managed_group_items(
            settings=NewAPIOAuthSettings(enabled=True, issuer="https://xg.example.test"),
            group_catalog={
                "半公益渠道": {"name": "半公益渠道", "models": ["charity-model"]},
                "国产": {"name": "国产", "models": ["domestic-model"]},
            },
            group_bootstraps={
                "半公益渠道": {
                    "hub_api_token": {"sk_key": "token-charity", "group": "default"},
                    "model_sync_status": "synced",
                },
                "国产": {
                    "hub_api_token": {"sk_key": "token-domestic", "group": "default"},
                    "model_sync_status": "synced",
                },
            },
            relay_base_url="https://xg.example.test/v1",
        )

    items = anyio.run(_run)

    assert [item["group_id"] for item in items] == ["半公益渠道", "国产"]
    assert [item["name"] for item in items] == ["半公益渠道", "国产"]
    assert items[0]["model_groups"] == {"半公益渠道": ["charity-model"]}
    assert items[1]["model_groups"] == {"国产": ["domestic-model"]}


def test_newapi_token_key_prefers_raw_authorization_key_over_sk_key() -> None:
    from app.gateway.auth.newapi_oauth import _extract_newapi_token_key

    assert (
        _extract_newapi_token_key(
            {
                "hub_api_token": {
                    "authorization": "Bearer raw-token",
                    "key": "raw-token",
                    "sk_key": "sk-raw-token",
                }
            }
        )
        == "raw-token"
    )


def test_newapi_group_items_surface_product_access_missing_instead_of_empty_success() -> None:
    import anyio

    from app.gateway.auth.newapi_oauth import (
        NewAPIOAuthSettings,
        _build_newapi_managed_group_items,
    )

    async def _run() -> list[dict]:
        return await _build_newapi_managed_group_items(
            settings=NewAPIOAuthSettings(enabled=True, issuer="https://xg.example.test"),
            group_catalog={"vip": {"name": "VIP分组", "models": []}},
            group_bootstraps={
                "vip": {
                    "model_sync_status": "synced",
                    "has_novel_product_access": False,
                    "hub_api_token": {
                        "created": False,
                        "provisioning": "not_available_without_product_entitlement",
                    },
                },
            },
            relay_base_url="https://xg.example.test/v1",
        )

    items = anyio.run(_run)

    assert len(items) == 1
    assert items[0]["group_id"] == "vip"
    assert items[0]["models"] == []
    assert items[0]["model_sync_status"] == "error"
    assert "没有小说产品访问权限" in items[0]["model_sync_error"]


def test_get_ai_settings_repairs_duplicate_default_provider_ids_and_single_active() -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        api_provider="openai",
        api_base_url="http://example.test/v1",
        llm_model="fallback-model",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://example.test/v1",
                            "models": ["default-model"],
                            "is_active": True,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "api_key_encrypted": "token-default",
                        },
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（半公益渠道）",
                            "provider": "openai",
                            "base_url": "http://example.test/v1",
                            "models": ["charity-model"],
                            "is_active": True,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["charity-model"]},
                            "api_key_encrypted": "token-charity",
                        },
                        {
                            "id": "newapi-managed-vip",
                            "name": "NewAPI（vip）",
                            "provider": "openai",
                            "base_url": "http://example.test/v1",
                            "models": ["vip-model"],
                            "is_active": True,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "vip",
                            "api_key_encrypted": "token-vip",
                        },
                    ],
                    "client_settings": {},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    provider_ids = [provider["id"] for provider in data["providers"]]
    assert len(provider_ids) == 3
    assert provider_ids[0] == "newapi-managed"
    assert provider_ids[1].startswith("newapi-managed-group-")
    assert provider_ids[2] == "newapi-managed-vip"
    assert len(set(provider_ids)) == 3
    active_ids = [provider["id"] for provider in data["providers"] if provider["is_active"]]
    assert active_ids == ["newapi-managed"]
    assert data["providers"][0]["models"] == ["default-model"]
    assert data["providers"][1]["models"] == ["charity-model"]
    assert data["providers"][1]["name"] == "NewAPI（半公益渠道）"
    assert data["providers"][1]["managed_group"] == "半公益渠道"

    stored_prefs = json.loads(fake_db.settings.preferences or "{}")
    stored_providers = stored_prefs["ai_provider_settings"]["providers"]
    assert [provider["id"] for provider in stored_providers] == provider_ids
    assert [provider["id"] for provider in stored_providers if provider["is_active"]] == ["newapi-managed"]
    assert stored_providers[1]["managed_group"] == "半公益渠道"


def test_get_ai_settings_repairs_first_duplicate_when_default_group_is_later() -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        api_provider="openai",
        api_base_url="http://example.test/v1",
        llm_model="fallback-model",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（半公益渠道）",
                            "provider": "openai",
                            "base_url": "http://example.test/v1",
                            "models": ["charity-model"],
                            "is_active": True,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["charity-model"]},
                            "api_key_encrypted": "token-charity",
                        },
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://example.test/v1",
                            "models": ["default-model"],
                            "is_active": True,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "api_key_encrypted": "token-default",
                        },
                    ],
                    "client_settings": {},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    providers = data["providers"]
    assert providers[0]["id"].startswith("newapi-managed-group-")
    assert providers[0]["managed_group"] == "半公益渠道"
    assert providers[1]["id"] == "newapi-managed"
    assert [provider["id"] for provider in providers if provider["is_active"]] == ["newapi-managed"]

    stored_prefs = json.loads(fake_db.settings.preferences or "{}")
    assert "_normalization_changed" not in stored_prefs["ai_provider_settings"]
    assert [provider["id"] for provider in stored_prefs["ai_provider_settings"]["providers"]] == [
        providers[0]["id"],
        "newapi-managed",
    ]


def test_get_ai_settings_repairs_feature_routing_targets_after_provider_split() -> None:
    fake_db = _FakeDB()
    fake_db.settings = Settings(
        user_id="default_user",
        api_provider="openai",
        api_base_url="http://example.test/default/v1",
        llm_model="default-model",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "newapi-managed",
                    "providers": [
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（default）",
                            "provider": "openai",
                            "base_url": "http://example.test/default/v1",
                            "models": ["default-model"],
                            "is_active": True,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "api_key_encrypted": "token-default",
                        },
                        {
                            "id": "newapi-managed",
                            "name": "NewAPI（半公益渠道）",
                            "provider": "openai",
                            "base_url": "http://example.test/charity/v1",
                            "models": ["charity-model"],
                            "is_active": False,
                            "is_managed": True,
                            "managed_by": "newapi",
                            "managed_group": "default",
                            "model_groups": {"default": ["charity-model"]},
                            "api_key_encrypted": "token-charity",
                        },
                    ],
                    "client_settings": {},
                    "feature_routing_settings": {
                        "version": 1,
                        "defaultTarget": {"providerId": "newapi-managed", "model": "charity-model"},
                        "channels": [],
                        "modules": [
                            {
                                "moduleId": "novel-outline",
                                "moduleLabel": "大纲规划",
                                "moduleDescription": "小说大纲规划与维护",
                                "category": "novel",
                                "runtimeReady": True,
                                "defaultTarget": {"providerId": "newapi-managed", "model": "charity-model"},
                                "primaryTarget": {"providerId": "newapi-managed", "model": "charity-model"},
                                "backupTarget": None,
                                "currentMode": "primary",
                                "autoFailover": True,
                                "parallelEnabled": True,
                                "parallelStrategy": "compare",
                                "parallelTargets": [{"providerId": "newapi-managed", "model": "charity-model"}],
                            }
                        ],
                        "switchLogs": [],
                    },
                }
            },
            ensure_ascii=False,
        ),
    )
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/api/user/ai-settings")

    assert resp.status_code == 200
    data = resp.json()
    charity_provider = next(provider for provider in data["providers"] if provider["managed_group"] == "半公益渠道")
    repaired_target = {
        "providerId": charity_provider["id"],
        "model": "charity-model",
    }
    assert data["feature_routing_settings"]["defaultTarget"] == repaired_target
    assert data["feature_routing_settings"]["modules"][0]["primaryTarget"] == repaired_target
    assert data["feature_routing_settings"]["modules"][0]["parallelTargets"] == [repaired_target]

    stored_prefs = json.loads(fake_db.settings.preferences or "{}")
    assert stored_prefs["ai_provider_settings"]["feature_routing_settings"]["defaultTarget"] == repaired_target
    assert "_normalization_changed" not in stored_prefs["ai_provider_settings"]

    runtime, source = resolve_user_ai_runtime_config(fake_db.settings, module_id="novel-outline")
    assert source == "feature-routing:novel-outline"
    assert runtime["api_base_url"] == "http://example.test/charity/v1"
    assert runtime["api_key"] == "token-charity"
    assert runtime["model_name"] == "charity-model"


def test_put_ai_settings_keeps_feature_routing_settings_when_omitted() -> None:
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        first = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "feature_routing_settings": {
                    "create_novel": {"provider_id": "p1", "model": "gpt-4o-mini"},
                },
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                    }
                ],
            },
        )
        assert first.status_code == 200
        assert first.json()["feature_routing_settings"] == {
            "create_novel": {"provider_id": "p1", "model": "gpt-4o-mini"}
        }

        second = client.put(
            "/api/user/ai-settings",
            json={
                # Explicitly omit feature_routing_settings: should keep previous value.
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                    }
                ],
                "system_prompt": "keep-routing",
            },
        )
        assert second.status_code == 200
        data = second.json()
        assert data["system_prompt"] == "keep-routing"
        assert data["feature_routing_settings"] == {
            "create_novel": {"provider_id": "p1", "model": "gpt-4o-mini"}
        }

    prefs = json.loads(fake_db.settings.preferences or "{}")
    assert prefs["ai_provider_settings"]["feature_routing_settings"] == {
        "create_novel": {"provider_id": "p1", "model": "gpt-4o-mini"}
    }


def test_put_ai_settings_preserves_key_when_omitted_and_clears_when_requested() -> None:
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        first = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                        "api_key": "sk-first",
                    }
                ],
            },
        )
        assert first.status_code == 200
        key_after_first = fake_db.settings.api_key
        assert key_after_first is not None

        second = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                        # api_key omitted => preserve
                    }
                ],
            },
        )
        assert second.status_code == 200
        assert fake_db.settings.api_key == key_after_first
        data_second = second.json()
        assert data_second["providers"][0]["has_api_key"] is True

        third = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                        "clear_api_key": True,
                    }
                ],
            },
        )
        assert third.status_code == 200
        data_third = third.json()
        assert data_third["providers"][0]["has_api_key"] is False
        assert fake_db.settings.api_key is None


def test_put_ai_settings_rejects_client_injected_encrypted_secret() -> None:
    """Client payloads must not be able to smuggle backend-only secret fields."""
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    service = get_ai_settings_service()
    injected_ciphertext = crypto.encrypt_secret("sk-injected")

    import anyio

    async def _run() -> dict:
        return await service.put_ai_settings(
            "user-a",
            {
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI-compatible",
                        "provider": "custom",
                        "base_url": "https://api.example.com/v1",
                        "models": ["custom-model"],
                        "is_active": True,
                        # This field is backend-only. It must be ignored for
                        # normal PUT requests even if a malicious client sends it.
                        "api_key_encrypted": injected_ciphertext,
                    }
                ],
            },
            fake_db,
        )

    response = anyio.run(_run)

    assert response["providers"][0]["has_api_key"] is False
    assert fake_db.settings is not None
    assert fake_db.settings.api_key is None
    prefs = json.loads(fake_db.settings.preferences or "{}")
    stored_provider = prefs["ai_provider_settings"]["providers"][0]
    assert stored_provider["api_key_encrypted"] is None
    assert "sk-injected" not in json.dumps(response, ensure_ascii=False)
    assert "sk-injected" not in json.dumps(prefs, ensure_ascii=False)


def test_resolve_user_ai_runtime_config_is_isolated_per_settings_record() -> None:
    _enable_encryption_for_test()
    user_a_key = crypto.encrypt_secret("sk-user-a")
    user_b_key = crypto.encrypt_secret("sk-user-b")
    user_a = Settings(
        user_id="user-a",
        api_provider="custom",
        api_key=user_a_key,
        api_base_url="https://a.example.com/v1",
        llm_model="model-a",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "provider-a",
                    "providers": [
                        {
                            "id": "provider-a",
                            "name": "Provider A",
                            "provider": "custom",
                            "base_url": "https://a.example.com/v1",
                            "models": ["model-a"],
                            "is_active": True,
                            "api_key_encrypted": user_a_key,
                        }
                    ],
                    "client_settings": {},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )
    user_b = Settings(
        user_id="user-b",
        api_provider="custom",
        api_key=user_b_key,
        api_base_url="https://b.example.com/v1",
        llm_model="model-b",
        preferences=json.dumps(
            {
                "ai_provider_settings": {
                    "version": 1,
                    "default_provider_id": "provider-b",
                    "providers": [
                        {
                            "id": "provider-b",
                            "name": "Provider B",
                            "provider": "custom",
                            "base_url": "https://b.example.com/v1",
                            "models": ["model-b"],
                            "is_active": True,
                            "api_key_encrypted": user_b_key,
                        }
                    ],
                    "client_settings": {},
                    "feature_routing_settings": None,
                }
            },
            ensure_ascii=False,
        ),
    )

    runtime_a, source_a = resolve_user_ai_runtime_config(user_a)
    runtime_b, source_b = resolve_user_ai_runtime_config(user_b)

    assert source_a == "provider-default-model"
    assert source_b == "provider-default-model"
    assert runtime_a["api_key"] == "sk-user-a"
    assert runtime_b["api_key"] == "sk-user-b"
    assert runtime_a["api_base_url"] == "https://a.example.com/v1"
    assert runtime_b["api_base_url"] == "https://b.example.com/v1"
    assert runtime_a["model_name"] == "model-a"
    assert runtime_b["model_name"] == "model-b"


def test_put_ai_settings_allows_empty_providers_bundle_without_recreating_placeholder() -> None:
    """Regression: new-contract PUT always sends system_prompt; it must not trigger legacy sync.

    If providers is explicitly set to an empty list, the backend should persist
    an empty providers bundle (so the UI can delete providers) instead of
    recreating a placeholder provider from Settings top-level defaults.
    """
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        first = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                    }
                ],
                "system_prompt": "hello",
            },
        )
        assert first.status_code == 200

        second = client.put(
            "/api/user/ai-settings",
            json={
                # Explicitly empty providers (delete all)
                "default_provider_id": "p1",
                "providers": [],
                "system_prompt": "after-delete",
            },
        )
        assert second.status_code == 200
        data = second.json()
        assert data["providers"] == []
        assert data["default_provider_id"] is None
        assert data["system_prompt"] == "after-delete"


def test_put_ai_settings_persists_explicit_empty_models_and_base_url() -> None:
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        first = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                    }
                ],
            },
        )
        assert first.status_code == 200

        second = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "",
                        "models": [],
                        "is_active": True,
                    }
                ],
            },
        )
        assert second.status_code == 200
        data = second.json()
        assert data["providers"][0]["base_url"] == ""
        assert data["providers"][0]["models"] == []

    prefs = json.loads(fake_db.settings.preferences or "{}")
    bundle = prefs.get("ai_provider_settings") or {}
    stored = bundle.get("providers") or []
    assert stored and stored[0]["base_url"] == ""
    assert stored[0]["models"] == []


def test_get_ai_settings_keeps_zero_temperature_and_max_tokens() -> None:
    fake_db = _FakeDB()
    app = _build_user_settings_app(fake_db)

    with TestClient(app) as client:
        put_resp = client.put(
            "/api/user/ai-settings",
            json={
                "default_provider_id": "p1",
                "providers": [
                    {
                        "id": "p1",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://api.openai.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                        "temperature": 0.0,
                        "max_tokens": 0,
                    }
                ],
            },
        )
        assert put_resp.status_code == 200

        get_resp = client.get("/api/user/ai-settings")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["temperature"] == 0.0
        assert data["max_tokens"] == 0


def test_settings_endpoint_syncs_preferences_bundle() -> None:
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    app = _build_legacy_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.post(
            "/settings",
            json={
                "api_provider": "openai",
                "api_key": "sk-legacy",
                "api_base_url": "https://api.openai.com/v1",
                "llm_model": "gpt-4o-mini",
                "temperature": 0.4,
                "max_tokens": 123,
                "system_prompt": "legacy",
            },
        )

    assert resp.status_code == 200
    assert fake_db.settings is not None
    prefs = json.loads(fake_db.settings.preferences or "{}")
    bundle = prefs.get("ai_provider_settings") or {}
    assert bundle.get("version") == 1
    assert isinstance(bundle.get("providers"), list)
    assert bundle["providers"]
    active = next(item for item in bundle["providers"] if item.get("is_active"))
    assert active["provider"] == "openai"
    assert active["base_url"] == "https://api.openai.com/v1"
    assert active["models"] == ["gpt-4o-mini"]
    assert active["api_key_encrypted"] == fake_db.settings.api_key


def test_get_presets_redacts_plaintext_keys() -> None:
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    encrypted_key = crypto.encrypt_secret("sk-cipher-only")
    fake_db.settings = Settings(
        user_id="default_user",
        preferences=json.dumps(
            {
                "presets": [
                    {
                        "id": "p1",
                        "name": "secure-preset",
                        "config": {
                            "api_provider": "openai",
                            "api_key": "sk-plaintext-should-not-leak",
                            "cover_api_key": "cover-plaintext-should-not-leak",
                            "api_key_encrypted": encrypted_key,
                            "cover_api_key_encrypted": encrypted_key,
                            "llm_model": "gpt-4o-mini",
                        },
                    }
                ]
            },
            ensure_ascii=False,
        ),
    )
    app = _build_legacy_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.get("/settings/presets")

    assert resp.status_code == 200
    payload = resp.json()["data"]["presets"][0]
    config = payload["config"]
    assert "api_key" not in config
    assert "cover_api_key" not in config
    assert "api_key_encrypted" not in config
    assert "cover_api_key_encrypted" not in config
    assert config["has_api_key"] is True
    assert config["has_cover_api_key"] is True


def test_create_preset_from_current_omits_plaintext_key_in_response_and_storage() -> None:
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    existing_api_key = crypto.encrypt_secret("sk-live-secret")
    fake_db.settings = Settings(
        user_id="default_user",
        api_provider="openai",
        api_key=existing_api_key,
        api_base_url="https://api.openai.com/v1",
        llm_model="gpt-4o-mini",
        temperature=0.2,
        max_tokens=256,
        system_prompt="secure",
        preferences="{}",
    )
    app = _build_legacy_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.post(
            "/settings/presets/from-current",
            json={"name": "from-current", "description": "secure snapshot"},
        )

    assert resp.status_code == 200
    config = resp.json()["data"]["config"]
    assert "api_key" not in config
    assert "api_key_encrypted" not in config
    assert config["has_api_key"] is True

    stored_preferences = json.loads(fake_db.settings.preferences or "{}")
    stored_preset = stored_preferences["presets"][0]
    stored_config = stored_preset["config"]
    assert "api_key" not in stored_config
    assert stored_config["api_key_encrypted"] == existing_api_key
    assert "sk-live-secret" not in json.dumps(stored_preferences, ensure_ascii=False)


def test_activate_preset_supports_encrypted_secret_field() -> None:
    _enable_encryption_for_test()
    fake_db = _FakeDB()
    encrypted_active_key = crypto.encrypt_secret("sk-new-active")
    fake_db.settings = Settings(
        user_id="default_user",
        api_provider="openai",
        api_key=crypto.encrypt_secret("sk-old"),
        preferences=json.dumps(
            {
                "presets": [
                    {
                        "id": "p1",
                        "name": "encrypted-preset",
                        "config": {
                            "api_provider": "openai",
                            "api_key_encrypted": encrypted_active_key,
                            "api_base_url": "https://api.openai.com/v1",
                            "llm_model": "gpt-4o-mini",
                        },
                    }
                ]
            },
            ensure_ascii=False,
        ),
    )
    app = _build_legacy_settings_app(fake_db)

    with TestClient(app) as client:
        resp = client.post("/settings/presets/p1/activate")

    assert resp.status_code == 200
    assert crypto.safe_decrypt(fake_db.settings.api_key) == "sk-new-active"
    stored_preferences = json.loads(fake_db.settings.preferences or "{}")
    assert stored_preferences["presets"][0]["is_active"] is True


def test_fetch_provider_models_allows_anthropic_without_base_url() -> None:
    app = _build_user_settings_app(_FakeDB())

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/fetch-provider-models",
            json={"provider_type": "anthropic", "base_url": ""},
        )

    assert resp.status_code == 200
    payload = resp.json()
    assert isinstance(payload["models"], list)
    assert payload["models"]


def test_fetch_provider_models_rejects_non_http_scheme() -> None:
    app = _build_user_settings_app(_FakeDB())

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/fetch-provider-models",
            json={"provider_type": "openai", "base_url": "ftp://example.com"},
        )

    assert resp.status_code == 400
    assert "http/https" in resp.json()["detail"]


def test_fetch_provider_models_allows_localhost_target(monkeypatch) -> None:
    app = _build_user_settings_app(_FakeDB())

    async def _fake_fetch(url: str, api_key: str) -> list[str]:
        assert url == "http://localhost:8000/v1/models"
        return ["local-model"]

    monkeypatch.setattr(user_settings, "_fetch_models_from_upstream", _fake_fetch)

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/fetch-provider-models",
            json={"provider_type": "openai", "base_url": "http://localhost:8000"},
        )

    assert resp.status_code == 200
    assert resp.json()["models"] == ["local-model"]


def test_fetch_provider_models_allows_private_ip_target(monkeypatch) -> None:
    app = _build_user_settings_app(_FakeDB())

    async def _fake_fetch(url: str, api_key: str) -> list[str]:
        assert url == "http://10.1.2.3:8000/v1/models"
        return ["private-model"]

    monkeypatch.setattr(user_settings, "_fetch_models_from_upstream", _fake_fetch)

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/fetch-provider-models",
            json={"provider_type": "openai", "base_url": "http://10.1.2.3:8000"},
        )

    assert resp.status_code == 200
    assert resp.json()["models"] == ["private-model"]


def test_fetch_provider_models_allows_public_https_and_parses_models(monkeypatch) -> None:
    app = _build_user_settings_app(_FakeDB())

    async def _fake_fetch(url: str, api_key: str) -> list[str]:
        assert url == "https://api.example.com/v1/models"
        assert api_key == "sk-test"
        return ["model-a", "model-b"]

    monkeypatch.setattr(user_settings, "_fetch_models_from_upstream", _fake_fetch)

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/fetch-provider-models",
            json={
                "provider_type": "openai",
                "base_url": "https://api.example.com",
                "api_key": "sk-test",
            },
        )

    assert resp.status_code == 200
    assert resp.json()["models"] == ["model-a", "model-b"]


def test_fetch_provider_models_uses_managed_newapi(monkeypatch) -> None:
    app = _build_user_settings_app(_FakeDB())

    async def _fake_fetch_managed_newapi_models(provider_id=None):
        assert provider_id == "newapi-managed"
        return ["newapi-model-a", "newapi-model-b"], {
            "default": ["newapi-model-a"],
            "vip": ["newapi-model-b"],
        }

    monkeypatch.setattr(user_settings, "fetch_managed_newapi_models", _fake_fetch_managed_newapi_models)

    with TestClient(app) as client:
        resp = client.post(
            "/api/user/fetch-provider-models",
            json={"provider_type": "newapi", "provider_id": "newapi-managed"},
        )

    assert resp.status_code == 200
    assert resp.json() == {
        "models": ["newapi-model-a", "newapi-model-b"],
        "model_groups": {
            "default": ["newapi-model-a"],
            "vip": ["newapi-model-b"],
        },
    }
