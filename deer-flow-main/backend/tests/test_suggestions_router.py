import asyncio
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import suggestions


def test_strip_markdown_code_fence_removes_wrapping():
    text = '```json\n["a"]\n```'
    assert suggestions._strip_markdown_code_fence(text) == '["a"]'


def test_strip_markdown_code_fence_no_fence_keeps_content():
    text = '  ["a"]  '
    assert suggestions._strip_markdown_code_fence(text) == '["a"]'


def test_parse_json_string_list_filters_invalid_items():
    text = '```json\n["a", " ", 1, "b"]\n```'
    assert suggestions._parse_json_string_list(text) == ["a", "b"]


def test_parse_json_string_list_rejects_non_list():
    text = '{"a": 1}'
    assert suggestions._parse_json_string_list(text) is None


def test_format_conversation_formats_roles():
    messages = [
        suggestions.SuggestionMessage(role="User", content="Hi"),
        suggestions.SuggestionMessage(role="assistant", content="Hello"),
        suggestions.SuggestionMessage(role="system", content="note"),
    ]
    assert suggestions._format_conversation(messages) == "User: Hi\nAssistant: Hello\nsystem: note"


def test_generate_suggestions_parses_and_limits(monkeypatch):
    req = suggestions.SuggestionsRequest(
        messages=[
            suggestions.SuggestionMessage(role="user", content="Hi"),
            suggestions.SuggestionMessage(role="assistant", content="Hello"),
        ],
        n=3,
        model_name=None,
    )
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": '```json\n["Q1", "Q2", "Q3", "Q4"]\n```'}
    )

    result = asyncio.run(suggestions.generate_suggestions("t1", req, ai_service=fake_ai_service))

    assert result.suggestions == ["Q1", "Q2", "Q3"]


def test_generate_suggestions_parses_list_block_content(monkeypatch):
    req = suggestions.SuggestionsRequest(
        messages=[
            suggestions.SuggestionMessage(role="user", content="Hi"),
            suggestions.SuggestionMessage(role="assistant", content="Hello"),
        ],
        n=2,
        model_name=None,
    )
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": [{"type": "text", "text": '```json\n["Q1", "Q2"]\n```'}]}
    )

    result = asyncio.run(suggestions.generate_suggestions("t1", req, ai_service=fake_ai_service))

    assert result.suggestions == ["Q1", "Q2"]


def test_generate_suggestions_parses_output_text_block_content(monkeypatch):
    req = suggestions.SuggestionsRequest(
        messages=[
            suggestions.SuggestionMessage(role="user", content="Hi"),
            suggestions.SuggestionMessage(role="assistant", content="Hello"),
        ],
        n=2,
        model_name=None,
    )
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": [{"type": "output_text", "text": '```json\n["Q1", "Q2"]\n```'}]}
    )

    result = asyncio.run(suggestions.generate_suggestions("t1", req, ai_service=fake_ai_service))

    assert result.suggestions == ["Q1", "Q2"]


def test_generate_suggestions_returns_empty_on_model_error(monkeypatch):
    req = suggestions.SuggestionsRequest(
        messages=[suggestions.SuggestionMessage(role="user", content="Hi")],
        n=2,
        model_name=None,
    )
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(side_effect=RuntimeError("boom"))

    result = asyncio.run(suggestions.generate_suggestions("t1", req, ai_service=fake_ai_service))

    assert result.suggestions == []


def test_suggestions_route_uses_user_ai_service_dependency_override():
    app = FastAPI()
    app.include_router(suggestions.router)

    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(return_value={"content": '["Q1", "Q2", "Q3"]'})

    async def _override_user_ai_service():
        return fake_ai_service

    app.dependency_overrides[suggestions.get_user_ai_service] = _override_user_ai_service

    with TestClient(app) as client:
        response = client.post(
            "/api/threads/t1/suggestions",
            json={
                "messages": [
                    {"role": "user", "content": "Hi"},
                    {"role": "assistant", "content": "Hello"},
                ],
                "n": 3,
            },
        )

    assert response.status_code == 200
    assert response.json()["suggestions"] == ["Q1", "Q2", "Q3"]
