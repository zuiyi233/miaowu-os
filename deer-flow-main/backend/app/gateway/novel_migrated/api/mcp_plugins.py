"""MCP插件管理API"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.mcp_plugin import MCPPlugin

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
    display_name: Optional[str] = None
    plugin_type: Optional[str] = None
    server_url: Optional[str] = None
    command: Optional[str] = None
    args: Optional[str] = None
    env: Optional[str] = None
    enabled: Optional[bool] = None
    status: Optional[str] = None


class MCPPluginTestRequest(BaseModel):
    plugin_id: str


@router.get("")
async def list_plugins(
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    enabled: Optional[bool] = None,
):
    query = select(MCPPlugin).where(MCPPlugin.user_id == user_id)
    if enabled is not None:
        query = query.where(MCPPlugin.enabled == enabled)
    result = await db.execute(query.order_by(MCPPlugin.created_at))
    plugins = result.scalars().all()
    return {"plugins": [_serialize_plugin(p) for p in plugins]}


@router.post("")
async def create_plugin(
    req: MCPPluginCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(MCPPlugin).where(
            MCPPlugin.user_id == user_id,
            MCPPlugin.plugin_name == req.plugin_name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Plugin with this name already exists")

    plugin = MCPPlugin(
        user_id=user_id,
        plugin_name=req.plugin_name,
        display_name=req.display_name or req.plugin_name,
        plugin_type=req.plugin_type,
        server_url=req.server_url,
        command=req.command,
        args=req.args,
        env=req.env,
        enabled=req.enabled,
        status="inactive",
    )
    db.add(plugin)
    await db.commit()
    await db.refresh(plugin)
    return _serialize_plugin(plugin)


@router.get("/{plugin_id}")
async def get_plugin(
    plugin_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(MCPPlugin).where(MCPPlugin.id == plugin_id))
    plugin = result.scalar_one_or_none()
    if not plugin or plugin.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return _serialize_plugin(plugin)


@router.put("/{plugin_id}")
async def update_plugin(
    plugin_id: str,
    req: MCPPluginUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(MCPPlugin).where(MCPPlugin.id == plugin_id))
    plugin = result.scalar_one_or_none()
    if not plugin or plugin.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plugin not found")

    for field_name in ['display_name', 'plugin_type', 'server_url', 'command',
                        'args', 'env', 'enabled', 'status']:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(plugin, field_name, value)

    await db.commit()
    await db.refresh(plugin)
    return _serialize_plugin(plugin)


@router.delete("/{plugin_id}")
async def delete_plugin(
    plugin_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(MCPPlugin).where(MCPPlugin.id == plugin_id))
    plugin = result.scalar_one_or_none()
    if not plugin or plugin.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plugin not found")
    await db.delete(plugin)
    await db.commit()
    return {"message": "Plugin deleted"}


@router.post("/test")
async def test_plugin(
    req: MCPPluginTestRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(MCPPlugin).where(MCPPlugin.id == req.plugin_id))
    plugin = result.scalar_one_or_none()
    if not plugin or plugin.user_id != user_id:
        raise HTTPException(status_code=404, detail="Plugin not found")

    plugin.status = "testing"
    await db.commit()

    try:
        from app.gateway.novel_migrated.services.mcp_tools_loader import MCPToolsLoader
        loader = MCPToolsLoader()
        tools = await loader.load_tools_for_plugin(plugin)
        plugin.status = "active"
        plugin.tools = json.dumps([t.get("name", "") for t in tools], ensure_ascii=False) if tools else "[]"
        await db.commit()
        return {"status": "success", "tools_count": len(tools), "tools": tools}
    except Exception as e:
        plugin.status = "error"
        await db.commit()
        return {"status": "error", "message": str(e)}


def _serialize_plugin(p: MCPPlugin) -> dict:
    tools = None
    if p.tools:
        try:
            tools = json.loads(p.tools) if isinstance(p.tools, str) else p.tools
        except json.JSONDecodeError:
            tools = p.tools
    return {
        "id": p.id, "user_id": p.user_id,
        "plugin_name": p.plugin_name, "display_name": p.display_name,
        "plugin_type": p.plugin_type, "server_url": p.server_url,
        "command": p.command, "args": p.args, "env": p.env,
        "tools": tools, "enabled": p.enabled, "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
