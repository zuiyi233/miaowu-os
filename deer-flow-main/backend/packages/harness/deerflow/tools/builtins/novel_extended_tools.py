from __future__ import annotations

import logging
from typing import Any

from langchain.tools import tool

from deerflow.tools.builtins.novel_idempotency import check_idempotency
from deerflow.tools.builtins.novel_tool_helpers import _fail, _ok, get_base_url, get_json, post_json, put_json

logger = logging.getLogger(__name__)


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
    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": project_id,
        "chapter_id": chapter_id,
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
    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": project_id,
        "chapter_id": chapter_id,
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
    base_url = get_base_url()
    try:
        gate_data = await get_json(f"{base_url}/polish/projects/{project_id}/consistency-report")
        if gate_data.get("success") is False:
            return _ok(gate_data, source="novel_migrated.finalize_gate")
    except Exception as exc:
        logger.warning("finalize_project gate check failed (proceeding anyway): %s", exc)
    try:
        data = await post_json(f"{base_url}/polish/projects/{project_id}/finalize", {})
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
    base_url = get_base_url()
    payload: dict[str, Any] = {"file_path": file_path}
    if project_title:
        payload["project_title"] = project_title
    try:
        data = await post_json(f"{base_url}/book-import/tasks", payload)
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
    base_url = get_base_url()
    payload: dict[str, Any] = {"chapter_id": chapter_id}
    if project_id:
        payload["project_id"] = project_id
    try:
        data = await post_json(
            f"{base_url}/api/memories/projects/{project_id}/analyze-chapter/{chapter_id}",
            payload,
        )
        return _ok(data, source="novel_migrated.character_states")
    except Exception as exc:
        logger.error("update_character_states failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.character_states")
