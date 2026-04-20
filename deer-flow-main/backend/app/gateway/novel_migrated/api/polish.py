"""文本润色API"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import AIService

logger = get_logger(__name__)
router = APIRouter(prefix="/polish", tags=["polish"])


class PolishRequest(BaseModel):
    text: str = Field(..., min_length=1, description="需要润色的文本")
    instructions: str = Field("", description="润色指令")
    style: str = Field("literary", description="润色风格: literary/formal/casual/vivid/concise")
    preserve_tone: bool = Field(True, description="是否保持原有语气")


class PolishResponse(BaseModel):
    original_text: str
    polished_text: str
    changes_summary: str = ""


@router.post("", response_model=PolishResponse)
async def polish_text(
    req: PolishRequest,
    user_id: str = Depends(get_user_id),
    ai_service: AIService = Depends(get_user_ai_service),
):
    style_map = {
        "literary": "文学性润色：增强文字的文学性和艺术性，使用更优美的词汇和句式",
        "formal": "正式润色：使文字更加正式、规范，适合严肃场景",
        "casual": "轻松润色：使文字更加自然、流畅，贴近口语化表达",
        "vivid": "生动润色：增强描写的画面感和生动性，加入更多感官细节",
        "concise": "精简润色：去除冗余，使文字更加精炼有力",
    }

    style_instruction = style_map.get(req.style, style_map["literary"])

    system_prompt = f"""你是一位专业的文字编辑，擅长对小说文本进行润色优化。

润色风格：{style_instruction}

要求：
1. 保持原文的核心含义和情节不变
2. {"保持原有语气和叙事风格" if req.preserve_tone else "可以调整语气和叙事风格"}
3. 优化文字的流畅度和可读性
4. 修正语法和用词问题
5. 增强文字的表现力

请直接输出润色后的文本，不要添加任何解释或注释。"""

    user_prompt = req.text
    if req.instructions:
        user_prompt = f"【额外润色要求】\n{req.instructions}\n\n【原文】\n{req.text}"

    accumulated = ""
    async for chunk in ai_service.generate_text_stream(
        prompt=user_prompt, system_prompt=system_prompt, temperature=0.5
    ):
        accumulated += chunk

    return PolishResponse(
        original_text=req.text,
        polished_text=accumulated,
        changes_summary="润色完成"
    )
