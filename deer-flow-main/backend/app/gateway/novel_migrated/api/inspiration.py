"""灵感模式 API - 通过对话引导创建项目。"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.api.settings import get_user_ai_service_with_overrides
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.inspiration import InspirationService
from app.gateway.novel_migrated.services.prompt_service import PromptService

router = APIRouter(prefix="/api/inspiration", tags=["灵感模式"])
logger = get_logger(__name__)

INSPIRATION_MODULE_ID = "novel-inspiration-wizard"


def _extract_runtime_overrides(data: dict[str, Any]) -> tuple[str | None, str | None, str]:
    ai_provider_id = data.get("ai_provider_id")
    ai_model = data.get("ai_model")
    module_id = data.get("module_id")

    normalized_provider_id = str(ai_provider_id).strip() if isinstance(ai_provider_id, str) else ""
    normalized_model = str(ai_model).strip() if isinstance(ai_model, str) else ""
    normalized_module_id = str(module_id).strip() if isinstance(module_id, str) else ""

    return (
        normalized_provider_id or None,
        normalized_model or None,
        normalized_module_id or INSPIRATION_MODULE_ID,
    )

def _build_inspiration_service(*, ai_service: AIService, user_id: str, db: AsyncSession) -> InspirationService:
    return InspirationService(
        ai_service=ai_service,
        user_id=user_id,
        db_session=db,
        max_retries=10,
    )


@router.post("/generate-options")
async def generate_options(
    data: dict[str, Any],
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """根据当前收集的信息生成下一步的选项建议（带自动重试）。"""
    step = str(data.get("step", "title"))
    context = data.get("context", {})
    if not isinstance(context, dict):
        context = {}

    ai_provider_id, ai_model, module_id = _extract_runtime_overrides(data)
    ai_service = await get_user_ai_service_with_overrides(
        http_request,
        db,
        ai_provider_id=ai_provider_id,
        ai_model=ai_model,
        module_id=module_id,
    )

    user_id = get_user_id(http_request)
    service = _build_inspiration_service(ai_service=ai_service, user_id=user_id, db=db)
    return await service.generate_options(step=step, context=context)


@router.post("/refine-options")
async def refine_options(
    data: dict[str, Any],
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """基于用户反馈重新生成选项（支持多轮对话）。"""
    step = str(data.get("step", "title"))
    context = data.get("context", {})
    if not isinstance(context, dict):
        context = {}

    feedback = str(data.get("feedback", ""))
    raw_previous_options = data.get("previous_options", [])
    if not isinstance(raw_previous_options, list):
        raw_previous_options = []
    previous_options = [str(item) for item in raw_previous_options]

    ai_provider_id, ai_model, module_id = _extract_runtime_overrides(data)
    ai_service = await get_user_ai_service_with_overrides(
        http_request,
        db,
        ai_provider_id=ai_provider_id,
        ai_model=ai_model,
        module_id=module_id,
    )

    user_id = get_user_id(http_request)
    service = _build_inspiration_service(ai_service=ai_service, user_id=user_id, db=db)
    return await service.refine_options(
        step=step,
        context=context,
        feedback=feedback,
        previous_options=previous_options,
    )


@router.post("/quick-generate")
async def quick_generate(
    data: dict[str, Any],
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """智能补全：根据用户已提供的部分信息，AI 自动补全缺失字段。"""
    try:
        logger.info("灵感模式：智能补全")
        user_id = get_user_id(http_request)
        ai_provider_id, ai_model, module_id = _extract_runtime_overrides(data)
        ai_service = await get_user_ai_service_with_overrides(
            http_request,
            db,
            ai_provider_id=ai_provider_id,
            ai_model=ai_model,
            module_id=module_id,
        )

        existing_info = []
        if data.get("title"):
            existing_info.append(f"- 书名：{data['title']}")
        if data.get("description"):
            existing_info.append(f"- 简介：{data['description']}")
        if data.get("theme"):
            existing_info.append(f"- 主题：{data['theme']}")
        if data.get("genre"):
            existing_info.append(f"- 类型：{', '.join(data['genre'])}")

        existing_text = "\n".join(existing_info) if existing_info else "暂无信息"
        system_template = await PromptService.get_template("INSPIRATION_QUICK_COMPLETE", user_id, db)

        prompts = {
            "system": PromptService.format_prompt(system_template, existing=existing_text),
            "user": "请补全小说信息",
        }

        accumulated_text = ""
        async for chunk in ai_service.generate_text_stream(
            prompt=prompts["user"],
            system_prompt=prompts["system"],
            temperature=0.7,
        ):
            accumulated_text += chunk

        content = accumulated_text

        try:
            cleaned_content = ai_service.clean_json_response(content)
            result = json.loads(cleaned_content)
            final_result = {
                "title": data.get("title") or result.get("title", ""),
                "description": data.get("description") or result.get("description", ""),
                "theme": data.get("theme") or result.get("theme", ""),
                "genre": data.get("genre") or result.get("genre", []),
            }
            logger.info("✅ 智能补全成功")
            return final_result
        except json.JSONDecodeError as exc:
            logger.error("JSON解析失败: %s", exc)
            raise Exception("AI返回格式错误，请重试") from exc

    except Exception as exc:
        logger.error("智能补全失败: %s", exc, exc_info=True)
        return {"error": str(exc)}
