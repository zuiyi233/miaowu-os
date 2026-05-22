"""意图识别会话与幂等键共享存储模型。"""

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class IntentSessionState(Base):
    """意图识别会话状态表（跨进程共享）。"""

    __tablename__ = "intent_session_states"

    session_key = Column(String(255), primary_key=True, comment="会话唯一键")
    user_id = Column(String(100), nullable=False, index=True, comment="用户ID")
    payload_json = Column(Text, nullable=False, comment="会话序列化数据(JSON)")
    updated_at = Column(DateTime, nullable=False, index=True, comment="会话更新时间")
    created_at = Column(DateTime, server_default=func.now(), comment="创建时间")

    __table_args__ = (
        Index("idx_intent_session_user_updated", "user_id", "updated_at"),
    )


class IntentIdempotencyKey(Base):
    """意图识别幂等键表（跨进程共享）。"""

    __tablename__ = "intent_idempotency_keys"

    key = Column(String(64), primary_key=True, comment="幂等键")
    user_id = Column(String(100), nullable=True, index=True, comment="用户ID")
    action = Column(String(100), nullable=True, comment="动作名")
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True, comment="创建时间")

