"""Media asset APIs backed by S3-compatible object storage."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_owned_user_resource, get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.object_storage import build_private_object_key, get_object_storage_config
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.services.object_storage_service import (
    ObjectNotFoundError,
    ObjectStorageConfigurationError,
    ObjectStorageError,
    object_storage_service,
)

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
    safe_name = filename.strip().replace("\\", "/").split("/")[-1]
    safe_name = safe_name.replace("\r", "_").replace("\n", "_").replace('"', "_")
    return safe_name or "asset.bin"


def _normalize_metadata_json(raw_metadata: str | None) -> str | None:
    if raw_metadata is None or not raw_metadata.strip():
        return None
    try:
        parsed = json.loads(raw_metadata)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="metadata_json must be valid JSON") from exc
    return json.dumps(parsed, ensure_ascii=False, sort_keys=True)


async def _read_upload_bytes(file: UploadFile) -> tuple[bytes, str]:
    hasher = hashlib.sha256()
    chunks: list[bytes] = []
    total_size = 0

    while True:
        chunk = await file.read(UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > MAX_MEDIA_ASSET_BYTES:
            raise HTTPException(status_code=413, detail="Media asset is larger than 100MB")
        hasher.update(chunk)
        chunks.append(chunk)

    if total_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    return b"".join(chunks), hasher.hexdigest()


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
    safe_filename = _safe_filename(file.filename)
    if project_id:
        await verify_project_access(project_id, user_id, db)

    data, content_hash = await _read_upload_bytes(file)
    config = get_object_storage_config()
    asset_id = str(uuid.uuid4())
    object_key = build_private_object_key(
        user_id=user_id,
        asset_id=asset_id,
        filename=safe_filename,
    )

    try:
        await object_storage_service.put_object(
            object_key=object_key,
            data=data,
            content_type=file.content_type or "application/octet-stream",
        )
    except ObjectStorageError as exc:
        raise _storage_exception_to_http(exc) from exc

    asset = MediaAsset(
        id=asset_id,
        user_id=user_id,
        project_id=project_id,
        purpose=purpose.strip() or "attachment",
        filename=safe_filename,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=len(data),
        content_hash=content_hash,
        storage_backend=config.provider,
        endpoint=config.endpoint,
        bucket=config.bucket,
        object_key=object_key,
        status="active",
        metadata_json=_normalize_metadata_json(metadata_json),
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return _asset_to_dict(asset)


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

    headers = {"Content-Disposition": f'attachment; filename="{_safe_filename(asset.filename)}"'}
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
    await db.commit()
    return {"success": True, "id": asset_id, "status": "deleted"}
