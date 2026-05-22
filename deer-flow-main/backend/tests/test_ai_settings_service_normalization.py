from __future__ import annotations

from app.gateway.novel_migrated.services.ai_settings_service import _ensure_ai_provider_settings


def test_ensure_ai_provider_settings_sanitizes_models_list() -> None:
    """Regression: reading persisted providers must not re-use raw dict as `previous`.

    When models contains no valid string entries, the sanitized result should be []
    (not the original invalid list).
    """
    prefs = {
        "ai_provider_settings": {
            "version": 1,
            "default_provider_id": "p1",
            "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
            "providers": [
                {
                    "id": "p1",
                    "name": "OpenAI",
                    "provider": "openai",
                    "base_url": "",
                    "models": [123, None],  # invalid persisted data
                    "is_active": True,
                    "temperature": 0.7,
                    "max_tokens": 2000,
                    "api_key_encrypted": "encrypted",
                }
            ],
        }
    }

    normalized = _ensure_ai_provider_settings(prefs)
    assert normalized["providers"]
    assert normalized["providers"][0]["models"] == []


def test_ensure_ai_provider_settings_trims_and_filters_empty_models() -> None:
    prefs = {
        "ai_provider_settings": {
            "version": 1,
            "default_provider_id": "p1",
            "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
            "providers": [
                {
                    "id": "p1",
                    "name": "OpenAI",
                    "provider": "openai",
                    "base_url": "",
                    "models": ["", "  ", None, " gpt-4o-mini "],
                    "is_active": True,
                }
            ],
        }
    }

    normalized = _ensure_ai_provider_settings(prefs)
    assert normalized["providers"][0]["models"] == ["gpt-4o-mini"]


def test_ensure_ai_provider_settings_accepts_feature_routing_settings_dict() -> None:
    prefs = {
        "ai_provider_settings": {
            "version": 1,
            "default_provider_id": None,
            "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
            "feature_routing_settings": {
                "create_novel": {"provider_id": "p1"},
                "novel_tools": {"provider_id": "p2", "base_url": "http://127.0.0.1:8551"},
            },
            "providers": [],
        }
    }

    normalized = _ensure_ai_provider_settings(prefs)
    assert normalized["feature_routing_settings"] == {
        "create_novel": {"provider_id": "p1"},
        "novel_tools": {"provider_id": "p2", "base_url": "http://127.0.0.1:8551"},
    }


def test_ensure_ai_provider_settings_invalid_feature_routing_settings_becomes_none() -> None:
    prefs = {
        "ai_provider_settings": {
            "version": 1,
            "default_provider_id": None,
            "client_settings": {"enable_stream_mode": True, "request_timeout": 660000, "max_retries": 2},
            "feature_routing_settings": ["invalid"],
            "providers": [],
        }
    }

    normalized = _ensure_ai_provider_settings(prefs)
    assert normalized["feature_routing_settings"] is None
