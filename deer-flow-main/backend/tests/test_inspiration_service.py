from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.inspiration import InspirationService


class _FakeAIService:
    def __init__(self, response_text: str) -> None:
        self._response_text = response_text
        self.calls: list[dict[str, object]] = []

    async def generate_text_stream(self, *, prompt: str, system_prompt: str, temperature: float):
        self.calls.append(
            {
                "prompt": prompt,
                "system_prompt": system_prompt,
                "temperature": temperature,
            }
        )
        yield self._response_text

    def _clean_json_response(self, text: str) -> str:  # pragma: no cover - should never be called
        raise AssertionError("private cleaner should not be used")


@pytest.mark.anyio
async def test_generate_and_refine_delegate_to_shared_logic() -> None:
    service = InspirationService(ai_service=_FakeAIService("{}"), user_id="u1", db_session=object())
    with patch.object(
        InspirationService,
        "_generate_options_common",
        new=AsyncMock(return_value={"prompt": "p", "options": ["a", "b", "c"]}),
    ) as mock_common:
        await service.generate_options(step="title", context={"initial_idea": "猫咪冒险"})
        await service.refine_options(step="title", context={"initial_idea": "猫咪冒险"}, feedback="更热血", previous_options=["A"])

    assert mock_common.await_count == 2
    first_call = mock_common.await_args_list[0].kwargs
    second_call = mock_common.await_args_list[1].kwargs
    assert first_call["feedback"] == ""
    assert first_call["previous_options"] == []
    assert second_call["feedback"] == "更热血"
    assert second_call["previous_options"] == ["A"]


@pytest.mark.anyio
async def test_generate_options_uses_public_json_clean_wrapper() -> None:
    fake_ai = _FakeAIService('```json\n{"prompt":"请选","options":["A","B","C"]}\n```')
    service = InspirationService(ai_service=fake_ai, user_id="u1", db_session=object(), max_retries=1)

    with patch(
        "app.gateway.novel_migrated.services.inspiration.PromptService.get_template",
        new=AsyncMock(side_effect=["SYS {initial_idea}", "USR {initial_idea}"]),
    ), patch.object(
        AIService,
        "clean_json_response",
        return_value='{"prompt":"请选","options":["A","B","C"]}',
    ) as mock_public_clean:
        result = await service.generate_options(step="title", context={"initial_idea": "猫咪冒险"})

    assert result["options"] == ["A", "B", "C"]
    mock_public_clean.assert_called_once()


@pytest.mark.anyio
async def test_refine_options_increases_temperature_by_feedback() -> None:
    fake_ai = _FakeAIService('{"prompt":"请选","options":["A","B","C"]}')
    service = InspirationService(ai_service=fake_ai, user_id="u1", db_session=object(), max_retries=1)

    with patch(
        "app.gateway.novel_migrated.services.inspiration.PromptService.get_template",
        new=AsyncMock(side_effect=["SYS {initial_idea}", "USR {initial_idea}"]),
    ), patch.object(
        AIService,
        "clean_json_response",
        side_effect=lambda text: text,
    ):
        result = await service.refine_options(
            step="theme",
            context={"initial_idea": "猫咪冒险"},
            feedback="更黑暗",
            previous_options=["温馨成长"],
        )

    assert result["options"] == ["A", "B", "C"]
    assert fake_ai.calls
    assert fake_ai.calls[0]["temperature"] == pytest.approx(0.65)
