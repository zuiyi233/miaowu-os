"""Shared helpers for object-storage-backed media asset metadata."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.object_storage import build_private_object_key, get_object_storage_config
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.services.object_storage_service import (
    ObjectStorageError,
    object_storage_service,
)
from app.gateway.storage_quota import storage_quota_service

ACTIVE_PURPOSES = {
    "cover",
    "cover_image",
    "book_import_source",
    "project_import_source",
    "project_export",
    "attachment",
    "image_material",
    "image_generation_result",
    "generated_result",
    "tts_audio",
}


def safe_asset_filename(filename: str | None, *, fallback: str = "asset.bin") -> str:
    safe_name = (filename or "").strip().replace("\\", "/").split("/")[-1]
    safe_name = safe_name.replace("\r", "_").replace("\n", "_").replace('"', "_")
    return safe_name or fallback


def normalize_asset_metadata(metadata: dict[str, Any] | None) -> str | None:
    if not metadata:
        return None
    return json.dumps(metadata, ensure_ascii=False, sort_keys=True)


@dataclass(frozen=True)
class CreatedMediaAsset:
    asset: MediaAsset
    object_key: str


class MediaAssetService:
    @staticmethod
    def _supports_quota(db: AsyncSession) -> bool:
        return all(hasattr(db, name) for name in ("get", "execute", "flush"))

    async def create_asset_from_bytes(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        project_id: str | None,
        purpose: str,
        filename: str,
        content: bytes,
        mime_type: str | None = None,
        metadata: dict[str, Any] | None = None,
        commit: bool = False,
        refresh: bool = False,
        flush: bool = True,
    ) -> CreatedMediaAsset:
        safe_filename = safe_asset_filename(filename)
        content_type = mime_type or "application/octet-stream"
        asset_id = str(uuid.uuid4())
        object_key = build_private_object_key(user_id=user_id, asset_id=asset_id, filename=safe_filename)
        config = get_object_storage_config()
        reservation = None
        if self._supports_quota(db):
            reservation = await storage_quota_service.reserve(
                db,
                user_id=user_id,
                source="media_asset",
                resource_id=asset_id,
                incoming_bytes=len(content),
            )

        await object_storage_service.put_object(
            object_key=object_key,
            data=content,
            content_type=content_type,
        )

        normalized_purpose = purpose.strip() or "attachment"
        if normalized_purpose not in ACTIVE_PURPOSES:
            normalized_purpose = "attachment"

        asset = MediaAsset(
            id=asset_id,
            user_id=user_id,
            project_id=project_id,
            purpose=normalized_purpose,
            filename=safe_filename,
            mime_type=content_type,
            size_bytes=len(content),
            content_hash=hashlib.sha256(content).hexdigest(),
            storage_backend=config.provider,
            endpoint=config.endpoint,
            bucket=config.bucket,
            object_key=object_key,
            status="active",
            metadata_json=normalize_asset_metadata(metadata),
        )
        db.add(asset)
        try:
            if hasattr(db, "flush") and (commit or flush):
                await db.flush()
            if reservation is not None:
                await storage_quota_service.commit_reservation(
                    db,
                    reservation,
                    storage_path=object_key,
                    content_hash=asset.content_hash,
                )
            if commit and hasattr(db, "commit"):
                await db.commit()
                if refresh:
                    await db.refresh(asset)
        except Exception:
            await db.rollback()
            await self.delete_uploaded_object_best_effort(object_key=object_key)
            raise

        return CreatedMediaAsset(asset=asset, object_key=object_key)

    async def delete_uploaded_object_best_effort(self, *, object_key: str) -> None:
        try:
            await object_storage_service.delete_object(object_key=object_key)
        except ObjectStorageError:
            return


media_asset_service = MediaAssetService()
