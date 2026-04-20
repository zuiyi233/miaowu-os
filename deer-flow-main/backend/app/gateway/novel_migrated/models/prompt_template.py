"""提示词模板模型 - 支持用户自定义模板覆盖系统默认"""
import json
import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, Index
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(100), nullable=False, index=True)
    template_key = Column(String(100), nullable=False, comment="模板键名，对应PromptService中的常量名")
    template_name = Column(String(200), comment="模板显示名称")
    template_content = Column(Text, nullable=False, comment="自定义模板内容")
    category = Column(String(50), comment="模板分类: world_building/character/outline/chapter/analysis/inspiration/mcp")
    description = Column(String(500), comment="模板描述")
    parameters = Column(Text, comment="参数JSON（存储模板变量定义）")
    is_active = Column(Boolean, default=True, comment="是否启用")
    is_system_default = Column(Boolean, default=False, comment="是否为系统默认模板")
    version = Column(Integer, default=1, comment="版本号")

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_prompt_template_user_key", "user_id", "template_key", unique=True),
        Index("idx_prompt_template_category", "category"),
        Index("idx_prompt_template_system_default", "is_system_default"),
    )

    def __repr__(self):
        return f"<PromptTemplate(user={self.user_id}, key={self.template_key})>"

    def to_dict(self) -> dict:
        """转换为字典（兼容API响应）"""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "template_key": self.template_key,
            "template_name": self.template_name or self.template_key,
            "template_content": self.template_content,
            "category": self.category,
            "description": self.description,
            "parameters": json.loads(self.parameters) if self.parameters else {},
            "is_active": self.is_active,
            "is_system_default": getattr(self, 'is_system_default', False),
            "version": self.version,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
