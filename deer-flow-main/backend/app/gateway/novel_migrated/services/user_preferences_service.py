"""Unified per-user preferences service for multi-user settings boundaries."""

from __future__ import annotations

import json
import threading
from collections.abc import Mapping
from typing import Any, Literal, TypedDict

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.settings import Settings
from deerflow.config.extensions_config import ExtensionsConfig, McpServerConfig
from deerflow.skills.types import Skill

USER_SKILL_SETTINGS_PREF_KEY = "user_skill_settings"
USER_TOOL_SETTINGS_PREF_KEY = "user_tool_settings"
USER_UI_SETTINGS_PREF_KEY = "user_ui_settings"

USER_SKILL_SETTINGS_VERSION = 1
USER_TOOL_SETTINGS_VERSION = 1
USER_UI_SETTINGS_VERSION = 1

DEFAULT_MEDIA_DRAFT_RETENTION: Literal["24h", "7d", "never"] = "7d"
VALID_MEDIA_DRAFT_RETENTIONS: set[str] = {"24h", "7d", "never"}

_NORMALIZATION_CHANGED_KEY = "_normalization_changed"


class UserSkillSettings(TypedDict):
    version: int
    enabled_skills: dict[str, bool]


class UserToolSettings(TypedDict):
    version: int
    enabled_mcp_servers: dict[str, bool]


class UserUiSettings(TypedDict):
    version: int
    media_draft_retention: Literal["24h", "7d", "never"]


def load_preferences_blob(settings: Settings) -> dict[str, Any]:
    raw = settings.preferences or "{}"
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {}
    else:
        parsed = raw
    return parsed if isinstance(parsed, dict) else {}


def save_preferences_blob(settings: Settings, preferences: Mapping[str, Any]) -> None:
    settings.preferences = json.dumps(dict(preferences), ensure_ascii=False)


def _coerce_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return bool(value)


def _normalize_enabled_mapping(
    raw: Any,
    *,
    valid_names: list[str],
    default_enabled: bool,
) -> tuple[dict[str, bool], bool]:
    changed = False
    valid_set = set(valid_names)
    normalized: dict[str, bool] = {}

    if isinstance(raw, Mapping):
        for key, value in raw.items():
            name = str(key or "").strip()
            if not name or name not in valid_set:
                changed = True
                continue
            bool_value = _coerce_bool(value, default=default_enabled)
            normalized[name] = bool_value
            if value is not bool_value:
                changed = True
    elif raw not in (None, {}):
        changed = True

    for name in valid_names:
        if name not in normalized:
            normalized[name] = default_enabled
            changed = True

    return normalized, changed


def normalize_user_skill_settings(
    preferences: dict[str, Any],
    *,
    available_skills: list[Skill],
) -> UserSkillSettings:
    raw = preferences.get(USER_SKILL_SETTINGS_PREF_KEY)
    changed = False
    version = USER_SKILL_SETTINGS_VERSION
    enabled_raw: Any = None

    if isinstance(raw, Mapping):
        raw_version = raw.get("version")
        if isinstance(raw_version, int) and raw_version > 0:
            version = raw_version
        else:
            changed = True
        enabled_raw = raw.get("enabled_skills")
    elif raw is not None:
        changed = True

    skill_names = sorted({skill.name.strip() for skill in available_skills if skill.name and skill.name.strip()})
    enabled_skills, map_changed = _normalize_enabled_mapping(
        enabled_raw,
        valid_names=skill_names,
        default_enabled=True,
    )
    changed = changed or map_changed or version != USER_SKILL_SETTINGS_VERSION

    normalized: UserSkillSettings = {
        "version": USER_SKILL_SETTINGS_VERSION,
        "enabled_skills": enabled_skills,
    }
    if changed:
        preferences[USER_SKILL_SETTINGS_PREF_KEY] = normalized
        preferences[_NORMALIZATION_CHANGED_KEY] = True
    return normalized


def normalize_user_tool_settings(
    preferences: dict[str, Any],
    *,
    extensions_config: ExtensionsConfig,
) -> UserToolSettings:
    raw = preferences.get(USER_TOOL_SETTINGS_PREF_KEY)
    changed = False
    version = USER_TOOL_SETTINGS_VERSION
    enabled_raw: Any = None

    if isinstance(raw, Mapping):
        raw_version = raw.get("version")
        if isinstance(raw_version, int) and raw_version > 0:
            version = raw_version
        else:
            changed = True
        enabled_raw = raw.get("enabled_mcp_servers")
    elif raw is not None:
        changed = True

    server_names = sorted(name for name in extensions_config.mcp_servers.keys() if str(name or "").strip())
    enabled_servers, map_changed = _normalize_enabled_mapping(
        enabled_raw,
        valid_names=server_names,
        default_enabled=True,
    )
    changed = changed or map_changed or version != USER_TOOL_SETTINGS_VERSION

    normalized: UserToolSettings = {
        "version": USER_TOOL_SETTINGS_VERSION,
        "enabled_mcp_servers": enabled_servers,
    }
    if changed:
        preferences[USER_TOOL_SETTINGS_PREF_KEY] = normalized
        preferences[_NORMALIZATION_CHANGED_KEY] = True
    return normalized


def normalize_user_ui_settings(
    preferences: dict[str, Any],
    *,
    local_retention_candidate: str | None = None,
) -> UserUiSettings:
    raw = preferences.get(USER_UI_SETTINGS_PREF_KEY)
    changed = False
    version = USER_UI_SETTINGS_VERSION
    retention: str | None = None

    if isinstance(raw, Mapping):
        raw_version = raw.get("version")
        if isinstance(raw_version, int) and raw_version > 0:
            version = raw_version
        else:
            changed = True
        value = raw.get("media_draft_retention")
        if isinstance(value, str):
            retention = value.strip()
    elif raw is not None:
        changed = True

    if retention not in VALID_MEDIA_DRAFT_RETENTIONS:
        candidate = (local_retention_candidate or "").strip()
        if candidate in VALID_MEDIA_DRAFT_RETENTIONS:
            retention = candidate
        else:
            retention = DEFAULT_MEDIA_DRAFT_RETENTION
        changed = True

    changed = changed or version != USER_UI_SETTINGS_VERSION
    normalized: UserUiSettings = {
        "version": USER_UI_SETTINGS_VERSION,
        "media_draft_retention": retention,  # type: ignore[typeddict-item]
    }
    if changed:
        preferences[USER_UI_SETTINGS_PREF_KEY] = normalized
        preferences[_NORMALIZATION_CHANGED_KEY] = True
    return normalized


def get_user_enabled_skill_names(
    *,
    preferences: dict[str, Any],
    available_skills: list[Skill],
) -> set[str]:
    normalized = normalize_user_skill_settings(preferences, available_skills=available_skills)
    system_enabled_names = {
        skill.name
        for skill in available_skills
        if skill.name and getattr(skill, "enabled", True)
    }
    return {
        name
        for name, enabled in normalized["enabled_skills"].items()
        if enabled and name in system_enabled_names
    }


def get_user_enabled_mcp_servers(
    *,
    preferences: dict[str, Any],
    extensions_config: ExtensionsConfig,
) -> dict[str, McpServerConfig]:
    normalized = normalize_user_tool_settings(preferences, extensions_config=extensions_config)
    result: dict[str, McpServerConfig] = {}
    for name, server in extensions_config.mcp_servers.items():
        if not server.enabled:
            continue
        if not normalized["enabled_mcp_servers"].get(name, True):
            continue
        result[name] = server
    return result


def get_user_enabled_mcp_server_names(
    *,
    preferences: dict[str, Any],
    extensions_config: ExtensionsConfig,
) -> set[str]:
    return set(
        get_user_enabled_mcp_servers(
            preferences=preferences,
            extensions_config=extensions_config,
        ).keys()
    )


class UserPreferencesService:
    async def get_or_create_settings(self, user_id: str, db: AsyncSession) -> Settings:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if settings is not None:
            return settings

        settings = Settings(user_id=user_id)
        db.add(settings)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            result = await db.execute(select(Settings).where(Settings.user_id == user_id))
            existing = result.scalar_one_or_none()
            if existing is not None:
                return existing
            raise
        await db.refresh(settings)
        return settings

    async def load_preferences(
        self,
        *,
        user_id: str,
        db: AsyncSession,
    ) -> tuple[Settings, dict[str, Any]]:
        settings = await self.get_or_create_settings(user_id, db)
        return settings, load_preferences_blob(settings)

    async def save_preferences(
        self,
        *,
        settings: Settings,
        preferences: dict[str, Any],
        db: AsyncSession,
    ) -> None:
        preferences.pop(_NORMALIZATION_CHANGED_KEY, None)
        save_preferences_blob(settings, preferences)
        await db.commit()
        await db.refresh(settings)

    async def normalize_all_user_preferences(
        self,
        *,
        user_id: str,
        db: AsyncSession,
        available_skills: list[Skill],
        extensions_config: ExtensionsConfig,
        local_retention_candidate: str | None = None,
    ) -> tuple[Settings, dict[str, Any], UserSkillSettings, UserToolSettings, UserUiSettings]:
        settings, preferences = await self.load_preferences(user_id=user_id, db=db)
        skill_settings = normalize_user_skill_settings(preferences, available_skills=available_skills)
        tool_settings = normalize_user_tool_settings(preferences, extensions_config=extensions_config)
        ui_settings = normalize_user_ui_settings(
            preferences,
            local_retention_candidate=local_retention_candidate,
        )
        if preferences.pop(_NORMALIZATION_CHANGED_KEY, False):
            await self.save_preferences(settings=settings, preferences=preferences, db=db)
        return settings, preferences, skill_settings, tool_settings, ui_settings


_user_preferences_service: UserPreferencesService | None = None
_user_preferences_service_lock = threading.Lock()


def get_user_preferences_service() -> UserPreferencesService:
    global _user_preferences_service
    if _user_preferences_service is not None:
        return _user_preferences_service
    with _user_preferences_service_lock:
        if _user_preferences_service is None:
            _user_preferences_service = UserPreferencesService()
    return _user_preferences_service
