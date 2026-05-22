"""Tests for NewAPI OIDC account linking."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.gateway.auth.models import User
from app.gateway.auth.newapi_oauth import (
    NEWAPI_PROVIDER,
    NewAPIOAuthError,
    NewAPIOAuthSettings,
    NewAPIUserInfo,
    _normalize_local_email,
    build_newapi_authorize_url,
    create_newapi_state,
    exchange_code_for_token,
    resolve_or_create_local_user,
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
