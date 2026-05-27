"""TTS studio workspace persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class TtsStudioWorkspace(Base):
    """Backend-owned TTS studio board state scoped to one authenticated user."""

    __tablename__ = "tts_studio_workspaces"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True)
    name = Column(String(200), nullable=False, default="音频工作站")
    board_json = Column(Text, nullable=False, default="{}")
    status = Column(String(32), nullable=False, default="active", index=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_tts_studio_workspaces_user_updated", "user_id", "updated_at"),
    )
