"""提示词工坊数据模型"""

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class PromptWorkshopItem(Base):
    """提示词工坊条目 - 已审核通过的公开提示词"""

    __tablename__ = "prompt_workshop_items"

    id = Column(String(36), primary_key=True, comment="UUID")
    name = Column(String(100), nullable=False, comment="提示词名称")
    description = Column(Text, comment="提示词描述")
    prompt_content = Column(Text, nullable=False, comment="提示词内容")
    category = Column(String(50), default="general", comment="分类")
    tags = Column(JSON, comment="标签数组")
    author_id = Column(String(255), comment="作者用户标识（实例ID:用户ID）")
    author_name = Column(String(100), comment="作者显示名称")
    source_instance = Column(String(255), comment="来源实例标识")
    is_official = Column(Boolean, default=False, comment="是否官方提示词")
    download_count = Column(Integer, default=0, comment="下载/导入次数")
    like_count = Column(Integer, default=0, comment="点赞数")
    status = Column(String(20), default="active", comment="状态：active/hidden/deprecated")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index("idx_workshop_items_category", "category"),
        Index("idx_workshop_items_status", "status"),
        Index("idx_workshop_items_download_count", "download_count"),
        Index("idx_workshop_items_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<PromptWorkshopItem(id={self.id}, name={self.name})>"

    def __init__(self, **kwargs):
        # SQLAlchemy Column(default=...) is applied at INSERT time, not instance creation.
        # Provide python-side defaults so in-memory objects behave predictably (and match unit tests).
        super().__init__(**kwargs)
        if self.category is None:
            self.category = "general"
        if self.is_official is None:
            self.is_official = False
        if self.download_count is None:
            self.download_count = 0
        if self.like_count is None:
            self.like_count = 0
        if self.status is None:
            self.status = "active"


class PromptSubmission(Base):
    """用户提交的待审核提示词"""

    __tablename__ = "prompt_submissions"

    id = Column(String(36), primary_key=True, comment="UUID")
    submitter_id = Column(String(255), nullable=False, comment="提交者标识（实例ID:用户ID）")
    submitter_name = Column(String(100), comment="提交者显示名称")
    source_instance = Column(String(255), nullable=False, comment="来源实例标识")
    name = Column(String(100), nullable=False, comment="提示词名称")
    description = Column(Text, comment="提示词描述")
    prompt_content = Column(Text, nullable=False, comment="提示词内容")
    category = Column(String(50), default="general", comment="分类")
    tags = Column(JSON, comment="标签数组")
    author_display_name = Column(String(100), comment="希望显示的作者名")
    is_anonymous = Column(Boolean, default=False, comment="是否匿名发布")

    status = Column(String(20), default="pending", comment="状态：pending/approved/rejected")
    reviewer_id = Column(String(100), comment="审核人ID（云端管理员）")
    review_note = Column(Text, comment="审核备注（拒绝理由等）")
    reviewed_at = Column(DateTime, comment="审核时间")
    workshop_item_id = Column(String(36), comment="审核通过后关联的工坊条目ID")

    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    __table_args__ = (
        Index("idx_submissions_submitter", "submitter_id"),
        Index("idx_submissions_source", "source_instance"),
        Index("idx_submissions_status", "status"),
        Index("idx_submissions_created_at", "created_at"),
    )

    def __repr__(self):
        return f"<PromptSubmission(id={self.id}, name={self.name}, status={self.status})>"

    def __init__(self, **kwargs):
        # SQLAlchemy Column(default=...) is applied at INSERT time, not instance creation.
        # Provide python-side defaults so in-memory objects behave predictably (and match unit tests).
        super().__init__(**kwargs)
        if self.category is None:
            self.category = "general"
        if self.is_anonymous is None:
            self.is_anonymous = False
        if self.status is None:
            self.status = "pending"


class PromptWorkshopLike(Base):
    """提示词点赞记录"""

    __tablename__ = "prompt_workshop_likes"

    id = Column(String(36), primary_key=True, comment="UUID")
    user_identifier = Column(String(255), nullable=False, comment="用户标识（实例ID:用户ID）")
    workshop_item_id = Column(String(36), ForeignKey("prompt_workshop_items.id", ondelete="CASCADE"), nullable=False, comment="工坊条目ID")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")

    __table_args__ = (Index("idx_likes_user_item", "user_identifier", "workshop_item_id", unique=True),)

    def __repr__(self):
        return f"<PromptWorkshopLike(user={self.user_identifier}, item={self.workshop_item_id})>"
