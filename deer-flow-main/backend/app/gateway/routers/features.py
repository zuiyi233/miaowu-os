import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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


class FeatureFlagsResponse(BaseModel):
    features: dict[str, FeatureFlagState] = Field(
        default_factory=dict,
        description="Map of feature flag name to state",
    )


class FeatureFlagUpdateRequest(BaseModel):
    enabled: bool = Field(..., description="Whether to enable or disable the feature")


@router.get(
    "/features",
    response_model=FeatureFlagsResponse,
    summary="Get Feature Flags",
    description="Retrieve the current feature flags from extensions configuration.",
)
async def get_features() -> FeatureFlagsResponse:
    config = get_extensions_config()
    return FeatureFlagsResponse(
        features={name: FeatureFlagState(enabled=flag.enabled) for name, flag in config.features.items()}
    )


@router.put(
    "/features/{feature_name}",
    response_model=FeatureFlagState,
    summary="Update Feature Flag",
    description="Update a feature flag and persist to extensions_config.json.",
)
async def update_feature(feature_name: str, request: FeatureFlagUpdateRequest) -> FeatureFlagState:
    try:
        config_path = ExtensionsConfig.resolve_config_path()
        if config_path is None:
            config_path = Path.cwd().parent / "extensions_config.json"
            logger.info("No existing extensions config found. Creating new config at: %s", config_path)

        extensions_config = get_extensions_config()
        extensions_config.features[feature_name] = FeatureFlagConfig(enabled=request.enabled)

        config_data = {
            "mcpServers": {name: server.model_dump() for name, server in extensions_config.mcp_servers.items()},
            "skills": {name: {"enabled": skill.enabled} for name, skill in extensions_config.skills.items()},
            "features": {name: {"enabled": flag.enabled} for name, flag in extensions_config.features.items()},
        }

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2)

        logger.info("Feature flag '%s' updated and saved to: %s", feature_name, config_path)
        reloaded_config = reload_extensions_config()
        updated_flag = reloaded_config.features.get(feature_name)
        if updated_flag is None:
            raise HTTPException(status_code=500, detail=f"Failed to reload feature '{feature_name}' after update")
        return FeatureFlagState(enabled=updated_flag.enabled)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update feature flag %s: %s", feature_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update feature flag: {str(e)}")
