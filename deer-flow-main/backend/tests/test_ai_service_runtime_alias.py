from __future__ import annotations

import logging
from unittest.mock import patch

from app.gateway.novel_migrated.services import ai_service as ai_service_module
from app.gateway.novel_migrated.services.ai_service import AIService


def _make_service() -> AIService:
    return AIService(
        api_provider="openai",
        api_key="test-key",
        api_base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        default_temperature=0.7,
        default_max_tokens=1000,
    )


def test_apply_runtime_params_logs_when_model_copy_unavailable(caplog) -> None:
    service = _make_service()

    class NoModelCopy:
        pass

    llm = NoModelCopy()
    with caplog.at_level(logging.WARNING):
        result = service._apply_runtime_params(llm, temperature=0.2, max_tokens=256)

    assert result is llm
    assert "model_copy 设置运行时参数不可用" in caplog.text
    assert "NoModelCopy" in caplog.text


def test_apply_runtime_params_logs_when_model_copy_fails(caplog) -> None:
    service = _make_service()

    class FailingModel:
        def model_copy(self, *, update):
            raise RuntimeError(f"boom: {update}")

    llm = FailingModel()
    with caplog.at_level(logging.WARNING):
        result = service._apply_runtime_params(llm, temperature=0.3, max_tokens=512)

    assert result is llm
    assert "model_copy 设置运行时参数失败" in caplog.text
    assert "updates={'temperature': 0.3, 'max_tokens': 512}" in caplog.text


def test_create_user_ai_service_with_mcp_is_compat_alias() -> None:
    sentinel = object()
    with patch.object(ai_service_module, "create_user_ai_service", return_value=sentinel) as mock_create:
        result = ai_service_module.create_user_ai_service_with_mcp(
            api_provider="openai",
            api_key="k",
            api_base_url="https://api.openai.com/v1",
            model_name="gpt-4o-mini",
            temperature=0.4,
            max_tokens=123,
            system_prompt="sys",
            user_id="u1",
            db_session=None,
            enable_mcp=False,
        )

    assert result is sentinel
    mock_create.assert_called_once_with(
        api_provider="openai",
        api_key="k",
        api_base_url="https://api.openai.com/v1",
        model_name="gpt-4o-mini",
        temperature=0.4,
        max_tokens=123,
        system_prompt="sys",
        user_id="u1",
        db_session=None,
        enable_mcp=False,
    )
