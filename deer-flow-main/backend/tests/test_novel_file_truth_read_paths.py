from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.gateway.novel_migrated.api import chapters, characters, outlines


class _Result:
    def __init__(self, obj):
        self._obj = obj

    def scalar_one_or_none(self):
        return self._obj


class _DB:
    def __init__(self, obj):
        self._obj = obj

    async def execute(self, _query):
        return _Result(self._obj)


class _MissingFileWorkspaceService:
    async def read_document(self, **_kwargs):
        raise FileNotFoundError("missing")


@pytest.mark.anyio
async def test_get_chapter_raises_404_when_workspace_file_missing(monkeypatch: pytest.MonkeyPatch):
    class _Chapter:
        id = "chapter-1"
        project_id = "project-1"

    async def _fake_verify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(chapters, "verify_project_access", _fake_verify)
    monkeypatch.setattr(chapters, "workspace_document_service", _MissingFileWorkspaceService())

    with pytest.raises(HTTPException) as exc:
        await chapters.get_chapter("chapter-1", user_id="user-1", db=_DB(_Chapter()))

    assert exc.value.status_code == 404
    assert "文件" in str(exc.value.detail)


@pytest.mark.anyio
async def test_get_character_raises_404_when_workspace_file_missing(monkeypatch: pytest.MonkeyPatch):
    class _Character:
        id = "char-1"
        project_id = "project-1"

    async def _fake_verify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(characters, "verify_project_access", _fake_verify)
    monkeypatch.setattr(characters, "workspace_document_service", _MissingFileWorkspaceService())

    with pytest.raises(HTTPException) as exc:
        await characters.get_character("char-1", user_id="user-1", db=_DB(_Character()))

    assert exc.value.status_code == 404
    assert "文件" in str(exc.value.detail)


@pytest.mark.anyio
async def test_get_outline_raises_404_when_workspace_file_missing(monkeypatch: pytest.MonkeyPatch):
    class _Outline:
        id = "outline-1"
        project_id = "project-1"

    async def _fake_verify(*_args, **_kwargs):
        return None

    monkeypatch.setattr(outlines, "verify_project_access", _fake_verify)
    monkeypatch.setattr(outlines, "workspace_document_service", _MissingFileWorkspaceService())

    with pytest.raises(HTTPException) as exc:
        await outlines.get_outline("outline-1", user_id="user-1", db=_DB(_Outline()))

    assert exc.value.status_code == 404
    assert "文件" in str(exc.value.detail)

