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

import json
import threading
import time
from collections import defaultdict
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.mcp_tools_loader import mcp_tools_loader
from app.gateway.novel_migrated.schemas.ai_message import AiMessage
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

_model_cache: dict[str, Any] = {}
_model_cache_stats: dict[str, dict] = defaultdict(lambda: {"hits": 0, "misses": 0, "created_at": 0})
_model_cache_lock = threading.Lock()


def _get_cached_model(model_name: str) -> Any:
    """
    获取缓存的模型实例
    
    使用说明：
    - 按 model_name 缓存模型实例，避免重复创建
    - 缓存命中时直接返回，未命中时创建并缓存
    - 适用于高频调用的场景（如批量章节生成）
    - 线程安全：使用 threading.Lock 保护所有缓存操作
    """
    with _model_cache_lock:
        if model_name in _model_cache:
            _model_cache_stats[model_name]["hits"] += 1
            return _model_cache[model_name]

        _model_cache_stats[model_name]["misses"] += 1
        model = create_chat_model(name=model_name)
        _model_cache[model_name] = model
        _model_cache_stats[model_name]["created_at"] = time.time()
        logger.info("📦 模型缓存未命中，创建新实例: %s", model_name)
        return model


def clear_model_cache() -> None:
    """清空模型缓存（用于配置变更后刷新）"""
    global _model_cache, _model_cache_stats
    with _model_cache_lock:
        count = len(_model_cache)
        _model_cache.clear()
        _model_cache_stats.clear()
    logger.info("🗑️ 已清空模型缓存（共 %s 个实例）", count)


def get_model_cache_stats() -> dict:
    """获取模型缓存统计信息"""
    with _model_cache_lock:
        return {
            "cache_size": len(_model_cache),
            "models": {name: stats.copy() for name, stats in _model_cache_stats.items()},
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

    def _resolve_model_name(self, model_name: str | None = None) -> str:
        config = get_app_config()
        wanted = model_name or self.default_model
        if wanted and config.get_model_config(wanted) is not None:
            return wanted
        if config.models:
            fallback = config.models[0].name
            if wanted != fallback:
                logger.warning("模型 %s 未在 deerflow 配置中找到，回退到 %s", wanted, fallback)
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

        try:
            return llm.model_copy(update=updates)
        except Exception as exc:
            logger.warning("model_copy 设置运行时参数失败，使用原始模型: %s", exc)
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
        **_: Any,
    ) -> dict[str, Any]:
        """非流式文本生成，返回与历史接口兼容的 dict。"""
        start_time = time.time()
        model_name = self._resolve_model_name(model)

        try:
            llm = _get_cached_model(model_name)  # 使用缓存
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
        处理 tool_calls 循环（真实执行版）

        当模型返回 tool_calls 时：
        1. 在已绑定的工具中查找对应名称的工具
        2. 执行工具并获取真实结果
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
                "🔧 第 %s 次工具调用循环，共 %s 个工具需要执行",
                iteration + 1,
                len(tool_calls),
            )

            # 执行每个工具调用
            for tool_call in tool_calls:
                start_time = time.time()
                tool_name = tool_call.get("name", "unknown")
                tool_args = tool_call.get("args", {})
                tool_id = tool_call.get("id", f"call_{iteration}_{tool_name}")

                try:
                    # 在已绑定工具中查找并执行
                    tool_result = await self._execute_tool_call(
                        tool_name=tool_name,
                        tool_args=tool_args,
                        tools=tools,
                    )

                    execution_time_ms = (time.time() - start_time) * 1000
                    iteration_stats["successful_calls"] += 1
                    iteration_stats["total_execution_time_ms"] += execution_time_ms

                    logger.info(
                        "✅ 工具 [%s] 执行成功 (耗时 %.0fms): %s",
                        tool_name,
                        execution_time_ms,
                        str(tool_result)[:100] + ("..." if len(str(tool_result)) > 100 else ""),
                    )

                    current_messages.append(
                        ToolMessage(content=str(tool_result), tool_call_id=tool_id)
                    )

                except Exception as exc:
                    execution_time_ms = (time.time() - start_time) * 1000
                    iteration_stats["failed_calls"] += 1
                    iteration_stats["total_execution_time_ms"] += execution_time_ms

                    error_msg = f"Error executing {tool_name}: {str(exc)}"
                    logger.warning(
                        "❌ 工具 [%s] 执行失败 (耗时 %.0fms): %s",
                        tool_name,
                        execution_time_ms,
                        str(exc),
                    )

                    current_messages.append(
                        ToolMessage(content=error_msg, tool_call_id=tool_id)
                    )

            # 再次调用模型，继续推理
            last_response = await llm.ainvoke(current_messages)

        # 输出统计日志
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
        llm = _get_cached_model(model_name)  # 使用缓存
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
        **_: Any,
    ) -> dict[str, Any]:
        """非流式文本生成（messages数组直传版本）。"""
        start_time = time.time()
        model_name = self._resolve_model_name(model)
        llm = _get_cached_model(model_name)  # 使用缓存
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
        **_: Any,
    ) -> AsyncGenerator[str, None]:
        """流式文本生成（messages数组直传版本）。"""
        model_name = self._resolve_model_name(model)
        llm = _get_cached_model(model_name)  # 使用缓存
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
            cleaned = self._clean_json_response(raw_content)

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


def create_user_ai_service_with_mcp(
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
    return create_user_ai_service(
        api_provider=api_provider,
        api_key=api_key,
        api_base_url=api_base_url,
        model_name=model_name,
        temperature=temperature,
        max_tokens=max_tokens,
        system_prompt=system_prompt,
        user_id=user_id,
        db_session=db_session,
        enable_mcp=enable_mcp,
    )
