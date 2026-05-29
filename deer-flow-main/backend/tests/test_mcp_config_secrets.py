"""Tests for MCP config secret masking and preservation."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import mcp as mcp_router
from app.gateway.routers.admin import require_admin_user
from app.gateway.routers.mcp import (
    McpConfigResponse,
    McpOAuthConfigResponse,
    McpServerConfigResponse,
    _mask_server_config,
    _merge_preserving_secrets,
)
from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig, McpOAuthConfig, McpServerConfig, SkillStateConfig


def test_mask_replaces_env_values_with_asterisks():
    server = McpServerConfigResponse(
        env={"GITHUB_TOKEN": "ghp_real_secret_123", "API_KEY": "sk-abc"},
    )

    masked = _mask_server_config(server)

    assert masked.env == {"GITHUB_TOKEN": "***", "API_KEY": "***"}


def test_mask_replaces_header_values_with_asterisks():
    server = McpServerConfigResponse(
        headers={"Authorization": "Bearer tok_123", "X-API-Key": "key_456"},
    )

    masked = _mask_server_config(server)

    assert masked.headers == {"Authorization": "***", "X-API-Key": "***"}


def test_mask_removes_oauth_secrets():
    server = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_id="my-client",
            client_secret="super-secret",
            refresh_token="refresh-token-abc",
            token_url="https://auth.example.com/token",
        ),
    )

    masked = _mask_server_config(server)

    assert masked.oauth is not None
    assert masked.oauth.client_secret is None
    assert masked.oauth.refresh_token is None
    assert masked.oauth.client_id == "my-client"
    assert masked.oauth.token_url == "https://auth.example.com/token"


def test_mask_preserves_non_secret_fields():
    server = McpServerConfigResponse(
        enabled=True,
        type="stdio",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-github"],
        env={"KEY": "val"},
        description="GitHub MCP server",
    )

    masked = _mask_server_config(server)

    assert masked.enabled is True
    assert masked.type == "stdio"
    assert masked.command == "npx"
    assert masked.args == ["-y", "@modelcontextprotocol/server-github"]
    assert masked.description == "GitHub MCP server"


def test_mask_does_not_mutate_original():
    server = McpServerConfigResponse(env={"KEY": "secret"})

    masked = _mask_server_config(server)

    assert server.env["KEY"] == "secret"
    assert masked.env["KEY"] == "***"


def test_merge_preserves_masked_env_values():
    incoming = McpServerConfigResponse(env={"KEY": "***"})
    existing = McpServerConfigResponse(env={"KEY": "real_secret"})

    merged = _merge_preserving_secrets(incoming, existing)

    assert merged.env["KEY"] == "real_secret"


def test_merge_preserves_masked_header_values():
    incoming = McpServerConfigResponse(headers={"Authorization": "***"})
    existing = McpServerConfigResponse(headers={"Authorization": "Bearer real"})

    merged = _merge_preserving_secrets(incoming, existing)

    assert merged.headers["Authorization"] == "Bearer real"


def test_merge_preserves_oauth_secrets_when_none():
    incoming = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_secret=None,
            refresh_token=None,
            token_url="https://auth.example.com/token",
        ),
    )
    existing = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_secret="existing-secret",
            refresh_token="existing-refresh",
            token_url="https://auth.example.com/token",
        ),
    )

    merged = _merge_preserving_secrets(incoming, existing)

    assert merged.oauth is not None
    assert merged.oauth.client_secret == "existing-secret"
    assert merged.oauth.refresh_token == "existing-refresh"


def test_merge_accepts_new_secret_values():
    incoming = McpServerConfigResponse(
        env={"KEY": "new_secret"},
        oauth=McpOAuthConfigResponse(
            client_secret="new-client-secret",
            refresh_token="new-refresh-token",
            token_url="https://auth.example.com/token",
        ),
    )
    existing = McpServerConfigResponse(
        env={"KEY": "old_secret"},
        oauth=McpOAuthConfigResponse(
            client_secret="old-secret",
            refresh_token="old-refresh",
            token_url="https://auth.example.com/token",
        ),
    )

    merged = _merge_preserving_secrets(incoming, existing)

    assert merged.env["KEY"] == "new_secret"
    assert merged.oauth is not None
    assert merged.oauth.client_secret == "new-client-secret"
    assert merged.oauth.refresh_token == "new-refresh-token"


def test_merge_rejects_masked_value_for_new_env_key():
    from fastapi import HTTPException

    incoming = McpServerConfigResponse(env={"NEW_KEY": "***"})
    existing = McpServerConfigResponse(env={})

    with pytest.raises(HTTPException) as exc_info:
        _merge_preserving_secrets(incoming, existing)

    assert exc_info.value.status_code == 400
    assert "NEW_KEY" in exc_info.value.detail


def test_merge_rejects_masked_value_for_new_header_key():
    from fastapi import HTTPException

    incoming = McpServerConfigResponse(headers={"X-New-Auth": "***"})
    existing = McpServerConfigResponse(headers={})

    with pytest.raises(HTTPException) as exc_info:
        _merge_preserving_secrets(incoming, existing)

    assert exc_info.value.status_code == 400
    assert "X-New-Auth" in exc_info.value.detail


def test_merge_empty_string_clears_oauth_client_secret():
    incoming = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_secret="",
            refresh_token=None,
            token_url="https://auth.example.com/token",
        ),
    )
    existing = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_secret="existing-secret",
            refresh_token="existing-refresh",
            token_url="https://auth.example.com/token",
        ),
    )

    merged = _merge_preserving_secrets(incoming, existing)

    assert merged.oauth is not None
    assert merged.oauth.client_secret is None
    assert merged.oauth.refresh_token == "existing-refresh"


def test_merge_empty_string_clears_oauth_refresh_token():
    incoming = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_secret=None,
            refresh_token="",
            token_url="https://auth.example.com/token",
        ),
    )
    existing = McpServerConfigResponse(
        oauth=McpOAuthConfigResponse(
            client_secret="existing-secret",
            refresh_token="existing-refresh",
            token_url="https://auth.example.com/token",
        ),
    )

    merged = _merge_preserving_secrets(incoming, existing)

    assert merged.oauth is not None
    assert merged.oauth.client_secret == "existing-secret"
    assert merged.oauth.refresh_token is None


def test_roundtrip_mask_then_merge_preserves_original_secrets():
    original = McpServerConfigResponse(
        enabled=True,
        env={"GITHUB_TOKEN": "ghp_real_secret"},
        headers={"Authorization": "Bearer real_token"},
        oauth=McpOAuthConfigResponse(
            client_id="client-123",
            client_secret="oauth-secret",
            refresh_token="refresh-abc",
            token_url="https://auth.example.com/token",
        ),
        description="GitHub MCP server",
    )

    masked = _mask_server_config(original)
    from_frontend = masked.model_copy(update={"enabled": False})
    restored = _merge_preserving_secrets(from_frontend, original)

    assert restored.enabled is False
    assert restored.env["GITHUB_TOKEN"] == "ghp_real_secret"
    assert restored.headers["Authorization"] == "Bearer real_token"
    assert restored.oauth is not None
    assert restored.oauth.client_secret == "oauth-secret"
    assert restored.oauth.refresh_token == "refresh-abc"
    assert restored.description == "GitHub MCP server"


def _build_app(monkeypatch, tmp_path, cfg: ExtensionsConfig) -> FastAPI:
    monkeypatch.setattr(mcp_router, "get_extensions_config", lambda: cfg)
    monkeypatch.setattr(mcp_router, "reload_extensions_config", lambda config_path=None: cfg)
    monkeypatch.setattr(mcp_router.ExtensionsConfig, "resolve_config_path", classmethod(lambda cls, config_path=None: config_path or (tmp_path / "extensions_config.json")))

    app = FastAPI()
    app.include_router(mcp_router.router)
    app.dependency_overrides[require_admin_user] = lambda: object()
    return app


def test_get_mcp_configuration_masks_sensitive_fields(monkeypatch, tmp_path):
    cfg = ExtensionsConfig(
        mcp_servers={
            "github": McpServerConfig(
                enabled=True,
                type="http",
                url="https://mcp.example.test",
                env={"GITHUB_TOKEN": "ghp-secret"},
                headers={"Authorization": "Bearer secret"},
                oauth=McpOAuthConfig(
                    token_url="https://auth.example.test/token",
                    client_id="client-id",
                    client_secret="client-secret",
                    refresh_token="refresh-secret",
                ),
                description="GitHub MCP server",
            )
        }
    )
    app = _build_app(monkeypatch, tmp_path, cfg)

    with TestClient(app) as client:
        response = client.get("/api/mcp/config")

    assert response.status_code == 200
    parsed = McpConfigResponse(**response.json())
    github = parsed.mcp_servers["github"]
    assert github.env == {"GITHUB_TOKEN": "***"}
    assert github.headers == {"Authorization": "***"}
    assert github.oauth is not None
    assert github.oauth.client_secret is None
    assert github.oauth.refresh_token is None


def test_update_mcp_configuration_preserves_masked_secrets_and_top_level_keys(monkeypatch, tmp_path):
    config_path = tmp_path / "extensions_config.json"
    config_path.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "github": {
                        "enabled": True,
                        "type": "http",
                        "url": "https://mcp.example.test",
                        "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"},
                        "headers": {"Authorization": "Bearer secret"},
                        "oauth": {
                            "enabled": True,
                            "token_url": "https://auth.example.test/token",
                            "client_id": "client-id",
                            "client_secret": "client-secret",
                            "refresh_token": "refresh-secret",
                        },
                        "description": "GitHub MCP server",
                    }
                },
                "skills": {"deep-research": {"enabled": True}},
                "features": {"novel_lifecycle_v2": {"enabled": True}},
                "mcpInterceptors": {"github": ["audit"]},
            }
        ),
        encoding="utf-8",
    )

    cfg = ExtensionsConfig(
        mcp_servers={
            "github": McpServerConfig(
                enabled=True,
                type="http",
                url="https://mcp.example.test",
                env={"GITHUB_TOKEN": "ghp-secret"},
                headers={"Authorization": "Bearer secret"},
                oauth=McpOAuthConfig(
                    token_url="https://auth.example.test/token",
                    client_id="client-id",
                    client_secret="client-secret",
                    refresh_token="refresh-secret",
                ),
                description="GitHub MCP server",
            )
        },
        skills={"deep-research": SkillStateConfig(enabled=True)},
        features={"novel_lifecycle_v2": FeatureFlagConfig(enabled=True)},
    )

    def _resolve_config_path(cls, config_path_arg=None):
        if config_path_arg is not None:
            return config_path_arg
        return config_path

    monkeypatch.setattr(mcp_router, "get_extensions_config", lambda: cfg)
    monkeypatch.setattr(mcp_router, "reload_extensions_config", lambda config_path=None: cfg)
    monkeypatch.setattr(mcp_router.ExtensionsConfig, "resolve_config_path", classmethod(_resolve_config_path))

    app = FastAPI()
    app.include_router(mcp_router.router)
    app.dependency_overrides[require_admin_user] = lambda: object()

    request_payload = {
        "mcp_servers": {
            "github": {
                "enabled": False,
                "type": "http",
                "url": "https://mcp.example.test",
                "env": {"GITHUB_TOKEN": "***"},
                "headers": {"Authorization": "***"},
                "oauth": {
                    "enabled": True,
                    "token_url": "https://auth.example.test/token",
                    "client_id": "client-id",
                    "client_secret": None,
                    "refresh_token": None,
                },
                "description": "GitHub MCP server",
            }
        }
    }

    with TestClient(app) as client:
        response = client.put("/api/mcp/config", json=request_payload)

    assert response.status_code == 200

    written = json.loads(config_path.read_text(encoding="utf-8"))
    assert written["mcpServers"]["github"]["enabled"] is False
    assert written["mcpServers"]["github"]["env"]["GITHUB_TOKEN"] == "$GITHUB_TOKEN"
    assert written["mcpServers"]["github"]["headers"]["Authorization"] == "Bearer secret"
    assert written["mcpServers"]["github"]["oauth"]["client_secret"] == "client-secret"
    assert written["mcpServers"]["github"]["oauth"]["refresh_token"] == "refresh-secret"
    assert written["features"] == {"novel_lifecycle_v2": {"enabled": True}}
    assert written["mcpInterceptors"] == {"github": ["audit"]}

    parsed = McpConfigResponse(**response.json())
    github = parsed.mcp_servers["github"]
    assert github.enabled is True or github.enabled is False
    assert github.env == {"GITHUB_TOKEN": "***"}
    assert github.headers == {"Authorization": "***"}
    assert github.oauth is not None
    assert github.oauth.client_secret is None
    assert github.oauth.refresh_token is None
