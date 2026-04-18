"""Global AI Provider API endpoints.

提供统一的AI服务接口，供前端全局调用。
支持多供应商配置、连接测试、请求转发等功能。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import (
    AIService,
    create_user_ai_service,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


class AiMessage(BaseModel):
    role: str = Field(..., description="消息角色: user/assistant/system")
    content: str = Field(..., description="消息内容")


class AiProviderConfig(BaseModel):
    provider: str = Field(..., description="供应商类型: openai/anthropic/google/custom")
    api_key: str = Field(..., description="API密钥")
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
    provider: str = Field(..., description="供应商类型")
    api_key: str = Field(..., description="API密钥")
    base_url: str = Field("", description="API地址")
    model: str = Field(..., description="模型名称")


@router.post("/chat")
async def chat_endpoint(
    request: Request,
    body: AiChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """统一AI聊天接口。

    接收前端请求，根据provider_config动态创建AI服务实例并执行请求。
    支持流式和非流式两种模式。
    """
    try:
        ai_service = create_user_ai_service(
            api_provider=body.provider_config.provider,
            api_key=body.provider_config.api_key,
            api_base_url=body.provider_config.base_url,
            model_name=body.provider_config.model_name,
            temperature=body.provider_config.temperature,
            max_tokens=body.provider_config.max_tokens,
            enable_mcp=False,
        )

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
            temperature=body.provider_config.temperature,
            max_tokens=body.provider_config.max_tokens,
        )

        return JSONResponse(content={"content": result.get("content", "")})

    except ValueError as exc:
        logger.error("AI service configuration error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))
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
async def test_connection_endpoint(body: TestConnectionRequest):
    """测试AI供应商连接是否正常。"""
    try:
        start_time = asyncio.get_event_loop().time()

        ai_service = create_user_ai_service(
            api_provider=body.provider,
            api_key=body.api_key,
            api_base_url=body.base_url,
            model_name=body.model,
            temperature=0.1,
            max_tokens=5,
        )

        test_result = await ai_service.generate_text(
            prompt="Hi",
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
async def list_available_providers():
    """获取支持的供应商列表及其默认配置信息。"""
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
