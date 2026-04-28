"""File-truth document index cache model.

Stores lightweight metadata for workspace documents. This table is a cache/index
layer only; canonical content remains in workspace files.
"""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class DocumentIndex(Base):
    """Workspace document index cache."""

    __tablename__ = "document_indexes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), nullable=False, index=True, comment="项目ID")
    user_id = Column(String(100), nullable=False, index=True, comment="用户ID")
    entity_type = Column(String(50), nullable=False, index=True, comment="实体类型")
    entity_id = Column(String(120), nullable=False, index=True, comment="实体ID")
    doc_path = Column(String(500), nullable=False, comment="相对工作区文档路径")
    title = Column(String(300), nullable=True, comment="文档标题（缓存）")
    content_hash = Column(String(128), nullable=False, index=True, comment="内容哈希")
    doc_updated_at = Column(DateTime, nullable=False, comment="文档最后更新时间")
    indexed_at = Column(DateTime, nullable=False, server_default=func.now(), comment="索引更新时间")
    status = Column(String(32), nullable=False, default="active", comment="索引状态")
    size = Column(Integer, nullable=False, default=0, comment="文件大小（字节）")
    tags_json = Column(Text, nullable=True, comment="标签JSON")
    schema_version = Column(String(20), nullable=False, default="1.0", comment="manifest schema 版本")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "user_id",
            "entity_type",
            "entity_id",
            name="uq_document_index_scope",
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<DocumentIndex(project_id={self.project_id}, user_id={self.user_id}, "
            f"entity_type={self.entity_type}, entity_id={self.entity_id})>"
        )

