from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.gateway.novel_migrated.api import inspiration as inspiration_api


def _fake_request(user_id: str = "user-test") -> SimpleNamespace:
    return SimpleNamespace(state=SimpleNamespace(user_id=user_id))


@pytest.mark.anyio
async def test_generate_options_uses_inspiration_service(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_service = SimpleNamespace(
        generate_options=AsyncMock(return_value={"prompt": "p", "options": ["A", "B", "C"]}),
    )

    monkeypatch.setattr(inspiration_api, "_build_inspiration_service", lambda **_: fake_service)
    monkeypatch.setattr(inspiration_api, "get_user_id", lambda request: "u-1")
    monkeypatch.setattr(
        inspiration_api,
        "get_user_ai_service_with_overrides",
        AsyncMock(return_value=object()),
    )

    result = await inspiration_api.generate_options(
        {"step": "theme", "context": {"title": "猫咪冒险"}},
        http_request=_fake_request(),
        db=object(),
    )

    assert result["options"] == ["A", "B", "C"]
    fake_service.generate_options.assert_awaited_once_with(
        step="theme",
        context={"title": "猫咪冒险"},
    )


@pytest.mark.anyio
async def test_refine_options_normalizes_payload_before_service(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_service = SimpleNamespace(
        refine_options=AsyncMock(return_value={"prompt": "p", "options": ["A", "B", "C"]}),
    )

    monkeypatch.setattr(inspiration_api, "_build_inspiration_service", lambda **_: fake_service)
    monkeypatch.setattr(inspiration_api, "get_user_id", lambda request: "u-1")
    monkeypatch.setattr(
        inspiration_api,
        "get_user_ai_service_with_overrides",
        AsyncMock(return_value=object()),
    )

    result = await inspiration_api.refine_options(
        {
            "step": "genre",
            "context": "invalid-context",
            "feedback": 12345,
            "previous_options": "invalid-list",
        },
        http_request=_fake_request(),
        db=object(),
    )

    assert result["options"] == ["A", "B", "C"]
    fake_service.refine_options.assert_awaited_once_with(
        step="genre",
        context={},
        feedback="12345",
        previous_options=[],
    )


class _FakeQuickGenerateAIService:
    def __init__(self, response: str) -> None:
        self.response = response
        self.cleaned_inputs: list[str] = []

    async def generate_text_stream(self, *, prompt: str, system_prompt: str, temperature: float):
        yield self.response

    def clean_json_response(self, text: str) -> str:
        self.cleaned_inputs.append(text)
        return text


@pytest.mark.anyio
async def test_quick_generate_uses_public_clean_json_wrapper(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_ai = _FakeQuickGenerateAIService(
        '{"title":"猫城日志","description":"desc","theme":"成长","genre":["奇幻"]}',
    )
    monkeypatch.setattr(
        inspiration_api.PromptService,
        "get_template",
        AsyncMock(return_value="请结合已有信息：{existing}"),
    )
    monkeypatch.setattr(
        inspiration_api,
        "get_user_ai_service_with_overrides",
        AsyncMock(return_value=fake_ai),
    )

    result = await inspiration_api.quick_generate(
        {
            "title": "",
            "description": "",
            "theme": "",
            "genre": [],
        },
        http_request=_fake_request(),
        db=object(),
    )

    assert result["title"] == "猫城日志"
    assert result["genre"] == ["奇幻"]
    assert fake_ai.cleaned_inputs == ['{"title":"猫城日志","description":"desc","theme":"成长","genre":["奇幻"]}']
