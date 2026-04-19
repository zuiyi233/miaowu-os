"""Global AI Provider API endpoints.

提供统一的AI服务接口，供前端全局调用。
支持多供应商配置、连接测试、请求转发等功能。
"""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import json
import os
import time
from collections import deque
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.core.user_context import get_request_user_id
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.services.ai_service import AIService

logger = get_logger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])
_ACCESS_TOKEN_ENV = "DEERFLOW_AI_PROVIDER_API_TOKEN"
_RATE_LIMIT_ENV = "DEERFLOW_AI_PROVIDER_RATE_LIMIT_PER_MINUTE"
_REQUEST_WINDOWS: dict[str, deque[float]] = {}


class AiMessage(BaseModel):
    role: str = Field(..., description="消息角色: user/assistant/system")
    content: str = Field(..., description="消息内容")


class AiProviderConfig(BaseModel):
    provider: str = Field(..., description="供应商类型: openai/anthropic/google/custom")
    api_key: str | None = Field(None, description="已废弃，后端不再接收明文 API 密钥")
    base_url: str = Field("", description="自定义API地址")
    model_name: str = Field(..., description="模型名称")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="温度参数")
    max_tokens: int = Field(2000, ge=1, description="最大token数")


class AiChatRequest(BaseModel):
    messages: list[AiMessage] = Field(..., description="消息列表")
    stream: bool = Field(True, description="是否使用流式响应")
    context: dict[str, Any] | None = Field(None, description="上下文信息")
    provider_config: AiProviderConfig = Field(..., description="供应商配置")


class TestConnectionRequest(BaseModel):
    provider: str | None = Field(None, description="已废弃，保留兼容")
    api_key: str | None = Field(None, description="已废弃，后端不再接收明文 API 密钥")
    base_url: str = Field("", description="已废弃，保留兼容")
    model: str = Field(..., description="模型名称")


def _extract_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "").strip()
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        return None
    return auth_header[7:].strip() or None


def _is_loopback_host(host: str) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _resolve_client_host(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded_for:
        return forwarded_for
    return request.client.host if request.client else ""


def _get_rate_limit_per_minute() -> int:
    configured = (os.getenv(_RATE_LIMIT_ENV) or "").strip()
    if not configured:
        return 30
    try:
        parsed = int(configured)
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to 30", _RATE_LIMIT_ENV, configured)
        return 30
    return max(1, parsed)


def _enforce_access_control(request: Request) -> None:
    expected_token = (os.getenv(_ACCESS_TOKEN_ENV) or "").strip()
    presented_token = _extract_bearer_token(request)
    client_host = _resolve_client_host(request)

    if expected_token:
        if presented_token and hmac.compare_digest(presented_token, expected_token):
            return
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Unauthorized. Provide Bearer token configured via {_ACCESS_TOKEN_ENV}.",
        )

    if _is_loopback_host(client_host):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            "AI provider endpoints are restricted to loopback requests by default. "
            f"Set {_ACCESS_TOKEN_ENV} and call with Bearer token for remote access."
        ),
    )


def _enforce_rate_limit(scope: str) -> None:
    limit = _get_rate_limit_per_minute()
    now = time.monotonic()
    window = _REQUEST_WINDOWS.setdefault(scope, deque())
    while window and now - window[0] >= 60:
        window.popleft()

    if len(window) >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded: max {limit} requests per minute.",
        )
    window.append(now)


@router.post("/chat")
async def chat_endpoint(
    request: Request,
    body: AiChatRequest,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """统一AI聊天接口。

    接收前端请求，根据provider_config动态创建AI服务实例并执行请求。
    支持流式和非流式两种模式。
    """
    try:
        _enforce_access_control(request)
        _enforce_rate_limit(f"chat:{get_request_user_id(request)}")
        if body.provider_config.api_key:
            logger.warning("Deprecated field provider_config.api_key was provided and ignored for /api/ai/chat")

        prompt = _build_prompt_from_messages(body.messages)

        if body.stream:
            return StreamingResponse(
                _stream_generator(ai_service, prompt, body.provider_config),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            )

        result = await ai_service.generate_text(
            prompt=prompt,
            model=body.provider_config.model_name,
            temperature=body.provider_config.temperature,
            max_tokens=body.provider_config.max_tokens,
        )

        return JSONResponse(content={"content": result.get("content", "")})

    except ValueError as exc:
        logger.error("AI service configuration error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("AI request failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"AI 请求失败: {str(exc)}")


async def _stream_generator(ai_service: AIService, prompt: str, config: AiProviderConfig):
    """流式响应生成器。

    使用SSE (Server-Sent Events) 格式返回流式数据。
    """
    try:
        async for chunk in ai_service.generate_text_stream(
            prompt=prompt,
            model=config.model_name,
            temperature=config.temperature,
            max_tokens=config.max_tokens,
        ):
            if isinstance(chunk, str) and chunk:
                data = json.dumps({"content": chunk}, ensure_ascii=False)
                yield f"data: {data}\n\n"

        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error("Stream generation error: %s", e)
        error_data = json.dumps({"error": str(e)}, ensure_ascii=False)
        yield f"data: {error_data}\n\n"


@router.post("/test-connection")
async def test_connection_endpoint(
    request: Request,
    body: TestConnectionRequest,
    ai_service: AIService = Depends(get_user_ai_service),
):
    """测试AI供应商连接是否正常。"""
    try:
        _enforce_access_control(request)
        _enforce_rate_limit(f"test-connection:{get_request_user_id(request)}")
        if body.api_key:
            logger.warning("Deprecated field api_key was provided and ignored for /api/ai/test-connection")

        start_time = asyncio.get_event_loop().time()

        test_result = await ai_service.generate_text(
            prompt="Hi",
            model=body.model,
            temperature=0.1,
            max_tokens=5,
        )

        latency_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)

        return JSONResponse(
            content={
                "success": True,
                "message": f"连接成功 ({latency_ms}ms)",
                "latency": latency_ms,
                "test_response": test_result.get("content", "")[:50],
            }
        )

    except Exception as exc:
        logger.error("Connection test failed: %s", exc)
        return JSONResponse(
            content={
                "success": False,
                "message": f"连接失败: {str(exc)}",
            },
            status_code=200,
        )


@router.get("/providers")
async def list_available_providers(request: Request):
    """获取支持的供应商列表及其默认配置信息。"""
    _enforce_access_control(request)
    providers = [
        {
            "id": "openai",
            "name": "OpenAI",
            "description": "GPT-4o、GPT-4o-mini 等模型",
            "default_base_url": "https://api.openai.com/v1",
            "popular_models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
        },
        {
            "id": "anthropic",
            "name": "Anthropic (Claude)",
            "description": "Claude 3.5 Sonnet、Claude 3 Opus 等模型",
            "default_base_url": "https://api.anthropic.com",
            "popular_models": [
                "claude-sonnet-4-20250514",
                "claude-opus-4-20250514",
                "claude-3-5-haiku-20241022",
            ],
        },
        {
            "id": "google",
            "name": "Google (Gemini)",
            "description": "Gemini Pro、Gemini Ultra 等模型",
            "default_base_url": "https://generativelanguage.googleapis.com/v1beta",
            "popular_models": ["gemini-pro", "gemini-1.5-pro", "gemini-ultra"],
        },
        {
            "id": "custom",
            "name": "自定义/OpenAI兼容",
            "description": "任何兼容 OpenAI API 格式的服务",
            "default_base_url": "",
            "popular_models": [],
        },
    ]

    return JSONResponse(content={"providers": providers})


def _build_prompt_from_messages(messages: list[AiMessage]) -> str:
    """将消息列表转换为单个prompt字符串。

    对于简单的实现，将所有消息拼接为一个prompt。
    后续可优化为支持完整的对话历史格式。
    """
    parts = []

    for msg in messages:
        if msg.role == "system":
            parts.append(f"[System]: {msg.content}")
        elif msg.role == "user":
            parts.append(f"[User]: {msg.content}")
        elif msg.role == "assistant":
            parts.append(f"[Assistant]: {msg.content}")

    return "\n\n".join(parts)
