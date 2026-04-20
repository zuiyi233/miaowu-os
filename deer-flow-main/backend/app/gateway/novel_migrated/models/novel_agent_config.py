"""Novel agent configuration model.

Supports per-task-type model selection for novel creation workflow.
Allows users to configure different models for writer, critic, polish, outline, etc.
"""

import uuid
from enum import Enum

from sqlalchemy import Boolean, Column, DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class NovelAgentType(str, Enum):
    """Supported novel agent task types."""

    WRITER = "writer"
    CRITIC = "critic"
    POLISH = "polish"
    OUTLINE = "outline"
    SUMMARY = "summary"
    CONTINUE = "continue"
    WORLD_BUILD = "world_build"
    CHARACTER = "character"


class NovelAgentConfig(Base):
    """Novel agent configuration per user and task type."""

    __tablename__ = "novel_agent_configs"

    id = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    user_id = Column(
        String(50),
        nullable=False,
        index=True,
        comment="User ID",
    )
    agent_type = Column(
        String(50),
        nullable=False,
        comment="Agent task type: writer/critic/polish/outline/summary/continue/world_build/character",
    )
    provider_id = Column(
        String(50),
        nullable=True,
        comment="AI provider ID, references main project's provider config",
    )
    model_name = Column(
        String(100),
        nullable=True,
        comment="Model name for this agent",
    )
    temperature = Column(
        Float,
        default=0.7,
        comment="Sampling temperature (0.0-2.0)",
    )
    max_tokens = Column(
        Integer,
        default=4096,
        comment="Maximum tokens per generation",
    )
    system_prompt = Column(
        Text,
        nullable=True,
        comment="Optional system prompt override for this agent",
    )
    is_enabled = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="Whether this custom config is active",
    )
    created_at = Column(
        DateTime,
        default=func.now(),
        comment="Creation timestamp",
    )
    updated_at = Column(
        DateTime,
        default=func.now(),
        onupdate=func.now(),
        comment="Last update timestamp",
    )

    __table_args__ = (
        UniqueConstraint("user_id", "agent_type", name="uq_user_agent_type"),
        Index("idx_novel_agent_user", "user_id"),
        Index("idx_novel_agent_type", "agent_type"),
    )

    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "agent_type": self.agent_type,
            "provider_id": self.provider_id,
            "model_name": self.model_name,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "system_prompt": self.system_prompt,
            "is_enabled": self.is_enabled,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def __repr__(self) -> str:
        return (
            f"<NovelAgentConfig("
            f"user_id={self.user_id}, "
            f"agent_type={self.agent_type}, "
            f"provider={self.provider_id}, "
            f"model={self.model_name}, "
            f"enabled={self.is_enabled}"
            f")>"
        )
