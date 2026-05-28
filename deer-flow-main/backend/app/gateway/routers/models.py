import logging
import time
from collections import OrderedDict
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

_MODELS_CACHE_TTL_SEC = 5.0
_MODELS_CACHE_MAX_SIZE = 256


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    provider_id: str | None = Field(None, description="Owning provider ID for default-group resolution")


class TokenUsageResponse(BaseModel):
    """Token usage display configuration."""

    enabled: bool = Field(default=False, description="Whether token usage display is enabled")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]
    token_usage: TokenUsageResponse
    default_model_name: str | None = Field(None, description="Default model name from user's default provider")
    default_provider_id: str | None = Field(None, description="User's default provider ID")


_models_cache: OrderedDict[str, tuple[float, ModelsListResponse]] = OrderedDict()


def _evict_models_cache() -> None:
    now = time.monotonic()
    expired = [k for k, (ts, _) in _models_cache.items() if now - ts >= _MODELS_CACHE_TTL_SEC]
    for k in expired:
        del _models_cache[k]
    while len(_models_cache) > _MODELS_CACHE_MAX_SIZE:
        _models_cache.popitem(last=False)


def _store_models_cache(user_id: str, response: ModelsListResponse) -> None:
    _models_cache[user_id] = (time.monotonic(), response)
    _models_cache.move_to_end(user_id)
    _evict_models_cache()


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


def _extract_user_models_and_provider_map(payload: object) -> tuple[list[str], dict[str, str]]:
    """Single-pass extraction of user model names and provider→model mapping.

    Returns (model_names, provider_model_map) where:
    - model_names: deduplicated list of model names across all providers
    - provider_model_map: {model_name: provider_id} for first-provider-wins
    """
    if not isinstance(payload, Mapping):
        return [], {}

    providers = payload.get("providers")
    if not isinstance(providers, list):
        return [], {}

    user_models: list[str] = []
    seen: set[str] = set()
    provider_model_map: dict[str, str] = {}

    for provider in providers:
        if not isinstance(provider, Mapping):
            continue
        provider_id = _as_non_empty_str(provider.get("id"))
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
            if provider_id and model_name not in provider_model_map:
                provider_model_map[model_name] = provider_id

    return user_models, provider_model_map


def _as_non_empty_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _select_default_provider(providers: list[object], default_provider_id: str | None) -> Mapping | None:
    if default_provider_id:
        for p in providers:
            if isinstance(p, Mapping) and p.get("id") == default_provider_id:
                return p
    for p in providers:
        if isinstance(p, Mapping) and p.get("is_active"):
            return p
    return None


def _provider_model_list(provider: Mapping) -> list[str]:
    models = provider.get("models")
    if not isinstance(models, list):
        return []
    return [m.strip() for m in models if isinstance(m, str) and m.strip()]


def _first_provider_with_models(providers: list[object]) -> Mapping | None:
    for p in providers:
        if isinstance(p, Mapping) and _provider_model_list(p):
            return p
    return None


def _build_config_model_response(model: object) -> ModelResponse:
    return ModelResponse(
        name=getattr(model, "name"),
        model=getattr(model, "model"),
        display_name=getattr(model, "display_name"),
        description=getattr(model, "description"),
        supports_thinking=bool(getattr(model, "supports_thinking", False)),
        supports_reasoning_effort=bool(getattr(model, "supports_reasoning_effort", False)),
        provider_id=None,
    )


def _build_user_model_response(model_name: str, mapped_config_model: object | None, *, provider_id: str | None = None) -> ModelResponse:
    if mapped_config_model is None:
        return ModelResponse(
            name=model_name,
            model=model_name,
            display_name=model_name,
            description=None,
            supports_thinking=False,
            supports_reasoning_effort=False,
            provider_id=provider_id,
        )

    return ModelResponse(
        name=model_name,
        model=str(getattr(mapped_config_model, "model", model_name) or model_name),
        display_name=getattr(mapped_config_model, "display_name"),
        description=getattr(mapped_config_model, "description"),
        supports_thinking=bool(getattr(mapped_config_model, "supports_thinking", False)),
        supports_reasoning_effort=bool(getattr(mapped_config_model, "supports_reasoning_effort", False)),
        provider_id=provider_id,
    )


async def _resolve_effective_models(
    request: Request,
    db: AsyncSession,
) -> tuple[list[ModelResponse], bool, str | None, str | None]:
    config = get_app_config()
    config_models = list(config.models)
    config_lookup = _build_config_model_lookup(config_models)

    default_model_name: str | None = None
    default_provider_id: str | None = None

    try:
        user_id = get_request_user_id(request)
        settings_payload = await get_ai_settings_service().get_ai_settings(user_id, db)
        user_model_names, provider_model_map = _extract_user_models_and_provider_map(settings_payload)

        if isinstance(settings_payload, Mapping):
            default_provider_id = _as_non_empty_str(settings_payload.get("default_provider_id"))

        providers = settings_payload.get("providers") if isinstance(settings_payload, Mapping) else None
        if isinstance(providers, list):
            default_provider = _select_default_provider(providers, default_provider_id)
            if default_provider is not None:
                provider_models = _provider_model_list(default_provider)
                if provider_models:
                    default_model_name = provider_models[0]
                else:
                    fallback_provider = _first_provider_with_models(providers)
                    if fallback_provider is not None:
                        default_model_name = _provider_model_list(fallback_provider)[0]
                        default_provider_id = _as_non_empty_str(fallback_provider.get("id"))
                        logger.info("Default provider has no models; fallback to provider=%s model=%s", default_provider_id, default_model_name)
            elif providers:
                fallback_provider = _first_provider_with_models(providers)
                if fallback_provider is not None:
                    default_model_name = _provider_model_list(fallback_provider)[0]
                    default_provider_id = _as_non_empty_str(fallback_provider.get("id"))
    except Exception:
        logger.warning("Failed to read user ai-settings for /api/models, falling back to static app config models.", exc_info=True)
        user_model_names = []
        provider_model_map = {}

    if user_model_names:
        return [
            _build_user_model_response(model_name, config_lookup.get(model_name), provider_id=provider_model_map.get(model_name))
            for model_name in user_model_names
        ], True, default_model_name, default_provider_id

    return [
        _build_config_model_response(model)
        for model in config_models
    ], False, default_model_name, default_provider_id


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

    Results are cached per-user for a short TTL to avoid redundant DB queries
    when the frontend polls rapidly (e.g. on window focus or reconnection).
    """
    try:
        user_id = get_request_user_id(request)
    except Exception:
        user_id = None

    if user_id is not None:
        cached_entry = _models_cache.get(user_id)
        if cached_entry is not None:
            cached_at, cached_response = cached_entry
            if time.monotonic() - cached_at < _MODELS_CACHE_TTL_SEC:
                _models_cache.move_to_end(user_id)
                return cached_response
            del _models_cache[user_id]

    config = get_app_config()
    models, _, default_model_name, default_provider_id = await _resolve_effective_models(request, db)
    response = ModelsListResponse(
        models=models,
        token_usage=TokenUsageResponse(enabled=config.token_usage.enabled),
        default_model_name=default_model_name,
        default_provider_id=default_provider_id,
    )

    if user_id is not None:
        _store_models_cache(user_id, response)

    return response


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
    models, _, _, _ = await _resolve_effective_models(request, db)
    model = next((item for item in models if item.name == model_name), None)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    return model
