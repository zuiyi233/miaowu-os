"""Novel agent configuration API.

Provides endpoints for managing per-task-type model configurations
and preset management for novel creation workflow.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.models.novel_agent_config import NovelAgentType
from app.gateway.novel_migrated.services.novel_agent_config_service import (
    MAX_MAX_TOKENS,
    MAX_TEMPERATURE,
    MIN_MAX_TOKENS,
    MIN_TEMPERATURE,
    NovelAgentConfigService,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/novel-agent", tags=["novel-agent"])


# ==================== Request/Response Models ====================

class AgentConfigPayload(BaseModel):
    """Agent configuration payload."""

    agent_type: str = Field(..., description="Agent task type")
    provider_id: str | None = Field(None, description="AI provider ID")
    model_name: str | None = Field(None, description="Model name")
    temperature: float | None = Field(
        None, ge=MIN_TEMPERATURE, le=MAX_TEMPERATURE, description="Temperature"
    )
    max_tokens: int | None = Field(
        None, ge=MIN_MAX_TOKENS, le=MAX_MAX_TOKENS, description="Max tokens"
    )
    system_prompt: str | None = Field(
        None, max_length=2000, description="System prompt"
    )
    is_enabled: bool | None = Field(None, description="Whether enabled")

    @field_validator("agent_type")
    @classmethod
    def validate_agent_type(cls, v: str) -> str:
        allowed = {e.value for e in NovelAgentType}
        if v not in allowed:
            raise ValueError(f"Invalid agent_type: {v}. Must be one of {allowed}")
        return v

    @field_validator("system_prompt")
    @classmethod
    def sanitize_system_prompt(cls, v: str | None) -> str | None:
        """Sanitize system prompt to prevent XSS and injection attacks."""
        if v is None:
            return None
        import re

        # Remove potentially dangerous HTML/script tags
        v = re.sub(r"<script[^>]*>.*?</script>", "", v, flags=re.IGNORECASE | re.DOTALL)
        v = re.sub(r"<iframe[^>]*>.*?</iframe>", "", v, flags=re.IGNORECASE | re.DOTALL)
        v = re.sub(r"javascript:", "", v, flags=re.IGNORECASE)
        v = re.sub(r"on\w+\s*=", "", v, flags=re.IGNORECASE)
        # Strip excessive whitespace
        v = v.strip()
        return v if v else None


class BatchAgentConfigPayload(BaseModel):
    """Batch update agent configurations."""

    configs: list[AgentConfigPayload] = Field(..., description="List of agent configs")


class PresetApplyPayload(BaseModel):
    """Apply preset request."""

    preset_id: str = Field(..., description="Preset ID to apply")


class CustomPresetCreatePayload(BaseModel):
    """Create custom preset request."""

    name: str = Field(..., min_length=1, max_length=100, description="Preset name")
    description: str | None = Field(None, max_length=500, description="Preset description")
    agent_configs: dict[str, dict[str, Any]] = Field(
        ..., description="Agent configurations map"
    )


class AgentConfigResponse(BaseModel):
    """Agent config response."""

    id: str
    user_id: str
    agent_type: str
    provider_id: str | None
    model_name: str | None
    temperature: float
    max_tokens: int
    system_prompt: str | None
    is_enabled: bool
    created_at: str | None
    updated_at: str | None


class PresetResponse(BaseModel):
    """Preset response."""

    id: str
    name: str
    description: str
    icon: str | None
    is_built_in: bool
    agent_configs: dict[str, dict[str, Any]]


class ActivePresetResponse(BaseModel):
    """Active preset response."""

    active_preset: str | None


# ==================== Helper ====================

async def get_config_service(
    db: AsyncSession = Depends(get_db),
) -> NovelAgentConfigService:
    """Dependency to get config service."""
    return NovelAgentConfigService(db)


# ==================== API Endpoints ====================

@router.get("/configs", response_model=list[AgentConfigResponse])
async def get_all_configs(
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> list[AgentConfigResponse]:
    """Get all agent configs for current user."""
    user_id = get_user_id(request)
    configs = await service.get_configs(user_id)
    return [AgentConfigResponse(**c.to_dict()) for c in configs]


@router.get("/configs/{agent_type}", response_model=AgentConfigResponse)
async def get_config(
    agent_type: str,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> AgentConfigResponse:
    """Get a specific agent config."""
    user_id = get_user_id(request)
    config = await service.get_config(user_id, agent_type)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Config not found for agent_type: {agent_type}",
        )
    return AgentConfigResponse(**config.to_dict())


@router.post("/configs/{agent_type}", response_model=AgentConfigResponse)
async def update_config(
    agent_type: str,
    payload: AgentConfigPayload,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> AgentConfigResponse:
    """Create or update an agent config."""
    user_id = get_user_id(request)
    config = await service.upsert_config(
        user_id=user_id,
        agent_type=agent_type,
        provider_id=payload.provider_id,
        model_name=payload.model_name,
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        system_prompt=payload.system_prompt,
        is_enabled=payload.is_enabled,
    )
    return AgentConfigResponse(**config.to_dict())


@router.put("/configs", response_model=list[AgentConfigResponse])
async def batch_update_configs(
    payload: BatchAgentConfigPayload,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> list[AgentConfigResponse]:
    """Batch update agent configs.

    Uses a single database transaction for all upserts to improve performance.
    """
    user_id = get_user_id(request)
    results: list[AgentConfigResponse] = []

    for cfg in payload.configs:
        config = await service.upsert_config(
            user_id=user_id,
            agent_type=cfg.agent_type,
            provider_id=cfg.provider_id,
            model_name=cfg.model_name,
            temperature=cfg.temperature,
            max_tokens=cfg.max_tokens,
            system_prompt=cfg.system_prompt,
            is_enabled=cfg.is_enabled,
        )
        results.append(AgentConfigResponse(**config.to_dict()))

    return results


@router.delete("/configs/{agent_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    agent_type: str,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> None:
    """Delete an agent config."""
    user_id = get_user_id(request)
    deleted = await service.delete_config(user_id, agent_type)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Config not found for agent_type: {agent_type}",
        )


@router.get("/presets", response_model=list[PresetResponse])
async def get_presets(
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> list[PresetResponse]:
    """Get all available presets (built-in + custom)."""
    user_id = get_user_id(request)
    presets = await service.get_presets(user_id)
    return [PresetResponse(**p) for p in presets]


@router.post("/presets/{preset_id}/apply", response_model=list[AgentConfigResponse])
async def apply_preset(
    preset_id: str,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> list[AgentConfigResponse]:
    """Apply a preset to current user's configs."""
    user_id = get_user_id(request)
    try:
        configs = await service.apply_preset(user_id, preset_id)
        return [AgentConfigResponse(**c.to_dict()) for c in configs]
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.post("/presets", response_model=PresetResponse)
async def create_custom_preset(
    payload: CustomPresetCreatePayload,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> PresetResponse:
    """Create a user-defined custom preset."""
    user_id = get_user_id(request)
    preset = await service.create_custom_preset(
        user_id=user_id,
        name=payload.name,
        description=payload.description,
        agent_configs=payload.agent_configs,
    )
    return PresetResponse(**preset)


@router.delete("/presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_preset(
    preset_id: str,
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> None:
    """Delete a custom preset."""
    user_id = get_user_id(request)
    deleted = await service.delete_custom_preset(user_id, preset_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Custom preset not found: {preset_id}",
        )


@router.get("/active-preset", response_model=ActivePresetResponse)
async def get_active_preset(
    request: Request,
    service: NovelAgentConfigService = Depends(get_config_service),
) -> ActivePresetResponse:
    """Get the currently active preset for current user."""
    user_id = get_user_id(request)
    active = await service.get_active_preset(user_id)
    return ActivePresetResponse(active_preset=active)
