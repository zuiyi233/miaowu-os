import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.gateway.observability.metrics import get_gateway_metrics_snapshot
from deerflow.config.extensions_config import (
    ExtensionsConfig,
    FeatureFlagConfig,
    get_extensions_config,
    reload_extensions_config,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["features"])


class FeatureFlagState(BaseModel):
    enabled: bool = Field(..., description="Whether this feature is enabled")
    rollout_percentage: int = Field(100, ge=0, le=100, description="Canary rollout percentage by user")
    allow_users: list[str] = Field(default_factory=list, description="Always-enabled users")
    deny_users: list[str] = Field(default_factory=list, description="Always-disabled users")


class FeatureFlagsResponse(BaseModel):
    features: dict[str, FeatureFlagState] = Field(
        default_factory=dict,
        description="Map of feature flag name to state",
    )


class FeatureFlagUpdateRequest(BaseModel):
    enabled: bool = Field(..., description="Whether to enable or disable the feature")
    rollout_percentage: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Canary rollout percentage by user hash",
    )
    allow_users: list[str] | None = Field(default=None, description="Always-enabled users")
    deny_users: list[str] | None = Field(default=None, description="Always-disabled users")


class FeatureEvaluationResponse(BaseModel):
    feature_name: str
    user_id: str
    enabled: bool


class NovelPipelineMetricsResponse(BaseModel):
    metrics: dict[str, Any]


def _to_flag_state(flag: FeatureFlagConfig) -> FeatureFlagState:
    return FeatureFlagState(
        enabled=flag.enabled,
        rollout_percentage=flag.rollout_percentage,
        allow_users=list(flag.allow_users),
        deny_users=list(flag.deny_users),
    )


def _normalize_user_list(raw_value: list[str] | None, *, fallback: list[str]) -> list[str]:
    if raw_value is None:
        return list(fallback)
    normalized: list[str] = []
    for user_id in raw_value:
        value = (user_id or "").strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


def _resolve_config_path() -> Path:
    config_path = ExtensionsConfig.resolve_config_path()
    if config_path is not None:
        return config_path
    fallback = Path.cwd().parent / "extensions_config.json"
    logger.info("No existing extensions config found. Creating new config at: %s", fallback)
    return fallback


def _build_config_data(extensions_config: ExtensionsConfig) -> dict[str, Any]:
    return {
        "mcpServers": {name: server.model_dump() for name, server in extensions_config.mcp_servers.items()},
        "skills": {name: {"enabled": skill.enabled} for name, skill in extensions_config.skills.items()},
        "features": {name: flag.model_dump() for name, flag in extensions_config.features.items()},
    }


def _persist_and_reload(extensions_config: ExtensionsConfig) -> ExtensionsConfig:
    config_path = _resolve_config_path()
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(_build_config_data(extensions_config), f, indent=2)
    logger.info("Feature flags saved to: %s", config_path)
    return reload_extensions_config()


@router.get(
    "/features",
    response_model=FeatureFlagsResponse,
    summary="Get Feature Flags",
    description="Retrieve the current feature flags from extensions configuration.",
)
async def get_features() -> FeatureFlagsResponse:
    config = get_extensions_config()
    return FeatureFlagsResponse(
        features={name: _to_flag_state(flag) for name, flag in config.features.items()}
    )


@router.get(
    "/features/{feature_name}/evaluate",
    response_model=FeatureEvaluationResponse,
    summary="Evaluate Feature Flag For User",
    description="Evaluate whether a feature is enabled for a specific user under canary rules.",
)
async def evaluate_feature(feature_name: str, user_id: str = Query(..., min_length=1)) -> FeatureEvaluationResponse:
    config = get_extensions_config()
    if hasattr(config, "is_feature_enabled_for_user"):
        enabled = config.is_feature_enabled_for_user(feature_name, user_id=user_id, default=True)
    else:
        enabled = config.is_feature_enabled(feature_name, default=True)
    return FeatureEvaluationResponse(feature_name=feature_name, user_id=user_id, enabled=enabled)


@router.put(
    "/features/{feature_name}",
    response_model=FeatureFlagState,
    summary="Update Feature Flag",
    description="Update feature flag strategy and persist to extensions_config.json.",
)
async def update_feature(feature_name: str, request: FeatureFlagUpdateRequest) -> FeatureFlagState:
    try:
        extensions_config = get_extensions_config()
        existing = extensions_config.features.get(feature_name)
        existing_flag = existing if existing is not None else FeatureFlagConfig(enabled=request.enabled)

        updated_flag = FeatureFlagConfig(
            enabled=request.enabled,
            rollout_percentage=request.rollout_percentage if request.rollout_percentage is not None else existing_flag.rollout_percentage,
            allow_users=_normalize_user_list(request.allow_users, fallback=existing_flag.allow_users),
            deny_users=_normalize_user_list(request.deny_users, fallback=existing_flag.deny_users),
        )
        extensions_config.features[feature_name] = updated_flag

        reloaded_config = _persist_and_reload(extensions_config)
        persisted_flag = reloaded_config.features.get(feature_name)
        if persisted_flag is None:
            raise HTTPException(status_code=500, detail=f"Failed to reload feature '{feature_name}' after update")
        return _to_flag_state(persisted_flag)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update feature flag %s: %s", feature_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update feature flag: {str(e)}")


@router.post(
    "/features/{feature_name}/rollback",
    response_model=FeatureFlagState,
    summary="Rollback Feature Flag",
    description="Fast rollback: disable feature and set rollout percentage to 0.",
)
async def rollback_feature(feature_name: str) -> FeatureFlagState:
    try:
        extensions_config = get_extensions_config()
        existing = extensions_config.features.get(feature_name) or FeatureFlagConfig(enabled=False, rollout_percentage=0)
        extensions_config.features[feature_name] = FeatureFlagConfig(
            enabled=False,
            rollout_percentage=0,
            allow_users=[],
            deny_users=list(existing.deny_users),
        )
        reloaded_config = _persist_and_reload(extensions_config)
        persisted_flag = reloaded_config.features.get(feature_name)
        if persisted_flag is None:
            raise HTTPException(status_code=500, detail=f"Failed to rollback feature '{feature_name}'")
        return _to_flag_state(persisted_flag)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to rollback feature flag %s: %s", feature_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to rollback feature flag: {str(e)}")


@router.get(
    "/features/metrics/novel-pipeline",
    response_model=NovelPipelineMetricsResponse,
    summary="Get Novel Pipeline Metrics",
    description="Return in-process observability metrics for novel pipeline gateway traffic.",
)
async def get_novel_pipeline_metrics() -> NovelPipelineMetricsResponse:
    return NovelPipelineMetricsResponse(metrics=get_gateway_metrics_snapshot())
