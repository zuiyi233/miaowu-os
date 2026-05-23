"""Author Control Station persistence models."""

from __future__ import annotations

import uuid

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class SceneCard(Base):
    """Scene/beat planning card scoped to one novel project and chapter."""

    __tablename__ = "scene_cards"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index = Column(Integer, nullable=False, default=0)
    title = Column(String(200), nullable=False, default="")
    scene_goal = Column(Text, nullable=False, default="")
    pov_character_id = Column(String(36), nullable=True)
    location = Column(String(200), nullable=True)
    involved_character_ids = Column(JSON, nullable=True)
    conflict = Column(Text, nullable=True)
    emotional_turn = Column(Text, nullable=True)
    foreshadow_in = Column(JSON, nullable=True)
    foreshadow_out = Column(JSON, nullable=True)
    required_facts = Column(JSON, nullable=True)
    forbidden_facts = Column(JSON, nullable=True)
    status_delta = Column(JSON, nullable=True)
    target_word_count = Column(Integer, nullable=True)
    draft_status = Column(String(30), nullable=False, default="planned")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_scene_cards_project_chapter_order", "project_id", "chapter_id", "order_index"),
        Index("idx_scene_cards_user_project", "user_id", "project_id"),
    )


class NovelIssue(Base):
    """Evidence-based critique issue for a chapter or scene."""

    __tablename__ = "novel_issues"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=True, index=True)
    scene_id = Column(String(36), ForeignKey("scene_cards.id", ondelete="SET NULL"), nullable=True, index=True)
    issue_type = Column(String(40), nullable=False, default="style")
    severity = Column(String(20), nullable=False, default="low")
    title = Column(String(200), nullable=False, default="")
    description = Column(Text, nullable=False, default="")
    evidence_text = Column(Text, nullable=False, default="")
    evidence_location = Column(JSON, nullable=True)
    conflicting_fact = Column(Text, nullable=True)
    suggestion = Column(Text, nullable=True)
    fix_action = Column(String(40), nullable=False, default="revise_selection")
    status = Column(String(20), nullable=False, default="open")
    source_run_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_novel_issues_project_status", "project_id", "status"),
        Index("idx_novel_issues_user_project", "user_id", "project_id"),
    )


class NovelDraftVersion(Base):
    """Candidate or accepted AI revision linked to chapter content."""

    __tablename__ = "novel_draft_versions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    scene_id = Column(String(36), ForeignKey("scene_cards.id", ondelete="SET NULL"), nullable=True, index=True)
    source_run_id = Column(String(100), nullable=True)
    context_hash = Column(String(100), nullable=True)
    base_content_hash = Column(String(100), nullable=False, default="")
    new_content_hash = Column(String(100), nullable=False, default="")
    diff_summary = Column(Text, nullable=False, default="")
    diff_payload = Column(JSON, nullable=True)
    content_snapshot_path = Column(Text, nullable=True)
    candidate_content = Column(Text, nullable=False, default="")
    base_content = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="candidate")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_novel_versions_chapter_status", "chapter_id", "status"),
        Index("idx_novel_versions_user_project", "user_id", "project_id"),
    )
