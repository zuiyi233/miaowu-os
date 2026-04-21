"""分析任务模型 - 追踪异步章节分析任务状态"""
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class AnalysisTask(Base):
    __tablename__ = "analysis_tasks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()), comment="任务ID")
    chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, comment="章节ID")
    user_id = Column(String(50), nullable=False, comment="用户ID")
    project_id = Column(String(36), nullable=False, index=True, comment="项目ID")

    status = Column(
        String(20),
        nullable=False,
        default="pending",
        comment="任务状态: pending/running/completed/failed",
    )
    progress = Column(Integer, default=0, comment="进度 0-100")
    error_message = Column(Text, nullable=True, comment="错误信息")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    started_at = Column(DateTime, nullable=True, comment="开始执行时间")
    completed_at = Column(DateTime, nullable=True, comment="完成时间")

    __table_args__ = (
        Index("idx_analysis_chapter_created", "chapter_id", "created_at"),
        Index("idx_analysis_status", "status"),
    )

    def __repr__(self):
        return f"<AnalysisTask(id={self.id[:8]}..., chapter_id={self.chapter_id[:8]}..., status={self.status})>"

    @property
    def is_terminal(self) -> bool:
        return self.status in {"completed", "failed"}
