"""卷管理API（文件真值版）"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.workspace_document_service import (
    WorkspaceSecurityError,
    workspace_document_service,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/volumes", tags=["volumes"])

_VOLUMES_DOC_ENTITY = "volumes"


class VolumeCreateRequest(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    order: int | None = Field(default=None, ge=0)


class VolumeUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    order: int | None = Field(default=None, ge=0)


async def _read_volumes_doc(
    *,
    user_id: str,
    project_id: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        doc = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=project_id,
            entity_type=_VOLUMES_DOC_ENTITY,
            entity_id="index",
        )
        if isinstance(doc, dict):
            return doc.get("volumes", []), doc
        if isinstance(doc, str):
            parsed = json.loads(doc)
            return parsed.get("volumes", []), parsed
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return [], {}


async def _load_volumes_store(
    *,
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    await verify_project_access(project_id, user_id, db)
    return await _read_volumes_doc(user_id=user_id, project_id=project_id)


async def _find_volume_in_all_projects(
    *,
    volume_id: str,
    user_id: str,
    db: AsyncSession,
) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any] | None, str]:
    from sqlalchemy import select

    from app.gateway.novel_migrated.core.database import Project

    result = await db.execute(
        select(Project.id).where(Project.user_id == user_id)
    )
    project_ids = [str(row[0]) for row in result.all()]

    for pid in project_ids:
        volumes, meta = await _read_volumes_doc(user_id=user_id, project_id=pid)
        for item in volumes:
            if isinstance(item, dict) and str(item.get("id")) == volume_id:
                return volumes, meta, item, pid
    return [], {}, None, ""


async def _save_volumes_store(
    *,
    project_id: str,
    user_id: str,
    db: AsyncSession,
    volumes: list[dict[str, Any]],
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    doc = {**(meta or {}), "volumes": volumes}
    try:
        await workspace_document_service.write_document(
            user_id=user_id,
            project_id=project_id,
            entity_type=_VOLUMES_DOC_ENTITY,
            entity_id="index",
            content=json.dumps(doc, ensure_ascii=False, indent=2),
        )
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"content_source": "file"}


def _serialize_volume(vol: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": vol.get("id", ""),
        "title": vol.get("title", ""),
        "description": vol.get("description"),
        "order": vol.get("order", 0),
        "novelId": vol.get("novelId") or vol.get("project_id", ""),
    }


@router.get("/project/{project_id}")
async def list_volumes(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    volumes, meta = await _load_volumes_store(project_id=project_id, user_id=user_id, db=db)
    return {
        "volumes": [_serialize_volume(v) for v in volumes if isinstance(v, dict)],
        "content_source": "file",
    }


@router.post("")
async def create_volume(
    req: VolumeCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(req.project_id, user_id, db)
    volumes, meta = await _load_volumes_store(project_id=req.project_id, user_id=user_id, db=db)
    volume = {
        "id": str(uuid.uuid4()),
        "project_id": req.project_id,
        "title": req.title,
        "description": req.description,
        "order": req.order if req.order is not None else len(volumes),
    }
    volumes.append(volume)
    file_meta = await _save_volumes_store(project_id=req.project_id, user_id=user_id, db=db, volumes=volumes, meta=meta)
    return {**_serialize_volume(volume), **file_meta}


@router.put("/{volume_id}")
async def update_volume(
    volume_id: str,
    req: VolumeUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    volumes, meta, target, project_id = await _find_volume_in_all_projects(
        volume_id=volume_id, user_id=user_id, db=db,
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Volume not found")
    await verify_project_access(project_id, user_id, db)
    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            target[key] = value
    file_meta = await _save_volumes_store(project_id=project_id, user_id=user_id, db=db, volumes=volumes, meta=meta)
    return {**_serialize_volume(target), **file_meta}


@router.delete("/{volume_id}")
async def delete_volume(
    volume_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    volumes, meta, removed, project_id = await _find_volume_in_all_projects(
        volume_id=volume_id, user_id=user_id, db=db,
    )
    if removed is None:
        raise HTTPException(status_code=404, detail="Volume not found")
    await verify_project_access(project_id, user_id, db)
    remained = [item for item in volumes if not (isinstance(item, dict) and str(item.get("id")) == volume_id)]
    file_meta = await _save_volumes_store(project_id=project_id, user_id=user_id, db=db, volumes=remained, meta=meta)
    return {"message": "Volume deleted", **file_meta}
