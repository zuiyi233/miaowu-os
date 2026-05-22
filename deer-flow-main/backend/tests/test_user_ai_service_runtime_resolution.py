import json

from app.gateway.novel_migrated.api.settings import _resolve_user_ai_runtime_config
from app.gateway.novel_migrated.models.settings import Settings


def _build_settings_with_bundle() -> Settings:
    settings = Settings(
        user_id="user-1",
        api_provider="openai",
        api_key="top-level-key",
        api_base_url="https://top-level.example.com/v1",
        llm_model="gpt-4o-mini",
        temperature=0.7,
        max_tokens=2048,
    )
    settings.preferences = json.dumps(
        {
            "ai_provider_settings": {
                "version": 1,
                "default_provider_id": "provider-default",
                "providers": [
                    {
                        "id": "provider-default",
                        "name": "OpenAI",
                        "provider": "openai",
                        "base_url": "https://openai.example.com/v1",
                        "models": ["gpt-4o-mini"],
                        "is_active": True,
                        "temperature": 0.4,
                        "max_tokens": 1200,
                        "api_key_encrypted": "openai-key",
                    },
                    {
                        "id": "provider-inspiration",
                        "name": "Anthropic",
                        "provider": "anthropic",
                        "base_url": "https://anthropic.example.com/v1",
                        "models": ["claude-3-5-sonnet"],
                        "is_active": False,
                        "temperature": 0.2,
                        "max_tokens": 900,
                        "api_key_encrypted": "anthropic-key",
                    },
                ],
                "feature_routing_settings": {
                    "defaultTarget": {
                        "providerId": "provider-default",
                        "model": "gpt-4o-mini",
                    },
                    "modules": [
                        {
                            "moduleId": "novel-inspiration-wizard",
                            "currentMode": "primary",
                            "primaryTarget": {
                                "providerId": "provider-inspiration",
                                "model": "claude-3-5-sonnet",
                            },
                        }
                    ],
                },
            }
        },
        ensure_ascii=False,
    )
    return settings


def test_resolve_runtime_prefers_feature_routing_module_target() -> None:
    settings = _build_settings_with_bundle()

    runtime, source = _resolve_user_ai_runtime_config(
        settings,
        module_id="novel-inspiration-wizard",
    )

    assert runtime["api_provider"] == "anthropic"
    assert runtime["api_base_url"] == "https://anthropic.example.com/v1"
    assert runtime["model_name"] == "claude-3-5-sonnet"
    assert runtime["temperature"] == 0.2
    assert runtime["max_tokens"] == 900
    assert source == "feature-routing:novel-inspiration-wizard"


def test_resolve_runtime_explicit_override_has_highest_priority() -> None:
    settings = _build_settings_with_bundle()

    runtime, source = _resolve_user_ai_runtime_config(
        settings,
        ai_provider_id="provider-default",
        ai_model="gpt-4.1-mini",
        module_id="novel-inspiration-wizard",
    )

    assert runtime["api_provider"] == "openai"
    assert runtime["model_name"] == "gpt-4.1-mini"
    assert runtime["temperature"] == 0.4
    assert runtime["max_tokens"] == 1200
    assert source == "explicit-provider+explicit-model"


def test_resolve_runtime_falls_back_to_routing_default_target() -> None:
    settings = _build_settings_with_bundle()

    runtime, source = _resolve_user_ai_runtime_config(
        settings,
        module_id="memory-ai",
    )

    assert runtime["api_provider"] == "openai"
    assert runtime["model_name"] == "gpt-4o-mini"
    assert source == "feature-routing:memory-ai"
