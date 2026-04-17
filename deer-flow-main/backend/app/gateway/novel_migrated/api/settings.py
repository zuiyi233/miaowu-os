"""Settings bridge for novel_migrated."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.ai_service import AIService, create_user_ai_service


async def get_user_ai_service(request: Request, db: AsyncSession) -> AIService:
    """Create user AI service from persisted settings."""
    user_id = get_request_user_id(request)

    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if not settings:
        settings = Settings(user_id=user_id)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)

    return create_user_ai_service(
        api_provider=settings.api_provider,
        api_key=settings.api_key or "",
        api_base_url=settings.api_base_url or "",
        model_name=settings.llm_model,
        temperature=settings.temperature,
        max_tokens=settings.max_tokens,
        system_prompt=settings.system_prompt,
        user_id=user_id,
        db_session=db,
        enable_mcp=True,
    )
