"""User AI settings CRUD APIs.

Single source of truth:
  - /api/user/ai-settings returns and updates the canonical providers list
    stored in Settings.preferences["ai_provider_settings"].
  - Active provider is mirrored to Settings top-level fields for legacy flows.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.services.ai_settings_service import get_ai_settings_service

logger = logging.getLogger(__name__)

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
    feature_routing_settings: dict[str, object] | None = None

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
    feature_routing_settings: dict[str, object] | None = None

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


class FetchProviderModelsRequest(BaseModel):
    base_url: str = Field(default="", description="Provider API base URL")
    api_key: str = Field(default="", description="Provider API key")
    provider_type: str = Field(default="openai", description="Provider type: openai, anthropic, google, custom")


class FetchProviderModelsResponse(BaseModel):
    models: list[str] = Field(default_factory=list)


def _build_models_url(base_url: str, provider_type: str) -> str | None:
    if provider_type in ("anthropic",):
        return None
    cleaned = base_url.rstrip("/")
    if not cleaned:
        return None
    if cleaned.endswith("/models"):
        return cleaned
    if cleaned.endswith("/v1"):
        return f"{cleaned}/models"
    if "/v1/" not in cleaned:
        return f"{cleaned}/v1/models"
    return f"{cleaned}/models"


def _parse_openai_models_response(data: Any) -> list[str]:
    if not isinstance(data, dict):
        return []
    raw_models = data.get("data") or []
    if not isinstance(raw_models, list):
        return []
    models: list[str] = []
    for item in raw_models:
        if isinstance(item, dict):
            model_id = item.get("id")
            if isinstance(model_id, str) and model_id.strip():
                models.append(model_id.strip())
        elif isinstance(item, str) and item.strip():
            models.append(item.strip())
    return sorted(models)


@router.post("/fetch-provider-models", response_model=FetchProviderModelsResponse)
async def fetch_provider_models(
    payload: FetchProviderModelsRequest,
    request: Request,
):
    """Fetch available models from an upstream provider API.

    Supports OpenAI-compatible /v1/models endpoints.
    The API key is used only for this request and is NOT stored.
    """
    base_url = (payload.base_url or "").strip()
    api_key = (payload.api_key or "").strip()
    provider_type = (payload.provider_type or "openai").strip().lower()

    if provider_type == "anthropic":
        return FetchProviderModelsResponse(
            models=_get_anthropic_static_models()
        )

    if provider_type == "google":
        return FetchProviderModelsResponse(
            models=_get_google_static_models()
        )

    models_url = _build_models_url(base_url, provider_type)
    if not models_url:
        raise HTTPException(status_code=400, detail="需要提供有效的接口地址")

    headers: dict[str, str] = {
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(models_url, headers=headers)
            if response.status_code != 200:
                logger.warning(
                    "fetch-provider-models: upstream %s returned %s",
                    models_url,
                    response.status_code,
                )
                raise HTTPException(
                    status_code=502,
                    detail=f"上游 API 返回 {response.status_code}",
                )
            data = response.json()
            models = _parse_openai_models_response(data)
            if not models:
                logger.warning("fetch-provider-models: no models parsed from %s", models_url)
            return FetchProviderModelsResponse(models=models)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="上游 API 请求超时")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="无法连接到上游 API，请检查接口地址")
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("fetch-provider-models: unexpected error")
        raise HTTPException(status_code=500, detail=f"获取模型列表失败: {exc}") from exc


def _get_anthropic_static_models() -> list[str]:
    return sorted([
        "claude-opus-4-0-20250514",
        "claude-sonnet-4-20250514",
        "claude-3-7-sonnet-20250219",
        "claude-3-5-sonnet-20241022",
        "claude-3-5-haiku-20241022",
        "claude-3-opus-20240229",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
    ])


def _get_google_static_models() -> list[str]:
    return sorted([
        "gemini-2.5-pro-preview-05-06",
        "gemini-2.5-flash-preview-05-20",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-pro",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
    ])
