from __future__ import annotations

import json

from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.novel_migrated.api import settings as legacy_settings
from app.gateway.novel_migrated.api import user_settings
from app.gateway.novel_migrated.core import crypto
from app.gateway.novel_migrated.models.settings import Settings


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
    app.include_router(user_settings.router)
    app.dependency_overrides[user_settings.get_db] = lambda: fake_db
    return app


def _build_legacy_settings_app(fake_db: _FakeDB) -> FastAPI:
    app = FastAPI()
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
    assert data["providers"], "should seed at least one provider from config.yaml"
    assert data["default_provider_id"] is not None
    assert data["client_settings"]["request_timeout"] == 660000
    assert data["api_provider"] == "openai"
    assert data["api_base_url"]
    assert data["llm_model"]

    # DB side effects: record + seeded bundle persisted.
    assert fake_db.settings is not None
    prefs = json.loads(fake_db.settings.preferences or "{}")
    assert "ai_provider_settings" in prefs


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
