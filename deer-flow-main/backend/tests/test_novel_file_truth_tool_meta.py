from __future__ import annotations

import pytest

from deerflow.tools.builtins import novel_analysis_tools, novel_creation_tools, novel_extended_tools


@pytest.mark.anyio
async def test_generate_characters_attaches_file_truth_metadata(monkeypatch: pytest.MonkeyPatch):
    async def _fake_internal(**_kwargs):
        return {"success": True, "id": "char-1", "name": "林墨", "source": "internal"}

    async def _fake_persist(**_kwargs):
        return [
            {
                "entity_type": "character",
                "entity_id": "char-1",
                "doc_path": "characters/char-1.md",
                "content_hash": "hash-1",
                "doc_updated_at": "2026-01-01T00:00:00+00:00",
                "size": 123,
                "tags": ["character"],
            }
        ]

    monkeypatch.setattr(novel_creation_tools, "check_idempotency", lambda *_args, **_kwargs: {"is_duplicate": False})
    monkeypatch.setattr(novel_creation_tools, "_generate_characters_internal", _fake_internal)
    monkeypatch.setattr(novel_creation_tools, "persist_workspace_documents", _fake_persist)

    result = await novel_creation_tools.generate_characters.ainvoke({"project_id": "p-1", "count": 1})
    assert result["success"] is True
    assert result["content_source"] == "file"
    assert result["index_status"] == "synced"
    assert result["doc_path"] == "characters/char-1.md"
    assert result["written_documents"][0]["entity_id"] == "char-1"


@pytest.mark.anyio
async def test_analyze_chapter_attaches_file_truth_metadata(monkeypatch: pytest.MonkeyPatch):
    async def _fake_internal(**_kwargs):
        return {"success": True, "project_id": "p-2", "analysis_score": 92}

    async def _fake_persist(**_kwargs):
        return [
            {
                "entity_type": "analysis",
                "entity_id": "c-1",
                "doc_path": "analysis/c-1.analysis.json",
                "content_hash": "hash-2",
                "doc_updated_at": "2026-01-02T00:00:00+00:00",
                "size": 456,
                "tags": ["analysis"],
            }
        ]

    monkeypatch.setattr(novel_analysis_tools, "_analyze_chapter_internal", _fake_internal)
    monkeypatch.setattr(novel_analysis_tools, "persist_workspace_documents", _fake_persist)

    result = await novel_analysis_tools.analyze_chapter.ainvoke({"chapter_id": "c-1"})
    assert result["success"] is True
    assert result["content_source"] == "file"
    assert result["doc_path"] == "analysis/c-1.analysis.json"
    assert result["index_status"] == "synced"


@pytest.mark.anyio
async def test_regenerate_chapter_attaches_file_truth_metadata(monkeypatch: pytest.MonkeyPatch):
    async def _fake_internal(**_kwargs):
        return {"success": True, "title": "第一章", "content": "新的内容"}

    async def _fake_persist(**_kwargs):
        return [
            {
                "entity_type": "chapter",
                "entity_id": "chapter-1",
                "doc_path": "chapters/chapter_chapter-1.md",
                "content_hash": "hash-3",
                "doc_updated_at": "2026-01-03T00:00:00+00:00",
                "size": 789,
                "tags": ["chapter"],
            }
        ]

    monkeypatch.setattr(novel_extended_tools, "check_idempotency", lambda *_args, **_kwargs: {"is_duplicate": False})
    monkeypatch.setattr(novel_extended_tools, "_regenerate_chapter_internal", _fake_internal)
    monkeypatch.setattr(novel_extended_tools, "persist_workspace_documents", _fake_persist)

    result = await novel_extended_tools.regenerate_chapter.ainvoke({"project_id": "p-3", "chapter_id": "chapter-1"})
    assert result["success"] is True
    assert result["content_source"] == "file"
    assert result["doc_path"] == "chapters/chapter_chapter-1.md"
    assert result["index_status"] == "synced"

