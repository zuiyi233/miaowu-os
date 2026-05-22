from __future__ import annotations

import pytest

from deerflow.tools.builtins import novel_analysis_tools


def test_parse_chapter_number_supports_chinese_and_mixed_text():
    assert novel_analysis_tools._parse_chapter_number("第十二章") == 12
    assert novel_analysis_tools._parse_chapter_number("第2章（修订）") == 2
    assert novel_analysis_tools._parse_chapter_number("第一百零三章") == 103
    assert novel_analysis_tools._parse_chapter_number("未提供章节") == 1


@pytest.mark.anyio
async def test_manage_foreshadow_context_uses_parsed_chapter_number(monkeypatch):
    called: dict[str, str] = {}

    async def _fake_get_json(url: str):
        called["url"] = url
        return {"ok": True}

    monkeypatch.setattr(novel_analysis_tools, "get_base_url", lambda: "http://127.0.0.1:8001")
    monkeypatch.setattr(novel_analysis_tools, "get_json", _fake_get_json)

    result = await novel_analysis_tools.manage_foreshadow.ainvoke(
        {
            "action": "context",
            "project_id": "p-1",
            "content": "第十二章 回忆片段",
        }
    )

    assert result["success"] is True
    assert called["url"] == "http://127.0.0.1:8001/api/foreshadows/projects/p-1/context/12"
