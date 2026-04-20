"""大纲管理API - CRUD、续写、展开"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService

logger = get_logger(__name__)
router = APIRouter(prefix="/outlines", tags=["outlines"])


class OutlineCreateRequest(BaseModel):
    title: str
    content: str
    structure: Optional[str] = None
    order_index: Optional[int] = None


class OutlineUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    structure: Optional[str] = None
    order_index: Optional[int] = None


class OutlineContinueRequest(BaseModel):
    project_id: str
    chapter_count: int = 5
    plot_stage_instruction: str = ""
    story_direction: str = ""
    requirements: str = ""


class OutlineExpandRequest(BaseModel):
    project_id: str
    outline_id: str
    target_chapter_count: int = 3
    expansion_strategy: str = "balanced"
    batch_size: int = 5


@router.get("/project/{project_id}")
async def list_outlines(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(
        select(Outline).where(Outline.project_id == project_id)
        .order_by(Outline.order_index))
    outlines = result.scalars().all()
    return {"outlines": [_serialize_outline(o) for o in outlines]}


@router.get("/{outline_id}")
async def get_outline(
    outline_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Outline).where(Outline.id == outline_id))
    outline = result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")
    await verify_project_access(outline.project_id, user_id, db)
    return _serialize_outline(outline)


@router.post("/project/{project_id}")
async def create_outline(
    project_id: str,
    req: OutlineCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    if req.order_index is None:
        max_result = await db.execute(
            select(func.max(Outline.order_index)).where(Outline.project_id == project_id))
        order_index = (max_result.scalar() or 0) + 1
    else:
        order_index = req.order_index

    outline = Outline(
        project_id=project_id,
        title=req.title,
        content=req.content,
        structure=req.structure,
        order_index=order_index,
    )
    db.add(outline)
    await db.commit()
    await db.refresh(outline)
    return _serialize_outline(outline)


@router.put("/{outline_id}")
async def update_outline(
    outline_id: str,
    req: OutlineUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Outline).where(Outline.id == outline_id))
    outline = result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")
    await verify_project_access(outline.project_id, user_id, db)

    if req.title is not None:
        outline.title = req.title
    if req.content is not None:
        outline.content = req.content
    if req.structure is not None:
        outline.structure = req.structure
    if req.order_index is not None:
        outline.order_index = req.order_index

    await db.commit()
    await db.refresh(outline)
    return _serialize_outline(outline)


@router.delete("/{outline_id}")
async def delete_outline(
    outline_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Outline).where(Outline.id == outline_id))
    outline = result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")
    await verify_project_access(outline.project_id, user_id, db)
    await db.delete(outline)
    await db.commit()
    return {"message": "Outline deleted"}


@router.post("/continue")
async def continue_outlines(
    req: OutlineContinueRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    project_result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    outlines_result = await db.execute(
        select(Outline).where(Outline.project_id == req.project_id)
        .order_by(Outline.order_index.desc()).limit(10))
    recent_outlines = outlines_result.scalars().all()
    recent_outlines_text = "\n\n".join([
        f"第{o.order_index}节《{o.title}》：{o.content[:300]}"
        for o in reversed(recent_outlines)
    ])

    characters_result = await db.execute(
        select(Character).where(Character.project_id == req.project_id))
    characters = characters_result.scalars().all()
    characters_info = "\n".join([
        f"- {c.name} ({c.role_type}): {c.personality[:80] if c.personality else '暂无'}"
        for c in characters
    ])

    current_count_result = await db.execute(
        select(func.count(Outline.id)).where(Outline.project_id == req.project_id))
    current_count = current_count_result.scalar() or 0
    start_chapter = current_count + 1
    end_chapter = start_chapter + req.chapter_count - 1

    template = PromptService.OUTLINE_CONTINUE
    prompt = template.format(
        current_chapter_count=current_count,
        start_chapter=start_chapter,
        end_chapter=end_chapter,
        chapter_count=req.chapter_count,
        plot_stage_instruction=req.plot_stage_instruction or "发展阶段",
        story_direction=req.story_direction or "自然推进",
        title=project.title or "", theme=project.theme or "",
        genre=project.genre or "",
        narrative_perspective=project.narrative_perspective or "第三人称",
        time_period=project.world_time_period or "未设定",
        location=project.world_location or "未设定",
        atmosphere=project.world_atmosphere or "未设定",
        rules=project.world_rules or "未设定",
        recent_outlines=recent_outlines_text or "暂无已有大纲",
        characters_info=characters_info or "暂无角色",
        requirements=req.requirements or "无特殊要求",
        mcp_references=""
    )

    accumulated = ""
    async for chunk in ai_service.generate_text_stream(prompt=prompt, temperature=0.7):
        accumulated += chunk

    try:
        cleaned = ai_service._clean_json_response(accumulated)
        outlines_data = json.loads(cleaned)
        if not isinstance(outlines_data, list):
            outlines_data = [outlines_data]

        created = []
        for od in outlines_data:
            oi = (current_count + len(created) + 1)
            outline = Outline(
                project_id=req.project_id,
                title=od.get("title", f"第{oi}节"),
                content=od.get("summary", ""),
                structure=json.dumps(od, ensure_ascii=False) if isinstance(od, dict) else None,
                order_index=oi,
            )
            db.add(outline)
            created.append(outline)

        await db.commit()
        for o in created:
            await db.refresh(o)

        return {"outlines": [_serialize_outline(o) for o in created]}

    except (json.JSONDecodeError, Exception) as e:
        logger.error(f"Parse outline continue response failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI response parse error: {str(e)}")


@router.post("/expand")
async def expand_outline(
    req: OutlineExpandRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    from app.gateway.novel_migrated.services.plot_expansion_service import PlotExpansionService
    service = PlotExpansionService(ai_service)

    outline_result = await db.execute(select(Outline).where(Outline.id == req.outline_id))
    outline = outline_result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")

    project_result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    chapter_plans = await service.analyze_outline_for_chapters(
        outline=outline, project=project, db=db,
        target_chapter_count=req.target_chapter_count,
        expansion_strategy=req.expansion_strategy,
        batch_size=req.batch_size
    )

    chapters = await service.create_chapters_from_plans(
        outline_id=req.outline_id,
        chapter_plans=chapter_plans,
        project_id=req.project_id,
        db=db
    )

    return {
        "outline_id": req.outline_id,
        "chapters_created": len(chapters),
        "chapters": [
            {
                "id": c.id,
                "chapter_number": c.chapter_number,
                "title": c.title,
                "summary": c.summary,
                "sub_index": c.sub_index,
            }
            for c in chapters
        ]
    }


@router.put("/reorder")
async def reorder_outlines(
    project_id: str = Query(...),
    outline_orders: list = [],
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    for item in outline_orders:
        oid = item.get("id")
        new_idx = item.get("order_index")
        if oid and new_idx is not None:
            result = await db.execute(select(Outline).where(Outline.id == oid))
            o = result.scalar_one_or_none()
            if o and o.project_id == project_id:
                o.order_index = new_idx
    await db.commit()
    return {"message": "Outlines reordered"}


def _serialize_outline(outline: Outline) -> dict:
    return {
        "id": outline.id,
        "project_id": outline.project_id,
        "title": outline.title,
        "content": outline.content,
        "structure": outline.structure,
        "order_index": outline.order_index,
        "created_at": outline.created_at.isoformat() if outline.created_at else None,
        "updated_at": outline.updated_at.isoformat() if outline.updated_at else None,
    }
