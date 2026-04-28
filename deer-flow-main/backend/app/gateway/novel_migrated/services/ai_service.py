"""AI service bridge for novel_migrated.

设计目标：
1. 复用 deerflow 的模型配置中心与模型工厂，不维护第二套模型配置。
2. 对外兼容参考实现最常用接口：AIService/create_user_ai_service/generate_text_stream。
3. 在可用时桥接 MCP 工具加载（读取 extensions_config），不可用时自动降级。

增强功能（P2 补齐）：
4. 模型实例缓存（按 model_name），避免重复创建
5. _handle_tool_calls 循环支持（参考项目兼容）
6. 调用统计构建与日志输出（性能监控）
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import threading
import time
from collections import OrderedDict, defaultdict
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.schemas.ai_message import AiMessage
from app.gateway.novel_migrated.services.mcp_tools_loader import mcp_tools_loader
from deerflow.config import get_app_config
from deerflow.models import create_chat_model

logger = get_logger(__name__)


class AgentModelConfig(TypedDict):
    """Resolved model configuration for a novel agent.

    Attributes:
        agent_type: The agent task type (e.g., writer, critic, polish).
        provider_id: The AI provider ID (e.g., openai, deepseek).
        model_name: The specific model name to use.
        temperature: Sampling temperature (0.0-2.0).
        max_tokens: Maximum tokens per generation.
        system_prompt: Optional system prompt override.
        source: Where this config came from (custom, default, fallback).
    """

    agent_type: str
    provider_id: str | None
    model_name: str | None
    temperature: float
    max_tokens: int
    system_prompt: str | None
    source: str


# ==================== Agent-aware model resolution ====================

async def resolve_agent_model_config(
    user_id: str,
    agent_type: str,
    db_session: Any,
    default_provider: str | None = None,
    default_model: str | None = None,
) -> AgentModelConfig:
    """Resolve model configuration for a specific agent type at runtime.

    Resolution order:
    1. User's custom agent config (if enabled)
    2. User's default Settings config
    3. System fallback defaults

    Args:
        user_id: User identifier.
        agent_type: Agent task type (writer/critic/polish/outline/etc.).
        db_session: Async database session.
        default_provider: Fallback provider if no config found.
        default_model: Fallback model if no config found.

    Returns:
        AgentModelConfig with provider_id, model_name, temperature,
        max_tokens, system_prompt, and source.
    """
    from app.gateway.novel_migrated.services.novel_agent_config_service import (
        NovelAgentConfigService,
    )

    service = NovelAgentConfigService(db_session)
    return await service.resolve_agent_config(
        user_id=user_id,
        agent_type=agent_type,
        default_provider_id=default_provider,
        default_model_name=default_model,
    )


# ==================== 模型实例缓存 ====================

_model_cache: OrderedDict[tuple[str, ...], Any] = OrderedDict()
_model_cache_meta: dict[tuple[str, ...], dict[str, Any]] = {}
_model_cache_lock = threading.Lock()
_MODEL_CACHE_MAX_SIZE = 64


def _hash_api_key_for_cache(api_key: str) -> str:
    """Hash the API key so cache keys never store plaintext secrets.

    NOTE: This is only used for in-process cache keying (not persisted).
    """
    if not api_key:
        return ""
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def _make_cache_key(model_name: str, base_url: str | None = None, api_key: str | None = None) -> tuple[str, ...]:
    model_name_key = (model_name or "").strip()
    base_url_key = (base_url or "").strip()
    api_key_raw = (api_key or "").strip()
    if base_url_key or api_key_raw:
        return (model_name_key, base_url_key, _hash_api_key_for_cache(api_key_raw))
    return (model_name_key,)


def _format_cache_key(cache_key: tuple[str, ...]) -> str:
    if len(cache_key) == 1:
        return cache_key[0]
    return "|".join(cache_key)


def _get_cached_model(model_name: str, base_url: str | None = None, api_key: str | None = None) -> Any:
    model_name = (model_name or "").strip()
    cache_key = _make_cache_key(model_name, base_url, api_key)
    now = time.time()
    with _model_cache_lock:
        if cache_key in _model_cache:
            meta = _model_cache_meta.setdefault(
                cache_key,
                {
                    "model_name": model_name,
                    "hits": 0,
                    "misses": 0,
                    "created_at": now,
                    "last_accessed_at": now,
                },
            )
            meta["hits"] += 1
            meta["last_accessed_at"] = now
            _model_cache.move_to_end(cache_key)
            return _model_cache[cache_key]

        meta = _model_cache_meta.setdefault(
            cache_key,
            {
                "model_name": model_name,
                "hits": 0,
                "misses": 0,
                "created_at": now,
                "last_accessed_at": now,
            },
        )
        meta["misses"] += 1
        meta["last_accessed_at"] = now

        if len(_model_cache) >= _MODEL_CACHE_MAX_SIZE:
            evicted_key, _ = _model_cache.popitem(last=False)
            _model_cache_meta.pop(evicted_key, None)

        overrides: dict[str, Any] = {}
        if base_url and base_url.strip():
            overrides["base_url"] = base_url.strip()
        if api_key and api_key.strip():
            overrides["api_key"] = api_key.strip()
        model = create_chat_model(name=model_name, thinking_enabled=False, **overrides)
        _model_cache[cache_key] = model
        logger.info("📦 模型缓存未命中，创建新实例: %s (overrides=%s)", model_name, list(overrides.keys()) if overrides else "none")
        return model


def clear_model_cache() -> None:
    """清空模型缓存（用于配置变更后刷新）"""
    global _model_cache, _model_cache_meta
    with _model_cache_lock:
        count = len(_model_cache)
        _model_cache.clear()
        _model_cache_meta.clear()
    logger.info("🗑️ 已清空模型缓存（共 %s 个实例）", count)


def get_model_cache_stats() -> dict:
    """获取模型缓存统计信息"""
    with _model_cache_lock:
        models: dict[str, dict[str, Any]] = defaultdict(
            lambda: {"hits": 0, "misses": 0, "created_at": 0.0, "last_accessed_at": 0.0, "cache_entries": 0}
        )
        entries: dict[str, dict[str, Any]] = {}
        for cache_key, meta in _model_cache_meta.items():
            key_str = _format_cache_key(cache_key)
            entries[key_str] = dict(meta)

            model_name = str(meta.get("model_name") or "")
            aggregated = models[model_name]
            aggregated["hits"] += int(meta.get("hits", 0))
            aggregated["misses"] += int(meta.get("misses", 0))
            aggregated["cache_entries"] += 1

            created_at = float(meta.get("created_at", 0.0) or 0.0)
            last_accessed_at = float(meta.get("last_accessed_at", 0.0) or 0.0)
            if aggregated["created_at"] == 0.0 or (created_at and created_at < aggregated["created_at"]):
                aggregated["created_at"] = created_at
            if last_accessed_at > aggregated["last_accessed_at"]:
                aggregated["last_accessed_at"] = last_accessed_at

        return {
            "cache_size": len(_model_cache),
            "models": {name: stats.copy() for name, stats in models.items()},
            "entries": entries,
        }


# ==================== 调用统计 ====================

_call_stats: dict[str, dict] = defaultdict(
    lambda: {
        "total_calls": 0,
        "total_time_ms": 0,
        "success_count": 0,
        "error_count": 0,
        "avg_time_ms": 0,
    }
)


def record_call(model_name: str, success: bool, elapsed_ms: float) -> None:
    """
    记录 AI 调用统计
    
    Args:
        model_name: 模型名称
        success: 是否成功
        elapsed_ms: 耗时（毫秒）
    """
    stats = _call_stats[model_name]
    stats["total_calls"] += 1
    stats["total_time_ms"] += elapsed_ms
    if success:
        stats["success_count"] += 1
    else:
        stats["error_count"] += 1
    stats["avg_time_ms"] = round(stats["total_time_ms"] / stats["total_calls"], 2)


def get_call_stats() -> dict:
    """获取调用统计"""
    return {name: stats.copy() for name, stats in _call_stats.items()}


def normalize_provider(provider: str | None) -> str | None:
    """标准化 provider 名称，兼容历史值。"""
    if provider == "mumu":
        return "openai"
    return provider


@dataclass
class AIService:
    """基于 deerflow 模型配置的薄封装。"""

    api_provider: str
    api_key: str
    api_base_url: str
    default_model: str
    default_temperature: float
    default_max_tokens: int
    default_system_prompt: str | None = None
    user_id: str | None = None
    db_session: Any | None = None
    enable_mcp: bool = True

    _cached_tools: list[Any] | None = field(default=None, init=False, repr=False)
    _tools_loaded: bool = field(default=False, init=False, repr=False)

    def clear_mcp_cache(self) -> None:
        self._cached_tools = None
        self._tools_loaded = False

    async def _get_model_instance(
        self,
        model_name: str | None = None,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> Any:
        resolved_name = self._resolve_model_name(model_name)
        effective_base_url = base_url or self.api_base_url
        effective_api_key = api_key or self.api_key
        return await asyncio.to_thread(
            _get_cached_model,
            resolved_name,
            effective_base_url,
            effective_api_key,
        )

    def _resolve_model_name(self, model_name: str | None = None) -> str:
        config = get_app_config()
        wanted = model_name or self.default_model
        if wanted and config.get_model_config(wanted) is not None:
            return wanted
        if config.models:
            fallback = config.models[0].name
            if wanted and wanted != fallback:
                logger.warning(
                    "模型 %s 未在 deerflow 配置中找到，回退到 %s。"
                    "若搭配自定义 base_url/api_key，请确认该模型在目标 API 端点可用。",
                    wanted,
                    fallback,
                )
            return fallback
        raise ValueError("deerflow 未配置任何可用模型")

    def _apply_runtime_params(
        self,
        llm: Any,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Any:
        """运行时覆盖 temperature / max_tokens。

        与主项目 novel.py 保持一致，使用 model_copy(update=...) 而非
        config={"configurable": ...}，后者是 LangGraph RunnableConfig 约定，
        LangChain ChatModel 不会从中读取推理参数。
        """
        updates: dict[str, Any] = {}
        effective_temp = temperature if temperature is not None else self.default_temperature
        effective_tokens = max_tokens if max_tokens is not None else self.default_max_tokens

        if effective_temp is not None:
            updates["temperature"] = effective_temp
        if effective_tokens is not None:
            updates["max_tokens"] = effective_tokens

        if not updates:
            return llm

        model_copy = getattr(llm, "model_copy", None)
        if not callable(model_copy):
            logger.warning(
                "model_copy 设置运行时参数不可用，降级使用原始模型: model=%s updates=%s",
                type(llm).__name__,
                updates,
            )
            return llm

        try:
            return model_copy(update=updates)
        except Exception as exc:
            logger.warning(
                "model_copy 设置运行时参数失败，降级使用原始模型: model=%s updates=%s error=%s",
                type(llm).__name__,
                updates,
                exc,
                exc_info=True,
            )
            return llm

    async def _prepare_mcp_tools(self, auto_mcp: bool = True, force_refresh: bool = False) -> list[Any] | None:
        if not self.enable_mcp or not auto_mcp:
            self.clear_mcp_cache()
            return None

        if self._tools_loaded and not force_refresh:
            return self._cached_tools

        try:
            tools = await mcp_tools_loader.get_user_langchain_tools(
                user_id=self.user_id,
                db_session=self.db_session,
                use_cache=True,
                force_refresh=force_refresh,
            )
            self._cached_tools = tools or []
            self._tools_loaded = True
            if self._cached_tools:
                logger.info("🔧 已加载 %s 个MCP工具", len(self._cached_tools))
            return self._cached_tools
        except Exception as exc:
            logger.warning("⚠️ MCP工具加载失败，自动降级为无工具模式: %s", exc)
            self._cached_tools = None
            self._tools_loaded = True
            return None

    def _build_messages(self, prompt: str, system_prompt: str | None = None) -> list[Any]:
        messages: list[Any] = []
        final_system_prompt = system_prompt or self.default_system_prompt
        if final_system_prompt:
            messages.append(SystemMessage(content=final_system_prompt))
        messages.append(HumanMessage(content=prompt))
        return messages

    @staticmethod
    def _build_messages_from_array(messages: list[AiMessage]) -> list[Any]:
        langchain_messages = []

        for msg in messages:
            role = msg.role.lower().strip()
            content = msg.content

            if role == "system":
                langchain_messages.append(SystemMessage(content=content))
            elif role == "user":
                langchain_messages.append(HumanMessage(content=content))
            elif role == "assistant":
                langchain_messages.append(AIMessage(content=content))
            else:
                logger.warning("Unknown message role '%s', treating as user", role)
                langchain_messages.append(HumanMessage(content=content))

        return langchain_messages

    async def generate_text(
        self,
        prompt: str,
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
        auto_mcp: bool = True,
        base_url: str | None = None,
        api_key: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        """非流式文本生成，返回与历史接口兼容的 dict。"""
        start_time = time.time()
        model_name = self._resolve_model_name(model)

        try:
            llm = await self._get_model_instance(model_name, base_url=base_url, api_key=api_key)
            llm = self._apply_runtime_params(llm, temperature, max_tokens)

            logger.info(
                "generate_text: model=%s, temperature=%s, max_tokens=%s",
                model_name,
                llm.temperature if hasattr(llm, "temperature") else "N/A",
                llm.max_tokens if hasattr(llm, "max_tokens") else "N/A",
            )

            tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
            if tools:
                try:
                    llm = llm.bind_tools(tools)
                except Exception as exc:
                    logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

            messages = self._build_messages(prompt, system_prompt)
            response = await llm.ainvoke(messages)

            content = response.content if hasattr(response, "content") else str(response)
            if isinstance(content, list):
                content = "".join(str(part) for part in content)

            tool_calls = getattr(response, "tool_calls", None) or []

            # 处理 tool_calls 循环（参考项目兼容）
            if tool_calls and tools:
                content, tool_calls = await self._handle_tool_calls_loop(
                    messages, response, tools, llm, max_iterations=5
                )

            elapsed_ms = (time.time() - start_time) * 1000
            record_call(model_name, success=True, elapsed_ms=elapsed_ms)

            return {
                "content": str(content),
                "finish_reason": "stop" if not tool_calls else "tool_calls",
                "tool_calls": tool_calls,
            }

        except Exception as exc:
            elapsed_ms = (time.time() - start_time) * 1000
            record_call(model_name, success=False, elapsed_ms=elapsed_ms)
            logger.error("❌ generate_text 失败: %s", exc, exc_info=True)
            raise

    async def _handle_tool_calls_loop(
        self,
        messages: list[Any],
        last_response: Any,
        tools: list[Any],
        llm: Any,
        max_iterations: int = 5,
    ) -> tuple[str, list]:
        """
        处理 tool_calls 循环（并行执行版）

        当模型返回 tool_calls 时：
        1. 在已绑定的工具中查找对应名称的工具
        2. 并行执行所有工具（asyncio.gather）并获取结果
        3. 将 ToolMessage 回填给模型继续推理
        4. 重复直到模型完成或达到最大迭代次数

        Args:
            messages: 原始消息列表
            last_response: 上一次模型响应
            tools: 工具列表（LangChain Tool 对象）
            llm: 模型实例
            max_iterations: 最大迭代次数（默认5次，防止无限循环）

        Returns:
            (最终文本内容, 所有工具调用记录)
        """
        import asyncio

        from langchain_core.messages import ToolMessage

        all_tool_calls = []
        current_messages = messages + [last_response]
        iteration_stats = {
            "total_iterations": 0,
            "successful_calls": 0,
            "failed_calls": 0,
            "total_execution_time_ms": 0,
        }

        for iteration in range(max_iterations):
            tool_calls = getattr(last_response, "tool_calls", None) or []
            if not tool_calls:
                break

            iteration_stats["total_iterations"] = iteration + 1
            all_tool_calls.extend(tool_calls)
            logger.info(
                "🔧 第 %s 次工具调用循环，共 %s 个工具并行执行",
                iteration + 1,
                len(tool_calls),
            )

            iteration_start = time.time()

            async def _run_single_tool(tool_index: int, tc: dict) -> tuple[str, str, Any, bool]:
                tool_name = tc.get("name", "unknown")
                tool_args = tc.get("args", {})
                tool_id = str(tc.get("id") or "").strip() or f"call_{iteration}_{tool_index}_{tool_name}"
                start = time.time()
                try:
                    result = await self._execute_tool_call(
                        tool_name=tool_name,
                        tool_args=tool_args,
                        tools=tools,
                    )
                    elapsed = (time.time() - start) * 1000
                    logger.info(
                        "✅ 工具 [%s] 执行成功 (耗时 %.0fms): %s",
                        tool_name,
                        elapsed,
                        str(result)[:100] + ("..." if len(str(result)) > 100 else ""),
                    )
                    return tool_id, tool_name, result, True
                except Exception as exc:
                    elapsed = (time.time() - start) * 1000
                    error_msg = f"Error executing {tool_name}: {str(exc)}"
                    logger.warning("❌ 工具 [%s] 执行失败 (耗时 %.0fms): %s", tool_name, elapsed, str(exc))
                    return tool_id, tool_name, error_msg, False

            results = await asyncio.gather(
                *[_run_single_tool(idx, tc) for idx, tc in enumerate(tool_calls)],
                return_exceptions=False,
            )

            for tool_id, tool_name, result_or_error, success in results:
                if success:
                    iteration_stats["successful_calls"] += 1
                    current_messages.append(
                        ToolMessage(content=str(result_or_error), tool_call_id=tool_id)
                    )
                else:
                    iteration_stats["failed_calls"] += 1
                    current_messages.append(
                        ToolMessage(content=str(result_or_error), tool_call_id=tool_id)
                    )

            iteration_stats["total_execution_time_ms"] += (time.time() - iteration_start) * 1000

            last_response = await llm.ainvoke(current_messages)

        logger.info(
            "📊 工具调用循环完成: %s 次迭代, %s 成功/%s 失败, 总耗时 %.0fms",
            iteration_stats["total_iterations"],
            iteration_stats["successful_calls"],
            iteration_stats["failed_calls"],
            iteration_stats["total_execution_time_ms"],
        )

        content = getattr(last_response, "content", "")
        if isinstance(content, list):
            content = "".join(str(part) for part in content)

        return str(content), all_tool_calls

    async def _execute_tool_call(
        self,
        tool_name: str,
        tool_args: dict,
        tools: list[Any],
    ) -> Any:
        """
        执行单个工具调用

        在已绑定的 LangChain 工具列表中查找匹配的工具并执行。

        Args:
            tool_name: 工具名称（来自模型的 tool_call.name）
            tool_args: 工具参数（来自模型的 tool_call.args）
            tools: 已绑定的 LangChain Tool 对象列表

        Returns:
            Any: 工具执行结果

        Raises:
            ValueError: 未找到匹配的工具
            Exception: 工具执行过程中的异常
        """
        if not tools:
            raise ValueError("没有可用的工具")

        # 在工具列表中查找匹配的工具
        target_tool = None
        for tool in tools:
            if hasattr(tool, 'name') and tool.name == tool_name:
                target_tool = tool
                break
            elif hasattr(tool, '__name__') and tool.__name__ == tool_name:
                target_tool = tool
                break

        if target_tool is None:
            raise ValueError(f"未找到名为 '{tool_name}' 的工具。可用工具: {[getattr(t, 'name', 'unknown') for t in tools]}")

        # 执行工具
        if hasattr(target_tool, 'ainvoke'):
            result = await target_tool.ainvoke(tool_args)
        elif callable(target_tool):
            result = target_tool(tool_args)
        else:
            raise ValueError(f"工具 '{tool_name}' 不可调用")

        return result

    async def _resolve_agent_params(
        self,
        agent_type: str | None,
        model: str | None,
        temperature: float | None,
        max_tokens: int | None,
        system_prompt: str | None,
    ) -> tuple[str | None, float | None, int | None, str | None]:
        """Resolve model params from agent config if agent_type is provided.

        Returns:
            Tuple of (resolved_model, resolved_temperature, resolved_max_tokens, resolved_system_prompt)
        """
        if not agent_type or not self.db_session or not self.user_id:
            return model, temperature, max_tokens, system_prompt

        try:
            agent_config = await resolve_agent_model_config(
                self.user_id,
                agent_type,
                self.db_session,
                default_provider=self.api_provider,
                default_model=self.default_model,
            )
            resolved_model = agent_config.get("model_name") or model
            resolved_temp = (
                agent_config.get("temperature")
                if agent_config.get("temperature") is not None
                else temperature
            )
            resolved_tokens = (
                agent_config.get("max_tokens")
                if agent_config.get("max_tokens") is not None
                else max_tokens
            )
            resolved_prompt = agent_config.get("system_prompt") or system_prompt
            logger.info(
                "Agent config resolved: agent=%s model=%s source=%s",
                agent_type,
                resolved_model,
                agent_config.get("source", "unknown"),
            )
            return resolved_model, resolved_temp, resolved_tokens, resolved_prompt
        except Exception as exc:
            logger.warning("Failed to resolve agent config for %s: %s", agent_type, exc)
            return model, temperature, max_tokens, system_prompt

    async def generate_text_stream(
        self,
        prompt: str,
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
        auto_mcp: bool = True,
        agent_type: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        **_: Any,
    ) -> AsyncGenerator[str, None]:
        """流式文本生成；保持与 careers/memories/plot_analyzer 调用兼容。

        Args:
            prompt: 输入提示词
            provider: 供应商（保留兼容性，实际通过 model 选择）
            model: 模型名称，None 时使用默认模型
            temperature: 温度参数
            max_tokens: 最大 token 数
            system_prompt: 系统提示词
            auto_mcp: 是否自动加载 MCP 工具
            agent_type: 智能体类型（writer/critic/polish/outline 等），
                        提供时会从配置服务解析对应模型和参数
        """
        model, temperature, max_tokens, system_prompt = await self._resolve_agent_params(
            agent_type, model, temperature, max_tokens, system_prompt
        )

        model_name = self._resolve_model_name(model)
        llm = await self._get_model_instance(model_name, base_url=base_url, api_key=api_key)
        llm = self._apply_runtime_params(llm, temperature, max_tokens)

        logger.info(
            "generate_text_stream: model=%s, temperature=%s, max_tokens=%s",
            model_name,
            llm.temperature if hasattr(llm, "temperature") else "N/A",
            llm.max_tokens if hasattr(llm, "max_tokens") else "N/A",
        )

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        messages = self._build_messages(prompt, system_prompt)

        async for chunk in llm.astream(messages):
            if isinstance(chunk, AIMessage):
                text = chunk.content
            else:
                text = getattr(chunk, "content", chunk)

            if isinstance(text, list):
                text = "".join(str(part) for part in text)
            if text:
                yield str(text)

    async def generate_text_with_messages(
        self,
        messages: list[AiMessage],
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        auto_mcp: bool = True,
        base_url: str | None = None,
        api_key: str | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        """非流式文本生成（messages数组直传版本）。"""
        start_time = time.time()
        model_name = self._resolve_model_name(model)
        llm = await self._get_model_instance(model_name, base_url=base_url, api_key=api_key)
        llm = self._apply_runtime_params(llm, temperature, max_tokens)

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        langchain_messages = self._build_messages_from_array(messages)
        response = await llm.ainvoke(langchain_messages)

        content = response.content if hasattr(response, "content") else str(response)
        if isinstance(content, list):
            content = "".join(str(part) for part in content)

        # 处理 tool_calls 循环（与 generate_text 保持一致）
        tool_calls = getattr(response, "tool_calls", None) or []
        if tool_calls and tools:
            content, tool_calls = await self._handle_tool_calls_loop(
                langchain_messages, response, tools, llm, max_iterations=5
            )

        elapsed_ms = (time.time() - start_time) * 1000
        record_call(model_name, success=True, elapsed_ms=elapsed_ms)

        return {
            "content": str(content),
            "finish_reason": "stop" if not tool_calls else "tool_calls",
            "tool_calls": tool_calls,
        }

    async def generate_text_stream_with_messages(
        self,
        messages: list[AiMessage],
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        auto_mcp: bool = True,
        base_url: str | None = None,
        api_key: str | None = None,
        **_: Any,
    ) -> AsyncGenerator[str, None]:
        """流式文本生成（messages数组直传版本）。"""
        model_name = self._resolve_model_name(model)
        llm = await self._get_model_instance(model_name, base_url=base_url, api_key=api_key)
        llm = self._apply_runtime_params(llm, temperature, max_tokens)

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        langchain_messages = self._build_messages_from_array(messages)

        async for chunk in llm.astream(langchain_messages):
            if isinstance(chunk, AIMessage):
                text = chunk.content
            else:
                text = getattr(chunk, "content", chunk)

            if isinstance(text, list):
                text = "".join(str(part) for part in text)
            if text:
                yield str(text)

    @staticmethod
    def _clean_json_response(text: str) -> str:
        if not text:
            return ""

        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:]
            cleaned = cleaned.strip()

        if cleaned.startswith("{") or cleaned.startswith("["):
            return cleaned

        start_obj = cleaned.find("{")
        end_obj = cleaned.rfind("}")
        start_arr = cleaned.find("[")
        end_arr = cleaned.rfind("]")

        obj_candidate = cleaned[start_obj : end_obj + 1] if start_obj != -1 and end_obj != -1 and end_obj > start_obj else ""
        arr_candidate = cleaned[start_arr : end_arr + 1] if start_arr != -1 and end_arr != -1 and end_arr > start_arr else ""

        candidate = obj_candidate if len(obj_candidate) >= len(arr_candidate) else arr_candidate
        if candidate:
            return candidate
        return cleaned

    @classmethod
    def clean_json_response(cls, text: str) -> str:
        """Public wrapper for JSON cleaning.

        Keeps compatibility with existing `_clean_json_response` behavior while
        avoiding private-method coupling from router/service layers.
        """
        return cls._clean_json_response(text)

    async def call_with_json_retry(
        self,
        *,
        prompt: str,
        max_retries: int = 3,
        expected_type: str = "object",
        **kwargs: Any,
    ) -> Any:
        if max_retries < 1:
            max_retries = 1

        last_error: Exception | None = None
        for attempt in range(1, max_retries + 1):
            result = await self.generate_text(prompt=prompt, **kwargs)
            raw_content = str(result.get("content") or "")
            cleaned = self.clean_json_response(raw_content)

            try:
                data = json.loads(cleaned)
            except Exception as exc:
                last_error = exc
                logger.warning("JSON 解析失败（第 %s/%s 次）: %s", attempt, max_retries, exc)
                continue

            if expected_type == "object" and not isinstance(data, dict):
                last_error = TypeError("AI 返回不是 JSON object")
                logger.warning("JSON 类型不匹配（第 %s/%s 次）：期望 object", attempt, max_retries)
                continue
            if expected_type == "array" and not isinstance(data, list):
                last_error = TypeError("AI 返回不是 JSON array")
                logger.warning("JSON 类型不匹配（第 %s/%s 次）：期望 array", attempt, max_retries)
                continue

            return data

        if last_error is not None:
            raise ValueError(f"JSON 解析失败，已重试 {max_retries} 次: {last_error}") from last_error
        raise ValueError(f"JSON 解析失败，已重试 {max_retries} 次")


def create_user_ai_service(
    api_provider: str,
    api_key: str,
    api_base_url: str,
    model_name: str,
    temperature: float,
    max_tokens: int,
    system_prompt: str | None = None,
    user_id: str | None = None,
    db_session: Any | None = None,
    enable_mcp: bool = True,
) -> AIService:
    provider = normalize_provider(api_provider) or "openai"
    return AIService(
        api_provider=provider,
        api_key=api_key,
        api_base_url=api_base_url,
        default_model=model_name,
        default_temperature=temperature,
        default_max_tokens=max_tokens,
        default_system_prompt=system_prompt,
        user_id=user_id,
        db_session=db_session,
        enable_mcp=enable_mcp,
    )


def create_user_ai_service_with_mcp(*args: Any, **kwargs: Any) -> AIService:
    """Backward-compatible alias for create_user_ai_service.

    Keeps legacy call-sites working while avoiding duplicated parameter plumbing.
    """
    return create_user_ai_service(
        *args,
        **kwargs,
    )


async def create_user_ai_service_from_db(
    db: Any,
    user_id: str,
    module_id: str | None = None,
) -> AIService:
    from sqlalchemy import select as _sel

    from app.gateway.novel_migrated.api.settings import _resolve_user_ai_runtime_config
    from app.gateway.novel_migrated.models.settings import Settings as _Settings

    _sresult = await db.execute(_sel(_Settings).where(_Settings.user_id == user_id))
    _settings = _sresult.scalar_one_or_none()
    if _settings is None:
        _settings = _Settings(user_id=user_id)
        db.add(_settings)
        await db.commit()
        await db.refresh(_settings)
    _runtime, _ = _resolve_user_ai_runtime_config(_settings, module_id=module_id)
    return create_user_ai_service(
        api_provider=_runtime["api_provider"],
        api_key=_runtime["api_key"],
        api_base_url=_runtime["api_base_url"],
        model_name=_runtime["model_name"],
        temperature=_runtime["temperature"],
        max_tokens=_runtime["max_tokens"],
        system_prompt=getattr(_settings, "system_prompt", None),
        user_id=user_id,
        db_session=db,
        enable_mcp=True,
    )
