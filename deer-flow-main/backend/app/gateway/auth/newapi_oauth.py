"""NewAPI OIDC consumer integration for Miaowu local sessions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urljoin

import httpx
from pydantic import BaseModel, ConfigDict, EmailStr, Field, TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.auth.config import get_auth_config
from app.gateway.auth.models import NewAPIAccountSnapshot, User
from app.gateway.novel_migrated.core.crypto import encrypt_secret, is_encryption_enabled, safe_decrypt
from app.gateway.novel_migrated.core.database import AsyncSessionLocal
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.ai_settings_service import MANAGED_NEWAPI_PROVIDER_ID, get_ai_settings_service
from app.gateway.product_entitlements import product_entitlement_service

NEWAPI_PROVIDER = "newapi"
_STATE_TTL_SECONDS = 10 * 60
_DEFAULT_SCOPES = "openid profile email"
_DEFAULT_REDIRECT_URI = "http://127.0.0.1:8551/api/v1/auth/callback/newapi"
_EMAIL_ADAPTER = TypeAdapter(EmailStr)
_ADMIN_ROLE_VALUES = {"admin", "administrator", "root", "owner", "super_admin", "superadmin"}
_NEWAPI_SYNC_PREF_KEY = "newapi_sync"
_MAX_MANUAL_GROUPS = 20
_MAX_GROUP_NAME_LENGTH = 80
logger = logging.getLogger(__name__)


class NewAPIOAuthError(RuntimeError):
    """User-facing NewAPI OAuth error."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class NewAPIOAuthSettings(BaseModel):
    enabled: bool = False
    issuer: str = ""
    public_issuer: str | None = None
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = _DEFAULT_REDIRECT_URI
    scopes: str = _DEFAULT_SCOPES

    @property
    def discovery_url(self) -> str:
        return f"{self.issuer.rstrip('/')}/.well-known/openid-configuration"

    @property
    def browser_issuer(self) -> str:
        return (self.public_issuer or self.issuer).rstrip("/")


class NewAPIUserInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    sub: str = Field(min_length=1)
    email: str | None = None
    preferred_username: str | None = None
    username: str | None = None
    name: str | None = None
    picture: str | None = None
    avatar: str | None = None
    quota: int | None = None
    used_quota: int | None = None
    remain_quota: int | None = None
    balance: int | None = None
    is_admin: bool | None = None
    role: str | None = None
    roles: list[str] | str | None = None
    group: str | None = None
    groups: list[str] | str | None = None


@dataclass(frozen=True)
class NewAPIBootstrapResult:
    success: bool
    group_count: int = 0
    groups_with_key_count: int = 0
    managed_groups: tuple[str, ...] = ()
    message: str | None = None


@dataclass(frozen=True)
class NewAPIManualGroupSyncItem:
    group_id: str
    provider_id: str
    model_count: int
    has_api_key: bool
    status: str
    error: str | None = None


@dataclass(frozen=True)
class NewAPIModelFetchResult:
    models: tuple[str, ...] = ()
    status_code: int | None = None
    error: str | None = None


@dataclass(frozen=True)
class NewAPIManualGroupSyncResult:
    results: tuple[NewAPIManualGroupSyncItem, ...]
    group_items: tuple[dict[str, Any], ...]
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class NewAPILoginResult:
    user: User
    snapshot: NewAPIAccountSnapshot
    next_path: str


def get_newapi_oauth_settings() -> NewAPIOAuthSettings:
    enabled = (os.getenv("NEWAPI_OAUTH_ENABLED") or "").strip().lower() in {"1", "true", "yes", "on"}
    return NewAPIOAuthSettings(
        enabled=enabled,
        issuer=(os.getenv("NEWAPI_OAUTH_ISSUER") or "").strip(),
        public_issuer=(os.getenv("NEWAPI_OAUTH_PUBLIC_ISSUER") or "").strip() or None,
        client_id=(os.getenv("NEWAPI_OAUTH_CLIENT_ID") or "").strip(),
        client_secret=os.getenv("NEWAPI_OAUTH_CLIENT_SECRET") or "",
        redirect_uri=(os.getenv("NEWAPI_OAUTH_REDIRECT_URI") or _DEFAULT_REDIRECT_URI).strip(),
        scopes=(os.getenv("NEWAPI_OAUTH_SCOPES") or _DEFAULT_SCOPES).strip() or _DEFAULT_SCOPES,
    )


def _env_csv_values(name: str) -> set[str]:
    raw = os.getenv(name, "")
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def _truthy_env(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _claim_values(value: str | list[str] | None) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        return {item.strip().lower() for item in value.replace(";", ",").split(",") if item.strip()}
    return {str(item).strip().lower() for item in value if str(item).strip()}


def newapi_user_is_admin(userinfo: NewAPIUserInfo) -> bool:
    """Return whether the trusted NewAPI identity should be a Miaowu admin.

    Prefer explicit deployment allowlists because NewAPI OIDC deployments may
    omit admin claims from userinfo. If claims are present, accept common role
    and group shapes used by OAuth providers.
    """
    if userinfo.sub.lower() in _env_csv_values("NEWAPI_OAUTH_ADMIN_SUBS"):
        return True

    identities = {
        (userinfo.email or "").strip().lower(),
        (userinfo.preferred_username or "").strip().lower(),
        (userinfo.username or "").strip().lower(),
    }
    if identities & _env_csv_values("NEWAPI_OAUTH_ADMIN_IDENTITIES"):
        return True

    if userinfo.is_admin is True:
        return True

    role_values = (
        _claim_values(userinfo.role)
        | _claim_values(userinfo.roles)
        | _claim_values(userinfo.group)
        | _claim_values(userinfo.groups)
    )
    return bool(role_values & _ADMIN_ROLE_VALUES)


async def sync_newapi_system_role(provider, user: User, userinfo: NewAPIUserInfo) -> User:
    """Promote/demote local shadow user role from trusted NewAPI admin state."""
    desired_role = "admin" if newapi_user_is_admin(userinfo) else "user"

    if user.system_role == desired_role:
        return user

    should_update = desired_role == "admin" or _truthy_env("NEWAPI_OAUTH_SYNC_ADMIN_DOWNGRADE")
    if not should_update:
        return user

    user.system_role = desired_role
    return await provider.update_user(user)


def validate_next_path(value: str | None) -> str:
    if not value:
        return "/workspace"
    if not value.startswith("/") or value.startswith("//"):
        return "/workspace"
    if ":" in value:
        return "/workspace"
    return value


def build_frontend_redirect_url(next_path: str) -> str:
    """Build the browser redirect target after backend OAuth callback.

    NewAPI redirects the browser to the gateway callback endpoint. A relative
    Location would keep the user on the gateway origin, so SaaS deployments can
    set MIAOWU_PUBLIC_FRONTEND_URL to send the browser back to Next.js.
    """
    safe_next = validate_next_path(next_path)
    frontend_base = (os.getenv("MIAOWU_PUBLIC_FRONTEND_URL") or "").strip().rstrip("/")
    if not frontend_base:
        return safe_next
    if not frontend_base.startswith(("http://", "https://")):
        return safe_next
    return urljoin(frontend_base + "/", safe_next.lstrip("/"))


def require_newapi_settings() -> NewAPIOAuthSettings:
    settings = get_newapi_oauth_settings()
    if not settings.enabled:
        raise NewAPIOAuthError("NewAPI login is disabled.", status_code=404)
    missing = [
        name
        for name, value in {
            "NEWAPI_OAUTH_ISSUER": settings.issuer,
            "NEWAPI_OAUTH_CLIENT_ID": settings.client_id,
            "NEWAPI_OAUTH_CLIENT_SECRET": settings.client_secret,
        }.items()
        if not value
    ]
    if missing:
        raise NewAPIOAuthError(f"NewAPI OAuth is not configured: {', '.join(missing)}", status_code=503)
    return settings


def _state_secret() -> bytes:
    return get_auth_config().jwt_secret.encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def create_newapi_state(next_path: str) -> str:
    payload = {
        "iat": int(time.time()),
        "next": validate_next_path(next_path),
        "nonce": secrets.token_urlsafe(24),
    }
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_state_secret(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url_encode(signature)}"


def validate_newapi_state(state: str) -> str:
    try:
        body, signature = state.split(".", 1)
        expected = _b64url_encode(hmac.new(_state_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature mismatch")
        payload = json.loads(_b64url_decode(body))
    except Exception as exc:
        raise NewAPIOAuthError("Invalid NewAPI login state.", status_code=400) from exc

    iat = payload.get("iat")
    if not isinstance(iat, int) or int(time.time()) - iat > _STATE_TTL_SECONDS:
        raise NewAPIOAuthError("NewAPI login state expired.", status_code=400)
    return validate_next_path(payload.get("next") if isinstance(payload.get("next"), str) else None)


async def build_newapi_authorize_url(next_path: str) -> str:
    settings = require_newapi_settings()
    discovery = await fetch_newapi_discovery(settings)
    authorization_endpoint = str(
        discovery.get("authorization_endpoint") or f"{settings.issuer.rstrip('/')}/oauth/authorize"
    )
    if settings.public_issuer:
        authorization_endpoint = _rewrite_endpoint_issuer(
            authorization_endpoint,
            source_issuer=settings.issuer,
            target_issuer=settings.browser_issuer,
        )
    query = urlencode(
        {
            "client_id": settings.client_id,
            "redirect_uri": settings.redirect_uri,
            "response_type": "code",
            "scope": settings.scopes,
            "state": create_newapi_state(next_path),
        }
    )
    return f"{authorization_endpoint}?{query}"


def _rewrite_endpoint_issuer(endpoint: str, *, source_issuer: str, target_issuer: str) -> str:
    source = source_issuer.rstrip("/")
    target = target_issuer.rstrip("/")
    if source and endpoint.startswith(source + "/"):
        return target + endpoint[len(source) :]
    return endpoint


async def fetch_newapi_discovery(settings: NewAPIOAuthSettings) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        response = await client.get(settings.discovery_url)
    if response.status_code != 200:
        raise NewAPIOAuthError("Failed to fetch NewAPI OIDC discovery document.", status_code=502)
    data = response.json()
    if not isinstance(data, dict):
        raise NewAPIOAuthError("NewAPI OIDC discovery document is malformed.", status_code=502)
    issuer_origin = settings.issuer.rstrip("/")
    for key in ("token_endpoint", "userinfo_endpoint", "authorization_endpoint"):
        endpoint = data.get(key)
        if isinstance(endpoint, str) and not endpoint.startswith(issuer_origin + "/") and not endpoint.startswith(issuer_origin):
            logger.warning("Discovery %s=%s does not match issuer %s", key, endpoint, settings.issuer)
    return data


async def exchange_newapi_code_for_user(code: str, state: str, provider) -> NewAPILoginResult:
    settings = require_newapi_settings()
    next_path = validate_newapi_state(state)
    discovery = await fetch_newapi_discovery(settings)
    token_endpoint = str(discovery.get("token_endpoint") or f"{settings.issuer.rstrip('/')}/oauth/token")
    userinfo_endpoint = str(discovery.get("userinfo_endpoint") or f"{settings.issuer.rstrip('/')}/oauth/userinfo")
    token_data = await exchange_code_for_token(settings, token_endpoint, code)
    access_token = token_data.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise NewAPIOAuthError("NewAPI token response did not include access_token.", status_code=502)

    userinfo = await fetch_newapi_userinfo(userinfo_endpoint, access_token)
    user = await resolve_or_create_local_user(provider, userinfo)
    user = await sync_newapi_system_role(provider, user, userinfo)
    snapshot = await provider.upsert_newapi_snapshot(
        user_id=str(user.id),
        newapi_sub=userinfo.sub,
        email=userinfo.email,
        username=userinfo.preferred_username or userinfo.username,
        name=userinfo.name,
        avatar=userinfo.picture or userinfo.avatar,
        quota=userinfo.quota,
        used_quota=userinfo.used_quota,
        remain_quota=userinfo.remain_quota,
        balance=userinfo.balance,
    )
    bootstrap_result = await bootstrap_user_ai_settings_from_newapi(
        user_id=str(user.id),
        settings=settings,
        access_token=access_token,
        preferred_group=userinfo.group,
    )
    if not bootstrap_result.success:
        raise NewAPIOAuthError(
            bootstrap_result.message or "NewAPI login succeeded, but AI group/key sync failed.",
            status_code=502,
        )
    try:
        async with AsyncSessionLocal() as db:
            await product_entitlement_service.refresh_from_auth_hub(
                db,
                user_id=str(user.id),
                access_token=access_token,
            )
            await db.commit()
    except Exception:
        logger.warning("Entitlement sync failed for user_id=%s; will retry on next account page visit", str(user.id), exc_info=True)
    return NewAPILoginResult(user=user, snapshot=snapshot, next_path=next_path)


async def bootstrap_user_ai_settings_from_newapi(
    *,
    user_id: str,
    settings: NewAPIOAuthSettings,
    access_token: str,
    preferred_group: str | None,
) -> NewAPIBootstrapResult:
    """Sync the signed-in NewAPI user's usable model groups into Miaowu settings."""
    bootstrap_url = f"{settings.issuer.rstrip('/')}/api/hub/session/bootstrap"
    relay_base_url = f"{settings.issuer.rstrip('/')}/v1"
    payload: dict[str, Any] = {
        "client_id": settings.client_id,
        "site_name": "Miaowu OS",
        "token_name": "Miaowu OS Local",
    }
    if preferred_group:
        payload["group"] = preferred_group

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                bootstrap_url,
                json=payload,
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
        if response.status_code != 200:
            message = f"NewAPI Hub bootstrap failed: HTTP {response.status_code}"
            logger.warning("NewAPI bootstrap failed user_id=%s status=%s", user_id, response.status_code)
            return NewAPIBootstrapResult(success=False, message=message)
        data = response.json()
        if not isinstance(data, dict) or data.get("success") is False:
            logger.warning("NewAPI bootstrap returned unsuccessful payload user_id=%s", user_id)
            return NewAPIBootstrapResult(success=False, message="NewAPI Hub bootstrap returned unsuccessful payload.")
        result = data.get("data") if isinstance(data.get("data"), dict) else data
        if not isinstance(result, dict):
            logger.warning("NewAPI bootstrap returned malformed payload user_id=%s", user_id)
            return NewAPIBootstrapResult(success=False, message="NewAPI Hub bootstrap returned malformed payload.")

        quick_start = result.get("quick_start")
        if isinstance(quick_start, dict):
            raw_relay = quick_start.get("relay_base_url")
            if isinstance(raw_relay, str) and raw_relay.strip():
                relay_base_url = raw_relay.strip()

        system_access_token = _extract_newapi_system_access_token(result)
        if system_access_token:
            await _save_newapi_sync_token(user_id=user_id, system_access_token=system_access_token)
        group_catalog = await _fetch_newapi_hub_group_catalog(
            settings=settings,
            system_access_token=system_access_token,
        )
        requested_groups = _resolve_newapi_bootstrap_groups(
            group_catalog=group_catalog,
            preferred_group=preferred_group,
            first_bootstrap=result,
        )
        group_bootstraps = await _bootstrap_newapi_group_tokens(
            settings=settings,
            authorization_token=system_access_token or access_token,
            groups=requested_groups,
        )
        group_items = await _build_newapi_managed_group_items(
            settings=settings,
            group_catalog=group_catalog,
            group_bootstraps=group_bootstraps,
            relay_base_url=relay_base_url,
        )

        if not group_items:
            legacy_item = _build_legacy_newapi_group_item(
                result=result,
                relay_base_url=relay_base_url,
                preferred_group=preferred_group,
            )
            group_items = [legacy_item] if legacy_item is not None else []

        if not group_items:
            logger.warning("NewAPI bootstrap produced no managed group items user_id=%s", user_id)
            return NewAPIBootstrapResult(success=False, message="NewAPI Hub did not return any usable group or token.")

        async with AsyncSessionLocal() as db:
            existing = await db.execute(select(Settings).where(Settings.user_id == user_id))
            if existing.scalar_one_or_none() is None:
                db.add(Settings(user_id=user_id))
                await db.commit()
            await get_ai_settings_service().apply_managed_newapi_group_bootstrap(
                user_id=user_id,
                groups=group_items,
                db=db,
            )
        managed_groups = tuple(str(item.get("group_id") or "").strip() for item in group_items if item.get("group_id"))
        groups_with_key_count = sum(1 for item in group_items if isinstance(item.get("api_key"), str) and item["api_key"])
        logger.info(
            "NewAPI bootstrap synced user_id=%s groups=%d groups_with_key=%d managed_groups=%s",
            user_id,
            len(group_items),
            groups_with_key_count,
            list(managed_groups),
        )
        return NewAPIBootstrapResult(
            success=True,
            group_count=len(group_items),
            groups_with_key_count=groups_with_key_count,
            managed_groups=managed_groups,
        )
    except Exception:
        logger.exception("NewAPI bootstrap failed user_id=%s", user_id)
        return NewAPIBootstrapResult(success=False, message="NewAPI Hub bootstrap failed unexpectedly.")


def _load_settings_preferences(settings: Settings) -> dict[str, Any]:
    raw = settings.preferences or "{}"
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
    else:
        parsed = raw
    return parsed if isinstance(parsed, dict) else {}


def _save_settings_preferences(settings: Settings, preferences: dict[str, Any]) -> None:
    settings.preferences = json.dumps(preferences, ensure_ascii=False)


def _safe_newapi_group_id(value: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in value.strip().lower())
    normalized = "-".join(part for part in normalized.split("-") if part)
    if normalized:
        return normalized
    raw = value.strip()
    if not raw:
        return "default"
    return f"group-{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def _canonical_newapi_group_id(requested_group: str, token_group: str | None) -> str:
    requested = requested_group.strip()
    token = token_group.strip() if isinstance(token_group, str) else ""
    if token and token.lower() != "default":
        return token
    return requested or token or "default"


def _newapi_provider_id_for_sync_group(group_id: str) -> str:
    safe_group = _safe_newapi_group_id(group_id)
    if safe_group == "default":
        return MANAGED_NEWAPI_PROVIDER_ID
    return f"{MANAGED_NEWAPI_PROVIDER_ID}-{safe_group}"


def _normalize_newapi_group_names(*groups: list[str] | tuple[str, ...] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for values in groups:
        for raw in values or []:
            if not isinstance(raw, str):
                continue
            group = raw.strip()
            if not group:
                continue
            if len(group) > _MAX_GROUP_NAME_LENGTH:
                group = group[:_MAX_GROUP_NAME_LENGTH].strip()
            key = group.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(group)
            if len(normalized) >= _MAX_MANUAL_GROUPS:
                return normalized
    return normalized


async def _save_newapi_sync_token(*, user_id: str, system_access_token: str) -> None:
    token = system_access_token.strip()
    if not token:
        return
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if settings is None:
            settings = Settings(user_id=user_id)
            db.add(settings)
            await db.flush()
        preferences = _load_settings_preferences(settings)
        sync_state = preferences.get(_NEWAPI_SYNC_PREF_KEY)
        if not isinstance(sync_state, dict):
            sync_state = {}
        if is_encryption_enabled():
            sync_state["system_access_token_encrypted"] = encrypt_secret(token)
        else:
            logger.warning("SETTINGS_ENCRYPTION_KEY not configured — NewAPI system token will be stored in plaintext. This is insecure for production deployments.")
            sync_state["system_access_token_encrypted"] = token
        sync_state["updated_at"] = int(time.time())
        preferences[_NEWAPI_SYNC_PREF_KEY] = sync_state
        _save_settings_preferences(settings, preferences)
        await db.commit()


def _read_newapi_sync_token_from_settings(settings: Settings) -> str | None:
    preferences = _load_settings_preferences(settings)
    sync_state = preferences.get(_NEWAPI_SYNC_PREF_KEY)
    if not isinstance(sync_state, dict):
        return None
    encrypted = sync_state.get("system_access_token_encrypted")
    if not isinstance(encrypted, str) or not encrypted.strip():
        return None
    decrypted = safe_decrypt(encrypted.strip())
    if decrypted is not None:
        return decrypted
    return None


async def get_newapi_group_catalog_for_user(*, user_id: str, db=None) -> tuple[dict[str, dict[str, Any]], list[str]]:
    settings = require_newapi_settings()
    warnings: list[str] = []

    async def _inner(db: AsyncSession) -> tuple[dict[str, dict[str, Any]], list[str]]:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        user_settings = result.scalar_one_or_none()
        if user_settings is None:
            warnings.append("当前账号还没有 NewAPI 同步令牌，请重新使用 NewAPI 登录。")
            return {}, warnings
        system_token = _read_newapi_sync_token_from_settings(user_settings)
        if not system_token:
            warnings.append("当前账号缺少 NewAPI 同步令牌，请重新使用 NewAPI 登录。")
            return {}, warnings
        catalog = await _fetch_newapi_hub_group_catalog(settings=settings, system_access_token=system_token)
        if not catalog:
            warnings.append("未从 NewAPI 获取到分组目录，可手动输入分组名同步。")
        return catalog, warnings

    if db is None:
        async with AsyncSessionLocal() as db:
            return await _inner(db)
    return await _inner(db)


async def sync_newapi_groups_for_user(
    *,
    user_id: str,
    groups: list[str] | tuple[str, ...] | None,
    manual_groups: list[str] | tuple[str, ...] | None = None,
    db,
) -> NewAPIManualGroupSyncResult:
    settings = require_newapi_settings()
    selected_groups = _normalize_newapi_group_names(list(groups or []))
    manual_group_names = _normalize_newapi_group_names(list(manual_groups or []))

    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    user_settings = result.scalar_one_or_none()
    if user_settings is None:
        raise NewAPIOAuthError("当前账号还没有 NewAPI 同步状态，请重新使用 NewAPI 登录。", status_code=409)
    system_token = _read_newapi_sync_token_from_settings(user_settings)
    if not system_token:
        raise NewAPIOAuthError("当前账号缺少 NewAPI 同步令牌，请重新使用 NewAPI 登录。", status_code=409)

    catalog = await _fetch_newapi_hub_group_catalog(settings=settings, system_access_token=system_token)
    if not selected_groups and not manual_group_names and catalog:
        selected_groups = _normalize_newapi_group_names(list(catalog.keys()))
    requested_groups = _normalize_newapi_group_names(selected_groups, manual_group_names)
    if not requested_groups:
        raise NewAPIOAuthError("请选择至少一个 NewAPI 分组。", status_code=400)

    bootstraps = await _bootstrap_newapi_group_tokens(
        settings=settings,
        authorization_token=system_token,
        groups=requested_groups,
    )
    relay_base_url = f"{settings.issuer.rstrip('/')}/v1"
    group_items = await _build_newapi_managed_group_items(
        settings=settings,
        group_catalog=catalog,
        group_bootstraps=bootstraps,
        relay_base_url=relay_base_url,
    )

    items_by_requested: dict[str, dict[str, Any]] = {}
    for item in group_items:
        group_id = str(item.get("group_id") or "").strip()
        if group_id:
            items_by_requested[group_id.lower()] = item

    results: list[NewAPIManualGroupSyncItem] = []
    for group in requested_groups:
        item = items_by_requested.get(group.lower())
        if item is None:
            bootstrap_error = bootstraps.get(group, {}).get("model_sync_error") if isinstance(bootstraps.get(group), dict) else None
            results.append(
                NewAPIManualGroupSyncItem(
                    group_id=group,
                    provider_id=_newapi_provider_id_for_sync_group(group),
                    model_count=0,
                    has_api_key=False,
                    status="error",
                    error=str(bootstrap_error or f"NewAPI 分组 {group} 同步失败"),
                )
            )
            continue
        models = _normalize_newapi_model_list(item.get("models"))
        status = str(item.get("model_sync_status") or ("synced" if models else "empty"))
        error = item.get("model_sync_error") if isinstance(item.get("model_sync_error"), str) else None
        group_id = str(item.get("group_id") or group).strip() or group
        results.append(
            NewAPIManualGroupSyncItem(
                group_id=group_id,
                provider_id=_newapi_provider_id_for_sync_group(group_id),
                model_count=len(models),
                has_api_key=bool(_extract_newapi_token_key(bootstraps.get(group, {})) or item.get("api_key")),
                status=status,
                error=error,
            )
        )

    persistable_items = [item for item in group_items if isinstance(item.get("group_id"), str) and item.get("group_id")]
    if persistable_items:
        await get_ai_settings_service().apply_managed_newapi_group_bootstrap(
            user_id=user_id,
            groups=persistable_items,
            db=db,
        )

    logger.info(
        "NewAPI manual group sync user_id=%s requested_groups=%s persisted_groups=%s",
        user_id,
        requested_groups,
        [str(item.get("group_id")) for item in persistable_items],
    )
    return NewAPIManualGroupSyncResult(results=tuple(results), group_items=tuple(persistable_items))


def _extract_newapi_system_access_token(result: dict[str, Any]) -> str | None:
    bearer = result.get("system_access_token_bearer")
    if isinstance(bearer, str) and bearer.strip():
        token = bearer.strip()
        if token.lower().startswith("bearer "):
            return token[7:].strip()
        return token
    token = result.get("system_access_token")
    return token.strip() if isinstance(token, str) and token.strip() else None


def _extract_newapi_token_key(result: dict[str, Any]) -> str | None:
    hub_token = result.get("hub_api_token")
    if not isinstance(hub_token, dict):
        return None
    raw_authorization = hub_token.get("authorization")
    if isinstance(raw_authorization, str) and raw_authorization.strip():
        auth_value = raw_authorization.strip()
        if auth_value.lower().startswith("bearer "):
            token = auth_value[7:].strip()
            if token:
                return token
    raw_key = hub_token.get("key") or hub_token.get("sk_key")
    return raw_key.strip() if isinstance(raw_key, str) and raw_key.strip() else None


def _extract_newapi_token_group(result: dict[str, Any], fallback: str | None = None) -> str | None:
    hub_token = result.get("hub_api_token")
    if isinstance(hub_token, dict):
        raw_group = hub_token.get("group")
        if isinstance(raw_group, str) and raw_group.strip():
            return raw_group.strip()
    return fallback.strip() if isinstance(fallback, str) and fallback.strip() else None


def _normalize_newapi_model_list(raw_models: Any) -> list[str]:
    if not isinstance(raw_models, list):
        return []
    return sorted({item.strip() for item in raw_models if isinstance(item, str) and item.strip()})


async def _fetch_newapi_hub_group_catalog(
    *,
    settings: NewAPIOAuthSettings,
    system_access_token: str | None,
) -> dict[str, dict[str, Any]]:
    if not system_access_token:
        return {}
    groups_url = f"{settings.issuer.rstrip('/')}/api/hub/user/groups"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                groups_url,
                headers={"Authorization": f"Bearer {system_access_token}", "Accept": "application/json"},
            )
        if response.status_code != 200:
            return {}
        data = response.json()
    except Exception as e:
        logger.warning("Failed to fetch NewAPI hub group catalog: %s", e)
        return {}

    payload = data.get("data") if isinstance(data, dict) else None
    if not isinstance(payload, dict):
        return {}
    raw_groups = payload.get("groups") if isinstance(payload.get("groups"), dict) else payload
    if not isinstance(raw_groups, dict):
        return {}

    catalog: dict[str, dict[str, Any]] = {}
    for group_id, group_payload in raw_groups.items():
        group_name = str(group_id).strip()
        if not group_name:
            continue
        if isinstance(group_payload, dict):
            display_name = group_payload.get("name") or group_payload.get("desc") or group_name
            models = _normalize_newapi_model_list(group_payload.get("models"))
        else:
            display_name = group_name
            models = []
        catalog[group_name] = {"name": str(display_name or group_name), "models": models}
    return catalog


def _resolve_newapi_bootstrap_groups(
    *,
    group_catalog: dict[str, dict[str, Any]],
    preferred_group: str | None,
    first_bootstrap: dict[str, Any],
) -> list[str]:
    groups = [group for group in group_catalog.keys() if group.strip()]
    if groups:
        return sorted(dict.fromkeys(groups))

    user = first_bootstrap.get("user")
    if isinstance(user, dict):
        user_group = user.get("group")
        if isinstance(user_group, str) and user_group.strip():
            return [user_group.strip()]

    token_group = _extract_newapi_token_group(first_bootstrap, preferred_group)
    if token_group:
        return [token_group]

    return ["default"]


async def _bootstrap_newapi_group_tokens(
    *,
    settings: NewAPIOAuthSettings,
    authorization_token: str,
    groups: list[str],
) -> dict[str, dict[str, Any]]:
    bootstrap_url = f"{settings.issuer.rstrip('/')}/api/hub/session/bootstrap"
    results: dict[str, dict[str, Any]] = {}
    async with httpx.AsyncClient(timeout=15.0) as client:
        for group in groups:
            payload: dict[str, Any] = {
                "client_id": settings.client_id,
                "site_name": "Miaowu OS",
                "token_name": f"Miaowu OS Local {group}",
                "group": group,
            }
            try:
                response = await client.post(
                    bootstrap_url,
                    json=payload,
                    headers={"Authorization": f"Bearer {authorization_token}", "Accept": "application/json"},
                )
                if response.status_code != 200:
                    results[group] = {
                        "group": group,
                        "model_sync_status": "error",
                        "model_sync_error": f"NewAPI 分组 {group} 引导失败：HTTP {response.status_code}",
                    }
                    continue
                data = response.json()
                result = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), dict) else data
                if isinstance(result, dict):
                    results[group] = result
            except Exception:
                results[group] = {
                    "group": group,
                    "model_sync_status": "error",
                    "model_sync_error": f"NewAPI 分组 {group} 引导失败",
                }
    return results


async def _fetch_newapi_models_with_token(*, relay_base_url: str, api_key: str | None) -> NewAPIModelFetchResult:
    if not api_key:
        return NewAPIModelFetchResult(error="NewAPI Hub 没有返回该分组的 API Token")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{relay_base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            )
        if response.status_code != 200:
            return NewAPIModelFetchResult(
                status_code=response.status_code,
                error=f"NewAPI /v1/models 返回 HTTP {response.status_code}",
            )
        data = response.json()
    except Exception as e:
        logger.warning("Failed to fetch NewAPI models: %s", e)
        return NewAPIModelFetchResult(error="NewAPI /v1/models 请求失败")
    raw_models = data.get("data") if isinstance(data, dict) else None
    models: list[str] = []
    if isinstance(raw_models, list):
        for item in raw_models:
            if isinstance(item, dict):
                model_id = item.get("id")
                if isinstance(model_id, str) and model_id.strip():
                    models.append(model_id.strip())
            elif isinstance(item, str) and item.strip():
                models.append(item.strip())
    return NewAPIModelFetchResult(models=tuple(sorted(dict.fromkeys(models))))


def _newapi_bootstrap_diagnostic_error(bootstrap: dict[str, Any]) -> str | None:
    if bootstrap.get("has_novel_product_access") is False:
        return "NewAPI 账号没有小说产品访问权限，Hub 不会创建分组 API Token 或返回可用模型"
    hub_token = bootstrap.get("hub_api_token")
    if isinstance(hub_token, dict):
        provisioning = hub_token.get("provisioning")
        if isinstance(provisioning, str) and provisioning.strip() and provisioning != "created" and provisioning != "reuse_named_token":
            return f"NewAPI Hub Token 未可用：{provisioning.strip()}"
    return None


async def _build_newapi_managed_group_items(
    *,
    settings: NewAPIOAuthSettings,
    group_catalog: dict[str, dict[str, Any]],
    group_bootstraps: dict[str, dict[str, Any]],
    relay_base_url: str,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for group, bootstrap in group_bootstraps.items():
        token_key = _extract_newapi_token_key(bootstrap)
        token_group = _canonical_newapi_group_id(group, _extract_newapi_token_group(bootstrap, None))
        quick_start = bootstrap.get("quick_start")
        group_relay_base_url = relay_base_url
        if isinstance(quick_start, dict):
            raw_relay = quick_start.get("relay_base_url")
            if isinstance(raw_relay, str) and raw_relay.strip():
                group_relay_base_url = raw_relay.strip()

        model_fetch = await _fetch_newapi_models_with_token(relay_base_url=group_relay_base_url, api_key=token_key)
        models = list(model_fetch.models)
        catalog_item = group_catalog.get(token_group) or group_catalog.get(group) or {}
        if not models:
            models = _normalize_newapi_model_list(catalog_item.get("models"))

        status = bootstrap.get("model_sync_status") if isinstance(bootstrap.get("model_sync_status"), str) else None
        error = bootstrap.get("model_sync_error") if isinstance(bootstrap.get("model_sync_error"), str) else None
        if not error:
            error = _newapi_bootstrap_diagnostic_error(bootstrap)
        if not error and not models:
            error = model_fetch.error
        if not status:
            status = "synced" if models else ("error" if error else "empty")
        if error and not models and status == "synced":
            status = "error"
        if status == "empty" and not error:
            error = f"NewAPI 分组 {token_group} 没有返回可用模型"

        items.append(
            {
                "group_id": token_group,
                "name": catalog_item.get("name") or token_group,
                "base_url": group_relay_base_url or f"{settings.issuer.rstrip('/')}/v1",
                "api_key": token_key,
                "models": models,
                "model_groups": {token_group: models} if models else {},
                "model_sync_status": status,
                "model_sync_error": error,
            }
        )
    return items


def _build_legacy_newapi_group_item(
    *,
    result: dict[str, Any],
    relay_base_url: str,
    preferred_group: str | None,
) -> dict[str, Any] | None:
    models = _normalize_newapi_model_list(result.get("models"))
    token_key = _extract_newapi_token_key(result)
    token_group = _extract_newapi_token_group(result, preferred_group) or "default"
    if not models and not token_key:
        return None
    return {
        "group_id": token_group,
        "name": token_group,
        "base_url": relay_base_url,
        "api_key": token_key,
        "models": models,
        "model_groups": {token_group: models} if models else {},
        "model_sync_status": "synced" if models else "empty",
        "model_sync_error": None if models else "NewAPI 登录成功，但 Hub 没有返回可用模型",
    }


async def exchange_code_for_token(settings: NewAPIOAuthSettings, token_endpoint: str, code: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            token_endpoint,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.redirect_uri,
            },
            auth=(settings.client_id, settings.client_secret),
            headers={"Accept": "application/json"},
        )
    if response.status_code != 200:
        detail = _oauth_error_detail(response)
        if response.status_code == 401 and "invalid_client" in detail:
            detail = f"{detail}; check NEWAPI_OAUTH_CLIENT_SECRET and provider CRYPTO_SECRET/SESSION_SECRET alignment."
        raise NewAPIOAuthError(f"NewAPI token exchange failed: {detail}", status_code=502)
    data = response.json()
    if not isinstance(data, dict):
        raise NewAPIOAuthError("NewAPI token response is malformed.", status_code=502)
    return data


async def fetch_newapi_userinfo(userinfo_endpoint: str, access_token: str) -> NewAPIUserInfo:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            userinfo_endpoint,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if response.status_code != 200:
        raise NewAPIOAuthError(f"NewAPI userinfo request failed: {_oauth_error_detail(response)}", status_code=502)
    return NewAPIUserInfo.model_validate(response.json())


async def resolve_or_create_local_user(provider, userinfo: NewAPIUserInfo) -> User:
    existing = await provider.get_user_by_oauth(NEWAPI_PROVIDER, userinfo.sub)
    if existing is not None:
        return existing

    email = _normalize_local_email(userinfo)
    by_email = await provider.get_user_by_email(email)
    if by_email is not None:
        if by_email.oauth_provider and (
            by_email.oauth_provider != NEWAPI_PROVIDER or by_email.oauth_id != userinfo.sub
        ):
            raise NewAPIOAuthError("Local account email is already bound to another OAuth identity.", status_code=409)
        by_email.oauth_provider = NEWAPI_PROVIDER
        by_email.oauth_id = userinfo.sub
        return await provider.update_user(by_email)

    system_role = "admin" if newapi_user_is_admin(userinfo) else "user"
    return await provider.create_oauth_user(
        email=email,
        provider=NEWAPI_PROVIDER,
        oauth_id=userinfo.sub,
        system_role=system_role,
    )


def _normalize_local_email(userinfo: NewAPIUserInfo) -> str:
    candidate = (userinfo.email or "").strip().lower()
    if candidate:
        try:
            return str(_EMAIL_ADAPTER.validate_python(candidate)).lower()
        except ValidationError:
            pass
    safe_sub = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in userinfo.sub.lower()).strip("-_")
    safe_sub = safe_sub or secrets.token_urlsafe(8)
    return f"newapi-{safe_sub}@newapi.miaowu.bond"


def _oauth_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:300] or f"HTTP {response.status_code}"
    if isinstance(data, dict):
        error = data.get("error")
        description = data.get("error_description")
        if error and description:
            return f"{error}: {description}"
        if error:
            return str(error)
    return str(data)[:300]
