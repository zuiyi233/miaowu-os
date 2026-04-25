import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

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


def _make_fake_request() -> Request:
    scope = {"type": "http", "method": "POST"}
    return Request(scope)


def _make_fake_db() -> AsyncSession:
    db = MagicMock(spec=AsyncSession)
    return db


def _build_req(messages=None, n=3, model_name=None, module_id=None):
    return suggestions.SuggestionsRequest(
        messages=messages or [
            suggestions.SuggestionMessage(role="user", content="Hi"),
            suggestions.SuggestionMessage(role="assistant", content="Hello"),
        ],
        n=n,
        model_name=model_name,
        module_id=module_id,
    )


def test_generate_suggestions_parses_and_limits(monkeypatch):
    req = _build_req()
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": '```json\n["Q1", "Q2", "Q3", "Q4"]\n```'}
    )

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ):
        result = asyncio.run(
            suggestions.generate_suggestions("t1", req, request=_make_fake_request(), db=_make_fake_db())
        )

    assert result.suggestions == ["Q1", "Q2", "Q3"]


def test_generate_suggestions_parses_list_block_content(monkeypatch):
    req = _build_req(n=2)
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": [{"type": "text", "text": '```json\n["Q1", "Q2"]\n```'}]}
    )

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ):
        result = asyncio.run(
            suggestions.generate_suggestions("t1", req, request=_make_fake_request(), db=_make_fake_db())
        )

    assert result.suggestions == ["Q1", "Q2"]


def test_generate_suggestions_parses_output_text_block_content(monkeypatch):
    req = _build_req(n=2)
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": [{"type": "output_text", "text": '```json\n["Q1", "Q2"]\n```'}]}
    )

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ):
        result = asyncio.run(
            suggestions.generate_suggestions("t1", req, request=_make_fake_request(), db=_make_fake_db())
        )

    assert result.suggestions == ["Q1", "Q2"]


def test_generate_suggestions_returns_empty_on_model_error(monkeypatch):
    req = _build_req(n=2)
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(side_effect=RuntimeError("boom"))

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ):
        result = asyncio.run(
            suggestions.generate_suggestions("t1", req, request=_make_fake_request(), db=_make_fake_db())
        )

    assert result.suggestions == []


def test_generate_suggestions_passes_module_id_to_routing(monkeypatch):
    """Verify module_id='chat-suggestions' is forwarded to get_user_ai_service_with_overrides."""
    req = _build_req(module_id="chat-suggestions")
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": '["Q1"]'}
    )

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ) as mock_override:
        result = asyncio.run(
            suggestions.generate_suggestions("t1", req, request=_make_fake_request(), db=_make_fake_db())
        )

        mock_override.assert_called_once()
        call_kwargs = mock_override.call_args.kwargs
        assert call_kwargs.get("module_id") == "chat-suggestions"
        assert result.suggestions == ["Q1"]


def test_generate_suggestions_without_module_id_forwards_model_name(monkeypatch):
    """When module_id is None, model_name should be passed as ai_model for backward compat."""
    req = _build_req(model_name="gpt-4o")
    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(
        return_value={"content": '["Q1"]'}
    )

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ) as mock_override:
        result = asyncio.run(
            suggestions.generate_suggestions("t1", req, request=_make_fake_request(), db=_make_fake_db())
        )

        call_kwargs = mock_override.call_args.kwargs
        assert call_kwargs.get("ai_model") == "gpt-4o"
        assert call_kwargs.get("module_id") is None
        assert result.suggestions == ["Q1"]


def test_suggestions_route_integration_with_module_id():
    """Integration test: full HTTP request path with module_id."""
    app = FastAPI()
    app.include_router(suggestions.router)

    fake_ai_service = MagicMock()
    fake_ai_service.generate_text_with_messages = AsyncMock(return_value={"content": '["Q1", "Q2", "Q3"]'})

    with patch(
        "app.gateway.routers.suggestions.get_user_ai_service_with_overrides",
        new_callable=AsyncMock,
        return_value=fake_ai_service,
    ):
        with TestClient(app) as client:
            response = client.post(
                "/api/threads/t1/suggestions",
                json={
                    "messages": [
                        {"role": "user", "content": "Hi"},
                        {"role": "assistant", "content": "Hello"},
                    ],
                    "n": 3,
                    "module_id": "chat-suggestions",
                },
            )

    assert response.status_code == 200
    assert response.json()["suggestions"] == ["Q1", "Q2", "Q3"]
