"""User AI settings CRUD APIs.

Single source of truth:
  - /api/user/ai-settings returns and updates the canonical providers list
    stored in Settings.preferences["ai_provider_settings"].
  - Active provider is mirrored to Settings top-level fields for legacy flows.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.auth.newapi_oauth import (
    NewAPIOAuthError,
    get_newapi_group_catalog_for_user,
    sync_newapi_groups_for_user,
)
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.services.ai_settings_service import (
    MANAGED_NEWAPI_PROVIDER_ID,
    fetch_managed_newapi_models,
    get_ai_settings_service,
    get_managed_newapi_groups,
)

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
    is_managed: bool = False
    managed_by: str | None = None
    managed_group: str | None = None
    model_groups: dict[str, list[str]] = Field(default_factory=dict)
    model_sync_status: str | None = None
    model_sync_error: str | None = None


class ProviderRecordUpdate(BaseModel):
    id: str | None = None
    name: str
    provider: str
    base_url: str = ""
    models: list[str] = Field(default_factory=list)
    model_groups: dict[str, list[str]] = Field(default_factory=dict)
    is_active: bool = False
    temperature: float | None = None
    max_tokens: int | None = None

    # write-only fields
    api_key: str | None = Field(default=None, description="write-only; non-empty overwrites backend stored key")
    clear_api_key: bool | None = Field(default=None, description="write-only; true clears backend stored key")


class AiSettingsResponse(BaseModel):
    providers: list[ProviderRecordResponse] = Field(default_factory=list)
    default_provider_id: str | None = None
    client_settings: ClientSettings = Field(default_factory=ClientSettings)
    feature_routing_settings: dict[str, object] | None = None

    api_provider: str = Field(deprecated=True, description="遗留字段，请使用 providers + default_provider_id")
    api_base_url: str = Field(deprecated=True, description="遗留字段，请使用 providers[id].base_url")
    llm_model: str = Field(deprecated=True, description="遗留字段，请使用 providers[id].models")
    temperature: float = Field(deprecated=True, description="遗留字段，请使用 providers[id].temperature")
    max_tokens: int = Field(deprecated=True, description="遗留字段，请使用 providers[id].max_tokens")
    system_prompt: str | None = Field(default=None, deprecated=True, description="遗留字段")


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
    result = await service.get_ai_settings(user_id, db)
    providers = result.get("providers") if isinstance(result, dict) else []
    managed_groups = [
        provider.get("managed_group")
        for provider in providers
        if isinstance(provider, dict) and provider.get("managed_by") == "newapi"
    ]
    logger.info(
        "AI settings fetched user_id=%s providers=%d managed_newapi_groups=%s",
        user_id,
        len(providers) if isinstance(providers, list) else 0,
        [group for group in managed_groups if group],
    )
    return result


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
    providers = updated.get("providers") if isinstance(updated, dict) else []
    managed_groups = [
        provider.get("managed_group")
        for provider in providers
        if isinstance(provider, dict) and provider.get("managed_by") == "newapi"
    ]
    logger.info(
        "AI settings updated user_id=%s providers=%d managed_newapi_groups=%s",
        user_id,
        len(providers) if isinstance(providers, list) else 0,
        [group for group in managed_groups if group],
    )
    return updated


class FetchProviderModelsRequest(BaseModel):
    base_url: str = Field(default="", description="Provider API base URL")
    api_key: str = Field(default="", description="Provider API key")
    provider_type: str = Field(default="openai", description="Provider type: openai, anthropic, google, custom")
    provider_id: str | None = Field(default=None, description="Optional provider ID")


class FetchProviderModelsResponse(BaseModel):
    models: list[str] = Field(default_factory=list)
    model_groups: dict[str, list[str]] = Field(default_factory=dict)


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


def _validate_and_normalize_public_base_url(raw_base_url: str) -> str:
    base_url = (raw_base_url or "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="需要提供有效的接口地址")

    parsed = urlparse(base_url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="接口地址仅支持 http/https 协议")

    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        raise HTTPException(status_code=400, detail="接口地址缺少主机名")

    blocked_hosts = {
        "169.254.169.254",
        "metadata.google.internal",
    }
    hostname_lower = hostname.lower()
    if hostname_lower in blocked_hosts:
        raise HTTPException(status_code=400, detail="Base URL points to a restricted network address")
    try:
        host_ip = ipaddress.ip_address(hostname_lower)
    except ValueError:
        host_ip = None
    if host_ip is not None and (host_ip.is_link_local or host_ip.is_multicast or host_ip.is_reserved):
        raise HTTPException(status_code=400, detail="Base URL points to a restricted network address")

    return base_url


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


async def _fetch_models_from_upstream(models_url: str, api_key: str) -> list[str]:
    headers: dict[str, str] = {
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    import logging as _logging
    _httpx_logger = _logging.getLogger("httpx")
    previous_level = _httpx_logger.level
    if previous_level < _logging.WARNING:
        _httpx_logger.setLevel(_logging.WARNING)

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(models_url, headers=headers)
    finally:
        if previous_level < _logging.WARNING:
            _httpx_logger.setLevel(previous_level)

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
    return models


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
        return FetchProviderModelsResponse(models=_get_anthropic_static_models())

    if provider_type == "google":
        return FetchProviderModelsResponse(models=_get_google_static_models())

    if provider_type == "newapi" or (payload.provider_id or "").startswith(MANAGED_NEWAPI_PROVIDER_ID):
        try:
            models, model_groups = await fetch_managed_newapi_models(payload.provider_id)
            return FetchProviderModelsResponse(models=models, model_groups=model_groups)
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "fetch-provider-models: managed NewAPI returned %s",
                exc.response.status_code if exc.response else "unknown",
            )
            raise HTTPException(status_code=502, detail="NewAPI 模型列表获取失败") from exc

    safe_base_url = _validate_and_normalize_public_base_url(base_url)
    models_url = _build_models_url(safe_base_url, provider_type)
    if not models_url:
        raise HTTPException(status_code=400, detail="需要提供有效的接口地址")

    try:
        models = await _fetch_models_from_upstream(models_url, api_key)
        return FetchProviderModelsResponse(models=models)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="上游 API 请求超时")
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="无法连接到上游 API，请检查接口地址")
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "fetch-provider-models: managed provider returned %s",
            exc.response.status_code if exc.response else "unknown",
        )
        raise HTTPException(status_code=502, detail="上游 API 返回错误") from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("fetch-provider-models: unexpected error")
        raise HTTPException(status_code=500, detail="获取模型列表失败，请稍后重试") from exc


class NewAPIProviderGroupResponse(BaseModel):
    provider_id: str
    group_id: str
    name: str
    base_url: str
    has_api_key: bool


@router.get("/newapi-provider-groups", response_model=list[NewAPIProviderGroupResponse])
async def list_newapi_provider_groups(request: Request):
    """Return server-managed NewAPI groups without exposing their keys."""
    get_request_user_id(request)
    groups = get_managed_newapi_groups()
    return [
        NewAPIProviderGroupResponse(
            provider_id=MANAGED_NEWAPI_PROVIDER_ID if group["group_id"] == "default" else f"{MANAGED_NEWAPI_PROVIDER_ID}-{group['group_id']}",
            group_id=group["group_id"],
            name=group["name"],
            base_url=group["base_url"],
            has_api_key=bool(group["api_key"]),
        )
        for group in groups
    ]


class NewAPISyncGroupItem(BaseModel):
    group_id: str
    name: str
    models: list[str] = Field(default_factory=list)
    model_count: int = 0
    provider_id: str
    already_synced: bool = False
    has_api_key: bool = False
    model_sync_status: str | None = None
    model_sync_error: str | None = None


class NewAPISyncGroupsResponse(BaseModel):
    groups: list[NewAPISyncGroupItem] = Field(default_factory=list)
    manual_group_allowed: bool = True
    warnings: list[str] = Field(default_factory=list)


class NewAPISyncGroupsRequest(BaseModel):
    groups: list[str] = Field(default_factory=list)
    manual_groups: list[str] = Field(default_factory=list)


class NewAPISyncGroupResult(BaseModel):
    group_id: str
    provider_id: str
    model_count: int
    has_api_key: bool
    status: str
    error: str | None = None


class NewAPISyncGroupsApplyResponse(BaseModel):
    results: list[NewAPISyncGroupResult] = Field(default_factory=list)
    ai_settings: AiSettingsResponse


def _newapi_provider_id_for_response(group_id: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in group_id.strip().lower())
    normalized = "-".join(part for part in normalized.split("-") if part)
    if not normalized:
        raw = group_id.strip()
        normalized = f"group-{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]}" if raw else "default"
    if normalized == "default":
        return MANAGED_NEWAPI_PROVIDER_ID
    return f"{MANAGED_NEWAPI_PROVIDER_ID}-{normalized}"


def _newapi_ascii_safe_group_id(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-")
    if normalized:
        return normalized
    raw = value.strip()
    return f"group-{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]}" if raw else "default"


def _newapi_ascii_compact_group_key(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "", value.strip().lower())


def _newapi_group_aliases(*values: Any) -> set[str]:
    aliases: set[str] = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        value = raw.strip()
        if not value:
            continue
        lowered = value.lower()
        aliases.add(lowered)
        aliases.add(_newapi_ascii_safe_group_id(value))
        compact = _newapi_ascii_compact_group_key(value)
        if compact:
            aliases.add(compact)
    aliases.discard("")
    return aliases


def _managed_newapi_provider_map(ai_settings: dict[str, Any]) -> dict[str, dict[str, Any]]:
    providers = ai_settings.get("providers") if isinstance(ai_settings, dict) else []
    result: dict[str, dict[str, Any]] = {}
    if not isinstance(providers, list):
        return result
    for provider in providers:
        if not isinstance(provider, dict):
            continue
        if provider.get("managed_by") != "newapi":
            continue
        group = provider.get("managed_group")
        if isinstance(group, str) and group.strip():
            result[group.strip().lower()] = provider
    return result


def _newapi_catalog_item_aliases(group_id: str, catalog_item: dict[str, Any]) -> set[str]:
    return _newapi_group_aliases(group_id, catalog_item.get("name"), catalog_item.get("group"), catalog_item.get("id"))


def _newapi_provider_aliases(provider: dict[str, Any]) -> set[str]:
    provider_id = provider.get("id")
    provider_suffix = None
    if isinstance(provider_id, str) and provider_id.startswith(f"{MANAGED_NEWAPI_PROVIDER_ID}-"):
        provider_suffix = provider_id[len(f"{MANAGED_NEWAPI_PROVIDER_ID}-") :]
    aliases = _newapi_group_aliases(
        provider.get("managed_group"),
        provider.get("name"),
        provider_id,
        provider_suffix,
    )
    model_groups = provider.get("model_groups")
    if isinstance(model_groups, dict):
        aliases.update(_newapi_group_aliases(*(key for key in model_groups.keys() if isinstance(key, str))))
    return aliases


def _merge_newapi_sync_group_ids(
    catalog: dict[str, dict[str, Any]],
    provider_by_group: dict[str, dict[str, Any]],
) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    provider_alias_index: dict[str, str] = {}
    for provider_group, provider in provider_by_group.items():
        for alias in _newapi_provider_aliases(provider):
            provider_alias_index.setdefault(alias, provider_group)

    merged: dict[str, tuple[str, dict[str, Any], dict[str, Any]]] = {}
    seen_catalog: set[str] = set()
    for catalog_group, catalog_item in catalog.items():
        aliases = _newapi_catalog_item_aliases(catalog_group, catalog_item)
        provider_group = next((provider_alias_index[alias] for alias in aliases if alias in provider_alias_index), None)
        canonical_group = provider_group or catalog_group
        provider = provider_by_group.get(canonical_group.lower(), {})
        merged[canonical_group.lower()] = (canonical_group, catalog_item, provider)
        seen_catalog.update(aliases)

    for provider_group, provider in provider_by_group.items():
        aliases = _newapi_provider_aliases(provider)
        if any(alias in seen_catalog for alias in aliases):
            continue
        merged.setdefault(provider_group.lower(), (provider_group, {}, provider))

    return sorted(merged.values(), key=lambda item: item[0].lower())


@router.get("/newapi-sync/groups", response_model=NewAPISyncGroupsResponse)
async def list_newapi_sync_groups(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return current user's selectable NewAPI groups without exposing tokens."""
    user_id = get_request_user_id(request)
    service = get_ai_settings_service()
    ai_settings = await service.get_ai_settings(user_id, db)
    provider_by_group = _managed_newapi_provider_map(ai_settings)
    try:
        catalog, warnings = await get_newapi_group_catalog_for_user(user_id=user_id, db=db)
    except NewAPIOAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    items: list[NewAPISyncGroupItem] = []
    for group_id, catalog_item, provider in _merge_newapi_sync_group_ids(catalog, provider_by_group):
        catalog_models = catalog_item.get("models") if isinstance(catalog_item.get("models"), list) else []
        provider_models = provider.get("models") if isinstance(provider.get("models"), list) else []
        model_list = [
            item
            for item in [*catalog_models, *provider_models]
            if isinstance(item, str) and item.strip()
        ]
        status = provider.get("model_sync_status") if isinstance(provider.get("model_sync_status"), str) else None
        error = provider.get("model_sync_error") if isinstance(provider.get("model_sync_error"), str) else None
        items.append(
            NewAPISyncGroupItem(
                group_id=group_id,
                name=str(catalog_item.get("name") or provider.get("name") or group_id),
                models=sorted(dict.fromkeys(model_list)),
                model_count=len(set(model_list)),
                provider_id=str(provider.get("id") or _newapi_provider_id_for_response(group_id)),
                already_synced=bool(provider),
                has_api_key=bool(provider.get("has_api_key")),
                model_sync_status=status,
                model_sync_error=error,
            )
        )

    logger.info(
        "NewAPI sync groups listed user_id=%s groups=%d synced=%d",
        user_id,
        len(items),
        sum(1 for item in items if item.already_synced),
    )
    return NewAPISyncGroupsResponse(groups=items, warnings=warnings)


@router.post("/newapi-sync/groups", response_model=NewAPISyncGroupsApplyResponse)
async def sync_newapi_sync_groups(
    payload: NewAPISyncGroupsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Synchronize user-selected NewAPI groups into managed AI providers."""
    user_id = get_request_user_id(request)
    try:
        sync_result = await sync_newapi_groups_for_user(
            user_id=user_id,
            groups=payload.groups,
            manual_groups=payload.manual_groups,
            db=db,
        )
    except NewAPIOAuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    ai_settings = await get_ai_settings_service().get_ai_settings(user_id, db)
    return NewAPISyncGroupsApplyResponse(
        results=[
            NewAPISyncGroupResult(
                group_id=item.group_id,
                provider_id=item.provider_id,
                model_count=item.model_count,
                has_api_key=item.has_api_key,
                status=item.status,
                error=item.error,
            )
            for item in sync_result.results
        ],
        ai_settings=ai_settings,
    )


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
