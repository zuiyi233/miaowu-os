"""User AI settings CRUD APIs.

Single source of truth:
  - /api/user/ai-settings returns and updates the canonical providers list
    stored in Settings.preferences["ai_provider_settings"].
  - Active provider is mirrored to Settings top-level fields for legacy flows.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.services.ai_settings_service import get_ai_settings_service

router = APIRouter(prefix="/api/user", tags=["user_settings"])


class ClientSettings(BaseModel):
    enable_stream_mode: bool = True
    request_timeout: int = 660000
    max_retries: int = 2


class ProviderRecordResponse(BaseModel):
    id: str
    name: str
    provider: str
    base_url: str = ""
    models: list[str] = Field(default_factory=list)
    is_active: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    has_api_key: bool = False


class ProviderRecordUpdate(BaseModel):
    id: str | None = None
    name: str
    provider: str
    base_url: str = ""
    models: list[str] = Field(default_factory=list)
    is_active: bool = False
    temperature: float | None = None
    max_tokens: int | None = None

    # write-only fields
    api_key: str | None = Field(default=None, description="write-only; non-empty overwrites backend stored key")
    clear_api_key: bool | None = Field(default=None, description="write-only; true clears backend stored key")


class AiSettingsResponse(BaseModel):
    # canonical fields
    providers: list[ProviderRecordResponse] = Field(default_factory=list)
    default_provider_id: str | None = None
    client_settings: ClientSettings = Field(default_factory=ClientSettings)

    # legacy-compatible fields (mirrored from active provider / Settings top-level)
    api_provider: str
    api_base_url: str
    llm_model: str
    temperature: float
    max_tokens: int
    system_prompt: str | None


class AiSettingsUpdateRequest(BaseModel):
    # new contract fields (preferred)
    providers: list[ProviderRecordUpdate] | None = None
    default_provider_id: str | None = None
    client_settings: ClientSettings | None = None

    # legacy fields (supported)
    api_provider: str | None = None
    api_key: str | None = None
    api_base_url: str | None = None
    llm_model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    system_prompt: str | None = None


@router.get("/ai-settings", response_model=AiSettingsResponse)
async def get_ai_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get current user's AI settings."""
    user_id = get_request_user_id(request)
    service = get_ai_settings_service()
    return await service.get_ai_settings(user_id, db)


@router.put("/ai-settings")
async def update_ai_settings(
    payload: AiSettingsUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update user's AI settings."""
    user_id = get_request_user_id(request)
    service = get_ai_settings_service()
    updated = await service.put_ai_settings(user_id, payload.model_dump(exclude_unset=True), db)
    return updated
