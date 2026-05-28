import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.settings import get_user_ai_service_with_overrides
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.schemas.ai_message import AiMessage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["suggestions"])


class SuggestionMessage(BaseModel):
    role: str = Field(..., description="Message role: user|assistant")
    content: str = Field(..., description="Message content as plain text")


class SuggestionsRequest(BaseModel):
    messages: list[SuggestionMessage] = Field(..., description="Recent conversation messages")
    n: int = Field(default=3, ge=1, le=5, description="Number of suggestions to generate")
    model_name: str | None = Field(default=None, description="Optional model override")
    module_id: str | None = Field(default=None, description="Feature module ID for routing (e.g. 'chat-suggestions')")


class SuggestionsResponse(BaseModel):
    suggestions: list[str] = Field(default_factory=list, description="Suggested follow-up questions")


_MODULE_ROUTING_FALLBACK_HINTS = (
    "module",
    "feature-routing",
    "route config",
    "routing",
    "provider_id",
    "module_id",
    "模块",
    "路由",
    "解析",
    "配置",
)
_NO_RETRY_ERROR_HINTS = (
    "authorization",
    "auth",
    "quota",
    "timeout",
    "rate limit",
    "forbidden",
    "429",
    "403",
    "401",
)


def _strip_markdown_code_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if len(lines) >= 3 and lines[0].startswith("```") and lines[-1].startswith("```"):
        return "\n".join(lines[1:-1]).strip()
    return stripped


def _remove_thinking_tags(text: str) -> str:
    text = re.sub(r"<think>[^<]*</think>", "", text, flags=re.DOTALL)
    text = re.sub(r"<thinking>[^<]*</thinking>", "", text, flags=re.DOTALL)
    return text.strip()


def _parse_json_string_list(text: str) -> list[str] | None:
    if not text or not text.strip():
        return None

    cleaned = _remove_thinking_tags(text)
    candidate = _strip_markdown_code_fence(cleaned)

    start = candidate.find("[")
    end = candidate.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return None
    candidate = candidate[start : end + 1]
    try:
        data = json.loads(candidate)
    except Exception:
        return None
    if not isinstance(data, list):
        return None
    out: list[str] = []
    for item in data:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        out.append(s)
    return out


def _coerce_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if s:
            out.append(s)
    return out


def _parse_json_suggestions_object(text: str) -> list[str] | None:
    if not text or not text.strip():
        return None

    cleaned = _remove_thinking_tags(text)
    candidate = _strip_markdown_code_fence(cleaned)

    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(candidate[start : end + 1])
    except Exception:
        return None
    if not isinstance(data, dict):
        return None

    for key in ("suggestions", "questions", "followups", "follow_up_questions"):
        parsed = _coerce_string_list(data.get(key))
        if parsed:
            return parsed
    return None


def _parse_plain_text_suggestions(text: str) -> list[str]:
    if not text or not text.strip():
        return []

    cleaned = _strip_markdown_code_fence(_remove_thinking_tags(text))
    out: list[str] = []
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        line = re.sub(r"^\s*(?:[-*•]\s+|\d+[\).、]\s*)", "", line).strip()
        line = line.strip('"“”')
        if not line:
            continue
        if line.startswith(("[", "{", "```")):
            continue
        out.append(line)
    return out


def _extract_response_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        for key in ("content", "text", "output_text", "message"):
            value = content.get(key)
            if isinstance(value, str):
                return value
        for key in ("suggestions", "questions", "followups", "follow_up_questions"):
            value = content.get(key)
            if isinstance(value, list):
                return json.dumps({key: value}, ensure_ascii=False)
        return json.dumps(content, ensure_ascii=False)
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts) if parts else ""
    if content is None:
        return ""
    return str(content)


def _generate_suggestions_from_raw(raw: str, n: int) -> list[str]:
    suggestions = _parse_json_string_list(raw) or _parse_json_suggestions_object(raw) or _parse_plain_text_suggestions(raw)
    cleaned = [s.replace("\n", " ").strip() for s in suggestions if s.strip()]
    return cleaned[:n]


def _should_retry_without_module(exc: Exception) -> bool:
    message = str(exc).lower()
    if any(hint in message for hint in _NO_RETRY_ERROR_HINTS):
        return False

    # Upstream model lifecycle/deprecation errors should fall back to explicit
    # model_name when provided by caller (e.g. route points to EOL model).
    if _is_model_unavailable_error(exc):
        return True

    if isinstance(exc, (KeyError, ValueError, TypeError)):
        return any(hint in message for hint in _MODULE_ROUTING_FALLBACK_HINTS) if message else True

    return any(hint in message for hint in _MODULE_ROUTING_FALLBACK_HINTS)


def _is_model_unavailable_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    if status_code is None:
        response = getattr(exc, "response", None)
        status_code = getattr(response, "status_code", None)

    message = str(exc).lower()
    model_unavailable_hints = (
        "end of life",
        "no longer available",
        "model_not_found",
        "model unavailable",
        "model has been deprecated",
    )

    has_model_hint = any(hint in message for hint in model_unavailable_hints)
    # 404/410 can also come from non-model faults (resource/path gone).
    # Treat them as model-unavailable only when payload/message contains
    # explicit model lifecycle/not-found hints.
    if status_code in {404, 410}:
        return has_model_hint

    return has_model_hint


async def _run_suggestions_generation(
    *,
    ai_service: Any,
    system_instruction: str,
    user_content: str,
    n: int,
    model_name: str | None,
) -> list[str]:
    result = await ai_service.generate_text_with_messages(
        messages=[
            AiMessage(role="system", content=system_instruction),
            AiMessage(role="user", content=user_content),
        ],
        model=model_name,
        temperature=0.2,
        max_tokens=256,
        auto_mcp=False,
    )
    raw = _extract_response_text(result.get("content"))
    return _generate_suggestions_from_raw(raw, n)


def _format_conversation(messages: list[SuggestionMessage]) -> str:
    parts: list[str] = []
    for m in messages:
        role = m.role.strip().lower()
        if role in ("user", "human"):
            parts.append(f"User: {m.content.strip()}")
        elif role in ("assistant", "ai"):
            parts.append(f"Assistant: {m.content.strip()}")
        else:
            parts.append(f"{m.role}: {m.content.strip()}")
    return "\n".join(parts).strip()


def _fallback_suggestions_from_conversation(messages: list[SuggestionMessage], n: int) -> list[str]:
    last_user = next(
        (
            m.content.strip()
            for m in reversed(messages)
            if m.role.strip().lower() in {"user", "human"} and m.content.strip()
        ),
        "",
    )
    last_assistant = next(
        (
            m.content.strip()
            for m in reversed(messages)
            if m.role.strip().lower() in {"assistant", "ai"} and m.content.strip()
        ),
        "",
    )
    sample = f"{last_user}\n{last_assistant}".strip()
    has_cjk = bool(re.search(r"[\u4e00-\u9fff]", sample))
    if has_cjk:
        candidates = [
            "你能继续展开这个思路吗？",
            "下一步应该怎么做？",
            "能给我一个更具体的方案吗？",
            "有没有需要注意的风险？",
            "可以换一种写法再生成吗？",
        ]
    else:
        candidates = [
            "Can you expand on this?",
            "What should I do next?",
            "Can you give a more specific plan?",
            "What risks should I watch for?",
            "Can you rewrite it another way?",
        ]
    return candidates[:n]


@router.post(
    "/threads/{thread_id}/suggestions",
    response_model=SuggestionsResponse,
    summary="Generate Follow-up Questions",
    description="Generate short follow-up questions a user might ask next, based on recent conversation context.",
)
async def generate_suggestions(
    thread_id: str,
    body: SuggestionsRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> SuggestionsResponse:
    if not body.messages:
        return SuggestionsResponse(suggestions=[])

    n = body.n
    conversation = _format_conversation(body.messages)
    if not conversation:
        return SuggestionsResponse(suggestions=[])

    system_instruction = (
        "You are generating follow-up questions to help the user continue the conversation.\n"
        f"Based on the conversation below, produce EXACTLY {n} short questions the user might ask next.\n"
        "Requirements:\n"
        "- Questions must be relevant to the preceding conversation.\n"
        "- Questions must be written in the same language as the user.\n"
        "- Keep each question concise (ideally <= 20 words / <= 40 Chinese characters).\n"
        "- Do NOT include any explanation, reasoning, or extra text.\n"
        "- Output MUST be a JSON array of strings only, with no other text.\n"
        "Example output:\n"
        '["你能详细解释一下吗？", "这个功能怎么使用？", "有什么类似的例子？"]\n'
        "Do NOT include markdown code fences, numbered lists, or any other formatting."
    )
    user_content = f"Conversation Context:\n{conversation}\n\nGenerate {n} follow-up questions"

    try:
        effective_ai_service = await get_user_ai_service_with_overrides(
            request=request,
            db=db,
            module_id=body.module_id,
            ai_model=body.model_name if not body.module_id else None,
        )

        cleaned = await _run_suggestions_generation(
            ai_service=effective_ai_service,
            system_instruction=system_instruction,
            user_content=user_content,
            n=n,
            model_name=body.model_name,
        )
        source = "model"
        if not cleaned:
            cleaned = _fallback_suggestions_from_conversation(body.messages, n)
            source = "local-fallback-empty-model-output"
        logger.info(
            "Suggestions generated: thread_id=%s module_id=%s count=%d source=%s",
            thread_id,
            body.module_id,
            len(cleaned),
            source,
        )
        return SuggestionsResponse(suggestions=cleaned)
    except Exception as exc:
        logger.exception("Failed to generate suggestions: thread_id=%s module_id=%s model_name=%s err=%s", thread_id, body.module_id, body.model_name, exc)
        should_fallback = body.module_id and body.model_name and _should_retry_without_module(exc)
        if should_fallback:
            logger.info("Retrying suggestions without module_id: thread_id=%s model_name=%s", thread_id, body.model_name)
            try:
                fallback_service = await get_user_ai_service_with_overrides(
                    request=request,
                    db=db,
                    module_id=None,
                    ai_model=body.model_name,
                )
                cleaned = await _run_suggestions_generation(
                    ai_service=fallback_service,
                    system_instruction=system_instruction,
                    user_content=user_content,
                    n=n,
                    model_name=body.model_name,
                )
                source = "model-fallback-no-module"
                if not cleaned:
                    cleaned = _fallback_suggestions_from_conversation(body.messages, n)
                    source = "local-fallback-empty-model-output"
                logger.info("Fallback suggestions generated: thread_id=%s count=%d source=%s", thread_id, len(cleaned), source)
                return SuggestionsResponse(suggestions=cleaned)
            except Exception as fallback_exc:
                logger.exception("Fallback suggestions also failed: thread_id=%s err=%s", thread_id, fallback_exc)
        elif body.module_id and body.model_name:
            logger.info(
                "Skip fallback retry for terminal suggestions error: thread_id=%s module_id=%s err=%s",
                thread_id,
                body.module_id,
                type(exc).__name__,
            )
        return SuggestionsResponse(suggestions=[])
