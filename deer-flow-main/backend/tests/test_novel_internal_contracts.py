"""Contract tests for internal (request=None) novel tool calls.

Validates that:
1. generate_chapter internal path still accepts request=None for direct calls
2. analyze_chapter internal path still accepts request=None for direct calls
3. Missing user context fails instead of falling back to a default user
4. API signatures remain compatible with the internal calling convention
"""
from __future__ import annotations

import importlib
import inspect
from types import SimpleNamespace

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
    def test_missing_user_id_is_rejected_when_request_none(self):
        from app.gateway.novel_migrated.core.user_context import resolve_user_id

        with pytest.raises(Exception):
            resolve_user_id(None)


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
        from app.gateway.novel_migrated.core.user_context import resolve_user_id

        assert resolve_user_id("main-user") == "main-user"
        with pytest.raises(Exception):
            resolve_user_id(None)

    @pytest.mark.skipif(not HAS_USER_CONTEXT, reason="user_context module not importable")
    def test_internal_call_requires_explicit_user_id(self):
        from app.gateway.novel_migrated.core.user_context import resolve_user_id

        assert resolve_user_id("main-user") == "main-user"
        with pytest.raises(Exception):
            resolve_user_id(None)

    @pytest.mark.no_auto_user
    def test_harness_internal_bridge_reads_main_runtime_user(self):
        from deerflow.runtime.user_context import reset_current_user, set_current_user
        from deerflow.tools.builtins.novel_internal import resolve_user_id

        token = set_current_user(SimpleNamespace(id="runtime-user"))
        try:
            assert resolve_user_id(None) == "runtime-user"
        finally:
            reset_current_user(token)

    @pytest.mark.no_auto_user
    def test_harness_internal_bridge_rejects_missing_runtime_user(self):
        from deerflow.tools.builtins.novel_internal import resolve_user_id

        with pytest.raises(RuntimeError, match="requires explicit authenticated user_id"):
            resolve_user_id(None)


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
