"""
用户数据模型 - 最小兼容模型（适配 deer-flow 认证体系）
说明：
  - 参考项目使用完整 User/UserPassword 模型支持 OAuth + 本地密码登录
  - deer-flow 项目采用不同的认证体系（可能基于 request.state.user 或中间件）
  - 此文件提供最小兼容模型，仅用于 admin 等必须依赖 User 的场景
  - 实际认证逻辑应通过 common.py 中的 get_user_id() / resolve_user_id() 进行桥接
取舍：
  ✓ 保留 User 核心字段（user_id, username, display_name, is_admin 等）
  ✓ 保留 UserPassword 用于密码管理（如果需要）
  ✗ 不强制要求 OAuth 字段（linuxdo_id 等），按需扩展
"""

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.gateway.novel_migrated.core.database import Base


class User(Base):
    """
    用户模型 - 最小兼容版本
    兼容参考项目的 User 模型接口，但适配 deer-flow 认证体系
    """

    __tablename__ = "users"

    user_id = Column(String(100), primary_key=True, index=True, comment="用户ID")
    username = Column(String(100), nullable=False, index=True, comment="用户名")
    display_name = Column(String(200), nullable=False, comment="显示名称")
    avatar_url = Column(String(500), nullable=True, comment="头像URL")
    trust_level = Column(Integer, default=0, comment="信任等级（-1=禁用, 0=普通用户, >=1=高级用户）")
    is_admin = Column(Boolean, default=False, comment="是否为管理员")
    linuxdo_id = Column(String(100), nullable=True, index=True, comment="LinuxDO用户ID（可选，OAuth场景）")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    last_login = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="最后登录时间")

    @property
    def is_active(self) -> bool:
        """用户是否激活（trust_level != -1）"""
        return self.trust_level != -1

    def to_dict(self):
        """转换为字典"""
        return {
            "user_id": self.user_id,
            "username": self.username,
            "display_name": self.display_name,
            "avatar_url": self.avatar_url,
            "trust_level": self.trust_level,
            "is_admin": self.is_admin,
            "is_active": self.is_active,
            "linuxdo_id": self.linuxdo_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_login": self.last_login.isoformat() if self.last_login else None,
        }


class UserPassword(Base):
    """用户密码模型 - 存储用户密码信息"""

    __tablename__ = "user_passwords"

    user_id = Column(String(100), primary_key=True, index=True, comment="用户ID")
    username = Column(String(100), nullable=False, comment="用户名")
    password_hash = Column(String(60), nullable=False, comment="密码哈希（bcrypt, $2b$12$...格式）")
    has_custom_password = Column(Boolean, default=False, comment="是否为自定义密码")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __init__(self, **kwargs):
        # SQLAlchemy Column(default=...) is applied at INSERT time, not instance creation.
        # Provide python-side defaults so in-memory objects behave predictably (and match unit tests).
        super().__init__(**kwargs)
        if self.has_custom_password is None:
            self.has_custom_password = False
