"""生成历史记录模型"""
import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class GenerationHistory(Base):
    __tablename__ = "generation_history"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True)
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True)

    generation_type = Column(String(50), nullable=False, comment="生成类型: chapter/outline/character/world_build/career/analysis/regeneration")
    prompt = Column(Text, comment="输入提示词摘要")
    generated_content = Column(Text, comment="生成内容摘要")
    model = Column(String(100), comment="使用的模型")
    provider = Column(String(50), comment="AI提供商")
    tokens_used = Column(Integer, default=0, comment="消耗的token数")
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    generation_time_ms = Column(Integer, comment="生成耗时(毫秒)")
    success = Column(Integer, default=1, comment="1=成功, 0=失败")
    error_message = Column(Text, nullable=True)
    metadata_json = Column(JSON, comment="额外元数据")

    created_at = Column(DateTime, server_default=func.now(), index=True)

    def __repr__(self):
        return f"<GenerationHistory(id={self.id[:8]}..., type={self.generation_type})>"
