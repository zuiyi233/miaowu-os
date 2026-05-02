"""Tests for lead agent runtime model resolution behavior."""

from __future__ import annotations

import inspect
from unittest.mock import MagicMock

import pytest

from deerflow.agents.lead_agent import agent as lead_agent_module
from deerflow.config.app_config import AppConfig
from deerflow.config.memory_config import MemoryConfig
from deerflow.config.model_config import ModelConfig
from deerflow.config.sandbox_config import SandboxConfig
from deerflow.config.summarization_config import SummarizationConfig


def _make_app_config(models: list[ModelConfig]) -> AppConfig:
    return AppConfig(
        models=models,
        sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"),
    )


def _make_model(name: str, *, supports_thinking: bool) -> ModelConfig:
    return ModelConfig(
        name=name,
        display_name=name,
        description=None,
        use="langchain_openai:ChatOpenAI",
        model=name,
        supports_thinking=supports_thinking,
        supports_vision=False,
    )


def test_make_lead_agent_signature_matches_langgraph_server_factory_abi():
    assert list(inspect.signature(lead_agent_module.make_lead_agent).parameters) == ["config"]


def test_internal_make_lead_agent_uses_explicit_app_config(monkeypatch):
    app_config = _make_app_config([_make_model("explicit-model", supports_thinking=False)])

    import deerflow.tools as tools_module

    def _raise_get_app_config():
        raise AssertionError("ambient get_app_config() must not be used when app_config is explicit")

    monkeypatch.setattr(lead_agent_module, "get_app_config", _raise_get_app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None, custom_middlewares=None, **kwargs: [])

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, app_config=None, **kwargs):
        captured["name"] = name
        captured["app_config"] = app_config
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {"configurable": {"model_name": "explicit-model", "app_config": app_config}},
    )

    assert captured["name"] == "explicit-model"
    assert captured["app_config"] is app_config
    assert result["model"] is not None


def test_make_lead_agent_uses_runtime_app_config_from_context_without_global_read(monkeypatch):
    app_config = _make_app_config([_make_model("context-model", supports_thinking=False)])

    import deerflow.tools as tools_module

    def _raise_get_app_config():
        raise AssertionError("ambient get_app_config() must not be used when runtime context already carries app_config")

    monkeypatch.setattr(lead_agent_module, "get_app_config", _raise_get_app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None, **kwargs: [])

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, app_config=None, **kwargs):
        captured["name"] = name
        captured["app_config"] = app_config
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {
            "context": {
                "model_name": "context-model",
                "app_config": app_config,
            }
        }
    )

    assert captured == {
        "name": "context-model",
        "app_config": app_config,
    }
    assert result["model"] is not None


def test_resolve_model_name_falls_back_to_default(monkeypatch, caplog):
    app_config = _make_app_config(
        [
            _make_model("default-model", supports_thinking=False),
            _make_model("other-model", supports_thinking=True),
        ]
    )

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)

    with caplog.at_level("WARNING"):
        resolved = lead_agent_module._resolve_model_name("missing-model")

    assert resolved == "default-model"
    assert "fallback to default model 'default-model'" in caplog.text


def test_resolve_model_name_uses_default_when_none(monkeypatch):
    app_config = _make_app_config(
        [
            _make_model("default-model", supports_thinking=False),
            _make_model("other-model", supports_thinking=True),
        ]
    )

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)

    resolved = lead_agent_module._resolve_model_name(None)

    assert resolved == "default-model"


def test_resolve_model_name_case_insensitive_match(monkeypatch):
    app_config = _make_app_config(
        [
            _make_model("deepseek-v3.2", supports_thinking=True),
            _make_model("other-model", supports_thinking=False),
        ]
    )

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)

    resolved = lead_agent_module._resolve_model_name("DeepSeek-V3.2")

    assert resolved == "deepseek-v3.2"


def test_resolve_model_name_raises_when_no_models_configured(monkeypatch):
    app_config = _make_app_config([])

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)

    with pytest.raises(
        ValueError,
        match="No chat models are configured",
    ):
        lead_agent_module._resolve_model_name("missing-model")


def test_make_lead_agent_disables_thinking_when_model_does_not_support_it(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=False)])

    import deerflow.tools as tools_module

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None, custom_middlewares=None, **kwargs: [])

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, app_config=None, **kwargs):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["reasoning_effort"] = reasoning_effort
        captured["app_config"] = app_config
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "model_name": "safe-model",
                "thinking_enabled": True,
                "is_plan_mode": False,
                "subagent_enabled": False,
            }
        }
    )

    assert captured["name"] == "safe-model"
    assert captured["thinking_enabled"] is False
    assert result["model"] is not None


def test_make_lead_agent_reads_runtime_options_from_context(monkeypatch):
    app_config = _make_app_config(
        [
            _make_model("default-model", supports_thinking=False),
            _make_model("context-model", supports_thinking=True),
        ]
    )

    import deerflow.tools as tools_module

    get_available_tools = MagicMock(return_value=[])
    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", get_available_tools)
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None, custom_middlewares=None, **kwargs: [])

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, app_config=None, **kwargs):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["reasoning_effort"] = reasoning_effort
        captured["app_config"] = app_config
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    result = lead_agent_module.make_lead_agent(
        {
            "context": {
                "model_name": "context-model",
                "thinking_enabled": False,
                "reasoning_effort": "high",
                "is_plan_mode": True,
                "subagent_enabled": True,
                "max_concurrent_subagents": 7,
            }
        }
    )

    assert captured["name"] == "context-model"
    assert captured["thinking_enabled"] is False
    assert captured["reasoning_effort"] == "high"
    get_available_tools.assert_called_once()
    call_kwargs = get_available_tools.call_args.kwargs
    assert call_kwargs["model_name"] == "context-model"
    assert call_kwargs["groups"] is None
    assert call_kwargs["subagent_enabled"] is True
    assert call_kwargs["include_novel"] is True
    assert result["model"] is not None


def test_make_lead_agent_forwards_runtime_provider_overrides(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=True)])

    import deerflow.tools as tools_module

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.setattr(tools_module, "get_available_tools", lambda **kwargs: [])
    monkeypatch.setattr(lead_agent_module, "_build_middlewares", lambda config, model_name, agent_name=None, custom_middlewares=None, **kwargs: [])

    captured: dict[str, object] = {}

    def _fake_create_chat_model(*, name, thinking_enabled, reasoning_effort=None, app_config=None, **kwargs):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["reasoning_effort"] = reasoning_effort
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "create_agent", lambda **kwargs: kwargs)

    lead_agent_module.make_lead_agent(
        {
            "configurable": {
                "model_name": "safe-model",
                "runtime_model": "Deepseek-v3.2",
                "runtime_provider": "openai",
                "runtime_base_url": "http://172.22.22.31:39999/v1",
                "runtime_api_key": "sk-runtime",
                "thinking_enabled": False,
                "is_plan_mode": False,
                "subagent_enabled": False,
            }
        }
    )

    assert captured["name"] == "safe-model"
    assert captured["thinking_enabled"] is False
    assert captured["reasoning_effort"] is None
    assert captured["model"] == "Deepseek-v3.2"
    assert captured["base_url"] == "http://172.22.22.31:39999/v1"
    assert captured["api_key"] == "sk-runtime"


def test_make_lead_agent_rejects_invalid_bootstrap_agent_name(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=False)])

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)

    with pytest.raises(ValueError, match="Invalid agent name"):
        lead_agent_module.make_lead_agent(
            {
                "configurable": {
                    "model_name": "safe-model",
                    "thinking_enabled": False,
                    "is_plan_mode": False,
                    "subagent_enabled": False,
                    "is_bootstrap": True,
                    "agent_name": "../../../tmp/evil",
                }
            }
        )


def test_build_middlewares_uses_resolved_model_name_for_vision(monkeypatch):
    app_config = _make_app_config(
        [
            _make_model("stale-model", supports_thinking=False),
            ModelConfig(
                name="vision-model",
                display_name="vision-model",
                description=None,
                use="langchain_openai:ChatOpenAI",
                model="vision-model",
                supports_thinking=False,
                supports_vision=True,
            ),
        ]
    )

    monkeypatch.setattr(lead_agent_module, "get_app_config", lambda: app_config)
    monkeypatch.setattr(lead_agent_module, "_create_summarization_middleware", lambda **kwargs: None)
    monkeypatch.setattr(lead_agent_module, "_create_todo_list_middleware", lambda is_plan_mode: None)

    middlewares = lead_agent_module._build_middlewares(
        {"configurable": {"model_name": "stale-model", "is_plan_mode": False, "subagent_enabled": False}},
        model_name="vision-model",
        custom_middlewares=[MagicMock()],
        app_config=app_config,
    )

    assert any(isinstance(m, lead_agent_module.ViewImageMiddleware) for m in middlewares)
    # verify the custom middleware is injected correctly
    assert len(middlewares) > 0 and isinstance(middlewares[-2], MagicMock)


def test_build_middlewares_passes_explicit_app_config_to_shared_factory(monkeypatch):
    app_config = _make_app_config([_make_model("safe-model", supports_thinking=False)])

    def _raise_get_app_config():
        raise AssertionError("ambient get_app_config() must not be used when app_config is explicit")

    monkeypatch.setattr(lead_agent_module, "get_app_config", _raise_get_app_config)
    monkeypatch.setattr(lead_agent_module, "_create_summarization_middleware", lambda **kwargs: None)
    monkeypatch.setattr(lead_agent_module, "_create_todo_list_middleware", lambda is_plan_mode: None)

    middlewares = lead_agent_module._build_middlewares(
        {"configurable": {"is_plan_mode": False, "subagent_enabled": False}},
        model_name="safe-model",
        app_config=app_config,
    )

    assert isinstance(middlewares, list)


def test_create_summarization_middleware_uses_configured_model_alias(monkeypatch):
    app_config = _make_app_config([_make_model("model-masswork", supports_thinking=False)])
    app_config.summarization = SummarizationConfig(enabled=True, model_name="model-masswork")
    app_config.memory = MemoryConfig(enabled=False)

    from unittest.mock import MagicMock

    captured: dict[str, object] = {}
    fake_model = MagicMock()
    fake_model.with_config.return_value = fake_model

    def _fake_create_chat_model(*, name=None, thinking_enabled, reasoning_effort=None, app_config=None):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["reasoning_effort"] = reasoning_effort
        captured["app_config"] = app_config
        return fake_model

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "DeerFlowSummarizationMiddleware", lambda **kwargs: kwargs)

    middleware = lead_agent_module._create_summarization_middleware(app_config=app_config)

    assert captured["name"] == "model-masswork"
    assert captured["thinking_enabled"] is False
    assert captured["app_config"] is app_config
    assert middleware["model"] is fake_model


def test_create_summarization_middleware_forwards_runtime_provider_model_override(monkeypatch):
    app_config = _make_app_config([_make_model("default-model", supports_thinking=False)])
    app_config.summarization = SummarizationConfig(enabled=True)
    app_config.memory = MemoryConfig(enabled=False)

    captured: dict[str, object] = {}
    fake_model = object()

    def _fake_create_chat_model(*, name=None, thinking_enabled, reasoning_effort=None, app_config=None, **kwargs):
        captured["name"] = name
        captured["thinking_enabled"] = thinking_enabled
        captured["reasoning_effort"] = reasoning_effort
        captured.update(kwargs)
        return fake_model

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _fake_create_chat_model)
    monkeypatch.setattr(lead_agent_module, "DeerFlowSummarizationMiddleware", lambda **kwargs: kwargs)

    middleware = lead_agent_module._create_summarization_middleware(
        app_config=app_config,
        model_name="safe-model",
        runtime_model="LongCat-Flash-Chat",
        runtime_base_url="https://runtime.example/v1",
        runtime_api_key="sk-runtime",
    )

    assert captured["name"] == "safe-model"
    assert captured["thinking_enabled"] is False
    assert captured["model"] == "LongCat-Flash-Chat"
    assert captured["base_url"] == "https://runtime.example/v1"
    assert captured["api_key"] == "sk-runtime"
    assert middleware["model"] is fake_model


def test_create_summarization_middleware_registers_memory_flush_hook_when_memory_enabled(monkeypatch):
    app_config = _make_app_config([_make_model("default-model", supports_thinking=False)])
    app_config.summarization = SummarizationConfig(enabled=True)
    app_config.memory = MemoryConfig(enabled=True)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    captured: dict[str, object] = {}

    def _fake_middleware(**kwargs):
        captured.update(kwargs)
        return kwargs

    monkeypatch.setattr(lead_agent_module, "DeerFlowSummarizationMiddleware", _fake_middleware)

    lead_agent_module._create_summarization_middleware(app_config=app_config)

    assert captured["before_summarization"] == [lead_agent_module.memory_flush_hook]


def test_create_summarization_middleware_passes_skill_read_tool_names(monkeypatch):
    app_config = _make_app_config([_make_model("default-model", supports_thinking=False)])
    app_config.summarization = SummarizationConfig(enabled=True, skill_file_read_tool_names=["read_file", "cat"])
    app_config.memory = MemoryConfig(enabled=False)
    monkeypatch.setattr(lead_agent_module, "create_chat_model", lambda **kwargs: object())

    captured: dict[str, object] = {}

    def _fake_middleware(**kwargs):
        captured.update(kwargs)
        return kwargs

    monkeypatch.setattr(lead_agent_module, "DeerFlowSummarizationMiddleware", _fake_middleware)

    lead_agent_module._create_summarization_middleware(app_config=app_config)

    assert captured["skill_file_read_tool_names"] == ["read_file", "cat"]


def test_memory_middleware_uses_explicit_memory_config_without_global_read(monkeypatch):
    from deerflow.agents.middlewares import memory_middleware as memory_middleware_module
    from deerflow.agents.middlewares.memory_middleware import MemoryMiddleware

    def _raise_get_memory_config():
        raise AssertionError("ambient get_memory_config() must not be used when memory_config is explicit")

    monkeypatch.setattr(memory_middleware_module, "get_memory_config", _raise_get_memory_config)

    middleware = MemoryMiddleware(memory_config=MemoryConfig(enabled=False))

    assert middleware.after_agent({"messages": []}, runtime=MagicMock(context={"thread_id": "thread-1"})) is None
