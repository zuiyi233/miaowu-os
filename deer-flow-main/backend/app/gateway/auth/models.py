"""User Pydantic models for authentication."""

from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, EmailStr, Field


def _utc_now() -> datetime:
    """Return current UTC time (timezone-aware)."""
    return datetime.now(UTC)


class User(BaseModel):
    """Internal user representation."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(default_factory=uuid4, description="Primary key")
    email: EmailStr = Field(..., description="Unique email address")
    password_hash: str | None = Field(None, description="bcrypt hash, nullable for OAuth users")
    system_role: Literal["admin", "user"] = Field(default="user")
    created_at: datetime = Field(default_factory=_utc_now)

    # OAuth linkage (optional)
    oauth_provider: str | None = Field(None, description="e.g. 'github', 'google'")
    oauth_id: str | None = Field(None, description="User ID from OAuth provider")

    # Auth lifecycle
    needs_setup: bool = Field(default=False, description="True for auto-created admin until setup completes")
    token_version: int = Field(default=0, description="Incremented on password change to invalidate old JWTs")


class NewAPIAccountSnapshot(BaseModel):
    """Last known NewAPI account metadata for display and soft warnings."""

    model_config = ConfigDict(from_attributes=True)

    user_id: str
    newapi_sub: str
    email: str | None = None
    username: str | None = None
    name: str | None = None
    avatar: str | None = None
    quota: int | None = None
    used_quota: int | None = None
    remain_quota: int | None = None
    balance: int | None = None
    last_synced_at: datetime


class UserResponse(BaseModel):
    """Response model for user info endpoint."""

    id: str
    email: str
    system_role: Literal["admin", "user"]
    needs_setup: bool = False
    newapi_account: NewAPIAccountSnapshot | None = None
