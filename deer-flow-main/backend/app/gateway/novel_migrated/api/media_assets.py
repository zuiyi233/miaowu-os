"""Media asset APIs backed by S3-compatible object storage."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_owned_user_resource, get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.services.media_asset_service import (
    ACTIVE_PURPOSES,
    media_asset_service,
    safe_asset_filename,
)
from app.gateway.novel_migrated.services.object_storage_service import (
    ObjectNotFoundError,
    ObjectStorageConfigurationError,
    ObjectStorageError,
    object_storage_service,
)
from app.gateway.novel_migrated.utils.http_headers import safe_download_content_disposition
from app.gateway.storage_quota import storage_quota_service

router = APIRouter(prefix="/media-assets", tags=["media_assets"])

UPLOAD_CHUNK_SIZE = 1024 * 1024
MAX_MEDIA_ASSET_BYTES = 100 * 1024 * 1024


def _asset_to_dict(asset: MediaAsset) -> dict[str, Any]:
    metadata: dict[str, Any] | None = None
    if asset.metadata_json:
        try:
            parsed = json.loads(asset.metadata_json)
            metadata = parsed if isinstance(parsed, dict) else {"value": parsed}
        except json.JSONDecodeError:
            metadata = {"raw": asset.metadata_json}

    return {
        "id": asset.id,
        "user_id": asset.user_id,
        "project_id": asset.project_id,
        "purpose": asset.purpose,
        "filename": asset.filename,
        "mime_type": asset.mime_type,
        "size_bytes": asset.size_bytes,
        "content_hash": asset.content_hash,
        "storage_backend": asset.storage_backend,
        "bucket": asset.bucket,
        "status": asset.status,
        "metadata": metadata or {},
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
    }


def _safe_filename(filename: str) -> str:
    return safe_asset_filename(filename)


def _normalize_metadata_json(raw_metadata: str | None) -> str | None:
    if raw_metadata is None or not raw_metadata.strip():
        return None
    try:
        parsed = json.loads(raw_metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="metadata_json must be valid JSON") from exc
    return json.dumps(parsed, ensure_ascii=False, sort_keys=True)


async def _read_upload_bytes(file: UploadFile) -> tuple[bytes, str]:
    chunks: list[bytes] = []
    total_size = 0

    while True:
        chunk = await file.read(UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > MAX_MEDIA_ASSET_BYTES:
            raise HTTPException(status_code=413, detail="Media asset is larger than 100MB")
        chunks.append(chunk)

    if total_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    data = b"".join(chunks)
    return data, ""


async def _load_active_asset(asset_id: str, user_id: str, db: AsyncSession) -> MediaAsset:
    asset = await get_owned_user_resource(
        MediaAsset,
        asset_id,
        user_id,
        db,
        not_found_detail="Media asset not found",
    )
    if asset.status != "active":
        raise HTTPException(status_code=404, detail="Media asset not found")
    return asset


def _storage_exception_to_http(exc: ObjectStorageError) -> HTTPException:
    if isinstance(exc, ObjectStorageConfigurationError):
        return HTTPException(status_code=503, detail="Object storage is not configured")
    if isinstance(exc, ObjectNotFoundError):
        return HTTPException(status_code=404, detail="Media object not found")
    return HTTPException(status_code=502, detail="Object storage operation failed")


@router.post("/upload")
async def upload_media_asset(
    file: UploadFile = File(...),
    purpose: str = Form("attachment"),
    project_id: str | None = Form(None),
    metadata_json: str | None = Form(None),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="filename is required")
    if purpose not in ACTIVE_PURPOSES:
        raise HTTPException(status_code=422, detail=f"Unsupported media asset purpose: {purpose}")
    safe_filename = _safe_filename(file.filename)
    if project_id:
        await verify_project_access(project_id, user_id, db)

    data, _content_hash = await _read_upload_bytes(file)
    try:
        created = await media_asset_service.create_asset_from_bytes(
            db=db,
            user_id=user_id,
            project_id=project_id,
            purpose=purpose,
            filename=safe_filename,
            content=data,
            mime_type=file.content_type or "application/octet-stream",
            metadata=json.loads(_normalize_metadata_json(metadata_json) or "{}") if metadata_json else None,
            commit=True,
            refresh=True,
            flush=False,
        )
    except ObjectStorageError as exc:
        raise _storage_exception_to_http(exc) from exc
    return _asset_to_dict(created.asset)


@router.get("/{asset_id}")
async def get_media_asset(
    asset_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    asset = await _load_active_asset(asset_id, user_id, db)
    return _asset_to_dict(asset)


@router.get("/{asset_id}/download")
async def download_media_asset(
    asset_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> Response:
    asset = await _load_active_asset(asset_id, user_id, db)
    try:
        stored = await object_storage_service.get_object(object_key=asset.object_key)
    except ObjectStorageError as exc:
        raise _storage_exception_to_http(exc) from exc

    headers = {"Content-Disposition": safe_download_content_disposition(_safe_filename(asset.filename))}
    return Response(
        content=stored.content,
        media_type=asset.mime_type or stored.content_type or "application/octet-stream",
        headers=headers,
    )


@router.delete("/{asset_id}")
async def delete_media_asset(
    asset_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    asset = await _load_active_asset(asset_id, user_id, db)
    try:
        await object_storage_service.delete_object(object_key=asset.object_key)
    except ObjectStorageError as exc:
        raise _storage_exception_to_http(exc) from exc

    asset.status = "deleted"
    await storage_quota_service.release_object(
        db,
        user_id=user_id,
        source="media_asset",
        resource_id=asset_id,
    )
    await db.commit()
    return {"success": True, "id": asset_id, "status": "deleted"}
