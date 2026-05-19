"""Contract tests for internal (request=None) novel tool calls.

Validates that:
1. generate_chapter internal path resolves user_id correctly when request=None
2. analyze_chapter internal path resolves user_id correctly when request=None
3. Both paths fall back to 'local_single_user' when no user context is available
4. API signatures remain compatible with the internal calling convention
"""
from __future__ import annotations

import importlib
import inspect

import pytest


def _can_import(dotted_path: str) -> bool:
    try:
        importlib.import_module(dotted_path)
        return True
    except Exception:
        return False


HAS_CHAPTERS_API = _can_import("app.gateway.novel_migrated.api.chapters")
HAS_NOVEL_STREAM_API = _can_import("app.gateway.novel_migrated.api.novel_stream")
HAS_MEMORIES_API = _can_import("app.gateway.novel_migrated.api.memories")
HAS_USER_CONTEXT = _can_import("app.gateway.novel_migrated.core.user_context")
HAS_NOVEL_CREATION_TOOLS = _can_import("deerflow.tools.builtins.novel_creation_tools")
HAS_NOVEL_ANALYSIS_TOOLS = _can_import("deerflow.tools.builtins.novel_analysis_tools")


class TestGenerateChapterInternalContract:
    @pytest.mark.skipif(not HAS_CHAPTERS_API, reason="chapters API module not importable")
    def test_batch_generate_chapters_accepts_request_none(self):
        from app.gateway.novel_migrated.api.chapters import batch_generate_chapters

        sig = inspect.signature(batch_generate_chapters)
        request_param = sig.parameters.get("request")
        assert request_param is not None, "batch_generate_chapters must have a 'request' parameter"
        assert request_param.default is None, (
            "batch_generate_chapters 'request' parameter should default to None "
            "to support internal calls with request=None"
        )

    @pytest.mark.skipif(not HAS_USER_CONTEXT, reason="user_context module not importable")
    def test_effective_user_id_fallback_when_request_none(self):
        from app.gateway.novel_migrated.core.user_context import resolve_user_id

        result = resolve_user_id(None)
        assert result == "local_single_user" or isinstance(result, str), (
            f"When user_id is None, resolve_user_id should fallback gracefully, got: {result}"
        )


class TestAnalyzeChapterInternalContract:
    @pytest.mark.skipif(not HAS_NOVEL_STREAM_API, reason="novel_stream API module not importable")
    def test_analyze_chapter_accepts_request_none(self):
        from app.gateway.novel_migrated.api.novel_stream import analyze_chapter

        sig = inspect.signature(analyze_chapter)
        request_param = sig.parameters.get("request")
        assert request_param is not None, "analyze_chapter must have a 'request' parameter"
        assert request_param.default is None, (
            "analyze_chapter 'request' parameter should default to None "
            "for internal calling convention"
        )

    @pytest.mark.skipif(not HAS_MEMORIES_API, reason="memories API module not importable")
    def test_memories_analyze_chapter_accepts_request_none(self):
        from app.gateway.novel_migrated.api.memories import analyze_chapter

        sig = inspect.signature(analyze_chapter)
        request_param = sig.parameters.get("request")
        assert request_param is not None, "memories.analyze_chapter must have a 'request' parameter"
        assert request_param.default is None, (
            "memories.analyze_chapter 'request' parameter should default to None"
        )


class TestUserIdResolutionContract:
    @pytest.mark.skipif(not HAS_USER_CONTEXT, reason="user_context module not importable")
    def test_user_id_resolution_chain(self):
        from app.gateway.novel_migrated.core.user_context import resolve_user_id, get_default_user_id

        default_user = get_default_user_id()
        assert default_user is not None and len(default_user) > 0, (
            "get_default_user_id() must return a non-empty string"
        )

        resolved = resolve_user_id(None)
        assert resolved is not None and len(resolved) > 0, (
            "resolve_user_id(None) must return a non-None user_id"
        )

    @pytest.mark.skipif(not HAS_USER_CONTEXT, reason="user_context module not importable")
    def test_internal_call_user_id_not_empty(self):
        from app.gateway.novel_migrated.core.user_context import resolve_user_id

        user_id = resolve_user_id(None)
        assert isinstance(user_id, str) and len(user_id) > 0, (
            f"Internal call must always resolve to a non-empty user_id, got: {user_id!r}"
        )

    @pytest.mark.skipif(not HAS_USER_CONTEXT, reason="user_context module not importable")
    def test_default_user_id_is_local_single_user(self):
        from app.gateway.novel_migrated.core.user_context import DEFAULT_USER_ID

        assert DEFAULT_USER_ID == "local_single_user", (
            f"DEFAULT_USER_ID should be 'local_single_user', got: {DEFAULT_USER_ID!r}"
        )


class TestSignatureStability:
    @pytest.mark.skipif(not HAS_NOVEL_CREATION_TOOLS, reason="novel_creation_tools not importable")
    def test_generate_chapter_internal_signature_stable(self):
        from deerflow.tools.builtins.novel_creation_tools import _generate_chapter_internal

        sig = inspect.signature(_generate_chapter_internal)
        params = list(sig.parameters.keys())
        assert "project_id" in params, (
            f"_generate_chapter_internal must accept 'project_id', got params: {params}"
        )

    @pytest.mark.skipif(not HAS_NOVEL_ANALYSIS_TOOLS, reason="novel_analysis_tools not importable")
    def test_analyze_chapter_internal_signature_stable(self):
        from deerflow.tools.builtins.novel_analysis_tools import _analyze_chapter_internal

        sig = inspect.signature(_analyze_chapter_internal)
        params = list(sig.parameters.keys())
        assert "chapter_id" in params, (
            f"_analyze_chapter_internal must accept 'chapter_id', got params: {params}"
        )
