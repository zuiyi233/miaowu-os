"""Novel agent configuration service.

Provides CRUD operations for per-task-type model configurations.
Supports built-in presets and user-defined custom presets.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.novel_agent_config import NovelAgentConfig, NovelAgentType
from app.gateway.novel_migrated.models.settings import Settings

logger = logging.getLogger(__name__)


class AgentConfigDict(TypedDict):
    """Resolved agent configuration dictionary.

    Attributes:
        agent_type: The agent task type.
        provider_id: AI provider ID.
        model_name: Model name.
        temperature: Sampling temperature.
        max_tokens: Max tokens per generation.
        system_prompt: Optional system prompt.
        source: Config source (custom, default, fallback).
    """

    agent_type: str
    provider_id: str | None
    model_name: str | None
    temperature: float
    max_tokens: int
    system_prompt: str | None
    source: str


# ==================== Dynamic Preset Builder ====================

def _get_deployed_models() -> list[dict[str, Any]]:
    """Get actually deployed models from deerflow config.

    Returns:
        List of model dicts with name, display_name, provider_class, model_id.
    """
    try:
        from deerflow.config import get_app_config
        config = get_app_config()
        return [
            {
                "name": m.name,
                "display_name": m.display_name or m.name,
                "provider_class": m.use,
                "model_id": m.model,
            }
            for m in config.models
        ]
    except Exception as exc:
        logger.warning("Failed to load deployed models from deerflow config: %s", exc)
        return []


def _classify_models(models: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Classify models by capability heuristics.

    Categories:
        - strong: High-quality models (4o, claude, deepseek-v3, etc.)
        - fast: Lightweight models (mini, 3.5, turbo, etc.)
        - reasoning: Models with reasoning capabilities (reasoner, r1, o1, etc.)
    """
    strong: list[dict[str, Any]] = []
    fast: list[dict[str, Any]] = []
    reasoning: list[dict[str, Any]] = []

    for m in models:
        name_lower = m["name"].lower()
        if any(k in name_lower for k in ("reasoner", "r1", "o1", "o3")):
            reasoning.append(m)
        elif any(k in name_lower for k in ("mini", "3.5", "turbo", "flash")):
            fast.append(m)
        elif any(k in name_lower for k in ("4o", "claude", "deepseek", "qwen-max", "gpt-4")):
            strong.append(m)
        else:
            # Default to strong if cannot classify
            strong.append(m)

    return {"strong": strong, "fast": fast, "reasoning": reasoning}


def _build_presets_from_deployed_models() -> dict[str, dict[str, Any]]:
    """Build presets using actually deployed models instead of hardcoded values.

    Returns empty dict if no models are deployed.
    """
    models = _get_deployed_models()
    if not models:
        logger.warning("No deployed models found in deerflow config, presets unavailable")
        return {}

    classified = _classify_models(models)
    strong = classified["strong"] or models
    fast = classified["fast"] or models
    reasoning = classified["reasoning"] or strong
    first = models[0]

    def _pick(category_list: list[dict[str, Any]]) -> dict[str, Any]:
        return category_list[0] if category_list else first

    return {
        "quality": {
            "name": "质量优先",
            "description": "使用最强模型进行生成和审核，适合对质量要求极高的场景",
            "icon": "🏆",
            "agent_configs": {
                "writer": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.7,
                    "max_tokens": 8192,
                    "system_prompt": "你是一名专业长篇小说写作助手，擅长根据大纲和角色设定生成高质量的章节内容。",
                },
                "critic": {
                    "provider_id": None,
                    "model_name": _pick(reasoning)["name"],
                    "temperature": 0.3,
                    "max_tokens": 8192,
                    "system_prompt": "你是一名严格的小说编辑，擅长发现剧情漏洞、角色不一致和逻辑矛盾。",
                },
                "polish": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.5,
                    "max_tokens": 8192,
                },
                "outline": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
            },
        },
        "speed": {
            "name": "速度优先",
            "description": "使用轻量模型快速生成，适合初稿和探索性创作",
            "icon": "⚡",
            "agent_configs": {
                "writer": {
                    "provider_id": None,
                    "model_name": _pick(fast)["name"],
                    "temperature": 0.8,
                    "max_tokens": 4096,
                },
                "critic": {
                    "provider_id": None,
                    "model_name": _pick(fast)["name"],
                    "temperature": 0.3,
                    "max_tokens": 4096,
                },
                "polish": {
                    "provider_id": None,
                    "model_name": _pick(fast)["name"],
                    "temperature": 0.5,
                    "max_tokens": 4096,
                },
                "outline": {
                    "provider_id": None,
                    "model_name": _pick(fast)["name"],
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
            },
        },
        "balanced": {
            "name": "均衡模式",
            "description": "在质量和速度之间取得平衡，适合日常创作",
            "icon": "⚖️",
            "agent_configs": {
                "writer": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
                "critic": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.3,
                    "max_tokens": 4096,
                },
                "polish": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.5,
                    "max_tokens": 4096,
                },
                "outline": {
                    "provider_id": None,
                    "model_name": _pick(strong)["name"],
                    "temperature": 0.7,
                    "max_tokens": 4096,
                },
            },
        },
    }


# ==================== Default Config per Agent Type ====================

DEFAULT_AGENT_CONFIGS: dict[str, dict[str, Any]] = {
    "writer": {
        "temperature": 0.7,
        "max_tokens": 4096,
    },
    "critic": {
        "temperature": 0.3,
        "max_tokens": 4096,
    },
    "polish": {
        "temperature": 0.5,
        "max_tokens": 4096,
    },
    "outline": {
        "temperature": 0.7,
        "max_tokens": 4096,
    },
    "summary": {
        "temperature": 0.5,
        "max_tokens": 2048,
    },
    "continue": {
        "temperature": 0.7,
        "max_tokens": 4096,
    },
    "world_build": {
        "temperature": 0.8,
        "max_tokens": 4096,
    },
    "character": {
        "temperature": 0.7,
        "max_tokens": 4096,
    },
}


class NovelAgentConfigService:
    """Service for managing novel agent configurations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_configs(self, user_id: str) -> list[NovelAgentConfig]:
        """Get all agent configs for a user."""
        result = await self.db.execute(
            select(NovelAgentConfig).where(NovelAgentConfig.user_id == user_id)
        )
        return list(result.scalars().all())

    async def get_config(
        self, user_id: str, agent_type: str
    ) -> NovelAgentConfig | None:
        """Get a specific agent config for a user."""
        result = await self.db.execute(
            select(NovelAgentConfig)
            .where(NovelAgentConfig.user_id == user_id)
            .where(NovelAgentConfig.agent_type == agent_type)
        )
        return result.scalar_one_or_none()

    async def upsert_config(
        self,
        user_id: str,
        agent_type: str,
        provider_id: str | None = None,
        model_name: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
        is_enabled: bool | None = None,
    ) -> NovelAgentConfig:
        """Create or update an agent config."""
        config = await self.get_config(user_id, agent_type)

        if config is None:
            config = NovelAgentConfig(
                user_id=user_id,
                agent_type=agent_type,
            )
            self.db.add(config)

        if provider_id is not None:
            config.provider_id = provider_id
        if model_name is not None:
            config.model_name = model_name
        if temperature is not None:
            config.temperature = max(0.0, min(2.0, temperature))
        if max_tokens is not None:
            config.max_tokens = max(512, min(16000, max_tokens))
        if system_prompt is not None:
            config.system_prompt = system_prompt
        if is_enabled is not None:
            config.is_enabled = is_enabled

        await self.db.commit()
        await self.db.refresh(config)
        logger.info(
            "Novel agent config upserted: user=%s agent=%s provider=%s model=%s",
            user_id,
            agent_type,
            config.provider_id,
            config.model_name,
        )
        return config

    async def delete_config(self, user_id: str, agent_type: str) -> bool:
        """Delete an agent config."""
        config = await self.get_config(user_id, agent_type)
        if config is None:
            return False

        await self.db.delete(config)
        await self.db.commit()
        logger.info(
            "Novel agent config deleted: user=%s agent=%s",
            user_id,
            agent_type,
        )
        return True

    async def apply_preset(
        self, user_id: str, preset_id: str
    ) -> list[NovelAgentConfig]:
        """Apply a preset to user's agent configs."""
        preset = self._get_preset_definition(preset_id)
        if preset is None:
            raise ValueError(f"Preset not found: {preset_id}")

        agent_configs = preset.get("agent_configs", {})
        results: list[NovelAgentConfig] = []

        for agent_type, cfg in agent_configs.items():
            config = await self.upsert_config(
                user_id=user_id,
                agent_type=agent_type,
                provider_id=cfg.get("provider_id"),
                model_name=cfg.get("model_name"),
                temperature=cfg.get("temperature"),
                max_tokens=cfg.get("max_tokens"),
                system_prompt=cfg.get("system_prompt"),
                is_enabled=True,
            )
            results.append(config)

        await self._update_active_preset(user_id, preset_id)
        logger.info(
            "Preset applied: user=%s preset=%s configs=%d",
            user_id,
            preset_id,
            len(results),
        )
        return results

    async def get_presets(self, user_id: str) -> list[dict[str, Any]]:
        """Get all available presets (built-in + custom)."""
        presets: list[dict[str, Any]] = []
        built_in = _build_presets_from_deployed_models()

        for preset_id, preset in built_in.items():
            presets.append(
                {
                    "id": preset_id,
                    "name": preset["name"],
                    "description": preset["description"],
                    "icon": preset.get("icon", ""),
                    "is_built_in": True,
                    "agent_configs": preset["agent_configs"],
                }
            )

        custom_presets = await self._get_custom_presets(user_id)
        presets.extend(custom_presets)

        return presets

    async def create_custom_preset(
        self,
        user_id: str,
        name: str,
        description: str | None,
        agent_configs: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        """Create a user-defined custom preset."""
        preset_id = f"custom-{uuid.uuid4().hex[:8]}"
        preset = {
            "id": preset_id,
            "name": name,
            "description": description or "",
            "is_built_in": False,
            "agent_configs": agent_configs,
        }

        custom_presets = await self._get_custom_presets_raw(user_id)
        custom_presets.append(preset)
        await self._save_custom_presets(user_id, custom_presets)

        logger.info(
            "Custom preset created: user=%s preset=%s",
            user_id,
            preset_id,
        )
        return preset

    async def delete_custom_preset(self, user_id: str, preset_id: str) -> bool:
        """Delete a custom preset."""
        custom_presets = await self._get_custom_presets_raw(user_id)
        original_len = len(custom_presets)
        custom_presets = [p for p in custom_presets if p["id"] != preset_id]

        if len(custom_presets) == original_len:
            return False

        await self._save_custom_presets(user_id, custom_presets)
        logger.info(
            "Custom preset deleted: user=%s preset=%s",
            user_id,
            preset_id,
        )
        return True

    async def resolve_agent_config(
        self,
        user_id: str,
        agent_type: str,
        default_provider_id: str | None = None,
        default_model_name: str | None = None,
    ) -> AgentConfigDict:
        """Resolve the effective config for an agent at runtime.

        Resolution order:
        1. User's custom agent config (if enabled)
        2. User's default model config from Settings
        3. System default for the agent type
        """
        config = await self.get_config(user_id, agent_type)

        if config and config.is_enabled:
            return {
                "agent_type": agent_type,
                "provider_id": config.provider_id,
                "model_name": config.model_name,
                "temperature": config.temperature,
                "max_tokens": config.max_tokens,
                "system_prompt": config.system_prompt,
                "source": "custom",
            }

        settings_result = await self.db.execute(
            select(Settings).where(Settings.user_id == user_id)
        )
        settings = settings_result.scalar_one_or_none()

        if settings:
            defaults = DEFAULT_AGENT_CONFIGS.get(agent_type, {})
            return {
                "agent_type": agent_type,
                "provider_id": default_provider_id or settings.api_provider,
                "model_name": default_model_name or settings.llm_model,
                "temperature": defaults.get("temperature", 0.7),
                "max_tokens": defaults.get("max_tokens", 4096),
                "system_prompt": None,
                "source": "default",
            }

        defaults = DEFAULT_AGENT_CONFIGS.get(agent_type, {})
        return {
            "agent_type": agent_type,
            "provider_id": default_provider_id or "openai",
            "model_name": default_model_name or "gpt-4o",
            "temperature": defaults.get("temperature", 0.7),
            "max_tokens": defaults.get("max_tokens", 4096),
            "system_prompt": None,
            "source": "fallback",
        }

    def _get_preset_definition(self, preset_id: str) -> dict[str, Any] | None:
        """Get preset definition by ID (built-in or custom)."""
        built_in = _build_presets_from_deployed_models()
        if preset_id in built_in:
            return built_in[preset_id]
        return None

    async def _get_custom_presets(self, user_id: str) -> list[dict[str, Any]]:
        """Get custom presets with full metadata."""
        raw = await self._get_custom_presets_raw(user_id)
        for preset in raw:
            preset["is_built_in"] = False
        return raw

    async def _get_custom_presets_raw(self, user_id: str) -> list[dict[str, Any]]:
        """Get raw custom presets list from user preferences."""
        result = await self.db.execute(
            select(Settings.preferences).where(Settings.user_id == user_id)
        )
        prefs_str = result.scalar_one_or_none()

        if not prefs_str:
            return []

        try:
            prefs = json.loads(prefs_str)
            novel_agent = prefs.get("novel_agent", {})
            return novel_agent.get("custom_presets", [])
        except (json.JSONDecodeError, TypeError):
            logger.warning("Failed to parse user preferences for custom presets")
            return []

    async def _save_custom_presets(
        self, user_id: str, presets: list[dict[str, Any]]
    ) -> None:
        """Save custom presets to user preferences."""
        result = await self.db.execute(
            select(Settings).where(Settings.user_id == user_id)
        )
        settings = result.scalar_one_or_none()

        if settings is None:
            settings = Settings(user_id=user_id)
            self.db.add(settings)

        try:
            prefs = json.loads(settings.preferences or "{}")
        except (json.JSONDecodeError, TypeError):
            prefs = {}

        if "novel_agent" not in prefs:
            prefs["novel_agent"] = {}

        prefs["novel_agent"]["custom_presets"] = presets
        settings.preferences = json.dumps(prefs, ensure_ascii=False)
        await self.db.commit()

    async def _update_active_preset(self, user_id: str, preset_id: str) -> None:
        """Update the active preset ID in user preferences."""
        result = await self.db.execute(
            select(Settings).where(Settings.user_id == user_id)
        )
        settings = result.scalar_one_or_none()

        if settings is None:
            settings = Settings(user_id=user_id)
            self.db.add(settings)

        try:
            prefs = json.loads(settings.preferences or "{}")
        except (json.JSONDecodeError, TypeError):
            prefs = {}

        if "novel_agent" not in prefs:
            prefs["novel_agent"] = {}

        prefs["novel_agent"]["active_preset"] = preset_id
        settings.preferences = json.dumps(prefs, ensure_ascii=False)
        await self.db.commit()

    async def get_active_preset(self, user_id: str) -> str | None:
        """Get the currently active preset ID for a user."""
        result = await self.db.execute(
            select(Settings.preferences).where(Settings.user_id == user_id)
        )
        prefs_str = result.scalar_one_or_none()

        if not prefs_str:
            return None

        try:
            prefs = json.loads(prefs_str)
            novel_agent = prefs.get("novel_agent", {})
            return novel_agent.get("active_preset")
        except (json.JSONDecodeError, TypeError):
            return None
