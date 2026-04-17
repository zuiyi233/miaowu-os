"""灵感模式 API - 通过对话引导创建项目。"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import AIService

try:
    from app.gateway.novel_migrated.services.prompt_service import PromptService
except Exception:
    class PromptService:  # type: ignore[no-redef]
        """PromptService fallback to keep inspiration API runnable."""

        INSPIRATION_TITLE_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}

请根据用户的想法，生成6个吸引人的书名建议，要求：
1. 紧扣用户的原始想法和核心故事构思
2. 富有创意和吸引力
3. 涵盖不同的风格倾向
4. 书名中不要带有"《》"符号

返回JSON格式：
{{
    "prompt": "根据你的想法，我为你准备了几个书名建议：",
    "options": ["书名1", "书名2", "书名3", "书名4", "书名5", "书名6"]
}}

只返回纯JSON，不要有其他文字。"""

        INSPIRATION_TITLE_USER = "用户的想法：{initial_idea}\n请生成6个书名建议"

        INSPIRATION_DESCRIPTION_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}
已确定的书名：{title}

请生成6个精彩的小说简介，要求：
1. 必须紧扣用户的原始想法，确保简介是原始想法的具体展开
2. 符合已确定的书名风格
3. 简洁有力，每个50-100字
4. 包含核心冲突
5. 涵盖不同的故事走向，但都基于用户的原始构思

返回JSON格式：
{{"prompt":"选择一个简介：","options":["简介1","简介2","简介3","简介4","简介5","简介6"]}}

只返回纯JSON，不要有其他文字，不要换行。"""

        INSPIRATION_DESCRIPTION_USER = "原始想法：{initial_idea}\n书名：{title}\n请生成6个简介选项"

        INSPIRATION_THEME_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}
小说信息：
- 书名：{title}
- 简介：{description}

请生成6个深刻的主题选项，要求：
1. 必须与用户的原始想法保持高度一致
2. 符合书名和简介的风格
3. 有深度和思想性
4. 每个50-150字
5. 涵盖不同角度（如：成长、复仇、救赎、探索等），但都围绕用户的核心构思

返回JSON格式：
{{"prompt":"这本书的核心主题是什么？","options":["主题1","主题2","主题3","主题4","主题5","主题6"]}}

只返回纯JSON，不要有其他文字，不要换行。"""

        INSPIRATION_THEME_USER = "原始想法：{initial_idea}\n书名：{title}\n简介：{description}\n请生成6个主题选项"

        INSPIRATION_GENRE_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}
小说信息：
- 书名：{title}
- 简介：{description}
- 主题：{theme}

请生成6个合适的类型标签（每个2-4字），要求：
1. 必须符合用户原始想法中暗示的类型倾向
2. 符合小说整体风格
3. 可以多选组合

常见类型：玄幻、都市、科幻、武侠、仙侠、历史、言情、悬疑、奇幻、修仙等

返回JSON格式：
{{"prompt":"选择类型标签（可多选）：","options":["类型1","类型2","类型3","类型4","类型5","类型6"]}}

只返回紧凑的纯JSON，不要换行，不要有其他文字。"""

        INSPIRATION_GENRE_USER = (
            "原始想法：{initial_idea}\n书名：{title}\n简介：{description}\n主题：{theme}\n请生成6个类型标签"
        )

        INSPIRATION_QUICK_COMPLETE = """你是一位专业的小说创作顾问。用户提供了部分小说信息，请补全缺失的字段。

用户已提供的信息：
{existing}

请生成完整的小说方案，包含：
1. title: 书名（3-6字，如果用户已提供则保持原样）
2. description: 简介（50-100字，必须基于用户提供的信息，不要偏离原意）
3. theme: 核心主题（30-50字，必须与用户提供的信息保持一致）
4. genre: 类型标签数组（2-3个）

重要：所有补全的内容都必须与用户提供的信息保持高度关联，确保前后一致性。

返回JSON格式：
{{
    "title": "书名",
    "description": "简介内容...",
    "theme": "主题内容...",
    "genre": ["类型1", "类型2"]
}}

只返回纯JSON，不要有其他文字。"""

        _INSPIRATION_TEMPLATES = {
            "INSPIRATION_TITLE_SYSTEM": INSPIRATION_TITLE_SYSTEM,
            "INSPIRATION_TITLE_USER": INSPIRATION_TITLE_USER,
            "INSPIRATION_DESCRIPTION_SYSTEM": INSPIRATION_DESCRIPTION_SYSTEM,
            "INSPIRATION_DESCRIPTION_USER": INSPIRATION_DESCRIPTION_USER,
            "INSPIRATION_THEME_SYSTEM": INSPIRATION_THEME_SYSTEM,
            "INSPIRATION_THEME_USER": INSPIRATION_THEME_USER,
            "INSPIRATION_GENRE_SYSTEM": INSPIRATION_GENRE_SYSTEM,
            "INSPIRATION_GENRE_USER": INSPIRATION_GENRE_USER,
            "INSPIRATION_QUICK_COMPLETE": INSPIRATION_QUICK_COMPLETE,
        }

        @staticmethod
        async def get_template(template_name: str, user_id: str | None, db: AsyncSession) -> str:
            del user_id, db
            return PromptService._INSPIRATION_TEMPLATES.get(template_name, "")

        @staticmethod
        def format_prompt(template: str, **kwargs: Any) -> str:
            try:
                return template.format(**kwargs)
            except Exception:
                return template


router = APIRouter(prefix="/api/inspiration", tags=["灵感模式"])
logger = get_logger(__name__)


# 不同阶段的 temperature 设置（递减以保持一致性）
TEMPERATURE_SETTINGS = {
    "title": 0.8,        # 书名阶段可以更有创意
    "description": 0.65, # 简介需要贴合书名和原始想法
    "theme": 0.55,       # 主题需要更加贴合
    "genre": 0.45,       # 类型应该很明确
}


def validate_options_response(result: dict[str, Any], step: str) -> tuple[bool, str]:
    """校验 AI 返回的选项格式是否正确。"""
    if "options" not in result:
        return False, "缺少options字段"

    options = result.get("options", [])
    if not isinstance(options, list):
        return False, "options必须是数组"

    if len(options) < 3:
        return False, f"选项数量不足，至少需要3个，当前只有{len(options)}个"
    if len(options) > 10:
        return False, f"选项数量过多，最多10个，当前有{len(options)}个"

    for i, option in enumerate(options):
        if not isinstance(option, str):
            return False, f"第{i + 1}个选项不是字符串类型"
        if not option.strip():
            return False, f"第{i + 1}个选项为空"
        if len(option) > 500:
            return False, f"第{i + 1}个选项过长（超过500字符）"

    if step == "genre":
        for option in options:
            if len(option) > 10:
                return False, f"类型标签【{option}】过长，应该在2-10字之间"

    return True, ""


@router.post("/generate-options")
async def generate_options(
    data: dict[str, Any],
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
) -> dict[str, Any]:
    """根据当前收集的信息生成下一步的选项建议（带自动重试）。"""
    max_retries = 3

    for attempt in range(max_retries):
        try:
            step = data.get("step", "title")
            context = data.get("context", {})

            logger.info("灵感模式：生成%s阶段的选项（第%s次尝试）", step, attempt + 1)
            user_id = get_user_id(http_request)

            template_key_map = {
                "title": ("INSPIRATION_TITLE_SYSTEM", "INSPIRATION_TITLE_USER"),
                "description": ("INSPIRATION_DESCRIPTION_SYSTEM", "INSPIRATION_DESCRIPTION_USER"),
                "theme": ("INSPIRATION_THEME_SYSTEM", "INSPIRATION_THEME_USER"),
                "genre": ("INSPIRATION_GENRE_SYSTEM", "INSPIRATION_GENRE_USER"),
            }
            template_keys = template_key_map.get(step)

            if not template_keys:
                return {"error": f"不支持的步骤: {step}", "prompt": "", "options": []}

            system_key, user_key = template_keys
            system_template = await PromptService.get_template(system_key, user_id, db)
            user_template = await PromptService.get_template(user_key, user_id, db)

            format_params = {
                "initial_idea": context.get("initial_idea", context.get("description", "")),
                "title": context.get("title", ""),
                "description": context.get("description", ""),
                "theme": context.get("theme", ""),
            }

            system_prompt = system_template.format(**format_params)
            user_prompt = user_template.format(**format_params)

            if attempt > 0:
                system_prompt += (
                    f"\n\n⚠️ 这是第{attempt + 1}次生成，请务必严格按照JSON格式返回，"
                    "确保options数组包含6个有效选项！"
                )

            temperature = TEMPERATURE_SETTINGS.get(step, 0.7)
            logger.info("调用AI生成%s选项... (temperature=%s)", step, temperature)

            accumulated_text = ""
            async for chunk in ai_service.generate_text_stream(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=temperature,
            ):
                accumulated_text += chunk

            content = accumulated_text
            logger.info("AI返回内容长度: %s", len(content))

            try:
                cleaned_content = ai_service._clean_json_response(content)
                result = json.loads(cleaned_content)
                is_valid, error_msg = validate_options_response(result, step)

                if not is_valid:
                    logger.warning("⚠️ 第%s次生成格式校验失败: %s", attempt + 1, error_msg)
                    if attempt < max_retries - 1:
                        logger.info("准备重试...")
                        continue
                    return {
                        "prompt": f"请为【{step}】提供内容：",
                        "options": ["让AI重新生成", "我自己输入"],
                        "error": (
                            f"AI生成格式错误（{error_msg}），"
                            f"已自动重试{max_retries}次，请手动重试或自己输入"
                        ),
                    }

                logger.info("✅ 第%s次成功生成%s个有效选项", attempt + 1, len(result.get("options", [])))
                return result

            except json.JSONDecodeError as exc:
                logger.error("第%s次JSON解析失败: %s", attempt + 1, exc)
                if attempt < max_retries - 1:
                    logger.info("JSON解析失败，准备重试...")
                    continue
                return {
                    "prompt": f"请为【{step}】提供内容：",
                    "options": ["让AI重新生成", "我自己输入"],
                    "error": f"AI返回格式错误，已自动重试{max_retries}次，请手动重试或自己输入",
                }

        except Exception as exc:
            logger.error("第%s次生成失败: %s", attempt + 1, exc, exc_info=True)
            if attempt < max_retries - 1:
                logger.info("发生异常，准备重试...")
                continue
            return {"error": str(exc), "prompt": "生成失败，请重试", "options": ["重新生成", "我自己输入"]}

    return {"error": "生成失败", "prompt": "请重试", "options": []}


@router.post("/refine-options")
async def refine_options(
    data: dict[str, Any],
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
) -> dict[str, Any]:
    """基于用户反馈重新生成选项（支持多轮对话）。"""
    max_retries = 3

    for attempt in range(max_retries):
        try:
            step = data.get("step", "title")
            context = data.get("context", {})
            feedback = data.get("feedback", "")
            previous_options = data.get("previous_options", [])

            logger.info("灵感模式：根据反馈重新生成%s阶段选项（第%s次尝试）", step, attempt + 1)
            logger.info("用户反馈: %s", feedback)

            user_id = get_user_id(http_request)
            template_key_map = {
                "title": ("INSPIRATION_TITLE_SYSTEM", "INSPIRATION_TITLE_USER"),
                "description": ("INSPIRATION_DESCRIPTION_SYSTEM", "INSPIRATION_DESCRIPTION_USER"),
                "theme": ("INSPIRATION_THEME_SYSTEM", "INSPIRATION_THEME_USER"),
                "genre": ("INSPIRATION_GENRE_SYSTEM", "INSPIRATION_GENRE_USER"),
            }
            template_keys = template_key_map.get(step)

            if not template_keys:
                return {"error": f"不支持的步骤: {step}", "prompt": "", "options": []}

            system_key, user_key = template_keys
            system_template = await PromptService.get_template(system_key, user_id, db)
            user_template = await PromptService.get_template(user_key, user_id, db)

            format_params = {
                "initial_idea": context.get("initial_idea", context.get("description", "")),
                "title": context.get("title", ""),
                "description": context.get("description", ""),
                "theme": context.get("theme", ""),
            }

            system_prompt = system_template.format(**format_params)
            user_prompt = user_template.format(**format_params)

            previous_text = "\n".join([f"- {opt}" for opt in previous_options]) if previous_options else "（无）"
            feedback_instruction = f"""

⚠️ 用户对之前的选项不太满意，提供了以下反馈：
「{feedback}」

之前生成的选项：
{previous_text}

请根据用户的反馈调整生成策略，提供更符合用户期望的新选项。
注意：
1. 仔细理解用户的反馈意图
2. 生成的新选项要明显体现用户要求的调整方向
3. 保持与已有上下文的一致性
4. 确保返回6个有效选项
"""
            system_prompt += feedback_instruction

            if attempt > 0:
                system_prompt += f"\n\n⚠️ 这是第{attempt + 1}次生成，请务必严格按照JSON格式返回！"

            temperature = min(TEMPERATURE_SETTINGS.get(step, 0.7) + 0.1, 0.9)
            logger.info("调用AI根据反馈生成%s选项... (temperature=%s)", step, temperature)

            accumulated_text = ""
            async for chunk in ai_service.generate_text_stream(
                prompt=user_prompt,
                system_prompt=system_prompt,
                temperature=temperature,
            ):
                accumulated_text += chunk

            content = accumulated_text
            logger.info("AI返回内容长度: %s", len(content))

            try:
                cleaned_content = ai_service._clean_json_response(content)
                result = json.loads(cleaned_content)
                is_valid, error_msg = validate_options_response(result, step)

                if not is_valid:
                    logger.warning("⚠️ 第%s次生成格式校验失败: %s", attempt + 1, error_msg)
                    if attempt < max_retries - 1:
                        logger.info("准备重试...")
                        continue
                    return {
                        "prompt": f"请为【{step}】提供内容：",
                        "options": ["让AI重新生成", "我自己输入"],
                        "error": f"AI生成格式错误（{error_msg}），已自动重试{max_retries}次",
                    }

                logger.info(
                    "✅ 第%s次根据反馈成功生成%s个有效选项",
                    attempt + 1,
                    len(result.get("options", [])),
                )
                return result

            except json.JSONDecodeError as exc:
                logger.error("第%s次JSON解析失败: %s", attempt + 1, exc)
                if attempt < max_retries - 1:
                    logger.info("JSON解析失败，准备重试...")
                    continue
                return {
                    "prompt": f"请为【{step}】提供内容：",
                    "options": ["让AI重新生成", "我自己输入"],
                    "error": f"AI返回格式错误，已自动重试{max_retries}次",
                }

        except Exception as exc:
            logger.error("第%s次根据反馈生成失败: %s", attempt + 1, exc, exc_info=True)
            if attempt < max_retries - 1:
                logger.info("发生异常，准备重试...")
                continue
            return {"error": str(exc), "prompt": "生成失败，请重试", "options": ["重新生成", "我自己输入"]}

    return {"error": "生成失败", "prompt": "请重试", "options": []}


@router.post("/quick-generate")
async def quick_generate(
    data: dict[str, Any],
    http_request: Request,
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
) -> dict[str, Any]:
    """智能补全：根据用户已提供的部分信息，AI 自动补全缺失字段。"""
    try:
        logger.info("灵感模式：智能补全")
        user_id = get_user_id(http_request)

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
            cleaned_content = ai_service._clean_json_response(content)
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
