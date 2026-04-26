from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from langchain.tools import tool

from deerflow.tools.builtins.novel_idempotency import check_idempotency
from deerflow.tools.builtins.novel_tool_helpers import _fail, _ok, build_headers, get_base_url, get_timeout_seconds, post_json

logger = logging.getLogger(__name__)


def _build_character_user_input(*, count: int, requirements: str) -> str:
    normalized_requirements = (requirements or "").strip()
    if normalized_requirements:
        return f"请生成 {max(1, count)} 个角色，并满足以下要求：{normalized_requirements}"
    return f"请生成 {max(1, count)} 个角色"


def _emit_progress_event(event_type: str, **payload: Any) -> None:
    try:
        from langgraph.config import get_stream_writer

        writer = get_stream_writer()
        if writer:
            writer({"type": event_type, **payload})
    except Exception:  # pragma: no cover - best effort progress event
        logger.debug("emit progress event failed", exc_info=True)


async def _consume_career_system_stream(*, base_url: str, params: dict[str, Any]) -> dict[str, Any]:
    """Consume career-system SSE endpoint and extract final result payload."""
    timeout = httpx.Timeout(get_timeout_seconds())
    stream_url = f"{base_url}/api/careers/generate-system"
    result_payload: dict[str, Any] | None = None
    stream_error: str | None = None

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("GET", stream_url, params=params, headers=build_headers()) as response:
            response.raise_for_status()
            async for raw_line in response.aiter_lines():
                line = (raw_line or "").strip()
                if not line or line.startswith(":"):
                    continue
                if not line.startswith("data:"):
                    continue
                data_text = line[len("data:") :].strip()
                if not data_text:
                    continue
                try:
                    payload = json.loads(data_text)
                except json.JSONDecodeError:
                    continue

                msg_type = str(payload.get("type") or "")
                if msg_type == "result" and isinstance(payload.get("data"), dict):
                    result_payload = payload["data"]
                elif msg_type == "error":
                    stream_error = str(payload.get("error") or "career system stream error")
                elif msg_type == "done":
                    break

    if stream_error:
        raise RuntimeError(stream_error)
    if result_payload is None:
        raise RuntimeError("career system stream finished without result payload")
    return result_payload


async def _build_world_internal(project_id, title="", genre="", theme="", description=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-world-building")
    WorldBuildRequest = load_attr("app.gateway.novel_migrated.api.projects", "WorldBuildRequest")
    world_build_fn = load_attr("app.gateway.novel_migrated.api.projects", "world_build")
    if WorldBuildRequest is None or not callable(world_build_fn):
        raise RuntimeError("internal world_build unavailable")
    req = WorldBuildRequest(project_id=project_id)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await world_build_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.world_build.internal")


async def _generate_characters_internal(project_id, count=5, requirements=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-characters")
    SingleGenerateRequest = load_attr("app.gateway.novel_migrated.api.characters", "SingleGenerateRequest")
    generate_fn = load_attr("app.gateway.novel_migrated.api.characters", "generate_single_character")
    if SingleGenerateRequest is None or not callable(generate_fn):
        raise RuntimeError("internal generate_characters unavailable")
    user_input = _build_character_user_input(count=count, requirements=requirements)
    req = SingleGenerateRequest(project_id=project_id, user_input=user_input, is_organization=False)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await generate_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.characters.internal")


async def _generate_outline_internal(project_id, chapter_count=10, requirements="", continue_from=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    user_id = resolve_user_id(None)

    if not continue_from:
        OutlineCreateRequest = load_attr("app.gateway.novel_migrated.api.outlines", "OutlineCreateRequest")
        create_fn = load_attr("app.gateway.novel_migrated.api.outlines", "create_outline")
        if OutlineCreateRequest is None or not callable(create_fn):
            raise RuntimeError("internal create_outline unavailable")
        req = OutlineCreateRequest(title="", content=requirements or "")
        async with AsyncSessionLocal() as db:
            result = await create_fn(project_id=project_id, req=req, user_id=user_id, db=db)
        return _ok(to_dict(result), source="novel_migrated.outline_create.internal")
    else:
        ai_service = await get_internal_ai_service(module_id="novel-outline")
        OutlineContinueRequest = load_attr("app.gateway.novel_migrated.api.outlines", "OutlineContinueRequest")
        continue_fn = load_attr("app.gateway.novel_migrated.api.outlines", "continue_outlines")
        if OutlineContinueRequest is None or not callable(continue_fn):
            raise RuntimeError("internal continue_outlines unavailable")
        req = OutlineContinueRequest(
            project_id=project_id,
            chapter_count=chapter_count,
            requirements=requirements,
            plot_stage_instruction=continue_from,
        )
        async with AsyncSessionLocal() as db:
            result = await continue_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
        return _ok(to_dict(result), source="novel_migrated.outline_continue.internal")


async def _expand_outline_internal(outline_id, project_id, target_chapter_count=3, strategy="single"):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-outline")
    OutlineExpandRequest = load_attr("app.gateway.novel_migrated.api.outlines", "OutlineExpandRequest")
    expand_fn = load_attr("app.gateway.novel_migrated.api.outlines", "expand_outline")
    if OutlineExpandRequest is None or not callable(expand_fn):
        raise RuntimeError("internal expand_outline unavailable")
    req = OutlineExpandRequest(
        project_id=project_id,
        outline_id=outline_id,
        target_chapter_count=target_chapter_count,
        expansion_strategy=strategy,
    )
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await expand_fn(req=req, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.outline_expand.internal")


async def _generate_chapter_internal(project_id, chapter_ids=None, outline_ids=None):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-chapter-management")
    BatchGenerateRequest = load_attr("app.gateway.novel_migrated.api.chapters", "BatchGenerateRequest")
    batch_fn = load_attr("app.gateway.novel_migrated.api.chapters", "batch_generate_chapters")
    if BatchGenerateRequest is None or not callable(batch_fn):
        raise RuntimeError("internal batch_generate unavailable")
    req = BatchGenerateRequest(project_id=project_id, chapter_ids=chapter_ids, outline_ids=outline_ids)
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await batch_fn(req=req, request=None, user_id=user_id, db=db, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.chapter_generate.internal")


async def _generate_career_system_internal(project_id, main_career_count=3, sub_career_count=5):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-careers")
    user_id = resolve_user_id(None)

    CareerService = load_attr("app.gateway.novel_migrated.services.career_service", "CareerService")
    if CareerService is None:
        raise RuntimeError("CareerService unavailable")

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select

        Project = load_attr("app.gateway.novel_migrated.models.project", "Project")
        if Project is None:
            raise RuntimeError("Project model unavailable")
        stmt = select(Project).where(Project.id == project_id)
        project_result = await db.execute(stmt)
        project = project_result.scalar_one_or_none()
        if project is None:
            raise RuntimeError(f"project {project_id} not found")

        prompt = await CareerService.get_career_generation_prompt(
            project=project,
            main_career_count=main_career_count,
            sub_career_count=sub_career_count,
        )

        ai_response = ""
        _emit_progress_event(
            "career_generation_progress",
            stage="generating",
            message="开始生成职业体系",
        )
        async for chunk in ai_service.generate_text_stream(prompt=prompt):
            ai_response += chunk
            _emit_progress_event(
                "career_generation_progress",
                stage="chunk",
                chunk=chunk,
            )

        cleaned = ai_service._clean_json_response(ai_response)
        career_data = json.loads(cleaned)

        result = await CareerService.parse_and_save_careers(career_data, project_id, db)
        await db.commit()
        _emit_progress_event(
            "career_generation_progress",
            stage="complete",
            user_id=user_id,
            created_main=len(result.get("main_careers", [])) if isinstance(result, dict) else None,
        )

    return _ok(result, source="novel_migrated.career_system.internal")


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

    try:
        return await _build_world_internal(
            project_id=project_id, title=title, genre=genre, theme=theme, description=description,
        )
    except Exception as exc:
        logger.warning("build_world internal failed: %s, falling back to HTTP", exc)

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

    try:
        return await _generate_characters_internal(
            project_id=project_id, count=count, requirements=requirements,
        )
    except Exception as exc:
        logger.warning("generate_characters internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": project_id,
        "user_input": _build_character_user_input(count=count, requirements=requirements),
        "is_organization": False,
    }
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

    try:
        return await _generate_outline_internal(
            project_id=project_id, chapter_count=chapter_count,
            requirements=requirements, continue_from=continue_from,
        )
    except Exception as exc:
        logger.warning("generate_outline internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    payload: dict[str, Any] = {
        "project_id": project_id,
        "chapter_count": chapter_count,
    }
    endpoint = f"{base_url}/outlines/continue"
    source = "novel_migrated.outline_continue"

    if not continue_from:
        payload.update(
            {
                "title": "",
                "content": requirements or "",
            }
        )
        endpoint = f"{base_url}/outlines/project/{project_id}"
        source = "novel_migrated.outline_create"
    else:
        if requirements:
            payload["requirements"] = requirements
        if continue_from:
            payload["plot_stage_instruction"] = continue_from

    try:
        data = await post_json(endpoint, payload)
        return _ok(data, source=source)
    except Exception as exc:
        logger.error("generate_outline failed (%s): %s", source, exc)
        return _fail(str(exc), source=source)


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

    try:
        return await _expand_outline_internal(
            outline_id=outline_id, project_id=project_id,
            target_chapter_count=target_chapter_count, strategy=strategy,
        )
    except Exception as exc:
        logger.warning("expand_outline internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    payload: dict[str, Any] = {
        "outline_id": outline_id,
        "project_id": project_id,
        "target_chapter_count": target_chapter_count,
        "expansion_strategy": strategy,
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

    try:
        return await _generate_chapter_internal(
            project_id=project_id, chapter_ids=chapter_ids, outline_ids=outline_ids,
        )
    except Exception as exc:
        logger.warning("generate_chapter internal failed: %s, falling back to HTTP", exc)

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

    try:
        return await _generate_career_system_internal(
            project_id=project_id, main_career_count=main_career_count,
            sub_career_count=sub_career_count,
        )
    except Exception as exc:
        logger.warning("generate_career_system internal failed: %s, falling back to HTTP", exc)

    base_url = get_base_url()
    params: dict[str, Any] = {
        "project_id": project_id,
        "main_career_count": main_career_count,
        "sub_career_count": sub_career_count,
    }
    try:
        data = await _consume_career_system_stream(base_url=base_url, params=params)
        return _ok(data, source="novel_migrated.career_system")
    except Exception as exc:
        logger.error("generate_career_system failed: %s", exc)
        return _fail(str(exc), source="novel_migrated.career_system")
