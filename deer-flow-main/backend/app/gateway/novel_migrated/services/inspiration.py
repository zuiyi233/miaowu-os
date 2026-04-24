"""Shared inspiration generation service.

Extracts duplicated generate/refine logic from API routes while keeping
response contracts compatible with existing inspiration endpoints.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService

logger = get_logger(__name__)

_TEMPLATE_KEY_MAP: dict[str, tuple[str, str]] = {
    "title": ("INSPIRATION_TITLE_SYSTEM", "INSPIRATION_TITLE_USER"),
    "description": ("INSPIRATION_DESCRIPTION_SYSTEM", "INSPIRATION_DESCRIPTION_USER"),
    "theme": ("INSPIRATION_THEME_SYSTEM", "INSPIRATION_THEME_USER"),
    "genre": ("INSPIRATION_GENRE_SYSTEM", "INSPIRATION_GENRE_USER"),
}

_TEMPERATURE_SETTINGS: dict[str, float] = {
    "title": 0.8,
    "description": 0.65,
    "theme": 0.55,
    "genre": 0.45,
}


def _handle_empty_content(content: str, attempt: int, max_retries: int, step: str) -> dict[str, Any] | None:
    if content.strip():
        return None
    logger.warning("第%s次AI返回为空内容，可能模型调用失败", attempt + 1)
    if attempt < max_retries - 1:
        return {"_retry": True}
    return {
        "prompt": f"请为【{step}】提供内容：",
        "options": ["让AI重新生成", "我自己输入"],
        "error": "AI返回为空，可能模型配置有误或API不可用",
    }


def validate_options_response(result: dict[str, Any], step: str) -> tuple[bool, str]:
    """Validate inspiration options payload."""
    if "options" not in result:
        return False, "缺少options字段"

    options = result.get("options", [])
    if not isinstance(options, list):
        return False, "options必须是数组"

    if len(options) < 3:
        return False, f"选项数量不足，至少需要3个，当前只有{len(options)}个"
    if len(options) > 10:
        return False, f"选项数量过多，最多10个，当前有{len(options)}个"

    for index, option in enumerate(options, start=1):
        if not isinstance(option, str):
            return False, f"第{index}个选项不是字符串类型"
        if not option.strip():
            return False, f"第{index}个选项为空"
        if len(option) > 500:
            return False, f"第{index}个选项过长（超过500字符）"

    if step == "genre":
        for option in options:
            if len(option) > 10:
                return False, f"类型标签【{option}】过长，应该在2-10字之间"

    return True, ""


@dataclass(slots=True)
class InspirationService:
    """Encapsulates inspiration generate/refine flows."""

    ai_service: AIService
    user_id: str
    db_session: Any
    max_retries: int = 3

    async def generate_options(self, *, step: str, context: dict[str, Any]) -> dict[str, Any]:
        return await self._generate_options_common(step=step, context=context, feedback="", previous_options=[])

    async def refine_options(
        self,
        *,
        step: str,
        context: dict[str, Any],
        feedback: str,
        previous_options: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        normalized_previous = [str(item) for item in previous_options or []]
        return await self._generate_options_common(
            step=step,
            context=context,
            feedback=feedback,
            previous_options=normalized_previous,
        )

    async def _generate_options_common(
        self,
        *,
        step: str,
        context: dict[str, Any],
        feedback: str,
        previous_options: list[str],
    ) -> dict[str, Any]:
        if step not in _TEMPLATE_KEY_MAP:
            return {"error": f"不支持的步骤: {step}", "prompt": "", "options": []}

        for attempt in range(self.max_retries):
            try:
                logger.info("灵感模式：生成%s阶段的选项（第%s次尝试）", step, attempt + 1)
                system_prompt, user_prompt = await self._build_prompts(step=step, context=context)
                system_prompt = self._build_runtime_system_prompt(
                    base_system_prompt=system_prompt,
                    attempt=attempt,
                    feedback=feedback,
                    previous_options=previous_options,
                )
                temperature = self._resolve_temperature(step=step, has_feedback=bool(feedback.strip()))
                logger.info("调用AI生成%s选项... (temperature=%s)", step, temperature)

                content = await self._collect_streamed_text(
                    prompt=user_prompt,
                    system_prompt=system_prompt,
                    temperature=temperature,
                )
                logger.info("AI返回内容长度: %s", len(content))

                empty_result = _handle_empty_content(content, attempt, self.max_retries, step)
                if empty_result is not None:
                    if empty_result.get("_retry"):
                        continue
                    return empty_result

                parsed_or_error = self._parse_json_with_validation(content=content, step=step)
                if isinstance(parsed_or_error, dict) and parsed_or_error.get("_validation_error"):
                    logger.warning("第%s次生成格式校验失败: %s", attempt + 1, parsed_or_error["_validation_error"])
                    if attempt < self.max_retries - 1:
                        logger.info("准备重试...")
                        continue
                    return self._build_validation_fallback(step=step, message=str(parsed_or_error["_validation_error"]), max_retries=self.max_retries)

                return parsed_or_error
            except json.JSONDecodeError as exc:
                logger.error("第%s次JSON解析失败: %s", attempt + 1, exc)
                if attempt < self.max_retries - 1:
                    logger.info("JSON解析失败，准备重试...")
                    continue
                return self._build_json_fallback(step=step, max_retries=self.max_retries)
            except Exception as exc:  # noqa: BLE001
                logger.error("第%s次生成失败: %s", attempt + 1, exc, exc_info=True)
                if attempt < self.max_retries - 1:
                    logger.info("发生异常，准备重试...")
                    continue
                return {"error": str(exc), "prompt": "生成失败，请重试", "options": ["重新生成", "我自己输入"]}

        return {"error": "生成失败", "prompt": "请重试", "options": []}

    async def _build_prompts(self, *, step: str, context: dict[str, Any]) -> tuple[str, str]:
        system_key, user_key = _TEMPLATE_KEY_MAP[step]
        system_template = await PromptService.get_template(system_key, self.user_id, self.db_session)
        user_template = await PromptService.get_template(user_key, self.user_id, self.db_session)

        format_params = {
            "initial_idea": context.get("initial_idea", context.get("description", "")),
            "title": context.get("title", ""),
            "description": context.get("description", ""),
            "theme": context.get("theme", ""),
        }
        return system_template.format(**format_params), user_template.format(**format_params)

    def _build_runtime_system_prompt(
        self,
        *,
        base_system_prompt: str,
        attempt: int,
        feedback: str,
        previous_options: Sequence[str],
    ) -> str:
        system_prompt = base_system_prompt
        feedback_text = feedback.strip()
        if feedback_text:
            previous_text = "\n".join([f"- {option}" for option in previous_options]) if previous_options else "（无）"
            system_prompt += f"""

用户对之前的选项不太满意，提供了以下反馈：
「{feedback_text}」

之前生成的选项：
{previous_text}

请根据用户的反馈调整生成策略，提供更符合用户期望的新选项。
注意：
1. 仔细理解用户的反馈意图
2. 生成的新选项要明显体现用户要求的调整方向
3. 保持与已有上下文的一致性
4. 确保返回6个有效选项
"""

        if attempt > 0:
            system_prompt += (
                f"\n\n这是第{attempt + 1}次生成，请务必严格按照JSON格式返回，"
                "确保options数组包含6个有效选项！"
            )

        return system_prompt

    def _resolve_temperature(self, *, step: str, has_feedback: bool) -> float:
        base = _TEMPERATURE_SETTINGS.get(step, 0.7)
        if has_feedback:
            return min(base + 0.1, 0.9)
        return base

    async def _collect_streamed_text(self, *, prompt: str, system_prompt: str, temperature: float) -> str:
        chunks: list[str] = []
        async for chunk in self.ai_service.generate_text_stream(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=temperature,
        ):
            chunks.append(str(chunk))
        return "".join(chunks)

    @staticmethod
    def _build_validation_fallback(*, step: str, message: str, max_retries: int) -> dict[str, Any]:
        return {
            "prompt": f"请为【{step}】提供内容：",
            "options": ["让AI重新生成", "我自己输入"],
            "error": f"AI生成格式错误（{message}），已自动重试{max_retries}次，请手动重试或自己输入",
        }

    @staticmethod
    def _build_json_fallback(*, step: str, max_retries: int) -> dict[str, Any]:
        return {
            "prompt": f"请为【{step}】提供内容：",
            "options": ["让AI重新生成", "我自己输入"],
            "error": f"AI返回格式错误，已自动重试{max_retries}次，请手动重试或自己输入",
        }

    @staticmethod
    def _parse_json_with_validation(*, content: str, step: str) -> dict[str, Any]:
        cleaned_content = AIService.clean_json_response(content)
        result = json.loads(cleaned_content)
        is_valid, error_msg = validate_options_response(result, step)
        if not is_valid:
            return {"_validation_error": error_msg}
        return result
