"""AI使用统计数据模型"""
import uuid

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Index
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class AIMetric(Base):
    """AI使用统计表"""
    __tablename__ = "ai_metrics"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(50), nullable=False, index=True, comment="用户ID")
    provider = Column(String(50), nullable=False, comment="API提供商")
    model = Column(String(100), nullable=False, comment="模型名称")
    prompt_tokens = Column(Integer, default=0, comment="输入token数")
    completion_tokens = Column(Integer, default=0, comment="输出token数")
    total_tokens = Column(Integer, default=0, comment="总token数")
    operation_type = Column(String(50), default="generation", comment="操作类型")
    success = Column(Boolean, default=True, comment="是否成功")
    created_at = Column(DateTime, server_default=func.now(), comment="记录时间")

    __table_args__ = (
        Index('idx_ai_metrics_user_time', 'user_id', 'created_at'),
        Index('idx_ai_metrics_model', 'model'),
    )

    def __repr__(self):
        return f"<AIMetric(id={self.id}, user_id={self.user_id}, model={self.model}, tokens={self.total_tokens})>"
