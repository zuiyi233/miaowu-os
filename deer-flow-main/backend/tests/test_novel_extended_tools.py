from __future__ import annotations

import pytest

from deerflow.tools.builtins import novel_extended_tools


@pytest.mark.anyio
async def test_update_character_states_requires_project_id(monkeypatch):
    monkeypatch.setattr(
        novel_extended_tools,
        "check_idempotency",
        lambda *_args, **_kwargs: {"is_duplicate": False},
    )
    monkeypatch.setattr(novel_extended_tools, "get_base_url", lambda: "http://127.0.0.1:8001")

    called = {"post": False}

    async def _fake_post_json(url: str, payload: dict):
        called["post"] = True
        return {"url": url, "payload": payload}

    monkeypatch.setattr(novel_extended_tools, "post_json", _fake_post_json)

    result = await novel_extended_tools.update_character_states.ainvoke(
        {"chapter_id": "c-1", "project_id": ""}
    )

    assert result["success"] is False
    assert "project_id required" in result["error"]
    assert called["post"] is False


@pytest.mark.anyio
async def test_update_character_states_uses_safe_path_segments(monkeypatch):
    monkeypatch.setattr(
        novel_extended_tools,
        "check_idempotency",
        lambda *_args, **_kwargs: {"is_duplicate": False},
    )
    monkeypatch.setattr(novel_extended_tools, "get_base_url", lambda: "http://127.0.0.1:8001")

    captured: dict[str, object] = {}

    async def _fake_post_json(url: str, payload: dict):
        captured["url"] = url
        captured["payload"] = payload
        return {"ok": True}

    monkeypatch.setattr(novel_extended_tools, "post_json", _fake_post_json)

    result = await novel_extended_tools.update_character_states.ainvoke(
        {"chapter_id": "chapter 1", "project_id": "proj/alpha"}
    )

    assert result["success"] is True
    assert captured["url"] == "http://127.0.0.1:8001/api/memories/projects/proj%2Falpha/analyze-chapter/chapter%201"
    assert captured["payload"] == {"chapter_id": "chapter 1", "project_id": "proj/alpha"}


@pytest.mark.anyio
async def test_finalize_project_requires_project_id(monkeypatch):
    monkeypatch.setattr(
        novel_extended_tools,
        "check_idempotency",
        lambda *_args, **_kwargs: {"is_duplicate": False},
    )
    result = await novel_extended_tools.finalize_project.ainvoke({"project_id": ""})

    assert result["success"] is False
    assert "project_id required" in result["error"]
