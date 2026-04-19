"""AI service bridge for novel_migrated.

设计目标：
1. 复用 deerflow 的模型配置中心与模型工厂，不维护第二套模型配置。
2. 对外兼容参考实现最常用接口：AIService/create_user_ai_service/generate_text_stream。
3. 在可用时桥接 MCP 工具加载（读取 extensions_config），不可用时自动降级。
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.mcp_tools_loader import mcp_tools_loader
from app.gateway.novel_migrated.schemas.ai_message import AiMessage
from deerflow.config import get_app_config
from deerflow.models import create_chat_model

logger = get_logger(__name__)


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
        """将AiMessage[]转换为LangChain消息列表。

        直接映射前端传递的messages数组到LangChain消息类型，
        保留完整的多轮对话结构以激活LLM Provider的缓存机制。

        Args:
            messages: 前端发送的消息列表

        Returns:
            LangChain消息列表（SystemMessage/HumanMessage/AIMessage）
        """
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
        model_name = self._resolve_model_name(model)
        llm = create_chat_model(name=model_name)

        # 尽力设置推理参数（不同 provider 不一定都支持）
        cfg = {
            "temperature": temperature if temperature is not None else self.default_temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.default_max_tokens,
        }

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        messages = self._build_messages(prompt, system_prompt)
        response = await llm.ainvoke(messages, config={"configurable": cfg})

        content = response.content if hasattr(response, "content") else str(response)
        if isinstance(content, list):
            content = "".join(str(part) for part in content)

        return {
            "content": str(content),
            "finish_reason": "stop",
            "tool_calls": getattr(response, "tool_calls", None) or [],
        }

    async def generate_text_stream(
        self,
        prompt: str,
        provider: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
        auto_mcp: bool = True,
        **_: Any,
    ) -> AsyncGenerator[str, None]:
        """流式文本生成；保持与 careers/memories/plot_analyzer 调用兼容。"""
        model_name = self._resolve_model_name(model)
        llm = create_chat_model(name=model_name)

        cfg = {
            "temperature": temperature if temperature is not None else self.default_temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.default_max_tokens,
        }

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        messages = self._build_messages(prompt, system_prompt)

        async for chunk in llm.astream(messages, config={"configurable": cfg}):
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
        """非流式文本生成（messages数组直传版本）。

        直接传递完整的messages数组到LLM Provider，保留多轮对话结构。
        返回与 generate_text() 完全兼容的格式。

        Args:
            messages: 前端发送的消息列表
            provider: 供应商类型（保留兼容）
            model: 模型名称
            temperature: 温度参数
            max_tokens: 最大token数
            auto_mcp: 是否加载MCP工具

        Returns:
            包含 content, finish_reason, tool_calls 的字典
        """
        model_name = self._resolve_model_name(model)
        llm = create_chat_model(name=model_name)

        cfg = {
            "temperature": temperature if temperature is not None else self.default_temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.default_max_tokens,
        }

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        langchain_messages = self._build_messages_from_array(messages)
        response = await llm.ainvoke(langchain_messages, config={"configurable": cfg})

        content = response.content if hasattr(response, "content") else str(response)
        if isinstance(content, list):
            content = "".join(str(part) for part in content)

        return {
            "content": str(content),
            "finish_reason": "stop",
            "tool_calls": getattr(response, "tool_calls", None) or [],
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
        """流式文本生成（messages数组直传版本）。

        直接传递完整的messages数组到LLM Provider，保留多轮对话结构。
        返回类型与 generate_text_stream() 一致。

        Args:
            messages: 前端发送的消息列表
            provider: 供应商类型（保留兼容）
            model: 模型名称
            temperature: 温度参数
            max_tokens: 最大token数
            auto_mcp: 是否加载MCP工具

        Yields:
            文本片段字符串
        """
        model_name = self._resolve_model_name(model)
        llm = create_chat_model(name=model_name)

        cfg = {
            "temperature": temperature if temperature is not None else self.default_temperature,
            "max_tokens": max_tokens if max_tokens is not None else self.default_max_tokens,
        }

        tools = await self._prepare_mcp_tools(auto_mcp=auto_mcp)
        if tools:
            try:
                llm = llm.bind_tools(tools)
            except Exception as exc:
                logger.warning("⚠️ 当前模型不支持 bind_tools，忽略 MCP 工具: %s", exc)

        langchain_messages = self._build_messages_from_array(messages)

        async for chunk in llm.astream(langchain_messages, config={"configurable": cfg}):
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
        """兼容参考实现：清理 markdown 代码块并提取 JSON。"""
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
        """调用模型并进行 JSON 解析重试。

        Args:
            prompt: 输入提示词。
            max_retries: 最大重试次数。
            expected_type: 期望类型，支持 `object` / `array`。
            **kwargs: 透传到 generate_text。

        Returns:
            解析后的 JSON 数据。
        """
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
    """创建用户 AI 服务（兼容历史签名）。"""
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
    """兼容参考实现命名，行为等同 create_user_ai_service。"""
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
