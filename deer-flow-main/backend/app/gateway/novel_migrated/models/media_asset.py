"""Object-storage-backed media asset metadata."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class MediaAsset(Base):
    """Metadata for novel assets whose bytes live in S3-compatible storage."""

    __tablename__ = "media_assets"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True, comment="Owner user id from main DeerFlow auth")
    project_id = Column(String(36), nullable=True, index=True, comment="Optional owning novel project")
    purpose = Column(String(64), nullable=False, index=True, comment="cover/import/attachment/export/draft/etc.")
    filename = Column(String(500), nullable=False, comment="Original file name")
    mime_type = Column(String(255), nullable=True, comment="MIME type")
    size_bytes = Column(Integer, nullable=False, default=0, comment="Object size in bytes")
    content_hash = Column(String(128), nullable=True, index=True, comment="Content hash for dedupe/integrity")
    storage_backend = Column(String(32), nullable=False, default="s3", comment="Storage protocol/backend")
    endpoint = Column(String(500), nullable=True, comment="Configured object storage endpoint")
    bucket = Column(String(255), nullable=False, comment="Object storage bucket")
    object_key = Column(String(1000), nullable=False, comment="Private object key")
    status = Column(String(32), nullable=False, default="active", index=True, comment="active/deleted/failed")
    metadata_json = Column(Text, nullable=True, comment="Additional JSON metadata")

    created_at = Column(DateTime, server_default=func.now(), comment="Creation time")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="Update time")

    __table_args__ = (
        UniqueConstraint("bucket", "object_key", name="uq_media_asset_object"),
        Index("idx_media_assets_user_project", "user_id", "project_id"),
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<MediaAsset(id={self.id}, user_id={self.user_id}, project_id={self.project_id})>"
