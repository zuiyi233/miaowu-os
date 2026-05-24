"""Tests for NewAPI OIDC account linking."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.gateway.auth.models import User
from app.gateway.auth.newapi_oauth import (
    NEWAPI_PROVIDER,
    NewAPIBootstrapResult,
    NewAPIOAuthError,
    NewAPIOAuthSettings,
    NewAPIUserInfo,
    _normalize_local_email,
    bootstrap_user_ai_settings_from_newapi,
    build_frontend_redirect_url,
    build_newapi_authorize_url,
    create_newapi_state,
    exchange_code_for_token,
    exchange_newapi_code_for_user,
    newapi_user_is_admin,
    resolve_or_create_local_user,
    sync_newapi_system_role,
    validate_newapi_state,
)


def test_newapi_state_round_trip(monkeypatch):
    monkeypatch.setenv("AUTH_JWT_SECRET", "state-secret-for-newapi-tests-32-chars")
    state = create_newapi_state("/workspace?tab=account")

    assert validate_newapi_state(state) == "/workspace?tab=account"


def test_newapi_state_rejects_tampering(monkeypatch):
    monkeypatch.setenv("AUTH_JWT_SECRET", "state-secret-for-newapi-tests-32-chars")
    state = create_newapi_state("/workspace")

    with pytest.raises(NewAPIOAuthError):
        validate_newapi_state(state + "x")


def test_build_frontend_redirect_url_defaults_to_relative(monkeypatch):
    monkeypatch.delenv("MIAOWU_PUBLIC_FRONTEND_URL", raising=False)

    assert build_frontend_redirect_url("/workspace") == "/workspace"


def test_build_frontend_redirect_url_uses_public_frontend_base(monkeypatch):
    monkeypatch.setenv("MIAOWU_PUBLIC_FRONTEND_URL", "http://127.0.0.1:14560/")

    assert build_frontend_redirect_url("/workspace") == "http://127.0.0.1:14560/workspace"


def test_build_frontend_redirect_url_rejects_external_next(monkeypatch):
    monkeypatch.setenv("MIAOWU_PUBLIC_FRONTEND_URL", "http://127.0.0.1:14560")

    assert build_frontend_redirect_url("https://evil.example/phish") == "http://127.0.0.1:14560/workspace"


def test_build_newapi_authorize_url(monkeypatch):
    monkeypatch.setenv("AUTH_JWT_SECRET", "state-secret-for-newapi-tests-32-chars")
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("NEWAPI_OAUTH_ISSUER", "https://newapi.example")
    monkeypatch.setenv("NEWAPI_OAUTH_CLIENT_ID", "oidc_client")
    monkeypatch.setenv("NEWAPI_OAUTH_CLIENT_SECRET", "oidc_secret")

    import app.gateway.auth.newapi_oauth as newapi_oauth

    async def fake_discovery(_settings):
        return {"authorization_endpoint": "https://newapi.example/oauth/authorize"}

    monkeypatch.setattr(newapi_oauth, "fetch_newapi_discovery", fake_discovery)

    url = asyncio.run(build_newapi_authorize_url("/workspace"))

    assert url.startswith("https://newapi.example/oauth/authorize?")
    assert "client_id=oidc_client" in url
    assert "response_type=code" in url
    assert "scope=openid+profile+email" in url
    assert "redirect_uri=http%3A%2F%2F127.0.0.1%3A8551%2Fapi%2Fv1%2Fauth%2Fcallback%2Fnewapi" in url
    assert "state=" in url


def test_build_newapi_authorize_url_uses_public_issuer(monkeypatch):
    monkeypatch.setenv("AUTH_JWT_SECRET", "state-secret-for-newapi-tests-32-chars")
    monkeypatch.setenv("NEWAPI_OAUTH_ENABLED", "true")
    monkeypatch.setenv("NEWAPI_OAUTH_ISSUER", "http://newapi-internal:3000")
    monkeypatch.setenv("NEWAPI_OAUTH_PUBLIC_ISSUER", "https://newapi.example")
    monkeypatch.setenv("NEWAPI_OAUTH_CLIENT_ID", "oidc_client")
    monkeypatch.setenv("NEWAPI_OAUTH_CLIENT_SECRET", "oidc_secret")

    import app.gateway.auth.newapi_oauth as newapi_oauth

    async def fake_discovery(_settings):
        return {"authorization_endpoint": "http://newapi-internal:3000/oauth/authorize"}

    monkeypatch.setattr(newapi_oauth, "fetch_newapi_discovery", fake_discovery)

    url = asyncio.run(build_newapi_authorize_url("/workspace"))

    assert url.startswith("https://newapi.example/oauth/authorize?")
    assert "client_id=oidc_client" in url


def test_exchange_code_invalid_client_has_diagnostic_message(monkeypatch):
    class FakeResponse:
        status_code = 401
        text = ""

        def json(self):
            return {"error": "invalid_client", "error_description": "invalid client credentials"}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    import app.gateway.auth.newapi_oauth as newapi_oauth

    monkeypatch.setattr(newapi_oauth.httpx, "AsyncClient", FakeClient)
    settings = NewAPIOAuthSettings(
        enabled=True,
        issuer="https://newapi.example",
        client_id="oidc_client",
        client_secret="oidc_secret",
    )

    with pytest.raises(NewAPIOAuthError) as exc:
        asyncio.run(exchange_code_for_token(settings, "https://newapi.example/oauth/token", "bad-code"))

    assert "invalid_client" in exc.value.message
    assert "CRYPTO_SECRET" in exc.value.message


def test_resolve_newapi_user_creates_shadow_user():
    provider = MagicMock()
    provider.get_user_by_oauth = AsyncMock(return_value=None)
    provider.get_user_by_email = AsyncMock(return_value=None)
    created = User(
        id=uuid4(),
        email="newapi@example.com",
        password_hash=None,
        oauth_provider=NEWAPI_PROVIDER,
        oauth_id="42",
    )
    provider.create_oauth_user = AsyncMock(return_value=created)
    userinfo = NewAPIUserInfo(sub="42", email="newapi@example.com")

    result = asyncio.run(resolve_or_create_local_user(provider, userinfo))

    assert result == created
    provider.create_oauth_user.assert_awaited_once_with(
        email="newapi@example.com",
        provider=NEWAPI_PROVIDER,
        oauth_id="42",
        system_role="user",
    )


def test_resolve_newapi_user_binds_existing_email():
    existing = User(id=uuid4(), email="newapi@example.com", password_hash="hash")
    provider = MagicMock()
    provider.get_user_by_oauth = AsyncMock(return_value=None)
    provider.get_user_by_email = AsyncMock(return_value=existing)
    provider.update_user = AsyncMock(return_value=existing)
    userinfo = NewAPIUserInfo(sub="42", email="newapi@example.com")

    result = asyncio.run(resolve_or_create_local_user(provider, userinfo))

    assert result.oauth_provider == NEWAPI_PROVIDER
    assert result.oauth_id == "42"
    provider.update_user.assert_awaited_once()


def test_newapi_admin_sub_allowlist_promotes_new_shadow_user(monkeypatch):
    monkeypatch.setenv("NEWAPI_OAUTH_ADMIN_SUBS", "42, 100")
    provider = MagicMock()
    provider.get_user_by_oauth = AsyncMock(return_value=None)
    provider.get_user_by_email = AsyncMock(return_value=None)
    created = User(
        id=uuid4(),
        email="newapi@example.com",
        password_hash=None,
        oauth_provider=NEWAPI_PROVIDER,
        oauth_id="42",
        system_role="admin",
    )
    provider.create_oauth_user = AsyncMock(return_value=created)
    userinfo = NewAPIUserInfo(sub="42", email="newapi@example.com")

    result = asyncio.run(resolve_or_create_local_user(provider, userinfo))

    assert result.system_role == "admin"
    provider.create_oauth_user.assert_awaited_once_with(
        email="newapi@example.com",
        provider=NEWAPI_PROVIDER,
        oauth_id="42",
        system_role="admin",
    )


def test_newapi_userinfo_claims_can_mark_admin(monkeypatch):
    monkeypatch.delenv("NEWAPI_OAUTH_ADMIN_SUBS", raising=False)
    monkeypatch.delenv("NEWAPI_OAUTH_ADMIN_IDENTITIES", raising=False)

    assert newapi_user_is_admin(NewAPIUserInfo(sub="1", is_admin=True))
    assert newapi_user_is_admin(NewAPIUserInfo(sub="2", role="admin"))
    assert newapi_user_is_admin(NewAPIUserInfo(sub="3", roles=["writer", "owner"]))
    assert newapi_user_is_admin(NewAPIUserInfo(sub="4", group="administrator"))
    assert newapi_user_is_admin(NewAPIUserInfo(sub="5", groups="users,root"))
    assert not newapi_user_is_admin(NewAPIUserInfo(sub="6", roles=["user"]))


def test_sync_newapi_system_role_promotes_existing_user(monkeypatch):
    monkeypatch.setenv("NEWAPI_OAUTH_ADMIN_SUBS", "42")
    user = User(
        id=uuid4(),
        email="newapi@example.com",
        password_hash=None,
        oauth_provider=NEWAPI_PROVIDER,
        oauth_id="42",
        system_role="user",
    )
    promoted = user.model_copy(update={"system_role": "admin"})
    provider = MagicMock()
    provider.update_user = AsyncMock(return_value=promoted)

    result = asyncio.run(sync_newapi_system_role(provider, user, NewAPIUserInfo(sub="42")))

    assert result.system_role == "admin"
    provider.update_user.assert_awaited_once()


def test_sync_newapi_system_role_does_not_demote_by_default(monkeypatch):
    monkeypatch.delenv("NEWAPI_OAUTH_ADMIN_SUBS", raising=False)
    monkeypatch.delenv("NEWAPI_OAUTH_SYNC_ADMIN_DOWNGRADE", raising=False)
    user = User(
        id=uuid4(),
        email="newapi@example.com",
        password_hash=None,
        oauth_provider=NEWAPI_PROVIDER,
        oauth_id="42",
        system_role="admin",
    )
    provider = MagicMock()
    provider.update_user = AsyncMock()

    result = asyncio.run(sync_newapi_system_role(provider, user, NewAPIUserInfo(sub="42")))

    assert result.system_role == "admin"
    provider.update_user.assert_not_awaited()


def test_resolve_newapi_user_rejects_conflicting_oauth_email():
    existing = User(
        id=uuid4(),
        email="newapi@example.com",
        password_hash=None,
        oauth_provider="github",
        oauth_id="abc",
    )
    provider = MagicMock()
    provider.get_user_by_oauth = AsyncMock(return_value=None)
    provider.get_user_by_email = AsyncMock(return_value=existing)
    userinfo = NewAPIUserInfo(sub="42", email="newapi@example.com")

    with pytest.raises(NewAPIOAuthError) as exc:
        asyncio.run(resolve_or_create_local_user(provider, userinfo))

    assert exc.value.status_code == 409


def test_normalize_local_email_falls_back_for_reserved_provider_domain():
    userinfo = NewAPIUserInfo(sub="932521", email="miaowu31test@example.invalid")

    assert _normalize_local_email(userinfo) == "newapi-932521@newapi.miaowu.bond"


def test_bootstrap_user_ai_settings_reports_hub_bootstrap_failure(monkeypatch):
    class FakeResponse:
        status_code = 500

        def json(self):
            return {"success": False}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    import app.gateway.auth.newapi_oauth as newapi_oauth

    monkeypatch.setattr(newapi_oauth.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(
        bootstrap_user_ai_settings_from_newapi(
            user_id="user-1",
            settings=NewAPIOAuthSettings(
                enabled=True,
                issuer="https://newapi.example",
                client_id="oidc_client",
                client_secret="oidc_secret",
            ),
            access_token="oidc-token",
            preferred_group="default",
        )
    )

    assert result.success is False
    assert "HTTP 500" in (result.message or "")


def test_exchange_newapi_code_fails_when_ai_settings_bootstrap_fails(monkeypatch):
    import app.gateway.auth.newapi_oauth as newapi_oauth

    settings = NewAPIOAuthSettings(
        enabled=True,
        issuer="https://newapi.example",
        client_id="oidc_client",
        client_secret="oidc_secret",
    )
    user = User(
        id=uuid4(),
        email="newapi@example.com",
        password_hash=None,
        oauth_provider=NEWAPI_PROVIDER,
        oauth_id="42",
    )
    provider = MagicMock()
    provider.upsert_newapi_snapshot = AsyncMock(return_value=None)

    monkeypatch.setattr(newapi_oauth, "require_newapi_settings", lambda: settings)
    monkeypatch.setattr(newapi_oauth, "validate_newapi_state", lambda _state: "/workspace")
    monkeypatch.setattr(
        newapi_oauth,
        "fetch_newapi_discovery",
        AsyncMock(return_value={"token_endpoint": "https://newapi.example/oauth/token"}),
    )
    monkeypatch.setattr(newapi_oauth, "exchange_code_for_token", AsyncMock(return_value={"access_token": "oidc-token"}))
    monkeypatch.setattr(
        newapi_oauth,
        "fetch_newapi_userinfo",
        AsyncMock(return_value=NewAPIUserInfo(sub="42", email="newapi@example.com", group="default")),
    )
    monkeypatch.setattr(newapi_oauth, "resolve_or_create_local_user", AsyncMock(return_value=user))
    monkeypatch.setattr(newapi_oauth, "sync_newapi_system_role", AsyncMock(return_value=user))
    monkeypatch.setattr(
        newapi_oauth,
        "bootstrap_user_ai_settings_from_newapi",
        AsyncMock(return_value=NewAPIBootstrapResult(success=False, message="bootstrap failed")),
    )

    with pytest.raises(NewAPIOAuthError) as exc:
        asyncio.run(exchange_newapi_code_for_user("code", "state", provider))

    assert "bootstrap failed" in exc.value.message
