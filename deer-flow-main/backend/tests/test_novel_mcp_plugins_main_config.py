from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.gateway.novel_migrated.api import mcp_plugins


@pytest.mark.asyncio
async def test_novel_mcp_plugin_list_reads_main_extensions_config(monkeypatch):
    config = SimpleNamespace(
        mcp_servers={
            "disabled": SimpleNamespace(enabled=False, type="stdio", command="npx", args=[], env={}, description="off"),
            "github": SimpleNamespace(enabled=True, type="http", url="https://mcp.example", headers={}, description="GitHub"),
        }
    )
    monkeypatch.setattr(mcp_plugins, "get_extensions_config", lambda: config)

    result = await mcp_plugins.list_plugins(user_id="u1", db=SimpleNamespace(), enabled=True)

    assert result["source"] == "deerflow.extensions_config"
    assert result["legacy_writes"] == "disabled"
    assert [item["plugin_name"] for item in result["plugins"]] == ["github"]
    assert result["plugins"][0]["server_url"] == "https://mcp.example"


@pytest.mark.asyncio
async def test_novel_mcp_plugin_writes_are_disabled():
    with pytest.raises(HTTPException) as exc_info:
        await mcp_plugins.create_plugin(
            mcp_plugins.MCPPluginCreateRequest(plugin_name="x"),
            user_id="u1",
            db=SimpleNamespace(),
        )

    assert exc_info.value.status_code == 410
    assert "/api/mcp/config" in str(exc_info.value.detail)
