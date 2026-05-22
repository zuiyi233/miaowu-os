"""Deprecated novel-local user compatibility shims.

The main Miaowu-OS/DeerFlow backend owns authentication and the ``users``
table.  This module intentionally does not declare SQLAlchemy models, so an
accidental import cannot register duplicate ``users`` or ``user_passwords``
tables on the shared metadata.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class User:
    """Historical DTO shape only; not a schema source."""

    user_id: str
    username: str
    display_name: str
    avatar_url: str | None = None
    trust_level: int = 0
    is_admin: bool = False
    linuxdo_id: str | None = None
    created_at: datetime | None = None
    last_login: datetime | None = None

    @property
    def is_active(self) -> bool:
        return self.trust_level != -1

    def to_dict(self) -> dict:
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


@dataclass
class UserPassword:
    """Historical DTO shape only; not a schema source."""

    user_id: str
    username: str
    password_hash: str
    has_custom_password: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
