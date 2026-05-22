"""NewAPI OIDC consumer integration for Miaowu local sessions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, EmailStr, Field, TypeAdapter, ValidationError

from app.gateway.auth.config import get_auth_config
from app.gateway.auth.models import NewAPIAccountSnapshot, User

NEWAPI_PROVIDER = "newapi"
_STATE_TTL_SECONDS = 10 * 60
_DEFAULT_SCOPES = "openid profile email"
_DEFAULT_REDIRECT_URI = "http://127.0.0.1:8551/api/v1/auth/callback/newapi"
_EMAIL_ADAPTER = TypeAdapter(EmailStr)


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


def validate_next_path(value: str | None) -> str:
    if not value:
        return "/workspace"
    if not value.startswith("/") or value.startswith("//"):
        return "/workspace"
    if ":" in value and not value.startswith("/"):
        return "/workspace"
    return value


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
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        response = await client.get(settings.discovery_url)
    if response.status_code != 200:
        raise NewAPIOAuthError("Failed to fetch NewAPI OIDC discovery document.", status_code=502)
    data = response.json()
    if not isinstance(data, dict):
        raise NewAPIOAuthError("NewAPI OIDC discovery document is malformed.", status_code=502)
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
    return NewAPILoginResult(user=user, snapshot=snapshot, next_path=next_path)


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

    return await provider.create_oauth_user(email=email, provider=NEWAPI_PROVIDER, oauth_id=userinfo.sub)


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
