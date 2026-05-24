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
