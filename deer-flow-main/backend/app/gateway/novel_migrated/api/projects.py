"""项目管理API - CRUD、世界构建、统计"""
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
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.career import Career
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService

logger = get_logger(__name__)
router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreateRequest(BaseModel):
    title: str
    description: str = ""
    theme: str = ""
    genre: str = ""
    target_words: int = 100000
    chapter_count: int = 30
    narrative_perspective: str = "第三人称"
    outline_mode: str = "one-to-one"
    world_time_period: str = ""
    world_location: str = ""
    world_atmosphere: str = ""
    world_rules: str = ""


class ProjectUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    theme: Optional[str] = None
    genre: Optional[str] = None
    target_words: Optional[int] = None
    chapter_count: Optional[int] = None
    narrative_perspective: Optional[str] = None
    outline_mode: Optional[str] = None
    world_time_period: Optional[str] = None
    world_location: Optional[str] = None
    world_atmosphere: Optional[str] = None
    world_rules: Optional[str] = None
    status: Optional[str] = None
    wizard_status: Optional[str] = None
    wizard_step: Optional[int] = None


class WorldBuildRequest(BaseModel):
    project_id: str
    force_regenerate: bool = False


@router.get("")
async def list_projects(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    status: Optional[str] = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    query = select(Project).where(Project.user_id == user_id)
    if status:
        query = query.where(Project.status == status)
    query = query.order_by(Project.created_at.desc()).offset(offset).limit(limit)

    result = await db.execute(query)
    projects = result.scalars().all()

    count_result = await db.execute(
        select(func.count(Project.id)).where(Project.user_id == user_id))
    total = count_result.scalar() or 0

    return {
        "projects": [_serialize_project(p) for p in projects],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.post("")
async def create_project(
    req: ProjectCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        user_id=user_id,
        title=req.title,
        description=req.description,
        theme=req.theme,
        genre=req.genre,
        target_words=req.target_words,
        chapter_count=req.chapter_count,
        narrative_perspective=req.narrative_perspective,
        outline_mode=req.outline_mode,
        world_time_period=req.world_time_period,
        world_location=req.world_location,
        world_atmosphere=req.world_atmosphere,
        world_rules=req.world_rules,
        status="created",
        wizard_status="pending",
        wizard_step=0,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return _serialize_project(project)


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _serialize_project(project)


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    req: ProjectUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_fields = ['title', 'description', 'theme', 'genre', 'target_words',
                      'chapter_count', 'narrative_perspective', 'outline_mode',
                      'world_time_period', 'world_location', 'world_atmosphere',
                      'world_rules', 'status', 'wizard_status', 'wizard_step']
    for field_name in update_fields:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(project, field_name, value)

    await db.commit()
    await db.refresh(project)
    return _serialize_project(project)


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.delete(project)
    await db.commit()
    return {"message": "Project deleted"}


@router.post("/world-build")
async def world_build(
    req: WorldBuildRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.world_time_period and project.world_location and not req.force_regenerate:
        return _serialize_project(project)

    template = PromptService.WORLD_BUILDING
    prompt = template.format(
        title=project.title or "",
        genre=project.genre or "通用",
        theme=project.theme or "未设定",
        description=project.description or "暂无描述"
    )

    accumulated = ""
    async for chunk in ai_service.generate_text_stream(prompt=prompt, temperature=0.7):
        accumulated += chunk

    try:
        cleaned = ai_service._clean_json_response(accumulated)
        world_data = json.loads(cleaned)

        if isinstance(world_data, dict):
            if world_data.get("time_period") and not project.world_time_period:
                project.world_time_period = world_data["time_period"]
            if world_data.get("location") and not project.world_location:
                project.world_location = world_data["location"]
            if world_data.get("atmosphere") and not project.world_atmosphere:
                project.world_atmosphere = world_data["atmosphere"]
            if world_data.get("rules") and not project.world_rules:
                project.world_rules = world_data["rules"]

            if project.wizard_step < 1:
                project.wizard_step = 1
                project.wizard_status = "world_build_completed"

            await db.commit()
            await db.refresh(project)

        return _serialize_project(project)

    except (json.JSONDecodeError, Exception) as e:
        logger.error(f"Parse world build response failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI response parse error: {str(e)}")


@router.get("/{project_id}/stats")
async def get_project_stats(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    chapter_count = await db.execute(
        select(func.count(Chapter.id)).where(Chapter.project_id == project_id))
    total_chapters = chapter_count.scalar() or 0

    word_count = await db.execute(
        select(func.sum(Chapter.word_count)).where(Chapter.project_id == project_id))
    total_words = word_count.scalar() or 0

    char_count = await db.execute(
        select(func.count(Character.id)).where(
            Character.project_id == project_id, Character.is_organization == False))
    total_characters = char_count.scalar() or 0

    org_count = await db.execute(
        select(func.count(Character.id)).where(
            Character.project_id == project_id, Character.is_organization == True))
    total_organizations = org_count.scalar() or 0

    outline_count = await db.execute(
        select(func.count(Outline.id)).where(Outline.project_id == project_id))
    total_outlines = outline_count.scalar() or 0

    career_count = await db.execute(
        select(func.count(Career.id)).where(Career.project_id == project_id))
    total_careers = career_count.scalar() or 0

    completed_chapters = await db.execute(
        select(func.count(Chapter.id)).where(
            Chapter.project_id == project_id, Chapter.status == "completed"))
    completed = completed_chapters.scalar() or 0

    return {
        "project_id": project_id,
        "total_chapters": total_chapters,
        "completed_chapters": completed,
        "total_words": total_words,
        "total_characters": total_characters,
        "total_organizations": total_organizations,
        "total_outlines": total_outlines,
        "total_careers": total_careers,
        "completion_rate": round(completed / total_chapters * 100, 1) if total_chapters > 0 else 0,
    }


@router.put("/{project_id}/wizard")
async def update_wizard_status(
    project_id: str,
    wizard_status: Optional[str] = None,
    wizard_step: Optional[int] = None,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if wizard_status is not None:
        project.wizard_status = wizard_status
    if wizard_step is not None:
        project.wizard_step = wizard_step

    await db.commit()
    await db.refresh(project)
    return _serialize_project(project)


def _serialize_project(p: Project) -> dict:
    return {
        "id": p.id,
        "user_id": p.user_id,
        "title": p.title,
        "description": p.description,
        "theme": p.theme,
        "genre": p.genre,
        "target_words": p.target_words,
        "current_words": p.current_words,
        "chapter_count": p.chapter_count,
        "narrative_perspective": p.narrative_perspective,
        "outline_mode": p.outline_mode,
        "status": p.status,
        "wizard_status": p.wizard_status,
        "wizard_step": p.wizard_step,
        "world_time_period": p.world_time_period,
        "world_location": p.world_location,
        "world_atmosphere": p.world_atmosphere,
        "world_rules": p.world_rules,
        "cover_image_url": p.cover_image_url,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
