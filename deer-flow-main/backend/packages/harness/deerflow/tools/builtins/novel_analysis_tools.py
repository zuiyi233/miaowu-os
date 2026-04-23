from __future__ import annotations

import logging
from typing import Any

from langchain.tools import tool

from deerflow.tools.builtins.novel_tool_helpers import _fail, _ok, get_base_url, get_json, post_json

logger = logging.getLogger(__name__)


@tool("analyze_chapter", parse_docstring=True)
async def analyze_chapter(
    chapter_id: str,
    force: bool = False,
) -> dict[str, Any]:
    """Analyze a chapter's plot, foreshadowing, and character states.

    Triggers the plot analysis pipeline which extracts hooks, foreshadows,
    conflicts, emotional arcs, character state changes, and quality scores.

    Args:
        chapter_id: The chapter ID to analyze.
        force: If True, re-analyze even if a previous analysis exists.

    Returns:
        A result dict with success, analysis task status, and raw response.
    """
    base_url = get_base_url()
    payload: dict[str, Any] = {"force": force}
    try:
        data = await post_json(f"{base_url}/api/chapters/{chapter_id}/analyze", payload)
        return _ok(data, source="novel_migrated.analyze_chapter")
    except Exception as exc:
        logger.error("analyze_chapter failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.analyze_chapter")


@tool("manage_foreshadow", parse_docstring=True)
async def manage_foreshadow(
    action: str,
    project_id: str = "",
    foreshadow_id: str = "",
    title: str = "",
    content: str = "",
    status: str = "",
    category: str = "",
    is_long_term: bool = False,
    importance: float = 0.5,
    related_characters: list[str] | None = None,
) -> dict[str, Any]:
    """Manage foreshadowing elements in a novel project.

    Supports CRUD operations and state transitions for foreshadowing elements.

    Args:
        action: Operation to perform. One of: "list", "create", "update",
                "plant", "resolve", "abandon", "context", "sync".
        project_id: The project ID (required for list, create, context, sync).
        foreshadow_id: The foreshadow ID (required for update, plant, resolve, abandon).
        title: Foreshadow title (for create/update).
        content: Foreshadow content/description (for create/update).
        status: Target status for update operations.
        category: Foreshadow category (identity/mystery/item/relationship/event).
        is_long_term: Whether this is a long-term foreshadow.
        importance: Importance score 0.0-1.0 (default 0.5).
        related_characters: List of related character names.

    Returns:
        A result dict with success, foreshadow data, and raw response.
    """
    base_url = get_base_url()

    if action == "list":
        if not project_id:
            return _fail("project_id required for list action")
        try:
            data = await get_json(f"{base_url}/api/foreshadows/projects/{project_id}")
            return _ok(data, source="novel_migrated.foreshadow_list")
        except Exception as exc:
            return _fail(str(exc), source="novel_migrated.foreshadow_list")

    if action == "context":
        if not project_id:
            return _fail("project_id required for context action")
        chapter_number = int(content) if content.isdigit() else 1
        try:
            data = await get_json(f"{base_url}/api/foreshadows/projects/{project_id}/context/{chapter_number}")
            return _ok(data, source="novel_migrated.foreshadow_context")
        except Exception as exc:
            return _fail(str(exc), source="novel_migrated.foreshadow_context")

    if action == "sync":
        if not project_id:
            return _fail("project_id required for sync action")
        try:
            data = await post_json(f"{base_url}/api/foreshadows/projects/{project_id}/sync-from-analysis", {})
            return _ok(data, source="novel_migrated.foreshadow_sync")
        except Exception as exc:
            return _fail(str(exc), source="novel_migrated.foreshadow_sync")

    if action == "create":
        if not project_id or not title or not content:
            return _fail("project_id, title, and content required for create action")
        payload: dict[str, Any] = {
            "project_id": project_id,
            "title": title,
            "content": content,
            "importance": importance,
            "is_long_term": is_long_term,
        }
        if category:
            payload["category"] = category
        if related_characters:
            payload["related_characters"] = related_characters
        try:
            data = await post_json(f"{base_url}/api/foreshadows", payload)
            return _ok(data, source="novel_migrated.foreshadow_create")
        except Exception as exc:
            return _fail(str(exc), source="novel_migrated.foreshadow_create")

    if action in ("update", "plant", "resolve", "abandon"):
        if not foreshadow_id:
            return _fail("foreshadow_id required for update/plant/resolve/abandon action")
        if action == "update":
            payload = {}
            if title:
                payload["title"] = title
            if content:
                payload["content"] = content
            if status:
                payload["status"] = status
            if category:
                payload["category"] = category
            try:
                from deerflow.tools.builtins.novel_tool_helpers import put_json
                data = await put_json(f"{base_url}/api/foreshadows/{foreshadow_id}", payload)
                return _ok(data, source="novel_migrated.foreshadow_update")
            except Exception as exc:
                return _fail(str(exc), source="novel_migrated.foreshadow_update")
        try:
            data = await post_json(f"{base_url}/api/foreshadows/{foreshadow_id}/{action}", {})
            return _ok(data, source=f"novel_migrated.foreshadow_{action}")
        except Exception as exc:
            return _fail(str(exc), source=f"novel_migrated.foreshadow_{action}")

    return _fail(f"unknown action: {action}")


@tool("search_memories", parse_docstring=True)
async def search_memories(
    project_id: str,
    query: str,
    memory_type: str = "",
    limit: int = 10,
) -> dict[str, Any]:
    """Search novel project memories using semantic similarity.

    Retrieves relevant story memories (plot points, character events,
    world details, foreshadowing) based on semantic search.

    Args:
        project_id: The novel project ID.
        query: Search query text for semantic matching.
        memory_type: Optional filter by type (plot_point/character_event/world_detail/hook/foreshadow).
        limit: Maximum number of results to return (default 10).

    Returns:
        A result dict with success, matching memories, and raw response.
    """
    base_url = get_base_url()
    payload: dict[str, Any] = {
        "query": query,
        "limit": limit,
    }
    if memory_type:
        payload["memory_type"] = memory_type
    try:
        data = await post_json(f"{base_url}/api/memories/projects/{project_id}/search", payload)
        return _ok(data, source="novel_migrated.memory_search")
    except Exception as exc:
        logger.error("search_memories failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.memory_search")


@tool("check_consistency", parse_docstring=True)
async def check_consistency(
    project_id: str,
) -> dict[str, Any]:
    """Check cross-chapter consistency for a novel project.

    Analyzes character survival status consistency, plot coherence,
    and other quality metrics across all chapters.

    Args:
        project_id: The novel project ID.

    Returns:
        A result dict with success, consistency report, and raw response.
    """
    base_url = get_base_url()
    try:
        data = await get_json(f"{base_url}/polish/projects/{project_id}/consistency-report")
        return _ok(data, source="novel_migrated.consistency_check")
    except Exception as exc:
        logger.error("check_consistency failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.consistency_check")


@tool("polish_text", parse_docstring=True)
async def polish_text(
    text: str,
    style: str = "literary",
    project_id: str = "",
) -> dict[str, Any]:
    """Polish and improve text with AI-powered refinement.

    Applies a specific writing style to improve text quality.

    Args:
        text: The text content to polish.
        style: Polish style - one of: literary, formal, casual, vivid, concise.
        project_id: Optional project ID for context-aware polishing.

    Returns:
        A result dict with success, polished text, and raw response.
    """
    base_url = get_base_url()
    payload: dict[str, Any] = {
        "text": text,
        "style": style,
    }
    if project_id:
        payload["project_id"] = project_id
    try:
        data = await post_json(f"{base_url}/polish", payload)
        return _ok(data, source="novel_migrated.polish")
    except Exception as exc:
        logger.error("polish_text failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.polish")
