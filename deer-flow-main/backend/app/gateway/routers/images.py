from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.routers.images_support import (
    ImageGenerateRequest,
    ImageGenerationError,
    ImageJobListResponse,
    ImageJobResponse,
    generate_images,
    get_image_job,
    list_image_jobs,
    read_image_file,
)

router = APIRouter(prefix="/api/v1/images", tags=["images"])


async def get_optional_db() -> AsyncGenerator[AsyncSession | None, None]:
    try:
        async for session in get_db():
            yield session
            return
    except HTTPException as exc:
        if exc.status_code != 503:
            raise
        yield None


def _raise_image_error(exc: ImageGenerationError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.as_detail()) from exc


@router.post("/generate", response_model=ImageJobResponse)
async def generate_image(
    req: ImageGenerateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession | None = Depends(get_optional_db),
) -> ImageJobResponse:
    try:
        return await generate_images(req, user_id=user_id, db=db)
    except ImageGenerationError as exc:
        _raise_image_error(exc)


@router.get("/jobs", response_model=ImageJobListResponse)
async def get_jobs(user_id: str = Depends(get_user_id)) -> ImageJobListResponse:
    return list_image_jobs(user_id=user_id)


@router.get("/jobs/{job_id}", response_model=ImageJobResponse)
async def get_job(job_id: str, user_id: str = Depends(get_user_id)) -> ImageJobResponse:
    return get_image_job(job_id, user_id=user_id)


@router.get("/files/{image_id}", response_class=None)
async def get_file(image_id: str, user_id: str = Depends(get_user_id)):
    payload = read_image_file(image_id=image_id, user_id=user_id)
    return Response(
        content=payload.content,
        media_type=payload.content_type,
        headers={"Content-Disposition": f'inline; filename="{payload.filename}"'},
    )
