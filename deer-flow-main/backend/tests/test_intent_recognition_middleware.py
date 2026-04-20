from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.gateway.middleware.intent_recognition_middleware import IntentRecognitionMiddleware, IntentRecognitionResult


def _request_with_message(message: str):
    return SimpleNamespace(
        messages=[SimpleNamespace(role="user", content=message)],
        stream=False,
    )


def test_detect_intent_extracts_title_and_genre():
    middleware = IntentRecognitionMiddleware()

    intent = middleware._detect_novel_creation_intent("请帮我创建一部名为《星际迷航》的科幻小说")

    assert intent is not None
    assert intent.title == "星际迷航"
    assert intent.genre == "科幻"


def test_detect_intent_ignores_how_to_question():
    middleware = IntentRecognitionMiddleware()

    intent = middleware._detect_novel_creation_intent("怎么创建小说项目？")

    assert intent is None


def test_process_request_returns_not_handled_for_normal_chat():
    middleware = IntentRecognitionMiddleware()
    request = _request_with_message("你好，今天天气怎么样")

    result = asyncio.run(
        middleware.process_request(
            request=request,
            user_id="user-1",
            db_session=None,
        )
    )

    assert result.handled is False


def test_process_request_calls_handle_when_intent_detected(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    request = _request_with_message("请创建一本小说")

    async def _fake_handle(**kwargs):
        assert kwargs["user_id"] == "user-2"
        return IntentRecognitionResult(
            handled=True,
            content="created",
            tool_calls=[{"function": {"name": "create_novel"}}],
            novel={"id": "n-1"},
        )

    monkeypatch.setattr(middleware, "_handle_novel_creation", _fake_handle)

    result = asyncio.run(
        middleware.process_request(
            request=request,
            user_id="user-2",
            db_session=object(),
        )
    )

    assert result.handled is True
    assert result.content == "created"
    assert result.novel == {"id": "n-1"}
