"""Account APIs for current-user storage usage and browser usage reports."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.auth.models import User
from app.gateway.deps import get_current_user_from_request
from app.gateway.storage_quota import storage_quota_service
from deerflow.persistence.engine import get_session_factory

router = APIRouter(prefix="/api/account", tags=["account"])


async def get_main_db() -> AsyncSession:
    sf = get_session_factory()
    if sf is None:
        raise HTTPException(status_code=503, detail="Database is not available")
    async with sf() as session:
        yield session


class BrowserUsageReport(BaseModel):
    used_bytes: int = Field(..., ge=0)


async def current_user(request: Request) -> User:
    return await get_current_user_from_request(request)


@router.get("/storage-usage")
async def get_storage_usage(
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    return await storage_quota_service.get_account_usage(db, str(user.id))


@router.post("/browser-storage-usage")
async def report_browser_storage_usage(
    body: BrowserUsageReport,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    usage = await storage_quota_service.report_browser_usage(db, user_id=str(user.id), used_bytes=body.used_bytes)
    await db.commit()
    return usage
