"""AI provider settings service (single source of truth).

This module implements the unified contract for:
  - GET/PUT /api/user/ai-settings

Design goals:
  1) Persist the *full* providers list + active/default provider into
     Settings.preferences["ai_provider_settings"] (no new tables).
  2) Mirror the active provider back to Settings top-level fields so that
     legacy flows (get_user_ai_service, /api/ai/chat, old novel_migrated code)
     continue to read the correct runtime config.
  3) Never return plaintext API keys to the client; use has_api_key boolean.
"""

from __future__ import annotations

import json
import threading
import uuid
from typing import Any, TypedDict

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.crypto import encrypt_secret, is_encryption_enabled, safe_decrypt
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.settings import Settings

logger = get_logger(__name__)

AI_PROVIDER_SETTINGS_PREF_KEY = "ai_provider_settings"
AI_PROVIDER_SETTINGS_VERSION = 1

DEFAULT_CLIENT_SETTINGS: ClientSettings = {
    "enable_stream_mode": True,
    "request_timeout": 660000,
    "max_retries": 2,
}


class ClientSettings(TypedDict):
    enable_stream_mode: bool
    request_timeout: int
    max_retries: int


class ProviderRecord(TypedDict, total=False):
    id: str
    name: str
    provider: str
    base_url: str
    models: list[str]
    is_active: bool
    temperature: float | None
    max_tokens: int | None
    # Backend-only persisted secret (encrypted when possible).
    api_key_encrypted: str | None


class ProviderRecordPublic(TypedDict):
    id: str
    name: str
    provider: str
    base_url: str
    models: list[str]
    is_active: bool
    temperature: float | None
    max_tokens: int | None
    has_api_key: bool


class UserAIRuntimeConfig(TypedDict):
    api_provider: str
    api_key: str
    api_base_url: str
    model_name: str
    temperature: float
    max_tokens: int


class AIProviderSettings(TypedDict):
    version: int
    default_provider_id: str | None
    providers: list[ProviderRecord]
    client_settings: ClientSettings
    feature_routing_settings: dict[str, Any] | None


def _map_model_use_to_provider_type(use: Any) -> str:
    lowered = str(use or "").lower()
    if "langchain_openai" in lowered or "chatopenai" in lowered:
        return "openai"
    if "langchain_anthropic" in lowered or "chatanthropic" in lowered:
        return "anthropic"
    if "google" in lowered or "genai" in lowered or "vertex" in lowered:
        return "google"
    return "custom"


def _as_non_empty_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _try_build_seed_bundle_from_config_yaml(
    *,
    settings: Settings,
    client_settings: ClientSettings,
) -> AIProviderSettings | None:
    """Best-effort seed from backend config.yaml (harness AppConfig).

    This helps prevent "fake providers/models" in frontend when the DB has not
    been configured yet (or is still at template defaults).
    """
    try:
        from deerflow.config.app_config import get_app_config

        cfg = get_app_config()
        cfg_models = getattr(cfg, "models", None) or []
        if not cfg_models:
            return None

        # Group by (provider_type, base_url) to form provider records.
        groups: dict[tuple[str, str], list[str]] = {}
        for m in cfg_models:
            name = getattr(m, "name", None)
            if not isinstance(name, str) or not name.strip():
                continue
            provider_type = _map_model_use_to_provider_type(getattr(m, "use", None))
            base_url = str(getattr(m, "base_url", "") or "").strip()
            groups.setdefault((provider_type, base_url), []).append(name.strip())

        if not groups:
            return None

        providers: list[ProviderRecord] = []
        for idx, ((provider_type, base_url), model_names) in enumerate(
            sorted(groups.items(), key=lambda item: (item[0][0], item[0][1]))
        ):
            provider_id = "default" if idx == 0 else f"config-{idx + 1}"
            providers.append(
                ProviderRecord(
                    id=provider_id,
                    name=f"config.yaml ({provider_type})",
                    provider=provider_type,
                    base_url=base_url,
                    models=model_names,
                    is_active=(idx == 0),
                    temperature=getattr(settings, "temperature", None),
                    max_tokens=getattr(settings, "max_tokens", None),
                    # Never seed persisted secrets from config.yaml directly.
                    api_key_encrypted=None,
                )
            )

        return AIProviderSettings(
            version=AI_PROVIDER_SETTINGS_VERSION,
            default_provider_id=providers[0].get("id") if providers else None,
            providers=providers,
            client_settings=client_settings,
        )
    except Exception:
        logger.debug("Skip seeding ai_provider_settings from config.yaml.", exc_info=True)
        return None


def _looks_like_template_placeholder(
    settings: Settings,
    ai_provider_settings: AIProviderSettings,
) -> bool:
    """Detect "template defaults" that should be replaced by config.yaml seed.

    Keep this conservative: only migrate obvious placeholders (empty base_url +
    single-model gpt-4*/gpt-4o-mini) AND empty Settings.api_base_url.
    """
    providers = ai_provider_settings.get("providers") or []
    if len(providers) != 1:
        return False
    p = providers[0]
    if str(p.get("base_url") or "").strip():
        return False
    if str(getattr(settings, "api_base_url", "") or "").strip():
        return False

    models = p.get("models") or []
    if len(models) != 1:
        return False
    model_name = str(models[0] or "").strip()
    return model_name in {"gpt-4", "gpt-4o", "gpt-4o-mini"}


def _load_preferences(settings: Settings) -> dict[str, Any]:
    raw = settings.preferences or "{}"
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            logger.warning("Invalid settings.preferences JSON, fallback to empty object.")
            parsed = {}
    else:
        parsed = raw
    return parsed if isinstance(parsed, dict) else {}


def _save_preferences(settings: Settings, preferences: dict[str, Any]) -> None:
    settings.preferences = json.dumps(preferences, ensure_ascii=False)


def _normalize_models(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        return []
    models: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        trimmed = item.strip()
        if trimmed:
            models.append(trimmed)
    return models


def _provider_secret_value(provider: dict[str, Any]) -> str | None:
    for field_name in ("api_key_encrypted", "api_key"):
        secret_value = provider.get(field_name)
        if isinstance(secret_value, str):
            trimmed = secret_value.strip()
            if trimmed:
                return trimmed
    return None


def _provider_secret_for_runtime(provider: dict[str, Any]) -> str | None:
    secret_value = _provider_secret_value(provider)
    if secret_value is None:
        return None
    return safe_decrypt(secret_value) or secret_value


def _normalize_provider_record(
    raw: dict[str, Any],
    *,
    previous: ProviderRecord | None = None,
    allow_raw_backend_secret_fields: bool = False,
) -> ProviderRecord:
    prev = previous or {}
    provider_id = (raw.get("id") or prev.get("id") or "").strip()
    if not provider_id:
        provider_id = str(uuid.uuid4())

    name = (raw.get("name") or prev.get("name") or "Provider").strip()
    provider = (raw.get("provider") or prev.get("provider") or "openai").strip()
    if "base_url" in raw:
        base_url = (raw.get("base_url") or "").strip()
    else:
        base_url = (prev.get("base_url") or "").strip()

    if "models" in raw:
        # Keep explicit empty list from request payloads; do not back-fill with previous.
        models = _normalize_models(raw.get("models"))
    else:
        models = _normalize_models(prev.get("models"))

    temperature = raw.get("temperature") if raw.get("temperature") is not None else prev.get("temperature")
    max_tokens = raw.get("max_tokens") if raw.get("max_tokens") is not None else prev.get("max_tokens")

    is_active = bool(raw.get("is_active")) if raw.get("is_active") is not None else bool(prev.get("is_active"))

    # Secret handling:
    # - Persisted records may contain api_key_encrypted or historical api_key.
    # - Request payloads must never be allowed to inject api_key_encrypted.
    api_key_encrypted = prev.get("api_key_encrypted")
    if allow_raw_backend_secret_fields:
        raw_backend_secret = _as_non_empty_str(raw.get("api_key_encrypted"))
        if raw_backend_secret is not None:
            api_key_encrypted = raw_backend_secret
        else:
            raw_legacy_secret = _as_non_empty_str(raw.get("api_key"))
            if raw_legacy_secret is not None:
                api_key_encrypted = encrypt_secret(raw_legacy_secret) if is_encryption_enabled() else raw_legacy_secret
    elif raw.get("clear_api_key") is True:
        api_key_encrypted = None
    else:
        api_key_plain = raw.get("api_key")
        if isinstance(api_key_plain, str) and api_key_plain.strip():
            trimmed_key = api_key_plain.strip()
            api_key_encrypted = encrypt_secret(trimmed_key) if is_encryption_enabled() else trimmed_key

    return ProviderRecord(
        id=provider_id,
        name=name,
        provider=provider,
        base_url=base_url,
        models=models,
        is_active=is_active,
        temperature=temperature,
        max_tokens=max_tokens,
        api_key_encrypted=api_key_encrypted,
    )


def _public_provider_record(provider: ProviderRecord) -> ProviderRecordPublic:
    return ProviderRecordPublic(
        id=provider.get("id", ""),
        name=provider.get("name", ""),
        provider=provider.get("provider", ""),
        base_url=provider.get("base_url", ""),
        models=list(provider.get("models") or []),
        is_active=bool(provider.get("is_active")),
        temperature=provider.get("temperature"),
        max_tokens=provider.get("max_tokens"),
        has_api_key=bool(_provider_secret_value(provider)),
    )


def _ensure_client_settings(value: Any) -> ClientSettings:
    if not isinstance(value, dict):
        return dict(DEFAULT_CLIENT_SETTINGS)
    merged = dict(DEFAULT_CLIENT_SETTINGS)
    for key in ("enable_stream_mode", "request_timeout", "max_retries"):
        if key in value:
            merged[key] = value[key]

    merged["enable_stream_mode"] = bool(merged.get("enable_stream_mode"))
    try:
        merged["request_timeout"] = int(merged.get("request_timeout"))
    except Exception:
        merged["request_timeout"] = DEFAULT_CLIENT_SETTINGS["request_timeout"]
    try:
        merged["max_retries"] = int(merged.get("max_retries"))
    except Exception:
        merged["max_retries"] = DEFAULT_CLIENT_SETTINGS["max_retries"]

    merged["request_timeout"] = max(1000, merged["request_timeout"])
    merged["max_retries"] = max(0, merged["max_retries"])
    return merged  # type: ignore[return-value]


def _ensure_feature_routing_settings(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        return None
    return dict(value)


def _ensure_ai_provider_settings(preferences: dict[str, Any]) -> AIProviderSettings:
    raw = preferences.get(AI_PROVIDER_SETTINGS_PREF_KEY)
    if not isinstance(raw, dict):
        return AIProviderSettings(
            version=AI_PROVIDER_SETTINGS_VERSION,
            default_provider_id=None,
            providers=[],
            client_settings=dict(DEFAULT_CLIENT_SETTINGS),
            feature_routing_settings=None,
        )

    default_provider_id = raw.get("default_provider_id")
    if not isinstance(default_provider_id, str):
        default_provider_id = None
    else:
        default_provider_id = default_provider_id.strip() or None

    providers_raw = raw.get("providers")
    providers: list[ProviderRecord] = []
    if isinstance(providers_raw, list):
        for item in providers_raw:
            if not isinstance(item, dict):
                continue
            # Normalize/sanitize persisted records; do NOT pass "previous=item"
            # (it defeats sanitization fallbacks like models normalization).
            providers.append(_normalize_provider_record(item, allow_raw_backend_secret_fields=True))

    client_settings = _ensure_client_settings(raw.get("client_settings"))
    feature_routing_settings = _ensure_feature_routing_settings(raw.get("feature_routing_settings"))

    return AIProviderSettings(
        version=int(raw.get("version") or AI_PROVIDER_SETTINGS_VERSION),
        default_provider_id=default_provider_id,
        providers=providers,
        client_settings=client_settings,
        feature_routing_settings=feature_routing_settings,
    )


def _select_active_provider(
    providers: list[ProviderRecord],
    *,
    default_provider_id: str | None,
) -> ProviderRecord | None:
    active = next((p for p in providers if p.get("is_active")), None)
    if active is None and default_provider_id:
        active = next((p for p in providers if p.get("id") == default_provider_id), None)
        if active is not None:
            active["is_active"] = True

    if active is None and providers:
        active = providers[0]
        active["is_active"] = True

    if active is not None:
        active_id = active.get("id")
        for p in providers:
            p["is_active"] = p.get("id") == active_id

    return active


def _extract_target_from_routing_node(node: Any) -> tuple[str | None, str | None]:
    if not isinstance(node, dict):
        return None, None

    provider_id = _as_non_empty_str(node.get("providerId") or node.get("provider_id"))
    model_name = _as_non_empty_str(node.get("model") or node.get("model_name"))
    return provider_id, model_name


def _resolve_feature_routing_target(
    bundle: AIProviderSettings,
    module_id: str | None,
) -> tuple[str | None, str | None]:
    feature_settings = bundle.get("feature_routing_settings")
    if not isinstance(feature_settings, dict):
        return None, None

    target_provider_id: str | None = None
    target_model: str | None = None

    if module_id:
        modules = feature_settings.get("modules")
        if isinstance(modules, list):
            matched_module = next(
                (
                    item
                    for item in modules
                    if isinstance(item, dict) and _as_non_empty_str(item.get("moduleId")) == module_id
                ),
                None,
            )
            if isinstance(matched_module, dict):
                current_mode = _as_non_empty_str(matched_module.get("currentMode")) or "primary"
                backup_provider_id, backup_model = _extract_target_from_routing_node(matched_module.get("backupTarget"))
                primary_provider_id, primary_model = _extract_target_from_routing_node(matched_module.get("primaryTarget"))
                default_provider_id, default_model = _extract_target_from_routing_node(matched_module.get("defaultTarget"))

                if current_mode == "backup" and backup_provider_id and backup_model:
                    target_provider_id, target_model = backup_provider_id, backup_model
                elif primary_provider_id and primary_model:
                    target_provider_id, target_model = primary_provider_id, primary_model
                elif default_provider_id and default_model:
                    target_provider_id, target_model = default_provider_id, default_model

    if target_provider_id and target_model:
        return target_provider_id, target_model

    return _extract_target_from_routing_node(feature_settings.get("defaultTarget"))


def _find_provider_record(bundle: AIProviderSettings, provider_id: str | None) -> ProviderRecord | None:
    if not provider_id:
        return None

    providers = bundle.get("providers")
    if not isinstance(providers, list):
        return None

    for provider in providers:
        if not isinstance(provider, dict):
            continue
        if _as_non_empty_str(provider.get("id")) == provider_id:
            return provider

    return None


def _provider_models(provider_record: dict[str, Any] | None) -> list[str]:
    if not isinstance(provider_record, dict):
        return []

    models = provider_record.get("models")
    if not isinstance(models, list):
        return []

    parsed: list[str] = []
    for model_name in models:
        if not isinstance(model_name, str):
            continue
        trimmed = model_name.strip()
        if trimmed:
            parsed.append(trimmed)
    return parsed


def resolve_user_ai_runtime_config(
    settings: Settings,
    *,
    ai_provider_id: str | None = None,
    ai_model: str | None = None,
    module_id: str | None = None,
) -> tuple[UserAIRuntimeConfig, str]:
    """Resolve the effective provider/runtime config for a user."""
    runtime: UserAIRuntimeConfig = {
        "api_provider": _as_non_empty_str(settings.api_provider) or "openai",
        "api_key": safe_decrypt(settings.api_key) or "",
        "api_base_url": _as_non_empty_str(settings.api_base_url) or "",
        "model_name": _as_non_empty_str(settings.llm_model) or "gpt-4",
        "temperature": float(settings.temperature) if settings.temperature is not None else 0.7,
        "max_tokens": int(settings.max_tokens) if settings.max_tokens is not None else 2000,
    }
    source = "settings-default"

    preferences = _load_preferences(settings)
    ai_provider_settings = _ensure_ai_provider_settings(preferences)
    providers = ai_provider_settings["providers"]
    active_provider = _select_active_provider(
        providers,
        default_provider_id=ai_provider_settings.get("default_provider_id"),
    )

    explicit_provider_id = _as_non_empty_str(ai_provider_id)
    explicit_model_name = _as_non_empty_str(ai_model)
    normalized_module_id = _as_non_empty_str(module_id)
    routed_provider_id: str | None = None
    routed_model: str | None = None

    if normalized_module_id:
        routed_provider_id, routed_model = _resolve_feature_routing_target(ai_provider_settings, normalized_module_id)

    target_provider_id = explicit_provider_id or routed_provider_id or (active_provider.get("id") if active_provider else None)
    provider_record = _find_provider_record(ai_provider_settings, target_provider_id)

    if provider_record is None and target_provider_id:
        logger.warning(
            "未找到 provider_id=%s（module=%s），回退 Settings 顶层配置",
            target_provider_id,
            normalized_module_id,
        )

    if provider_record is not None:
        runtime["api_provider"] = _as_non_empty_str(provider_record.get("provider")) or runtime["api_provider"]
        runtime["api_base_url"] = _as_non_empty_str(provider_record.get("base_url")) or ""

        provider_secret = _provider_secret_for_runtime(provider_record)
        if provider_secret is not None:
            runtime["api_key"] = provider_secret

        provider_temperature = provider_record.get("temperature")
        if provider_temperature is not None:
            try:
                runtime["temperature"] = float(provider_temperature)
            except Exception:
                pass

        provider_max_tokens = provider_record.get("max_tokens")
        if provider_max_tokens is not None:
            try:
                runtime["max_tokens"] = int(provider_max_tokens)
            except Exception:
                pass

    provider_models = _provider_models(provider_record)
    if explicit_model_name:
        runtime["model_name"] = explicit_model_name
        source = "explicit-provider+explicit-model" if explicit_provider_id and provider_record is not None else "explicit-model"
    elif routed_model:
        if not provider_models or routed_model in provider_models:
            runtime["model_name"] = routed_model
            source = f"feature-routing:{normalized_module_id or 'default'}"
        elif provider_models:
            runtime["model_name"] = provider_models[0]
            source = f"feature-routing-fallback:{normalized_module_id or 'default'}"
    elif provider_models:
        runtime["model_name"] = provider_models[0]
        source = "provider-default-model"

    if explicit_provider_id and not explicit_model_name and provider_record is not None:
        source = "explicit-provider"

    return runtime, source


class AISettingsService:
    """Orchestrates unified AI settings read/write + legacy field mirroring."""

    async def get_or_create_settings(self, user_id: str, db: AsyncSession) -> Settings:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if settings:
            return settings

        settings = Settings(user_id=user_id)

        # Seed initial bundle from config.yaml if possible.
        preferences = _load_preferences(settings)
        seed_bundle = _try_build_seed_bundle_from_config_yaml(
            settings=settings,
            client_settings=dict(DEFAULT_CLIENT_SETTINGS),
        )
        if seed_bundle is not None:
            active = _select_active_provider(
                seed_bundle["providers"],
                default_provider_id=seed_bundle.get("default_provider_id"),
            )
            if active is not None and active.get("id"):
                seed_bundle["default_provider_id"] = active["id"]
                settings.api_provider = active.get("provider") or settings.api_provider
                settings.api_base_url = active.get("base_url") or ""
                active_models = active.get("models") or []
                if active_models:
                    settings.llm_model = active_models[0]
                if active.get("temperature") is not None:
                    settings.temperature = float(active["temperature"])
                if active.get("max_tokens") is not None:
                    settings.max_tokens = int(active["max_tokens"])
                settings.api_key = active.get("api_key_encrypted") or active.get("api_key") or None

            preferences[AI_PROVIDER_SETTINGS_PREF_KEY] = {
                "version": AI_PROVIDER_SETTINGS_VERSION,
                "default_provider_id": seed_bundle.get("default_provider_id"),
                "providers": seed_bundle["providers"],
                "client_settings": seed_bundle["client_settings"],
                "feature_routing_settings": None,
            }
            _save_preferences(settings, preferences)

        db.add(settings)
        try:
            await db.commit()
        except IntegrityError:
            # Concurrent create for same user_id may happen under load.
            await db.rollback()
            result = await db.execute(select(Settings).where(Settings.user_id == user_id))
            existing = result.scalar_one_or_none()
            if existing is not None:
                return existing
            raise
        await db.refresh(settings)
        return settings

    async def get_ai_settings(self, user_id: str, db: AsyncSession) -> dict[str, Any]:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if settings is None:
            # Create a record so frontend can rely on a stable, server-backed truth.
            settings = await self.get_or_create_settings(user_id, db)

        preferences = _load_preferences(settings)
        ai_provider_settings = _ensure_ai_provider_settings(preferences)

        # If bundle missing (uninitialized) or still at template defaults, upgrade it
        # once from config.yaml (best-effort). Do NOT override explicit empty bundle.
        is_bundle_missing = AI_PROVIDER_SETTINGS_PREF_KEY not in preferences
        providers_list = ai_provider_settings.get("providers") or []
        should_upgrade = is_bundle_missing or _looks_like_template_placeholder(settings, ai_provider_settings)
        if should_upgrade and (is_bundle_missing or providers_list):
            seed_bundle = _try_build_seed_bundle_from_config_yaml(
                settings=settings,
                client_settings=ai_provider_settings.get("client_settings") or dict(DEFAULT_CLIENT_SETTINGS),
            )
            if seed_bundle is not None:
                active = _select_active_provider(
                    seed_bundle["providers"],
                    default_provider_id=seed_bundle.get("default_provider_id"),
                )
                if active is not None and active.get("id"):
                    seed_bundle["default_provider_id"] = active["id"]
                    settings.api_provider = active.get("provider") or settings.api_provider
                    settings.api_base_url = active.get("base_url") or ""
                    active_models = active.get("models") or []
                    if active_models:
                        settings.llm_model = active_models[0]

                preferences[AI_PROVIDER_SETTINGS_PREF_KEY] = {
                    "version": AI_PROVIDER_SETTINGS_VERSION,
                    "default_provider_id": seed_bundle.get("default_provider_id"),
                    "providers": seed_bundle["providers"],
                    "client_settings": seed_bundle["client_settings"],
                    "feature_routing_settings": ai_provider_settings.get("feature_routing_settings"),
                }
                _save_preferences(settings, preferences)
                await db.commit()
                await db.refresh(settings)

                # Re-load for response.
                preferences = _load_preferences(settings)
                ai_provider_settings = _ensure_ai_provider_settings(preferences)

        active_provider = _select_active_provider(
            ai_provider_settings["providers"],
            default_provider_id=ai_provider_settings["default_provider_id"],
        )
        effective_default_provider_id = ai_provider_settings["default_provider_id"]
        if effective_default_provider_id is None and active_provider is not None and active_provider.get("id"):
            effective_default_provider_id = active_provider["id"]

        runtime, _ = resolve_user_ai_runtime_config(settings)

        return {
            "providers": [_public_provider_record(p) for p in ai_provider_settings["providers"]],
            "default_provider_id": effective_default_provider_id,
            "client_settings": ai_provider_settings["client_settings"],
            "feature_routing_settings": ai_provider_settings.get("feature_routing_settings"),
            # legacy fields (mirror source-of-truth for runtime)
            "api_provider": runtime["api_provider"],
            "api_base_url": runtime["api_base_url"],
            "llm_model": runtime["model_name"],
            "temperature": runtime["temperature"],
            "max_tokens": runtime["max_tokens"],
            "system_prompt": settings.system_prompt,
        }

    async def put_ai_settings(self, user_id: str, payload: dict[str, Any], db: AsyncSession) -> dict[str, Any]:
        """Update AI settings (new contract preferred, legacy fields supported)."""
        settings = await self.get_or_create_settings(user_id, db)

        preferences = _load_preferences(settings)
        current = _ensure_ai_provider_settings(preferences)

        # ---- Update client_settings / default_provider_id (new contract) ----
        if isinstance(payload.get("client_settings"), dict):
            current["client_settings"] = _ensure_client_settings(payload["client_settings"])

        if "feature_routing_settings" in payload:
            current["feature_routing_settings"] = _ensure_feature_routing_settings(payload.get("feature_routing_settings"))

        if "default_provider_id" in payload:
            default_provider_id = payload.get("default_provider_id")
            if isinstance(default_provider_id, str):
                current["default_provider_id"] = default_provider_id.strip() or None
            else:
                current["default_provider_id"] = None

        # ---- Update providers list (new contract: whole bundle replace) ----
        if isinstance(payload.get("providers"), list):
            previous_by_id: dict[str, ProviderRecord] = {
                (p.get("id") or ""): p for p in current["providers"] if p.get("id")
            }
            next_providers: list[ProviderRecord] = []
            for item in payload["providers"]:
                if not isinstance(item, dict):
                    continue
                prev = previous_by_id.get((item.get("id") or "").strip())
                next_providers.append(
                    _normalize_provider_record(
                        item,
                        previous=prev,
                        allow_raw_backend_secret_fields=False,
                    )
                )

            current["providers"] = next_providers
            # If the default provider was deleted/changed, clear it so active selection
            # can fall back deterministically.
            default_provider_id = current.get("default_provider_id")
            if default_provider_id and not any(p.get("id") == default_provider_id for p in next_providers):
                current["default_provider_id"] = None

        # ---- Legacy fields: update Settings top-level directly ----
        #
        # NOTE: system_prompt is global and NOT part of the provider bundle. We
        # still support writing it via this endpoint, but it must not trigger
        # legacy provider-bundle sync (otherwise sending only system_prompt
        # alongside the new-contract payload would inadvertently recreate a
        # placeholder provider and make "delete provider" impossible).
        legacy_fields = {
            "api_provider",
            "api_key",
            "api_base_url",
            "llm_model",
            "temperature",
            "max_tokens",
        }
        providers_present = isinstance(payload.get("providers"), list)
        legacy_present = (not providers_present) and any(k in payload for k in legacy_fields)
        if legacy_present:
            if "api_provider" in payload and payload["api_provider"] is not None:
                settings.api_provider = str(payload["api_provider"])
            if "api_base_url" in payload and payload["api_base_url"] is not None:
                settings.api_base_url = str(payload["api_base_url"])
            if "llm_model" in payload and payload["llm_model"] is not None:
                settings.llm_model = str(payload["llm_model"])
            if "temperature" in payload and payload["temperature"] is not None:
                try:
                    settings.temperature = float(payload["temperature"])
                except Exception:
                    logger.warning("Invalid temperature value: %r, ignoring", payload["temperature"])
            if "max_tokens" in payload and payload["max_tokens"] is not None:
                try:
                    settings.max_tokens = int(payload["max_tokens"])
                except Exception:
                    logger.warning("Invalid max_tokens value: %r, ignoring", payload["max_tokens"])
            if "api_key" in payload and payload["api_key"] is not None:
                api_key_plain = str(payload["api_key"]).strip()
                if not api_key_plain:
                    settings.api_key = None
                else:
                    settings.api_key = encrypt_secret(api_key_plain) if is_encryption_enabled() else api_key_plain

            # Keep preferences in sync with the just-updated legacy top-level fields.
            self._sync_preferences_from_settings_payload(settings, current, payload)

        # ---- Mirror active provider back to Settings top-level (authoritative for runtime) ----
        active = _select_active_provider(
            current["providers"],
            default_provider_id=current["default_provider_id"],
        )
        if active is not None:
            if not current.get("default_provider_id") and active.get("id"):
                current["default_provider_id"] = active["id"]
            settings.api_provider = active.get("provider") or settings.api_provider
            settings.api_base_url = active.get("base_url") or ""

            models = active.get("models") or []
            if models:
                settings.llm_model = models[0]

            if active.get("temperature") is not None:
                settings.temperature = float(active["temperature"])
            if active.get("max_tokens") is not None:
                settings.max_tokens = int(active["max_tokens"])

            settings.api_key = active.get("api_key_encrypted") or active.get("api_key") or None

        # system_prompt is global; keep from payload if provided, else keep existing.
        if "system_prompt" in payload and payload["system_prompt"] is not None:
            settings.system_prompt = payload["system_prompt"]

        preferences[AI_PROVIDER_SETTINGS_PREF_KEY] = {
            "version": AI_PROVIDER_SETTINGS_VERSION,
            "default_provider_id": current["default_provider_id"],
            "providers": current["providers"],
            "client_settings": current["client_settings"],
            "feature_routing_settings": current.get("feature_routing_settings"),
        }
        _save_preferences(settings, preferences)

        await db.commit()
        await db.refresh(settings)

        # Clear model cache after config change (best-effort).
        try:
            from app.gateway.novel_migrated.services.ai_service import clear_model_cache

            clear_model_cache()
        except Exception:
            logger.debug("Skip clear_model_cache (import/init issue).", exc_info=True)

        return await self.get_ai_settings(user_id, db)

    def sync_preferences_from_settings_payload(self, settings: Settings, payload: dict[str, Any]) -> None:
        """Sync preferences.ai_provider_settings based on Settings top-level fields.

        This is the recommended entry-point for legacy writers (e.g. /settings)
        which update Settings fields directly and want to keep the canonical
        provider bundle in sync, without re-mirroring (and potentially
        overriding) those top-level fields again.
        """
        preferences = _load_preferences(settings)
        current = _ensure_ai_provider_settings(preferences)
        self._sync_preferences_from_settings_payload(settings, current, payload)
        preferences[AI_PROVIDER_SETTINGS_PREF_KEY] = {
            "version": AI_PROVIDER_SETTINGS_VERSION,
            "default_provider_id": current["default_provider_id"],
            "providers": current["providers"],
            "client_settings": current["client_settings"],
            "feature_routing_settings": current.get("feature_routing_settings"),
        }
        _save_preferences(settings, preferences)

    def _sync_preferences_from_settings_payload(
        self,
        settings: Settings,
        current: AIProviderSettings,
        payload: dict[str, Any],
    ) -> None:
        """Keep preferences.ai_provider_settings aligned with Settings top-level.

        This is mainly for legacy writers (e.g. /settings) that update Settings
        fields directly. We only update fields present in payload to avoid
        unintended clobbering (especially api_key).
        """
        providers = current["providers"]
        active = _select_active_provider(providers, default_provider_id=current.get("default_provider_id"))

        if active is None:
            # Create an active provider entry if none exists.
            provider_id = current.get("default_provider_id") or str(uuid.uuid4())
            active = ProviderRecord(
                id=provider_id,
                name=(settings.api_provider or "Provider"),
                provider=(settings.api_provider or "openai"),
                base_url=(settings.api_base_url or ""),
                models=[settings.llm_model] if settings.llm_model else [],
                is_active=True,
                temperature=settings.temperature,
                max_tokens=settings.max_tokens,
                api_key_encrypted=settings.api_key or None,
            )
            providers.append(active)
            current["default_provider_id"] = provider_id

        # Update only touched fields
        if "api_provider" in payload and payload.get("api_provider") is not None:
            active["provider"] = str(settings.api_provider or "openai")
        if "api_base_url" in payload and payload.get("api_base_url") is not None:
            active["base_url"] = str(settings.api_base_url or "")
        if "llm_model" in payload and payload.get("llm_model") is not None:
            active["models"] = [str(settings.llm_model)] if settings.llm_model else []
        if "temperature" in payload and payload.get("temperature") is not None:
            active["temperature"] = settings.temperature
        if "max_tokens" in payload and payload.get("max_tokens") is not None:
            active["max_tokens"] = settings.max_tokens
        if "api_key" in payload and payload.get("api_key") is not None:
            active["api_key_encrypted"] = settings.api_key or None

        # Ensure provider id is captured as default when we have active provider.
        if active.get("id") and current.get("default_provider_id") is None:
            current["default_provider_id"] = active["id"]


_ai_settings_service: AISettingsService | None = None
_ai_settings_service_lock = threading.Lock()


def get_ai_settings_service() -> AISettingsService:
    global _ai_settings_service
    if _ai_settings_service is not None:
        return _ai_settings_service
    with _ai_settings_service_lock:
        if _ai_settings_service is None:
            _ai_settings_service = AISettingsService()
    return _ai_settings_service
