import logging
from collections.abc import Mapping

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.services.ai_settings_service import get_ai_settings_service
from deerflow.config import get_app_config

router = APIRouter(prefix="/api", tags=["models"])
logger = logging.getLogger(__name__)


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")


class TokenUsageResponse(BaseModel):
    """Token usage display configuration."""

    enabled: bool = Field(default=False, description="Whether token usage display is enabled")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]
    token_usage: TokenUsageResponse


def _build_config_model_lookup(config_models: list[object]) -> dict[str, object]:
    lookup: dict[str, object] = {}
    for model in config_models:
        for raw_key in (getattr(model, "name", None), getattr(model, "model", None)):
            if not isinstance(raw_key, str):
                continue
            key = raw_key.strip()
            if not key or key in lookup:
                continue
            lookup[key] = model
    return lookup


def _extract_user_model_names(payload: object) -> list[str]:
    if not isinstance(payload, Mapping):
        return []

    providers = payload.get("providers")
    if not isinstance(providers, list):
        return []

    user_models: list[str] = []
    seen: set[str] = set()
    for provider in providers:
        if not isinstance(provider, Mapping):
            continue
        models = provider.get("models")
        if not isinstance(models, list):
            continue
        for item in models:
            if not isinstance(item, str):
                continue
            model_name = item.strip()
            if not model_name or model_name in seen:
                continue
            user_models.append(model_name)
            seen.add(model_name)
    return user_models


def _build_config_model_response(model: object) -> ModelResponse:
    return ModelResponse(
        name=getattr(model, "name"),
        model=getattr(model, "model"),
        display_name=getattr(model, "display_name"),
        description=getattr(model, "description"),
        supports_thinking=bool(getattr(model, "supports_thinking", False)),
        supports_reasoning_effort=bool(getattr(model, "supports_reasoning_effort", False)),
    )


def _build_user_model_response(model_name: str, mapped_config_model: object | None) -> ModelResponse:
    if mapped_config_model is None:
        return ModelResponse(
            name=model_name,
            model=model_name,
            display_name=model_name,
            description=None,
            supports_thinking=False,
            supports_reasoning_effort=False,
        )

    return ModelResponse(
        name=model_name,
        model=str(getattr(mapped_config_model, "model", model_name) or model_name),
        display_name=getattr(mapped_config_model, "display_name"),
        description=getattr(mapped_config_model, "description"),
        supports_thinking=bool(getattr(mapped_config_model, "supports_thinking", False)),
        supports_reasoning_effort=bool(getattr(mapped_config_model, "supports_reasoning_effort", False)),
    )


async def _resolve_effective_models(
    request: Request,
    db: AsyncSession,
) -> tuple[list[ModelResponse], bool]:
    config = get_app_config()
    config_models = list(config.models)
    config_lookup = _build_config_model_lookup(config_models)

    try:
        user_id = get_request_user_id(request)
        settings_payload = await get_ai_settings_service().get_ai_settings(user_id, db)
        user_model_names = _extract_user_model_names(settings_payload)
    except Exception:
        logger.warning("Failed to read user ai-settings for /api/models, falling back to static app config models.", exc_info=True)
        user_model_names = []

    if user_model_names:
        return [
            _build_user_model_response(model_name, config_lookup.get(model_name))
            for model_name in user_model_names
        ], True

    return [
        _build_config_model_response(model)
        for model in config_models
    ], False


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ModelsListResponse:
    """List all available models from configuration.

    Returns model information suitable for frontend display,
    excluding sensitive fields like API keys and internal configuration.

    Returns:
        A list of all configured models with their metadata and token usage display settings.

    Example Response:
        ```json
        {
            "models": [
                {
                    "name": "gpt-4",
                    "model": "gpt-4",
                    "display_name": "GPT-4",
                    "description": "OpenAI GPT-4 model",
                    "supports_thinking": false,
                    "supports_reasoning_effort": false
                },
                {
                    "name": "claude-3-opus",
                    "model": "claude-3-opus",
                    "display_name": "Claude 3 Opus",
                    "description": "Anthropic Claude 3 Opus model",
                    "supports_thinking": true,
                    "supports_reasoning_effort": false
                }
            ],
            "token_usage": {
                "enabled": true
            }
        }
        ```
    """
    config = get_app_config()
    models, _ = await _resolve_effective_models(request, db)
    return ModelsListResponse(
        models=models,
        token_usage=TokenUsageResponse(enabled=config.token_usage.enabled),
    )


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(
    model_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found.

    Example Response:
        ```json
        {
            "name": "gpt-4",
            "display_name": "GPT-4",
            "description": "OpenAI GPT-4 model",
            "supports_thinking": false
        }
        ```
    """
    models, _ = await _resolve_effective_models(request, db)
    model = next((item for item in models if item.name == model_name), None)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    return model
