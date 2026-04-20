"""写作风格管理API"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.writing_style import WritingStyle
from app.gateway.novel_migrated.models.project_default_style import ProjectDefaultStyle

logger = get_logger(__name__)
router = APIRouter(prefix="/writing-styles", tags=["writing-styles"])


class WritingStyleCreateRequest(BaseModel):
    name: str
    style_type: str = "custom"
    preset_id: Optional[str] = None
    description: str = ""
    prompt_content: str = ""
    order_index: int = 0


class WritingStyleUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    prompt_content: Optional[str] = None
    order_index: Optional[int] = None


class ProjectDefaultStyleRequest(BaseModel):
    project_id: str
    style_id: int


@router.get("")
async def list_styles(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    style_type: Optional[str] = None,
):
    query = select(WritingStyle).where(WritingStyle.user_id == user_id)
    if style_type:
        query = query.where(WritingStyle.style_type == style_type)
    result = await db.execute(query.order_by(WritingStyle.order_index, WritingStyle.id))
    styles = result.scalars().all()
    return {"styles": [_serialize_style(s) for s in styles]}


@router.post("")
async def create_style(
    req: WritingStyleCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    style = WritingStyle(
        user_id=user_id,
        name=req.name,
        style_type=req.style_type,
        preset_id=req.preset_id,
        description=req.description,
        prompt_content=req.prompt_content,
        order_index=req.order_index,
    )
    db.add(style)
    await db.commit()
    await db.refresh(style)
    return _serialize_style(style)


@router.get("/{style_id}")
async def get_style(
    style_id: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WritingStyle).where(WritingStyle.id == style_id))
    style = result.scalar_one_or_none()
    if not style or style.user_id != user_id:
        raise HTTPException(status_code=404, detail="Writing style not found")
    return _serialize_style(style)


@router.put("/{style_id}")
async def update_style(
    style_id: int,
    req: WritingStyleUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WritingStyle).where(WritingStyle.id == style_id))
    style = result.scalar_one_or_none()
    if not style or style.user_id != user_id:
        raise HTTPException(status_code=404, detail="Writing style not found")

    for field_name in ['name', 'description', 'prompt_content', 'order_index']:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(style, field_name, value)

    await db.commit()
    await db.refresh(style)
    return _serialize_style(style)


@router.delete("/{style_id}")
async def delete_style(
    style_id: int,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(WritingStyle).where(WritingStyle.id == style_id))
    style = result.scalar_one_or_none()
    if not style or style.user_id != user_id:
        raise HTTPException(status_code=404, detail="Writing style not found")
    await db.delete(style)
    await db.commit()
    return {"message": "Writing style deleted"}


@router.post("/project-default")
async def set_project_default_style(
    req: ProjectDefaultStyleRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    from app.gateway.novel_migrated.api.common import verify_project_access
    await verify_project_access(req.project_id, user_id, db)

    style_result = await db.execute(select(WritingStyle).where(WritingStyle.id == req.style_id))
    if not style_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Writing style not found")

    existing = await db.execute(
        select(ProjectDefaultStyle).where(ProjectDefaultStyle.project_id == req.project_id))
    default = existing.scalar_one_or_none()
    if default:
        default.style_id = req.style_id
    else:
        default = ProjectDefaultStyle(project_id=req.project_id, style_id=req.style_id)
        db.add(default)

    await db.commit()
    return {"project_id": req.project_id, "style_id": req.style_id}


@router.get("/project-default/{project_id}")
async def get_project_default_style(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    from app.gateway.novel_migrated.api.common import verify_project_access
    await verify_project_access(project_id, user_id, db)

    result = await db.execute(
        select(ProjectDefaultStyle).where(ProjectDefaultStyle.project_id == project_id))
    default = result.scalar_one_or_none()
    if not default:
        return {"project_id": project_id, "style_id": None, "style": None}

    style_result = await db.execute(select(WritingStyle).where(WritingStyle.id == default.style_id))
    style = style_result.scalar_one_or_none()
    return {
        "project_id": project_id,
        "style_id": default.style_id,
        "style": _serialize_style(style) if style else None,
    }


def _serialize_style(s: WritingStyle) -> dict:
    return {
        "id": s.id, "user_id": s.user_id,
        "name": s.name, "style_type": s.style_type,
        "preset_id": s.preset_id, "description": s.description,
        "prompt_content": s.prompt_content, "order_index": s.order_index,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }
