"""MCP插件测试服务"""
from __future__ import annotations

import json
from typing import Dict, Any, Optional, List

from app.gateway.novel_migrated.models.mcp_plugin import MCPPlugin
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService
from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class MCPTestService:

    def __init__(self, ai_service: AIService):
        self.ai_service = ai_service

    async def test_plugin(self, plugin: MCPPlugin) -> Dict[str, Any]:
        result = {
            "plugin_name": plugin.plugin_name,
            "plugin_type": plugin.plugin_type,
            "status": "unknown",
            "tools_found": 0,
            "test_result": None,
            "error": None,
        }

        try:
            from app.gateway.novel_migrated.services.mcp_tools_loader import MCPToolsLoader
            loader = MCPToolsLoader()
            tools = await loader.load_tools_for_plugin(plugin)

            if not tools:
                result["status"] = "no_tools"
                result["error"] = "No tools found for this plugin"
                return result

            result["tools_found"] = len(tools)
            result["tools"] = [{"name": t.get("name"), "description": t.get("description", "")} for t in tools]

            if tools:
                test_tool = tools[0]
                test_prompt = PromptService.MCP_TOOL_TEST.format(plugin_name=plugin.plugin_name)
                test_system = PromptService.MCP_TOOL_TEST_SYSTEM

                accumulated = ""
                async for chunk in self.ai_service.generate_text_stream(
                    prompt=test_prompt, system_prompt=test_system, temperature=0.3
                ):
                    accumulated += chunk

                result["test_result"] = {
                    "tool_tested": test_tool.get("name"),
                    "response_preview": accumulated[:500],
                }
                result["status"] = "success"

        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)
            logger.error(f"MCP plugin test failed for {plugin.plugin_name}: {e}")

        return result

    async def test_plugin_connection(self, plugin: MCPPlugin) -> Dict[str, Any]:
        result = {"plugin_name": plugin.plugin_name, "connection_status": "unknown", "error": None}

        try:
            if plugin.plugin_type == "http":
                import httpx
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(f"{plugin.server_url.rstrip('/')}/health")
                    if resp.status_code == 200:
                        result["connection_status"] = "connected"
                    else:
                        result["connection_status"] = f"http_{resp.status_code}"
            elif plugin.plugin_type == "stdio":
                result["connection_status"] = "stdio_configured"
            else:
                result["connection_status"] = "unknown_type"
        except Exception as e:
            result["connection_status"] = "connection_failed"
            result["error"] = str(e)

        return result


_mcp_test_service = None

def get_mcp_test_service(ai_service: AIService) -> MCPTestService:
    global _mcp_test_service
    if _mcp_test_service is None:
        _mcp_test_service = MCPTestService(ai_service)
    return _mcp_test_service
