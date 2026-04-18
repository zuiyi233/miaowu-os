"""User AI settings CRUD APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.core.crypto import encrypt_secret, decrypt_secret, is_encryption_enabled

router = APIRouter(prefix="/api/user", tags=["user_settings"])


class SettingsResponse(BaseModel):
    """Settings read response."""

    api_provider: str
    api_base_url: str
    llm_model: str
    temperature: float
    max_tokens: int
    system_prompt: str | None


class SettingsUpdateRequest(BaseModel):
    """Settings update request."""

    api_provider: str | None = None
    api_key: str | None = None
    api_base_url: str | None = None
    llm_model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    system_prompt: str | None = None


@router.get("/ai-settings", response_model=SettingsResponse)
async def get_ai_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get current user's AI settings."""
    user_id = get_request_user_id(request)

    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if not settings:
        return SettingsResponse(
            api_provider="openai",
            api_base_url="",
            llm_model="gpt-4o-mini",
            temperature=0.7,
            max_tokens=4096,
            system_prompt=None,
        )

    return SettingsResponse(
        api_provider=settings.api_provider or "openai",
        api_base_url=settings.api_base_url or "",
        llm_model=settings.llm_model or "gpt-4o-mini",
        temperature=settings.temperature or 0.7,
        max_tokens=settings.max_tokens or 4096,
        system_prompt=settings.system_prompt,
    )


@router.put("/ai-settings")
async def update_ai_settings(
    payload: SettingsUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update user's AI settings."""
    user_id = get_request_user_id(request)

    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if not settings:
        settings = Settings(user_id=user_id)
        db.add(settings)

    if payload.api_provider is not None:
        settings.api_provider = payload.api_provider
    if payload.api_key is not None:
        settings.api_key = encrypt_secret(payload.api_key) if is_encryption_enabled() and payload.api_key and payload.api_key.strip() else (payload.api_key or None)
    if payload.api_base_url is not None:
        settings.api_base_url = payload.api_base_url
    if payload.llm_model is not None:
        settings.llm_model = payload.llm_model
    if payload.temperature is not None:
        settings.temperature = payload.temperature
    if payload.max_tokens is not None:
        settings.max_tokens = payload.max_tokens
    if payload.system_prompt is not None:
        settings.system_prompt = payload.system_prompt

    await db.commit()
    await db.refresh(settings)

    return {"success": True, "message": "Settings updated"}
