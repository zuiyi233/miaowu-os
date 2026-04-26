from __future__ import annotations

import logging
import re
from typing import Any

from langchain.tools import tool

from deerflow.tools.builtins.novel_tool_helpers import _fail, _ok, get_base_url, get_json, post_json, put_json

logger = logging.getLogger(__name__)

_CN_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
_FULLWIDTH_DIGITS_TRANS = str.maketrans("０１２３４５６７８９", "0123456789")


def _parse_chinese_number(token: str) -> int:
    if not token:
        return 0
    total = 0
    section = 0
    number = 0

    for char in token:
        if char in _CN_DIGITS:
            number = _CN_DIGITS[char]
            continue
        if char in _CN_UNITS:
            unit = _CN_UNITS[char]
            if unit == 10000:
                section = (section + number) * unit
                total += section
                section = 0
                number = 0
            else:
                if number == 0:
                    number = 1
                section += number * unit
                number = 0
    return total + section + number


def _parse_chapter_number(raw: str) -> int:
    text = (raw or "").strip().translate(_FULLWIDTH_DIGITS_TRANS)
    if not text:
        return 1

    digit_match = re.search(r"\d+", text)
    if digit_match:
        try:
            return max(1, int(digit_match.group(0)))
        except ValueError:
            pass

    cn_match = re.search(r"[零〇一二两三四五六七八九十百千万]+", text)
    if cn_match:
        parsed = _parse_chinese_number(cn_match.group(0))
        if parsed > 0:
            return parsed
    return 1


async def _analyze_chapter_internal(chapter_id, force=False):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    ai_service = await get_internal_ai_service(module_id="novel-chapter-analysis")
    analyze_fn = load_attr("app.gateway.novel_migrated.api.novel_stream", "analyze_chapter")
    if not callable(analyze_fn):
        raise RuntimeError("internal analyze_chapter unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await analyze_fn(
            chapter_id=chapter_id, request=None, payload=None,
            force=force, db=db, user_ai_service=ai_service, user_id=user_id,
        )
    return _ok(to_dict(result), source="novel_migrated.analyze_chapter.internal")


async def _manage_foreshadow_internal(
    action, project_id="", foreshadow_id="", title="", content="",
    status="", category="", is_long_term=False, importance=0.5,
    related_characters=None,
):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    user_id = resolve_user_id(None)

    if action == "list":
        if not project_id:
            return _fail("project_id required for list action")
        fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "get_project_foreshadows")
        if not callable(fn):
            raise RuntimeError("internal foreshadow_list unavailable")
        async with AsyncSessionLocal() as db:
            result = await fn(project_id=project_id, request=None, db=db, user_id=user_id)
        return _ok(to_dict(result), source="novel_migrated.foreshadow_list.internal")

    if action == "context":
        if not project_id:
            return _fail("project_id required for context action")
        chapter_number = _parse_chapter_number(content)
        fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "get_chapter_foreshadow_context")
        if not callable(fn):
            raise RuntimeError("internal foreshadow_context unavailable")
        async with AsyncSessionLocal() as db:
            result = await fn(
                project_id=project_id, chapter_number=chapter_number,
                request=None, db=db, user_id=user_id,
            )
        return _ok(to_dict(result), source="novel_migrated.foreshadow_context.internal")

    if action == "sync":
        if not project_id:
            return _fail("project_id required for sync action")
        SyncFromAnalysisRequest = load_attr(
            "app.gateway.novel_migrated.schemas.foreshadow", "SyncFromAnalysisRequest",
        )
        sync_fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "sync_foreshadows_from_analysis")
        if not callable(sync_fn):
            raise RuntimeError("internal foreshadow_sync unavailable")
        req = SyncFromAnalysisRequest() if SyncFromAnalysisRequest else None
        async with AsyncSessionLocal() as db:
            result = await sync_fn(project_id=project_id, data=req, request=None, db=db, user_id=user_id)
        return _ok(to_dict(result), source="novel_migrated.foreshadow_sync.internal")

    if action == "create":
        if not project_id or not title or not content:
            return _fail("project_id, title, and content required for create action")
        ForeshadowCreate = load_attr(
            "app.gateway.novel_migrated.schemas.foreshadow", "ForeshadowCreate",
        )
        create_fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "create_foreshadow")
        if ForeshadowCreate is None or not callable(create_fn):
            raise RuntimeError("internal foreshadow_create unavailable")
        data = ForeshadowCreate(
            project_id=project_id, title=title, content=content,
            importance=importance, is_long_term=is_long_term,
            category=category or None,
            related_characters=related_characters or None,
        )
        async with AsyncSessionLocal() as db:
            result = await create_fn(data=data, request=None, db=db, user_id=user_id)
        return _ok(to_dict(result), source="novel_migrated.foreshadow_create.internal")

    if action in ("update", "plant", "resolve", "abandon"):
        if not foreshadow_id:
            return _fail("foreshadow_id required for update/plant/resolve/abandon action")
        if action == "update":
            ForeshadowUpdate = load_attr(
                "app.gateway.novel_migrated.schemas.foreshadow", "ForeshadowUpdate",
            )
            update_fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "update_foreshadow")
            if ForeshadowUpdate is None or not callable(update_fn):
                raise RuntimeError("internal foreshadow_update unavailable")
            update_data = ForeshadowUpdate(
                title=title or None,
                content=content or None,
                status=status or None,
                category=category or None,
            )
            async with AsyncSessionLocal() as db:
                result = await update_fn(
                    foreshadow_id=foreshadow_id, data=update_data,
                    request=None, db=db, user_id=user_id,
                )
            return _ok(to_dict(result), source="novel_migrated.foreshadow_update.internal")

        if action == "plant":
            PlantForeshadowRequest = load_attr(
                "app.gateway.novel_migrated.schemas.foreshadow", "PlantForeshadowRequest",
            )
            plant_fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "plant_foreshadow")
            if PlantForeshadowRequest is None or not callable(plant_fn):
                raise RuntimeError("internal foreshadow_plant unavailable")
            plant_data = PlantForeshadowRequest(
                chapter_id="", chapter_number=1, hint_text=content or None,
            )
            async with AsyncSessionLocal() as db:
                result = await plant_fn(
                    foreshadow_id=foreshadow_id, data=plant_data,
                    request=None, db=db, user_id=user_id,
                )
            return _ok(to_dict(result), source="novel_migrated.foreshadow_plant.internal")

        if action == "resolve":
            ResolveForeshadowRequest = load_attr(
                "app.gateway.novel_migrated.schemas.foreshadow", "ResolveForeshadowRequest",
            )
            resolve_fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "resolve_foreshadow")
            if ResolveForeshadowRequest is None or not callable(resolve_fn):
                raise RuntimeError("internal foreshadow_resolve unavailable")
            resolve_data = ResolveForeshadowRequest(
                chapter_id="", chapter_number=1, resolution_text=content or None,
            )
            async with AsyncSessionLocal() as db:
                result = await resolve_fn(
                    foreshadow_id=foreshadow_id, data=resolve_data,
                    request=None, db=db, user_id=user_id,
                )
            return _ok(to_dict(result), source="novel_migrated.foreshadow_resolve.internal")

        if action == "abandon":
            abandon_fn = load_attr("app.gateway.novel_migrated.api.foreshadows", "abandon_foreshadow")
            if not callable(abandon_fn):
                raise RuntimeError("internal foreshadow_abandon unavailable")
            async with AsyncSessionLocal() as db:
                result = await abandon_fn(
                    foreshadow_id=foreshadow_id, request=None, db=db, user_id=user_id,
                )
            return _ok(to_dict(result), source="novel_migrated.foreshadow_abandon.internal")

    return _fail(f"unknown action: {action}")


async def _search_memories_internal(project_id, query, memory_type="", limit=10):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    search_fn = load_attr("app.gateway.novel_migrated.api.memories", "search_memories")
    if not callable(search_fn):
        raise RuntimeError("internal search_memories unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await search_fn(
            project_id=project_id, request=None, query=query,
            memory_types=[memory_type] if memory_type else None,
            limit=limit, db=db, user_id=user_id,
        )
    return _ok(to_dict(result), source="novel_migrated.memory_search.internal")


async def _check_consistency_internal(project_id):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_db,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    AsyncSessionLocal = await get_internal_db()
    report_fn = load_attr("app.gateway.novel_migrated.api.polish", "get_project_consistency_report")
    if not callable(report_fn):
        raise RuntimeError("internal consistency_report unavailable")
    user_id = resolve_user_id(None)
    async with AsyncSessionLocal() as db:
        result = await report_fn(project_id=project_id, user_id=user_id, db=db)
    return _ok(to_dict(result), source="novel_migrated.consistency_check.internal")


async def _polish_text_internal(text, style="literary", project_id=""):
    from deerflow.tools.builtins.novel_internal import (
        get_internal_ai_service,
        load_attr,
        resolve_user_id,
        to_dict,
    )

    ai_service = await get_internal_ai_service(module_id="novel-chapter-ai-edit")
    PolishRequest = load_attr("app.gateway.novel_migrated.api.polish", "PolishRequest")
    polish_fn = load_attr("app.gateway.novel_migrated.api.polish", "polish_text")
    if PolishRequest is None or not callable(polish_fn):
        raise RuntimeError("internal polish_text unavailable")
    req = PolishRequest(text=text, style=style)
    user_id = resolve_user_id(None)
    result = await polish_fn(req=req, user_id=user_id, ai_service=ai_service)
    return _ok(to_dict(result), source="novel_migrated.polish.internal")


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
    try:
        return await _analyze_chapter_internal(chapter_id=chapter_id, force=force)
    except Exception as exc:
        logger.warning("analyze_chapter internal failed: %s, falling back to HTTP", exc)

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
    try:
        internal_result = await _manage_foreshadow_internal(
            action=action, project_id=project_id, foreshadow_id=foreshadow_id,
            title=title, content=content, status=status, category=category,
            is_long_term=is_long_term, importance=importance,
            related_characters=related_characters,
        )
        if internal_result.get("success") is False and "unknown action" in internal_result.get("error", ""):
            return internal_result
        return internal_result
    except Exception as exc:
        logger.warning("manage_foreshadow internal failed: %s, falling back to HTTP", exc)

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
        chapter_number = _parse_chapter_number(content)
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
    try:
        return await _search_memories_internal(
            project_id=project_id, query=query,
            memory_type=memory_type, limit=limit,
        )
    except Exception as exc:
        logger.warning("search_memories internal failed: %s, falling back to HTTP", exc)

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
    try:
        return await _check_consistency_internal(project_id=project_id)
    except Exception as exc:
        logger.warning("check_consistency internal failed: %s, falling back to HTTP", exc)

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
    try:
        return await _polish_text_internal(text=text, style=style, project_id=project_id)
    except Exception as exc:
        logger.warning("polish_text internal failed: %s, falling back to HTTP", exc)

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
