from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator

from app.gateway.novel_migrated.services.plot_analyzer import PlotAnalyzer


class _FakeAIService:
    def __init__(self, responses: list[str]) -> None:
        self._responses = responses
        self._index = 0

    async def generate_text_stream(self, *, prompt: str, temperature: float) -> AsyncGenerator[str, None]:
        del prompt, temperature
        response = self._responses[self._index]
        self._index += 1
        yield response

    def _clean_json_response(self, raw: str) -> str:
        return raw


def test_plot_analyzer_retry_callback_and_wait_are_shared_path(monkeypatch):
    ai_service = _FakeAIService(
        responses=[
            "{invalid-json",
            '{"hooks": [], "plot_points": [], "scores": {"overall": 8}}',
        ]
    )
    analyzer = PlotAnalyzer(ai_service=ai_service)

    sleeps: list[int] = []
    retries: list[tuple[int, int, int, str]] = []

    async def _fake_sleep(seconds: int) -> None:
        sleeps.append(seconds)

    async def _on_retry(attempt: int, max_retries: int, wait: int, reason: str) -> None:
        retries.append((attempt, max_retries, wait, reason))

    monkeypatch.setattr("app.gateway.novel_migrated.services.plot_analyzer.asyncio.sleep", _fake_sleep)

    result = asyncio.run(
        analyzer.analyze_chapter(
            chapter_number=3,
            title="测试章节",
            content="正文",
            word_count=1200,
            max_retries=2,
            on_retry=_on_retry,
        )
    )

    assert result is not None
    assert result["scores"]["overall"] == 8
    assert sleeps == [2]
    assert retries == [(1, 2, 2, "JSON解析失败")]
