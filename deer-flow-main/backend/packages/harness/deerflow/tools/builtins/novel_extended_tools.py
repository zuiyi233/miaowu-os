from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import quote

import httpx
from langchain.tools import tool

from deerflow.tools.builtins.novel_idempotency import check_idempotency
from deerflow.tools.builtins.novel_tool_helpers import _fail, _ok, build_headers, get_base_url, get_json, get_timeout_seconds, post_json

logger = logging.getLogger(__name__)


def _normalize_required_id(value: str, field_name: str) -> tuple[str | None, dict[str, Any] | None]:
    normalized = (value or "").strip()
    if not normalized:
        return None, _fail(f"{field_name} required")
    return normalized, None


def _safe_path_segment(value: str) -> str:
    return quote(value, safe="")


async def _regenerate_chapter_internal(project_id, chapter_id, modification_instructions="", custom_instructions="", target_word_count=3000, focus_areas=None, preserve_elements=None):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    RegenerateRequest = load_attr("app.gateway.novel_migrated.api.chapters", "RegenerateRequest")
    regen_fn = load_attr("app.gateway.novel_migrated.api.chapters", "regenerate_chapter")
    if RegenerateRequest is None or not callable(regen_fn):
        raise RuntimeError("internal regenerate_chapter unavailable")
    req = RegenerateRequest(
        project_id=project_id, chapter_id=chapter_id,
        modification_instructions=modification_instructions,
        custom_instructions=custom_instructions, target_word_count=target_word_count,
        focus_areas=focus_areas, preserve_elements=preserve_elements,
    )
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await regen_fn(req=req, request=None, user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.regenerate.internal")


async def _partial_regenerate_internal(project_id, chapter_id, selected_text, context_before="", context_after="", user_instructions=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-chapter-ai-edit")
    PartialRegenerateRequest = load_attr("app.gateway.novel_migrated.api.chapters", "PartialRegenerateRequest")
    partial_fn = load_attr("app.gateway.novel_migrated.api.chapters", "partial_regenerate")
    if PartialRegenerateRequest is None or not callable(partial_fn):
        raise RuntimeError("internal partial_regenerate unavailable")
    req = PartialRegenerateRequest(
        project_id=project_id, chapter_id=chapter_id, selected_text=selected_text,
        context_before=context_before, context_after=context_after, user_instructions=user_instructions,
    )
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await partial_fn(req=req, request=None, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.partial_regenerate.internal")


async def _finalize_project_internal(project_id):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    user_id = resolve_user_id(None)

    report_fn = load_attr("app.gateway.novel_migrated.api.polish", "get_project_consistency_report")
    if callable(report_fn):
        async with AsyncSessionLocal() as db:
            gate_data = await report_fn(project_id=project_id, user_id=user_id, db=db)
        gate_dict = to_dict(gate_data)
        if gate_dict.get("success") is False:
            return _ok(gate_dict, source="novel_migrated.finalize_gate.internal")

    finalize_fn = load_attr("app.gateway.novel_migrated.api.polish", "finalize_project")
    if not callable(finalize_fn):
        raise RuntimeError("internal finalize_project unavailable")
    async with AsyncSessionLocal() as db:
        result = await finalize_fn(project_id=project_id, req=None, user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.finalize.internal")


async def _import_book_internal(file_path, project_title=""):
    from deerflow.tools.builtins.novel_internal import (
        load_attr,
        resolve_user_id,
        to_dict,
    )

    filename = os.path.basename(file_path)
    with open(file_path, "rb") as f:
        content = f.read()
    service = load_attr("app.gateway.novel_migrated.services.book_import_service", "book_import_service")
    if service is None:
        raise RuntimeError("book_import_service unavailable")
    user_id = resolve_user_id(None)
    result = await service.create_task(
        user_id=user_id,
        filename=filename,
        file_content=content,
        project_id=None,
        create_new_project=True,
        import_mode="append",
        extract_mode="tail",
        tail_chapter_count=10,
    )
    return _ok(to_dict(result), source="novel_migrated.import_book.internal")


async def _update_character_states_internal(chapter_id, project_id=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="memory-ai")
    analyze_fn = load_attr("app.gateway.novel_migrated.api.memories", "analyze_chapter")
    if not callable(analyze_fn):
        raise RuntimeError("internal memories.analyze_chapter unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await analyze_fn(
            project_id=project_id,
            chapter_id=chapter_id,
            request=None,
            db=db,
            user_id=user_id,
            ai_service=ai_service,
        )
    return _ok(to_dict(result), source="novel_migrated.character_states.internal")


async def _post_book_import_multipart(
    *,
    url: str,
    file_path: str,
    project_title: str = "",
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    timeout = httpx.Timeout(get_timeout_seconds() if timeout_seconds is None else max(1.0, float(timeout_seconds)))
    headers = build_headers()
    headers.pop("Content-Type", None)

    filename = os.path.basename(file_path)
    with open(file_path, "rb") as file_obj:
        files = {"file": (filename, file_obj, "text/plain")}
        data: dict[str, Any] = {
            "create_new_project": "true",
            "import_mode": "append",
            "extract_mode": "tail",
            "tail_chapter_count": "10",
        }
        if project_title:
            data["project_title"] = project_title

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, data=data, files=files, headers=headers)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                return payload
            return {"raw": payload}


@tool("regenerate_chapter", parse_docstring=True)
async def regenerate_chapter(
    project_id: str,
    chapter_id: str,
    modification_instructions: str = "",
    custom_instructions: str = "",
    target_word_count: int = 3000,
    focus_areas: list[str] | None = None,
    preserve_elements: list[str] | None = None,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Rewrite a chapter with modification instructions.

    Creates a regeneration task that rewrites the chapter content
    based on AI analysis suggestions or user-specified instructions.

    Args:
        project_id: The novel project ID.
        chapter_id: The chapter ID to regenerate.
        modification_instructions: AI-suggested modification directions.
        custom_instructions: User-specified custom rewrite instructions.
        target_word_count: Target word count for the regenerated chapter (default 3000).
        focus_areas: Areas to focus on (e.g. ["pacing", "dialogue", "description"]).
        preserve_elements: Elements to preserve during rewriting (e.g. ["character_voice", "plot_points"]).
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, task_id for tracking, and raw response.
    """
    dup = check_idempotency("regenerate_chapter", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.regenerate")
    normalized_project_id, validation_error = _normalize_required_id(project_id, "project_id")
    if validation_error:
        return validation_error
    normalized_chapter_id, validation_error = _normalize_required_id(chapter_id, "chapter_id")
    if validation_error:
        return validation_error

    try:
        return await _regenerate_chapter_internal(
            project_id=normalized_project_id, chapter_id=normalized_chapter_id,
            modification_instructions=modification_instructions,
            custom_instructions=custom_instructions, target_word_count=target_word_count,
            focus_areas=focus_areas, preserve_elements=preserve_elements,
        )
    except Exception as exc:
        logger.warning("regenerate_chapter internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": normalized_project_id,
        "chapter_id": normalized_chapter_id,
        "modification_instructions": modification_instructions,
        "custom_instructions": custom_instructions,
        "target_word_count": target_word_count,
    }
    if focus_areas:
        payload["focus_areas"] = focus_areas
    if preserve_elements:
        payload["preserve_elements"] = preserve_elements
    try:
        data = await post_json(f"{base_url}/chapters/regenerate", payload)
        return _ok(data, source="novel_migrated.regenerate")
    except Exception as exc:
        logger.error("regenerate_chapter failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.regenerate")


@tool("partial_regenerate", parse_docstring=True)
async def partial_regenerate(
    project_id: str,
    chapter_id: str,
    selected_text: str,
    context_before: str = "",
    context_after: str = "",
    user_instructions: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Partially rewrite selected text within a chapter.

    Replaces only the selected portion of a chapter while maintaining
    continuity with the surrounding context.

    Args:
        project_id: The novel project ID.
        chapter_id: The chapter ID containing the text to rewrite.
        selected_text: The exact text to be replaced.
        context_before: Text before the selection for context.
        context_after: Text after the selection for context.
        user_instructions: Instructions for how to rewrite the selected text.
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, regenerated text, and raw response.
    """
    dup = check_idempotency("partial_regenerate", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.partial_regenerate")
    normalized_project_id, validation_error = _normalize_required_id(project_id, "project_id")
    if validation_error:
        return validation_error
    normalized_chapter_id, validation_error = _normalize_required_id(chapter_id, "chapter_id")
    if validation_error:
        return validation_error

    try:
        return await _partial_regenerate_internal(
            project_id=normalized_project_id, chapter_id=normalized_chapter_id,
            selected_text=selected_text, context_before=context_before,
            context_after=context_after, user_instructions=user_instructions,
        )
    except Exception as exc:
        logger.warning("partial_regenerate internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": normalized_project_id,
        "chapter_id": normalized_chapter_id,
        "selected_text": selected_text,
        "context_before": context_before,
        "context_after": context_after,
        "user_instructions": user_instructions,
    }
    try:
        data = await post_json(f"{base_url}/chapters/partial-regenerate", payload)
        return _ok(data, source="novel_migrated.partial_regenerate")
    except Exception as exc:
        logger.error("partial_regenerate failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.partial_regenerate")


@tool("finalize_project", parse_docstring=True)
async def finalize_project(
    project_id: str,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Run finalize gate check and finalize a novel project.

    Performs consistency checks, quality gate evaluation, and if all
    checks pass, marks the project as finalized.

    Args:
        project_id: The novel project ID to finalize.
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, gate result (pass/warn/block), and raw response.
    """
    dup = check_idempotency("finalize_project", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.finalize")
    normalized_project_id, validation_error = _normalize_required_id(project_id, "project_id")
    if validation_error:
        return validation_error

    try:
        return await _finalize_project_internal(project_id=normalized_project_id)
    except Exception as exc:
        logger.warning("finalize_project internal failed: %s, falling back to HTTP", exc)

    project_path_id = _safe_path_segment(normalized_project_id)
    base_url = get_base_url()
    try:
        gate_data = await get_json(f"{base_url}/polish/projects/{project_path_id}/consistency-report")
        if gate_data.get("success") is False:
            return _ok(gate_data, source="novel_migrated.finalize_gate")
    except Exception as exc:
        logger.warning("finalize_project gate check failed (proceeding anyway): %s", exc)
    try:
        data = await post_json(f"{base_url}/polish/projects/{project_path_id}/finalize", {})
        return _ok(data, source="novel_migrated.finalize")
    except Exception as exc:
        logger.error("finalize_project failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.finalize")


@tool("import_book", parse_docstring=True)
async def import_book(
    file_path: str,
    project_title: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Import a novel from a text file (book import / reverse engineering).

    Creates an import task that parses a TXT file, splits it into chapters,
    and reverse-engineers project metadata, outlines, and characters.

    Args:
        file_path: Path to the TXT file to import.
        project_title: Optional title for the imported project.
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, task_id for tracking, and raw response.
    """
    dup = check_idempotency("import_book", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.import_book")

    try:
        return await _import_book_internal(file_path=file_path, project_title=project_title)
    except Exception as exc:
        logger.warning("import_book internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    try:
        data = await _post_book_import_multipart(
            url=f"{base_url}/book-import/tasks",
            file_path=file_path,
            project_title=project_title,
        )
        return _ok(data, source="novel_migrated.import_book")
    except Exception as exc:
        logger.error("import_book failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.import_book")


@tool("update_character_states", parse_docstring=True)
async def update_character_states(
    chapter_id: str,
    project_id: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Update character states based on chapter analysis results.

    Triggers the character state update pipeline which processes
    the latest chapter analysis to update character psychological
    states, relationships, and organization memberships.

    Args:
        chapter_id: The chapter ID whose analysis should drive state updates.
        project_id: The project ID (optional, derived from chapter if omitted).
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, updated character states, and raw response.
    """
    dup = check_idempotency("update_character_states", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.character_states")
    normalized_chapter_id, validation_error = _normalize_required_id(chapter_id, "chapter_id")
    if validation_error:
        return validation_error
    normalized_project_id, validation_error = _normalize_required_id(project_id, "project_id")
    if validation_error:
        return validation_error

    try:
        return await _update_character_states_internal(
            chapter_id=normalized_chapter_id, project_id=normalized_project_id,
        )
    except Exception as exc:
        logger.warning("update_character_states internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    payload: dict[str, Any] = {"chapter_id": normalized_chapter_id, "project_id": normalized_project_id}
    project_path_id = _safe_path_segment(normalized_project_id)
    chapter_path_id = _safe_path_segment(normalized_chapter_id)
    try:
        data = await post_json(
            f"{base_url}/api/memories/projects/{project_path_id}/analyze-chapter/{chapter_path_id}",
            payload,
        )
        return _ok(data, source="novel_migrated.character_states")
    except Exception as exc:
        logger.error("update_character_states failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.character_states")
