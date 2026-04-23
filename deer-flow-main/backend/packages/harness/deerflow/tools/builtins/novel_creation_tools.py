from __future__ import annotations

import logging
from typing import Any

from langchain.tools import tool

from deerflow.tools.builtins.novel_idempotency import check_idempotency
from deerflow.tools.builtins.novel_tool_helpers import _fail, _ok, get_base_url, post_json

logger = logging.getLogger(__name__)


@tool("build_world", parse_docstring=True)
async def build_world(
    project_id: str,
    title: str = "",
    genre: str = "",
    theme: str = "",
    description: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Generate world-building settings for a novel project.

    Calls the novel_migrated world-build API to produce time_period,
    location, atmosphere, and rules for the project.

    Args:
        project_id: The novel project ID to generate world settings for.
        title: Novel title (used as context for generation).
        genre: Novel genre (used as context for generation).
        theme: Novel theme (used as context for generation).
        description: Novel description (used as context for generation).
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, world fields, and raw response.
    """
    dup = check_idempotency("build_world", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.world_build")
    base_url = get_base_url()
    payload: dict[str, Any] = {"project_id": project_id}
    if title:
        payload["title"] = title
    if genre:
        payload["genre"] = genre
    if theme:
        payload["theme"] = theme
    if description:
        payload["description"] = description
    try:
        data = await post_json(f"{base_url}/projects/world-build", payload)
        return _ok(data, source="novel_migrated.world_build")
    except Exception as exc:
        logger.error("build_world failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.world_build")


@tool("generate_characters", parse_docstring=True)
async def generate_characters(
    project_id: str,
    count: int = 5,
    requirements: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Generate characters and organizations for a novel project.

    Calls the novel_migrated character generation API to create
    characters with relationships, careers, and organization memberships.

    Args:
        project_id: The novel project ID to generate characters for.
        count: Number of characters to generate (default 5).
        requirements: Special requirements or constraints for character generation.
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, generated character data, and raw response.
    """
    dup = check_idempotency("generate_characters", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.characters")
    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": project_id,
        "count": count,
    }
    if requirements:
        payload["requirements"] = requirements
    try:
        data = await post_json(f"{base_url}/characters/generate", payload)
        return _ok(data, source="novel_migrated.characters")
    except Exception as exc:
        logger.error("generate_characters failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.characters")


@tool("generate_outline", parse_docstring=True)
async def generate_outline(
    project_id: str,
    chapter_count: int = 10,
    requirements: str = "",
    continue_from: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Generate or continue an outline for a novel project.

    Creates initial chapter outlines or continues from existing ones.

    Args:
        project_id: The novel project ID to generate outline for.
        chapter_count: Number of chapters to outline (default 10).
        requirements: Additional requirements for outline generation.
        continue_from: If provided, continue the outline from this point
                       (e.g., "chapter 5" to continue from chapter 5).
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, outline data, and raw response.
    """
    dup = check_idempotency("generate_outline", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.outline")
    base_url = get_base_url()
    if continue_from:
        payload: dict[str, Any] = {
            "project_id": project_id,
            "chapter_count": chapter_count,
        }
        if requirements:
            payload["requirements"] = requirements
        try:
            data = await post_json(f"{base_url}/outlines/continue", payload)
            return _ok(data, source="novel_migrated.outline_continue")
        except Exception as exc:
            logger.error("generate_outline (continue) failed: %s", exc)
            return _fail(str(exc), source="novel_migrated.outline_continue")

    payload = {
        "project_id": project_id,
        "title": "",
        "content": "",
        "chapter_count": chapter_count,
    }
    if requirements:
        payload["requirements"] = requirements
    try:
        data = await post_json(f"{base_url}/outlines/project/{project_id}", payload)
        return _ok(data, source="novel_migrated.outline_create")
    except Exception as exc:
        logger.error("generate_outline failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.outline_create")


@tool("expand_outline", parse_docstring=True)
async def expand_outline(
    outline_id: str,
    project_id: str,
    target_chapter_count: int = 3,
    strategy: str = "single",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Expand an outline node into sub-chapters.

    Takes an existing outline and generates detailed sub-chapter plans.

    Args:
        outline_id: The outline ID to expand.
        project_id: The project ID the outline belongs to.
        target_chapter_count: Number of sub-chapters to generate (default 3).
        strategy: Expansion strategy - "single" (one batch) or "multi" (multiple batches).
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, expanded chapter plans, and raw response.
    """
    dup = check_idempotency("expand_outline", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.outline_expand")
    base_url = get_base_url()
    payload: dict[str, Any] = {
        "outline_id": outline_id,
        "project_id": project_id,
        "target_chapter_count": target_chapter_count,
        "strategy": strategy,
    }
    try:
        data = await post_json(f"{base_url}/outlines/expand", payload)
        return _ok(data, source="novel_migrated.outline_expand")
    except Exception as exc:
        logger.error("expand_outline failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.outline_expand")


@tool("generate_chapter", parse_docstring=True)
async def generate_chapter(
    project_id: str,
    chapter_ids: list[str] | None = None,
    outline_ids: list[str] | None = None,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Generate chapter content for a novel project.

    Creates a batch generation task for one or more chapters.

    Args:
        project_id: The novel project ID.
        chapter_ids: List of specific chapter IDs to generate.
        outline_ids: List of outline IDs to generate chapters from.
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, task_id for tracking, and raw response.
    """
    dup = check_idempotency("generate_chapter", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.chapter_generate")
    base_url = get_base_url()
    payload: dict[str, Any] = {"project_id": project_id}
    if chapter_ids:
        payload["chapter_ids"] = chapter_ids
    if outline_ids:
        payload["outline_ids"] = outline_ids
    try:
        data = await post_json(f"{base_url}/chapters/batch-generate", payload)
        return _ok(data, source="novel_migrated.chapter_generate")
    except Exception as exc:
        logger.error("generate_chapter failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.chapter_generate")


@tool("generate_career_system", parse_docstring=True)
async def generate_career_system(
    project_id: str,
    main_career_count: int = 3,
    sub_career_count: int = 5,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Generate a career/power system for a novel project.

    Creates main and sub career hierarchies with progression stages.

    Args:
        project_id: The novel project ID.
        main_career_count: Number of main careers to generate (default 3).
        sub_career_count: Number of sub careers to generate (default 5).
        idempotency_key: Optional key to prevent duplicate execution.

    Returns:
        A result dict with success, career data, and raw response.
    """
    dup = check_idempotency("generate_career_system", idempotency_key)
    if dup["is_duplicate"]:
        return _ok({"skipped": True, "reason": "duplicate_idempotency_key"}, source="novel_migrated.career_system")
    base_url = get_base_url()
    params: dict[str, Any] = {
        "project_id": project_id,
        "main_career_count": main_career_count,
        "sub_career_count": sub_career_count,
    }
    try:
        from deerflow.tools.builtins.novel_tool_helpers import get_json
        data = await get_json(f"{base_url}/api/careers/generate-system", params=params)
        return _ok(data, source="novel_migrated.career_system")
    except Exception as exc:
        logger.error("generate_career_system failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.career_system")
