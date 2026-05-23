"""项目封面生成与下载 API。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.services.cover_generation_service import (
    cover_generation_service,
)
from app.gateway.novel_migrated.utils.http_headers import safe_download_content_disposition

router = APIRouter(prefix="/api/projects", tags=["project_covers"])


class CoverGenerateRequest(BaseModel):
    overwrite: bool = Field(default=True, description="是否覆盖已有封面")


class CoverGenerateResponse(BaseModel):
    project_id: str
    cover_status: str
    cover_image_url: str | None = None
    cover_prompt: str | None = None
    provider: str | None = None
    model: str | None = None
    message: str


@router.post(
    "/{project_id}/cover/generate",
    response_model=CoverGenerateResponse,
    summary="生成项目封面",
)
async def generate_project_cover(
    project_id: str,
    payload: CoverGenerateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    result = await cover_generation_service.generate_cover(
        db=db,
        user_id=user_id,
        project_id=project_id,
        overwrite=payload.overwrite,
    )
    return CoverGenerateResponse(**result)


@router.get("/{project_id}/cover/download", summary="下载项目封面")
async def download_project_cover(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    project, filename, content, media_type = await cover_generation_service.get_cover_download(
        db=db,
        user_id=user_id,
        project_id=project_id,
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": safe_download_content_disposition(filename)},
    )
