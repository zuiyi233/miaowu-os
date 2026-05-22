import uuid

from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class DualWriteLog(Base):
    __tablename__ = "novel_dual_write_log"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    modern_project_id = Column(String(36), nullable=False, index=True, comment="modern 端项目 ID")
    legacy_payload = Column(Text, nullable=False, comment="legacy 端写入的 JSON payload")
    status = Column(String(20), default="pending", nullable=False, comment="pending/success/failed")
    retry_count = Column(Integer, default=0, comment="已重试次数")
    max_retries = Column(Integer, default=5, comment="最大重试次数")
    last_error = Column(Text, comment="最近一次失败原因")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    next_retry_at = Column(DateTime, comment="下次重试时间")

    __table_args__ = (
        {"comment": "双写补偿日志：modern 写入成功但 legacy 写入失败时记录，后台任务重试"},
    )

    def __repr__(self) -> str:
        return (
            "DualWriteLog("
            f"id={self.id!r}, "
            f"modern_project_id={self.modern_project_id!r}, "
            f"status={self.status!r}, "
            f"retry_count={self.retry_count!r}, "
            f"max_retries={self.max_retries!r}"
            ")"
        )
