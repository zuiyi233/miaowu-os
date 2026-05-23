"""Legacy novel MCP plugin API backed by the main DeerFlow MCP config."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from deerflow.config.extensions_config import get_extensions_config

logger = get_logger(__name__)
router = APIRouter(prefix="/mcp-plugins", tags=["mcp-plugins"])


class MCPPluginCreateRequest(BaseModel):
    plugin_name: str
    display_name: str = ""
    plugin_type: str = "http"
    server_url: str = ""
    command: str = ""
    args: str = ""
    env: str = ""
    enabled: bool = True


class MCPPluginUpdateRequest(BaseModel):
    display_name: str | None = None
    plugin_type: str | None = None
    server_url: str | None = None
    command: str | None = None
    args: str | None = None
    env: str | None = None
    enabled: bool | None = None
    status: str | None = None


class MCPPluginTestRequest(BaseModel):
    plugin_id: str


@router.get("")
async def list_plugins(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    enabled: bool | None = None,
):
    del user_id, db
    config = get_extensions_config()
    plugins = []
    for name, server in sorted(config.mcp_servers.items()):
        if enabled is not None and bool(server.enabled) != enabled:
            continue
        plugins.append(_serialize_main_mcp_server(name, server))
    return {
        "plugins": plugins,
        "source": "deerflow.extensions_config",
        "legacy_writes": "disabled",
    }


@router.post("")
async def create_plugin(
    req: MCPPluginCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    del req, user_id, db
    raise _legacy_write_disabled()


@router.get("/{plugin_id}")
async def get_plugin(
    plugin_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    del user_id, db
    config = get_extensions_config()
    server = config.mcp_servers.get(plugin_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Plugin not found in main MCP configuration")
    return _serialize_main_mcp_server(plugin_id, server)


@router.put("/{plugin_id}")
async def update_plugin(
    plugin_id: str,
    req: MCPPluginUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    del plugin_id, req, user_id, db
    raise _legacy_write_disabled()


@router.delete("/{plugin_id}")
async def delete_plugin(
    plugin_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    del plugin_id, user_id, db
    raise _legacy_write_disabled()


@router.post("/test")
async def test_plugin(
    req: MCPPluginTestRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    del req, user_id, db
    raise _legacy_write_disabled()


def _legacy_write_disabled() -> HTTPException:
    return HTTPException(
        status_code=410,
        detail=(
            "Novel MCP plugin writes are deprecated. Use the main DeerFlow "
            "/api/mcp/config endpoint; novel runtime MCP availability follows "
            "extensions_config.json."
        ),
    )


def _serialize_main_mcp_server(name: str, server) -> dict:
    server_type = getattr(server, "type", "stdio")
    url = getattr(server, "url", None)
    command = getattr(server, "command", None)
    args = getattr(server, "args", []) or []
    env = getattr(server, "env", {}) or {}
    headers = getattr(server, "headers", {}) or {}
    return {
        "id": name,
        "plugin_name": name,
        "display_name": name,
        "plugin_type": server_type,
        "server_url": url or "",
        "command": command or "",
        "args": args,
        "env": env,
        "headers": headers,
        "tools": None,
        "enabled": bool(getattr(server, "enabled", True)),
        "status": "configured" if getattr(server, "enabled", True) else "disabled",
        "description": getattr(server, "description", ""),
        "source": "deerflow.extensions_config",
        "created_at": None,
        "updated_at": None,
    }
