"""Admin APIs for system settings, storage quotas, and recalculation."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.auth.models import User
from app.gateway.deps import get_current_user_from_request
from app.gateway.storage_quota import create_recalculate_all_task, get_recalculate_task, run_recalculate_all_task, storage_quota_service
from deerflow.persistence.engine import get_session_factory

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def get_main_db() -> AsyncSession:
    sf = get_session_factory()
    if sf is None:
        raise HTTPException(status_code=503, detail="Database is not available")
    async with sf() as session:
        yield session


async def require_admin_user(request: Request) -> User:
    user = await get_current_user_from_request(request)
    if user.system_role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


class SystemSettingsUpdate(BaseModel):
    backend_storage_quota_bytes: int | None = Field(default=None, ge=0)
    browser_storage_quota_bytes: int | None = Field(default=None, ge=0)
    backend_storage_quota_enabled: bool | None = None
    browser_storage_quota_enabled: bool | None = None


class UserQuotaPatch(BaseModel):
    backend_quota_bytes: int | None = Field(default=None, ge=0)
    browser_quota_bytes: int | None = Field(default=None, ge=0)


@router.get("/system-settings")
async def get_system_settings(
    _: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    return await storage_quota_service.get_system_settings(db)


@router.put("/system-settings")
async def update_system_settings(
    body: SystemSettingsUpdate,
    admin: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    values = body.model_dump(exclude_none=True)
    settings = await storage_quota_service.update_system_settings(
        db,
        admin_user_id=str(admin.id),
        values=values,
    )
    await db.commit()
    return settings


@router.get("/users")
async def list_users(
    _: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
    search: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    users = await storage_quota_service.list_admin_users(db, search=search, limit=limit, offset=offset)
    return {"users": users}


@router.patch("/users/{user_id}/quota")
async def patch_user_quota(
    user_id: str,
    body: UserQuotaPatch,
    admin: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    usage = await storage_quota_service.set_user_quota_override(
        db,
        admin_user_id=str(admin.id),
        target_user_id=user_id,
        backend_quota_bytes=body.backend_quota_bytes,
        browser_quota_bytes=body.browser_quota_bytes,
    )
    await db.commit()
    return {"user_id": user_id, "storage_usage": usage}


@router.post("/users/{user_id}/recalculate-storage")
async def recalculate_user_storage(
    user_id: str,
    _: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    usage = await storage_quota_service.recalculate_user(db, user_id=user_id)
    await db.commit()
    return {"user_id": user_id, "storage_usage": usage}


@router.post("/storage/recalculate-all")
async def recalculate_all_storage(
    admin: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    task_id = await create_recalculate_all_task(db, created_by=str(admin.id))
    await db.commit()
    asyncio.create_task(run_recalculate_all_task(task_id))
    return {"task_id": task_id, "status": "pending"}


@router.get("/storage/recalculate-all/{task_id}")
async def get_recalculate_all_status(
    task_id: str,
    _: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    task = await get_recalculate_task(db, task_id=task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Recalculate task not found")
    return task


@router.get("/storage/overview")
async def storage_overview(
    _: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
) -> dict[str, Any]:
    return await storage_quota_service.storage_overview(db)


@router.get("/audit-logs")
async def list_audit_logs(
    _: User = Depends(require_admin_user),
    db: AsyncSession = Depends(get_main_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    logs = await storage_quota_service.list_audit_logs(db, limit=limit, offset=offset)
    return {"logs": logs}
