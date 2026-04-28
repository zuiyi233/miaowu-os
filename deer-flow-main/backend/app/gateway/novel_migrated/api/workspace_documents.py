"""Workspace file-truth APIs for novel projects."""

from __future__ import annotations

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
router = APIRouter(prefix="/novels", tags=["workspace_documents"])


class WorkspaceInitResponse(BaseModel):
    project_id: str
    workspace_root: str
    manifest_path: str
    content_source: str = "file"


class WorkspaceRescanResponse(BaseModel):
    project_id: str
    content_source: str = "file"
    manifest_records: int
    synced_indexes: int
    stale_marked: int = 0


class DocumentWriteRequest(BaseModel):
    content: Any = Field(..., description="文档正文或JSON对象")
    title: str | None = Field(default=None, description="文档标题（可选）")
    tags: list[str] = Field(default_factory=list, description="文档标签")


@router.post("/{project_id}/workspace/init", response_model=WorkspaceInitResponse)
async def init_workspace(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceInitResponse:
    project = await verify_project_access(project_id, user_id, db)
    try:
        payload = await workspace_document_service.initialize_workspace(
            user_id=user_id,
            project_id=project_id,
            title=project.title or "",
            description=project.description or "",
            theme=project.theme or "",
            genre=project.genre or "",
        )
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime guard
        logger.exception("workspace init failed: project_id=%s user_id=%s", project_id, user_id)
        raise HTTPException(status_code=500, detail="工作区初始化失败") from exc

    return WorkspaceInitResponse(project_id=project_id, **payload)


@router.post("/{project_id}/workspace/rescan", response_model=WorkspaceRescanResponse)
async def rescan_workspace(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceRescanResponse:
    await verify_project_access(project_id, user_id, db)
    try:
        records = await workspace_document_service.rescan_workspace(
            user_id=user_id,
            project_id=project_id,
        )
        sync_stats = await workspace_document_service.sync_records_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            records=records,
        )
        await db.commit()
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime guard
        await db.rollback()
        logger.exception("workspace rescan failed: project_id=%s user_id=%s", project_id, user_id)
        raise HTTPException(status_code=500, detail="工作区重扫失败") from exc

    return WorkspaceRescanResponse(
        project_id=project_id,
        manifest_records=len(records),
        synced_indexes=sync_stats.get("synced", 0),
        stale_marked=sync_stats.get("stale_marked", 0),
    )


@router.get("/{project_id}/documents/{entity_type}/{entity_id}")
async def read_document(
    project_id: str,
    entity_type: str,
    entity_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await verify_project_access(project_id, user_id, db)
    try:
        payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime guard
        logger.exception(
            "workspace document read failed: project_id=%s entity_type=%s entity_id=%s",
            project_id,
            entity_type,
            entity_id,
        )
        raise HTTPException(status_code=500, detail="文档读取失败") from exc
    return payload


@router.put("/{project_id}/documents/{entity_type}/{entity_id}")
async def write_document(
    project_id: str,
    entity_type: str,
    entity_id: str,
    req: DocumentWriteRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await verify_project_access(project_id, user_id, db)
    try:
        record = await workspace_document_service.write_document(
            user_id=user_id,
            project_id=project_id,
            entity_type=entity_type,
            entity_id=entity_id,
            content=req.content,
            title=req.title,
            tags=req.tags,
        )
        await workspace_document_service.sync_record_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            record=record,
        )
        await db.commit()
    except WorkspaceSecurityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime guard
        await db.rollback()
        logger.exception(
            "workspace document write failed: project_id=%s entity_type=%s entity_id=%s",
            project_id,
            entity_type,
            entity_id,
        )
        raise HTTPException(status_code=500, detail="文档写入失败") from exc

    return {
        "success": True,
        "project_id": project_id,
        "entity_type": record.entity_type,
        "entity_id": record.entity_id,
        "doc_path": record.path,
        "content_source": "file",
        "content_hash": record.content_hash,
        "doc_updated_at": record.mtime,
        "size": record.size,
    }
