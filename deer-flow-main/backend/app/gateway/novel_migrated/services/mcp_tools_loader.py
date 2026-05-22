"""MCP 工具加载器（novel_migrated 兼容层）。

桥接策略：
- 复用 deerflow 的 extensions_config 与 MCP tools 初始化逻辑。
- 不维护新的插件配置中心。
- 保留参考实现的主要接口签名，便于 AIService 平滑调用。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from app.gateway.novel_migrated.core.logger import get_logger
from deerflow.config.extensions_config import get_extensions_config
from deerflow.mcp.tools import get_mcp_tools

logger = get_logger(__name__)


@dataclass
class UserToolsCache:
    """用户工具缓存条目。"""

    langchain_tools: list[Any]
    openai_tools: list[dict[str, Any]]
    expire_time: datetime
    hit_count: int = 0


class MCPToolsLoader:
    """按用户视角暴露 MCP 工具，但配置来源统一走 deerflow。"""

    _instance: MCPToolsLoader | None = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._cache: dict[str, UserToolsCache] = {}
        self._cache_ttl = timedelta(minutes=5)
        self._initialized = True
        logger.info("✅ MCPToolsLoader 初始化完成（deerflow bridge）")

    async def has_enabled_plugins(self, user_id: str, db_session: Any) -> bool:
        """兼容旧接口：按全局 extensions_config 判断是否有启用 MCP。"""
        del user_id, db_session
        try:
            cfg = get_extensions_config()
            return bool(cfg.get_enabled_mcp_servers())
        except Exception as exc:
            logger.warning("检查 MCP 配置失败: %s", exc)
            return False

    async def get_user_langchain_tools(
        self,
        user_id: str | None,
        db_session: Any,
        use_cache: bool = True,
        force_refresh: bool = False,
    ) -> list[Any]:
        """返回可直接给 LangChain bind_tools 的工具对象。"""
        del db_session
        cache_key = user_id or "__global__"
        now = datetime.now()

        if use_cache and not force_refresh and cache_key in self._cache:
            entry = self._cache[cache_key]
            if now < entry.expire_time:
                entry.hit_count += 1
                return entry.langchain_tools
            self._cache.pop(cache_key, None)

        tools = await self._load_langchain_tools()
        openai_tools = [self._format_tool_for_openai(t) for t in tools]

        self._cache[cache_key] = UserToolsCache(
            langchain_tools=tools,
            openai_tools=openai_tools,
            expire_time=now + self._cache_ttl,
        )
        return tools

    async def get_user_tools(
        self,
        user_id: str,
        db_session: Any,
        use_cache: bool = True,
        force_refresh: bool = False,
    ) -> list[dict[str, Any]] | None:
        """兼容旧接口：返回 OpenAI function-calling 格式工具描述。"""
        cache_key = user_id or "__global__"
        await self.get_user_langchain_tools(
            user_id=cache_key,
            db_session=db_session,
            use_cache=use_cache,
            force_refresh=force_refresh,
        )
        entry = self._cache.get(cache_key)
        if not entry:
            return None
        return entry.openai_tools or None

    async def _load_langchain_tools(self) -> list[Any]:
        try:
            tools = await get_mcp_tools()
            logger.info("🔧 MCP 工具加载完成，共 %s 个", len(tools))
            return list(tools)
        except Exception as exc:
            logger.warning("⚠️ 获取 MCP 工具失败，降级为空工具集: %s", exc)
            return []

    @staticmethod
    def _format_tool_for_openai(tool: Any) -> dict[str, Any]:
        schema: dict[str, Any] = {"type": "object", "properties": {}}

        args_schema = getattr(tool, "args_schema", None)
        if args_schema is not None and hasattr(args_schema, "model_json_schema"):
            try:
                schema = args_schema.model_json_schema()  # pydantic v2
            except Exception:
                schema = {"type": "object", "properties": {}}

        return {
            "type": "function",
            "function": {
                "name": getattr(tool, "name", "unknown_tool"),
                "description": getattr(tool, "description", ""),
                "parameters": schema,
            },
        }

    def invalidate_cache(self, user_id: str | None = None) -> None:
        if user_id is None:
            size = len(self._cache)
            self._cache.clear()
            logger.info("🧹 清空 MCP 工具缓存，共 %s 条", size)
            return

        self._cache.pop(user_id, None)
        logger.debug("🧹 清理用户 MCP 工具缓存: %s", user_id)

    def get_cache_stats(self) -> dict[str, Any]:
        now = datetime.now()
        return {
            "total_entries": len(self._cache),
            "total_hits": sum(entry.hit_count for entry in self._cache.values()),
            "cache_ttl_minutes": self._cache_ttl.total_seconds() / 60,
            "entries": [
                {
                    "user_id": user_id,
                    "tools_count": len(entry.langchain_tools),
                    "hit_count": entry.hit_count,
                    "expired": now >= entry.expire_time,
                    "expire_time": entry.expire_time.isoformat(),
                }
                for user_id, entry in self._cache.items()
            ],
        }


mcp_tools_loader = MCPToolsLoader()
