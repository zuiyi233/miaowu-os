"""Novel migration stream APIs (P0)."""

from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.analysis_task import AnalysisTask
from app.gateway.novel_migrated.models.batch_generation_task import BatchGenerationTask
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.project_default_style import ProjectDefaultStyle
from app.gateway.novel_migrated.models.writing_style import WritingStyle
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.book_import_service import book_import_service
from app.gateway.novel_migrated.services.orchestration_service import orchestration_service
from app.gateway.novel_migrated.services.recovery_service import recovery_service
from app.gateway.novel_migrated.utils.sse_response import SSEResponse, WizardProgressTracker, create_sse_response

logger = get_logger(__name__)
router = APIRouter(tags=["novel_stream"])

_ANALYSIS_TASKS: dict[str, dict[str, Any]] = {}
_ANALYSIS_RESULTS: dict[str, dict[str, Any]] = {}
_STREAM_REQUEST_WINDOWS: dict[str, deque[float]] = {}


def _read_positive_int_env(env_name: str, default: int) -> int:
    raw = (os.getenv(env_name) or "").strip()
    if not raw:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to %s", env_name, raw, default)
        return default
    return max(1, parsed)


_STREAM_RATE_LIMIT_PER_MINUTE = _read_positive_int_env(
    "NOVEL_STREAM_RATE_LIMIT_PER_MINUTE",
    30,
)
_ANALYSIS_CACHE_TTL_SECONDS = _read_positive_int_env(
    "NOVEL_ANALYSIS_CACHE_TTL_SECONDS",
    6 * 60 * 60,
)
_ANALYSIS_CACHE_MAX_ENTRIES = _read_positive_int_env(
    "NOVEL_ANALYSIS_CACHE_MAX_ENTRIES",
    500,
)


def _enforce_stream_rate_limit(*, user_id: str, action: str) -> None:
    now = time.monotonic()
    key = f"{action}:{user_id}"
    window = _STREAM_REQUEST_WINDOWS.setdefault(key, deque())
    while window and now - window[0] >= 60:
        window.popleft()

    if len(window) >= _STREAM_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail=(
                f"请求过于频繁（{action}）。每分钟最多 {_STREAM_RATE_LIMIT_PER_MINUTE} 次，"
                "请稍后重试。"
            ),
        )
    window.append(now)


def _cleanup_analysis_cache() -> None:
    cutoff = time.time() - _ANALYSIS_CACHE_TTL_SECONDS

    def parse_ts(item: dict[str, Any]) -> float:
        raw = (item.get("updated_at") or "").strip()
        if not raw:
            return 0.0
        try:
            return datetime.fromisoformat(raw).timestamp()
        except Exception:
            return 0.0

    for mapping in (_ANALYSIS_TASKS, _ANALYSIS_RESULTS):
        expired_keys = [key for key, value in mapping.items() if parse_ts(value) < cutoff]
        for key in expired_keys:
            mapping.pop(key, None)

        if len(mapping) <= _ANALYSIS_CACHE_MAX_ENTRIES:
            continue
        overflow = len(mapping) - _ANALYSIS_CACHE_MAX_ENTRIES
        oldest_keys = sorted(mapping.keys(), key=lambda item_key: parse_ts(mapping[item_key]))[:overflow]
        for key in oldest_keys:
            mapping.pop(key, None)


class ChapterGenerateStreamRequest(BaseModel):
    target_word_count: int = Field(default=3000, ge=500, le=10000)
    requirements: str = Field(default="")
    style_id: int | None = None
    model: str | None = None
    narrative_perspective: str | None = None
    max_tokens: int | None = Field(default=None, ge=512, le=16000)
    auto_analysis: bool = False
    auto_prepare_revision: bool = False
    analysis_idempotency_key: str | None = None


class ChapterContinueStreamRequest(BaseModel):
    continuation_hint: str = Field(default="")
    target_word_count: int = Field(default=1500, ge=200, le=10000)
    model: str | None = None
    max_tokens: int | None = Field(default=None, ge=512, le=16000)


class BatchGenerateStreamRequest(BaseModel):
    task_id: str | None = None
    idempotency_key: str | None = None
    chapter_ids: list[str] | None = None
    start_chapter_number: int | None = Field(default=None, ge=1)
    chapter_count: int = Field(default=1, ge=1, le=30)
    target_word_count: int = Field(default=3000, ge=500, le=10000)
    requirements: str = Field(default="")
    style_id: int | None = None
    model: str | None = None
    narrative_perspective: str | None = None
    max_tokens: int | None = Field(default=None, ge=512, le=16000)
    max_retries: int = Field(default=2, ge=0, le=6)
    replay_failed_only: bool = False
    auto_analysis: bool = False
    auto_prepare_revision: bool = False


class ChapterRevisionConfirmRequest(BaseModel):
    selected_suggestion_indices: list[int] = Field(default_factory=list)
    custom_instructions: str = ""
    target_word_count: int = Field(default=3000, ge=500, le=12000)
    idempotency_key: str | None = None
    max_retries: int = Field(default=2, ge=1, le=6)


class AnalyzeChapterRequest(BaseModel):
    force: bool = False
    idempotency_key: str | None = None


class OutlineGenerateStreamRequest(BaseModel):
    chapter_count: int = Field(default=30, ge=5, le=300)
    narrative_perspective: str = Field(default="第三人称")
    target_words: int = Field(default=100000, ge=1000, le=3_000_000)


class CharacterGenerateStreamRequest(BaseModel):
    count: int = Field(default=8, ge=5, le=20)
    theme: str | None = None
    genre: str | None = None


def _complete_event() -> str:
    return SSEResponse.format_sse({"type": "complete"})


def _error_event(message: str, code: int = 500) -> str:
    return SSEResponse.format_sse({"type": "error", "error": message, "code": code})


def _build_analysis_idempotency_key(project: Project, chapter: Chapter) -> str:
    chapter_updated_at = chapter.updated_at.isoformat() if chapter.updated_at else ""
    return orchestration_service.make_idempotency_key(
        project.id,
        chapter.id,
        str(chapter.word_count or 0),
        chapter_updated_at,
    )


async def _stream_worker(
    worker: Callable[[Callable[[str, int, str], Awaitable[None]]], Awaitable[dict[str, Any]]],
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def progress_callback(message: str, progress: int, status: str = "processing") -> None:
        await queue.put(
            SSEResponse.format_sse(
                {
                    "type": "progress",
                    "message": message,
                    "progress": progress,
                    "status": status,
                }
            )
        )

    async def runner() -> None:
        try:
            result = await worker(progress_callback)
            await queue.put(await SSEResponse.send_result(result))
            await queue.put(_complete_event())
        except HTTPException as exc:
            detail = str(exc.detail) if exc.detail is not None else "请求失败"
            await queue.put(_error_event(detail, exc.status_code))
        except Exception as exc:  # pragma: no cover - defensive branch
            logger.error("stream worker failed: %s", exc, exc_info=True)
            await queue.put(_error_event(str(exc), 500))
        finally:
            await queue.put(None)

    task = asyncio.create_task(runner())
    try:
        while True:
            msg = await queue.get()
            if msg is None:
                break
            yield msg
    except GeneratorExit:
        task.cancel()


async def _get_chapter_with_project_access(
    *,
    chapter_id: str,
    novel_id: str | None,
    user_id: str,
    db: AsyncSession,
) -> tuple[Project, Chapter]:
    chapter_result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = chapter_result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="章节不存在")

    project_id = novel_id or chapter.project_id
    if chapter.project_id != project_id:
        raise HTTPException(status_code=404, detail="章节不存在或不属于当前小说")

    project = await verify_project_access(project_id, user_id, db)
    return project, chapter


async def _build_style_content(
    *,
    style_id: int | None,
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> str:
    if style_id is not None:
        style_result = await db.execute(select(WritingStyle).where(WritingStyle.id == style_id))
        style = style_result.scalar_one_or_none()
        if style and (style.user_id is None or style.user_id == user_id):
            return style.prompt_content or ""
        return ""

    default_result = await db.execute(
        select(ProjectDefaultStyle, WritingStyle)
        .join(WritingStyle, WritingStyle.id == ProjectDefaultStyle.style_id)
        .where(ProjectDefaultStyle.project_id == project_id)
    )
    row = default_result.first()
    if not row:
        return ""
    style = row[1]
    if style.user_id is not None and style.user_id != user_id:
        return ""
    return style.prompt_content or ""


def _build_characters_summary(characters: list[Character]) -> str:
    if not characters:
        return "暂无角色信息"

    lines: list[str] = []
    for character in characters[:30]:
        entity_type = "组织" if character.is_organization else "角色"
        role_type = character.role_type or ("organization" if character.is_organization else "supporting")
        personality = (character.personality or "暂无描述").strip()
        lines.append(f"- {character.name}（{entity_type}/{role_type}）：{personality[:120]}")
    return "\n".join(lines)


def _build_chapter_prompt(
    *,
    project: Project,
    chapter: Chapter,
    outline: Outline | None,
    previous_chapter: Chapter | None,
    characters_summary: str,
    style_content: str,
    target_word_count: int,
    narrative_perspective: str,
    requirements: str,
    continue_mode: bool = False,
    continuation_hint: str = "",
) -> str:
    outline_title = outline.title if outline else chapter.title
    outline_summary = ""
    if outline and outline.content:
        outline_summary = outline.content
    elif chapter.summary:
        outline_summary = chapter.summary
    else:
        outline_summary = "请围绕章节标题推进剧情。"

    previous_content_excerpt = "（无前置章节）"
    previous_summary = "（无前置章节）"
    if previous_chapter and previous_chapter.content:
        previous_content_excerpt = previous_chapter.content[-1200:]
        previous_summary = (previous_chapter.summary or previous_chapter.content[:180]).strip()

    if continue_mode:
        return f"""你是一名专业长篇小说写作助手，请续写当前章节内容。

【项目背景】
- 书名：{project.title}
- 类型：{project.genre or "未设定"}
- 主题：{project.theme or "未设定"}
- 世界设定：{project.world_rules or "未设定"}
- 叙事人称：{narrative_perspective}

【当前章节】
- 章节号：第{chapter.chapter_number}章
- 标题：{chapter.title}
- 章节大纲：{outline_summary}
- 已有正文（末段）：{(chapter.content or "")[-1500:] or "（暂无正文）"}

【前情提要】
- 上一章摘要：{previous_summary}

【相关角色】
{characters_summary}

【续写要求】
- 目标新增字数：约 {target_word_count} 字
- 续写提示：{continuation_hint or "保持剧情连续推进"}
- 额外要求：{requirements or "无"}
- 风格指令：{style_content or "保持自然、连贯、可读"}

直接输出章节续写正文，不要输出解释、标题或 Markdown。
"""

    return f"""你是一名专业长篇小说写作助手，请生成完整章节正文。

【项目背景】
- 书名：{project.title}
- 类型：{project.genre or "未设定"}
- 主题：{project.theme or "未设定"}
- 简介：{project.description or "暂无简介"}
- 时间背景：{project.world_time_period or "未设定"}
- 地点：{project.world_location or "未设定"}
- 世界规则：{project.world_rules or "未设定"}
- 叙事人称：{narrative_perspective}

【章节目标】
- 章节号：第{chapter.chapter_number}章
- 章节标题：{chapter.title}
- 对应大纲标题：{outline_title}
- 章节大纲摘要：{outline_summary}
- 目标字数：约 {target_word_count} 字

【前文衔接】
- 上一章摘要：{previous_summary}
- 上一章末段：{previous_content_excerpt}

【角色信息】
{characters_summary}

【风格与要求】
- 风格指令：{style_content or "保持中文网文叙事风格，语言流畅、节奏明确"}
- 额外要求：{requirements or "无"}

直接输出章节正文，不要输出解释、标题或 Markdown。
"""


async def _resolve_outline_for_chapter(db: AsyncSession, chapter: Chapter) -> Outline | None:
    if chapter.outline_id:
        outline_result = await db.execute(select(Outline).where(Outline.id == chapter.outline_id))
        outline = outline_result.scalar_one_or_none()
        if outline:
            return outline

    outline_result = await db.execute(
        select(Outline)
        .where(Outline.project_id == chapter.project_id, Outline.order_index == chapter.chapter_number)
        .order_by(Outline.order_index)
    )
    return outline_result.scalar_one_or_none()


async def _resolve_previous_chapter(db: AsyncSession, chapter: Chapter) -> Chapter | None:
    previous_result = await db.execute(
        select(Chapter)
        .where(
            Chapter.project_id == chapter.project_id,
            Chapter.chapter_number < chapter.chapter_number,
        )
        .order_by(Chapter.chapter_number.desc())
    )
    return previous_result.scalars().first()


async def _collect_project_characters(db: AsyncSession, project_id: str) -> list[Character]:
    result = await db.execute(
        select(Character)
        .where(Character.project_id == project_id)
        .order_by(Character.created_at.asc())
    )
    return list(result.scalars().all())


async def _persist_generated_content(
    *,
    db: AsyncSession,
    project: Project,
    chapter: Chapter,
    generated_content: str,
    append_mode: bool,
) -> None:
    old_word_count = chapter.word_count or 0
    existing_content = chapter.content or ""

    if append_mode and existing_content.strip():
        separator = "\n\n" if not existing_content.endswith("\n") else "\n"
        final_content = f"{existing_content}{separator}{generated_content}".strip()
    else:
        final_content = generated_content.strip()

    chapter.content = final_content
    chapter.word_count = len(final_content)
    chapter.status = "completed"

    project.current_words = max(0, int(project.current_words or 0) - old_word_count + chapter.word_count)
    await db.commit()
    await db.refresh(chapter)


async def _generate_single_chapter_stream(
    *,
    db: AsyncSession,
    project: Project,
    chapter: Chapter,
    ai_service: AIService,
    request: ChapterGenerateStreamRequest | ChapterContinueStreamRequest,
    append_mode: bool,
    continue_mode: bool,
    style_user_id: str | None = None,
    emit_result: bool = True,
    emit_complete: bool = True,
) -> AsyncGenerator[str, None]:
    tracker = WizardProgressTracker("章节")
    target_word_count = int(getattr(request, "target_word_count", 3000) or 3000)

    yield await tracker.start()
    yield await tracker.loading("加载章节上下文...", 0.3)

    outline = await _resolve_outline_for_chapter(db, chapter)
    previous_chapter = await _resolve_previous_chapter(db, chapter)
    characters = await _collect_project_characters(db, project.id)
    characters_summary = _build_characters_summary(characters)

    style_content = ""
    if isinstance(request, ChapterGenerateStreamRequest):
        style_content = await _build_style_content(
            style_id=request.style_id,
            project_id=project.id,
            user_id=style_user_id or project.user_id,
            db=db,
        )

    narrative_perspective = (
        getattr(request, "narrative_perspective", None)
        or project.narrative_perspective
        or "第三人称"
    )
    requirements = getattr(request, "requirements", "") or ""
    continuation_hint = getattr(request, "continuation_hint", "") or ""

    if continue_mode and not (chapter.content or "").strip():
        raise HTTPException(status_code=400, detail="当前章节没有可续写内容")

    yield await tracker.preparing("正在构建生成提示词...")

    prompt = _build_chapter_prompt(
        project=project,
        chapter=chapter,
        outline=outline,
        previous_chapter=previous_chapter,
        characters_summary=characters_summary,
        style_content=style_content,
        target_word_count=target_word_count,
        narrative_perspective=narrative_perspective,
        requirements=requirements,
        continue_mode=continue_mode,
        continuation_hint=continuation_hint,
    )

    generate_kwargs: dict[str, Any] = {"prompt": prompt}
    if getattr(request, "model", None):
        generate_kwargs["model"] = request.model
    if getattr(request, "max_tokens", None):
        generate_kwargs["max_tokens"] = request.max_tokens

    full_content = ""
    chunk_count = 0
    yield await tracker.generating(0, max(target_word_count, 1))

    async for chunk in ai_service.generate_text_stream(**generate_kwargs):
        if not chunk:
            continue
        text = str(chunk)
        if not text:
            continue
        full_content += text
        chunk_count += 1
        yield await tracker.generating_chunk(text)
        if chunk_count % 5 == 0:
            yield await tracker.generating(len(full_content), max(target_word_count, 1))
        if chunk_count % 20 == 0:
            yield await tracker.heartbeat()
        await asyncio.sleep(0)

    if not full_content.strip():
        raise HTTPException(status_code=502, detail="AI 未返回有效内容")

    yield await tracker.saving("写入章节内容...", 0.5)
    await _persist_generated_content(
        db=db,
        project=project,
        chapter=chapter,
        generated_content=full_content,
        append_mode=append_mode,
    )

    analysis_task_id: str | None = None
    revision_suggestions: list[dict[str, Any]] = []
    analysis_error: str | None = None
    auto_analysis_enabled = isinstance(request, ChapterGenerateStreamRequest) and request.auto_analysis
    if auto_analysis_enabled:
        try:
            yield await tracker.saving("自动分析章节中...", 0.75)
            analysis_idem_key = (
                request.analysis_idempotency_key
                or _build_analysis_idempotency_key(project, chapter)
            )
            analysis_result = await orchestration_service.run_analysis_pipeline(
                db=db,
                chapter=chapter,
                project_id=project.id,
                user_id=style_user_id or project.user_id,
                ai_service=ai_service,
                idempotency_key=analysis_idem_key,
            )
            analysis_task_id = analysis_result.task.id
            _ANALYSIS_TASKS[chapter.id] = {
                "task_id": analysis_result.task.id,
                "chapter_id": chapter.id,
                "status": analysis_result.task.status,
                "progress": analysis_result.task.progress,
                "error_message": analysis_result.task.error_message,
                "updated_at": datetime.utcnow().isoformat(),
            }
            _ANALYSIS_RESULTS[chapter.id] = {
                "project_id": project.id,
                "chapter_id": chapter.id,
                "analysis": analysis_result.analysis,
                "updated_at": datetime.utcnow().isoformat(),
            }
            if request.auto_prepare_revision:
                revision_suggestions = orchestration_service.normalize_revision_suggestions(
                    analysis_result.analysis
                )
        except Exception as exc:  # pragma: no cover - defensive branch
            logger.warning("auto analysis failed chapter=%s err=%s", chapter.id, exc, exc_info=True)
            analysis_error = str(exc)

    action = "续写" if continue_mode else "生成"
    if emit_result:
        result_payload = {
            "novel_id": project.id,
            "chapter_id": chapter.id,
            "chapter_number": chapter.chapter_number,
            "title": chapter.title,
            "word_count": chapter.word_count,
            "status": chapter.status,
            "action": action,
        }
        if auto_analysis_enabled:
            result_payload["analysis"] = {
                "enabled": True,
                "task_id": analysis_task_id,
                "status": "failed" if analysis_error else "completed",
                "error_message": analysis_error,
                "revision_suggestions": revision_suggestions,
            }
        yield await tracker.result(
            result_payload
        )
    yield await tracker.complete(f"章节{action}完成")
    if emit_complete:
        yield _complete_event()


async def _safe_chapter_stream(
    *,
    db: AsyncSession,
    stream: AsyncGenerator[str, None],
) -> AsyncGenerator[str, None]:
    try:
        async for msg in stream:
            yield msg
    except HTTPException as exc:
        await db.rollback()
        yield _error_event(str(exc.detail), exc.status_code)
    except Exception as exc:  # pragma: no cover
        await db.rollback()
        logger.error("chapter stream failed: %s", exc, exc_info=True)
        yield _error_event(str(exc), 500)


def _normalize_user_id_for_style(request: Request, project: Project) -> str:
    request_user = get_user_id(request)
    if request_user:
        return request_user
    return project.user_id


async def _ensure_novel_chapter(
    *,
    novel_id: str,
    chapter_id: str,
    request: Request,
    db: AsyncSession,
) -> tuple[Project, Chapter, str]:
    user_id = get_user_id(request)
    project, chapter = await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=novel_id,
        user_id=user_id,
        db=db,
    )
    return project, chapter, _normalize_user_id_for_style(request, project)


def _serialize_batch_task(task: BatchGenerationTask) -> dict[str, Any]:
    return {
        "task_id": task.id,
        "status": task.status,
        "total_chapters": task.total_chapters,
        "completed_chapters": task.completed_chapters,
        "current_chapter_id": task.current_chapter_id,
        "current_chapter_number": task.current_chapter_number,
        "current_retry_count": task.current_retry_count,
        "max_retries": task.max_retries,
        "failed_chapters": task.failed_chapters or [],
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


async def _query_batch_chapters(
    *,
    db: AsyncSession,
    project: Project,
    payload: BatchGenerateStreamRequest,
) -> list[Chapter]:
    if payload.chapter_ids:
        result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == project.id, Chapter.id.in_(payload.chapter_ids))
            .order_by(Chapter.chapter_number.asc())
        )
        return list(result.scalars().all())

    start_number = payload.start_chapter_number or 1
    end_number = start_number + payload.chapter_count - 1
    result = await db.execute(
        select(Chapter)
        .where(
            Chapter.project_id == project.id,
            Chapter.chapter_number >= start_number,
            Chapter.chapter_number <= end_number,
        )
        .order_by(Chapter.chapter_number.asc())
    )
    return list(result.scalars().all())


async def _load_or_create_batch_task(
    *,
    db: AsyncSession,
    project: Project,
    user_id: str,
    payload: BatchGenerateStreamRequest,
) -> tuple[BatchGenerationTask, list[Chapter], bool]:
    if payload.task_id:
        existing_result = await db.execute(
            select(BatchGenerationTask).where(
                BatchGenerationTask.id == payload.task_id,
                BatchGenerationTask.project_id == project.id,
                BatchGenerationTask.user_id == user_id,
            )
        )
        task = existing_result.scalar_one_or_none()
        if not task:
            raise HTTPException(status_code=404, detail="批量任务不存在")
        if recovery_service.recover_batch_task(task):
            await db.commit()
        chapters_result = await db.execute(
            select(Chapter)
            .where(Chapter.project_id == project.id, Chapter.id.in_(task.chapter_ids or []))
            .order_by(Chapter.chapter_number.asc())
        )
        return task, list(chapters_result.scalars().all()), True

    chapters = await _query_batch_chapters(db=db, project=project, payload=payload)
    if not chapters:
        raise HTTPException(status_code=404, detail="未找到可生成章节")

    idempotency_key = (payload.idempotency_key or "").strip()
    if idempotency_key:
        consumed = await orchestration_service.consume_idempotency_key(
            db,
            key=idempotency_key,
            user_id=user_id,
            action=f"batch_generate:{project.id}",
        )
        if not consumed:
            existing_result = await db.execute(
                select(BatchGenerationTask)
                .where(
                    BatchGenerationTask.project_id == project.id,
                    BatchGenerationTask.user_id == user_id,
                    BatchGenerationTask.start_chapter_number == (payload.start_chapter_number or 1),
                    BatchGenerationTask.chapter_count == len(chapters),
                    BatchGenerationTask.target_word_count == payload.target_word_count,
                )
                .order_by(BatchGenerationTask.created_at.desc())
                .limit(1)
            )
            existing = existing_result.scalar_one_or_none()
            if existing:
                if recovery_service.recover_batch_task(existing):
                    await db.commit()
                chapters_result = await db.execute(
                    select(Chapter)
                    .where(Chapter.project_id == project.id, Chapter.id.in_(existing.chapter_ids or []))
                    .order_by(Chapter.chapter_number.asc())
                )
                return existing, list(chapters_result.scalars().all()), True
            raise HTTPException(status_code=409, detail="批量任务幂等键重复")

    start_num = payload.start_chapter_number or (chapters[0].chapter_number if chapters else 1)
    task = BatchGenerationTask(
        project_id=project.id,
        user_id=user_id,
        start_chapter_number=start_num,
        chapter_count=len(chapters),
        chapter_ids=[chapter.id for chapter in chapters],
        style_id=payload.style_id,
        target_word_count=payload.target_word_count,
        enable_analysis=payload.auto_analysis,
        status="pending",
        total_chapters=len(chapters),
        completed_chapters=0,
        failed_chapters=[],
        current_retry_count=0,
        max_retries=payload.max_retries,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task, chapters, False


@router.post("/api/novels/{novel_id}/chapters/{chapter_id}/generate-stream", summary="流式生成章节")
async def generate_chapter_stream(
    novel_id: str,
    chapter_id: str,
    payload: ChapterGenerateStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    project, chapter, style_user_id = await _ensure_novel_chapter(
        novel_id=novel_id,
        chapter_id=chapter_id,
        request=request,
        db=db,
    )
    _enforce_stream_rate_limit(user_id=style_user_id, action="generate_chapter_stream")
    return create_sse_response(
        _safe_chapter_stream(
            db=db,
            stream=_generate_single_chapter_stream(
                db=db,
                project=project,
                chapter=chapter,
                ai_service=user_ai_service,
                request=payload,
                append_mode=False,
                continue_mode=False,
                style_user_id=style_user_id,
            ),
        )
    )


@router.post("/api/novels/{novel_id}/chapters/{chapter_id}/continue-stream", summary="流式续写章节")
async def continue_chapter_stream(
    novel_id: str,
    chapter_id: str,
    payload: ChapterContinueStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    project, chapter, user_id = await _ensure_novel_chapter(
        novel_id=novel_id,
        chapter_id=chapter_id,
        request=request,
        db=db,
    )
    _enforce_stream_rate_limit(user_id=user_id, action="continue_chapter_stream")
    return create_sse_response(
        _safe_chapter_stream(
            db=db,
            stream=_generate_single_chapter_stream(
                db=db,
                project=project,
                chapter=chapter,
                ai_service=user_ai_service,
                request=payload,
                append_mode=True,
                continue_mode=True,
                style_user_id=None,
            ),
        )
    )


@router.post("/api/chapters/{chapter_id}/generate-stream", summary="兼容路由：流式生成章节")
async def generate_chapter_stream_alias(
    chapter_id: str,
    payload: ChapterGenerateStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="generate_chapter_stream_alias")
    project, chapter = await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )
    style_user_id = _normalize_user_id_for_style(request, project)
    return create_sse_response(
        _safe_chapter_stream(
            db=db,
            stream=_generate_single_chapter_stream(
                db=db,
                project=project,
                chapter=chapter,
                ai_service=user_ai_service,
                request=payload,
                append_mode=False,
                continue_mode=False,
                style_user_id=style_user_id,
            ),
        )
    )


@router.post("/api/chapters/{chapter_id}/continue-stream", summary="兼容路由：流式续写章节")
async def continue_chapter_stream_alias(
    chapter_id: str,
    payload: ChapterContinueStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="continue_chapter_stream_alias")
    project, chapter = await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )
    return create_sse_response(
        _safe_chapter_stream(
            db=db,
            stream=_generate_single_chapter_stream(
                db=db,
                project=project,
                chapter=chapter,
                ai_service=user_ai_service,
                request=payload,
                append_mode=True,
                continue_mode=True,
                style_user_id=user_id,
            ),
        )
    )


@router.post("/api/novels/{novel_id}/chapters/batch-generate-stream", summary="批量流式生成章节")
async def batch_generate_chapters_stream(
    novel_id: str,
    payload: BatchGenerateStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="batch_generate_chapters_stream")
    project = await verify_project_access(novel_id, user_id, db)

    async def event_generator() -> AsyncGenerator[str, None]:
        tracker = WizardProgressTracker("批量章节")
        yield await tracker.start()
        task: BatchGenerationTask | None = None
        try:
            task, chapters, reused = await _load_or_create_batch_task(
                db=db,
                project=project,
                user_id=user_id,
                payload=payload,
            )
            if not chapters:
                raise HTTPException(status_code=404, detail="批量任务没有可执行章节")

            if task.status == "cancelled":
                raise HTTPException(status_code=409, detail="批量任务已取消，无法继续执行")

            if task.status in {"completed"} and not payload.replay_failed_only:
                yield await SSEResponse.send_result(
                    {
                        "novel_id": project.id,
                        "task": _serialize_batch_task(task),
                        "completed": [],
                        "failed": task.failed_chapters or [],
                        "message": "任务已完成，返回历史结果",
                    }
                )
                yield await tracker.complete("批量章节生成已是完成态")
                yield _complete_event()
                return

            if task.status in {"pending", "failed"}:
                task.status = "running"
                task.started_at = datetime.utcnow()
                task.error_message = None

            resume_plan = recovery_service.compute_batch_resume_plan(
                task=task,
                chapters=chapters,
                replay_failed_only=payload.replay_failed_only,
            )
            already_completed_ids = set(resume_plan["completed_ids"])
            task.total_chapters = len(chapters)
            task.completed_chapters = len(already_completed_ids)
            await db.commit()

            chapter_map = {item.id: item for item in chapters}
            pending_chapters = [chapter_map[cid] for cid in resume_plan["pending_ids"] if cid in chapter_map]
            if not pending_chapters:
                task.status = "completed"
                task.completed_at = datetime.utcnow()
                await db.commit()
                yield await SSEResponse.send_result(
                    {
                        "novel_id": project.id,
                        "task": _serialize_batch_task(task),
                        "completed": [],
                        "failed": task.failed_chapters or [],
                        "message": "无待执行章节（可能已全部完成）",
                    }
                )
                yield await tracker.complete("批量任务无需执行")
                yield _complete_event()
                return

            completed_items: list[dict[str, Any]] = []
            total_pending = len(pending_chapters)
            for idx, chapter in enumerate(pending_chapters, start=1):
                progress_base = int(((idx - 1) / max(1, total_pending)) * 100)
                yield await SSEResponse.send_progress(
                    f"正在生成第{chapter.chapter_number}章（{idx}/{total_pending}）",
                    min(progress_base, 95),
                    "processing",
                )
                task.current_chapter_id = chapter.id
                task.current_chapter_number = chapter.chapter_number
                task.current_retry_count = 0
                await db.commit()

                if chapter.status == "completed" and (chapter.content or "").strip():
                    if chapter.id not in already_completed_ids:
                        task.completed_chapters += 1
                        already_completed_ids.add(chapter.id)
                        await db.commit()
                    completed_items.append(
                        {
                            "chapter_id": chapter.id,
                            "chapter_number": chapter.chapter_number,
                            "word_count": chapter.word_count,
                            "status": chapter.status,
                            "skipped": True,
                        }
                    )
                    continue

                req = ChapterGenerateStreamRequest(
                    target_word_count=payload.target_word_count,
                    requirements=payload.requirements,
                    style_id=payload.style_id,
                    model=payload.model,
                    narrative_perspective=payload.narrative_perspective,
                    max_tokens=payload.max_tokens,
                    auto_analysis=payload.auto_analysis,
                    auto_prepare_revision=payload.auto_prepare_revision,
                )

                chapter_ok = False
                last_error = ""
                for retry in range(payload.max_retries + 1):
                    task.current_retry_count = retry
                    await db.commit()
                    try:
                        if retry > 0:
                            yield await SSEResponse.send_progress(
                                f"第{chapter.chapter_number}章重试中({retry}/{payload.max_retries})",
                                min(progress_base + 5, 95),
                                "retrying",
                            )
                        async for message in _generate_single_chapter_stream(
                            db=db,
                            project=project,
                            chapter=chapter,
                            ai_service=user_ai_service,
                            request=req,
                            append_mode=False,
                            continue_mode=False,
                            style_user_id=user_id,
                            emit_result=False,
                            emit_complete=False,
                        ):
                            yield message
                        chapter_ok = True
                        break
                    except HTTPException as exc:
                        last_error = str(exc.detail)
                    except Exception as exc:  # pragma: no cover - defensive branch
                        last_error = str(exc)

                if not chapter_ok:
                    recovery_service.record_batch_failure(
                        task=task,
                        chapter=chapter,
                        stage="generation",
                        error=last_error or "章节生成失败",
                        retry_count=payload.max_retries,
                    )
                    task.status = "failed"
                    task.error_message = (
                        f"第{chapter.chapter_number}章失败，已进入补偿态，可重放：{last_error or '未知错误'}"
                    )[:500]
                    task.completed_at = datetime.utcnow()
                    task.current_retry_count = 0
                    await db.commit()
                    break

                if chapter.id not in already_completed_ids:
                    task.completed_chapters += 1
                    already_completed_ids.add(chapter.id)
                recovery_service.mark_batch_replayed(task=task, chapter_id=chapter.id)
                task.current_retry_count = 0
                await db.commit()
                completed_items.append(
                    {
                        "chapter_id": chapter.id,
                        "chapter_number": chapter.chapter_number,
                        "word_count": chapter.word_count,
                        "status": chapter.status,
                    }
                )

            if task.status != "failed":
                updated_plan = recovery_service.compute_batch_resume_plan(
                    task=task,
                    chapters=chapters,
                    replay_failed_only=False,
                )
                if updated_plan["pending_ids"]:
                    task.status = "failed"
                    task.error_message = "任务提前终止，存在未完成章节，可继续断点续跑"
                else:
                    task.status = "completed"
                    task.error_message = None
                task.completed_at = datetime.utcnow()
                task.current_chapter_id = None
                task.current_chapter_number = None
                task.current_retry_count = 0
                await db.commit()

            yield await SSEResponse.send_result(
                {
                    "novel_id": project.id,
                    "task": _serialize_batch_task(task),
                    "resumed": reused,
                    "completed": completed_items,
                    "failed": task.failed_chapters or [],
                }
            )
            if task.status == "completed":
                yield await tracker.complete("批量章节生成完成")
            else:
                yield await tracker.complete("批量任务结束（含失败，可重放）")
            yield _complete_event()
        except HTTPException as exc:
            # 确保任务不会卡在 running/processing
            try:
                if task is not None and task.status == "running":
                    task.status = "failed"
                    task.error_message = f"批量任务异常中断：{exc.detail}"[:500]
                    task.completed_at = datetime.utcnow()
                    await db.commit()
            except Exception:  # pragma: no cover - best effort
                await db.rollback()
            yield _error_event(str(exc.detail), exc.status_code)
        except Exception as exc:  # pragma: no cover
            await db.rollback()
            try:
                if task is not None and task.status == "running":
                    task.status = "failed"
                    task.error_message = f"批量任务异常中断：{exc}"[:500]
                    task.completed_at = datetime.utcnow()
                    await db.commit()
            except Exception:  # pragma: no cover - best effort
                await db.rollback()
            logger.error("batch generate stream failed: %s", exc, exc_info=True)
            yield _error_event(str(exc), 500)

    return create_sse_response(event_generator())


@router.post("/api/novels/{novel_id}/outlines/generate-stream", summary="流式生成大纲")
async def generate_novel_outline_stream(
    novel_id: str,
    payload: OutlineGenerateStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="generate_novel_outline_stream")

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        project = await verify_project_access(novel_id, user_id, db)
        outlines_count = await book_import_service._generate_outline_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            chapter_count=payload.chapter_count,
            narrative_perspective=payload.narrative_perspective,
            target_words=payload.target_words,
            progress_callback=progress_callback,
            progress_range=(10, 92),
        )
        await db.commit()
        return {
            "novel_id": project.id,
            "outlines_count": outlines_count,
            "chapter_count": project.chapter_count,
        }

    return create_sse_response(_stream_worker(worker))


@router.post("/api/novels/{novel_id}/characters/generate-stream", summary="流式生成角色")
async def generate_novel_characters_stream(
    novel_id: str,
    payload: CharacterGenerateStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="generate_novel_characters_stream")

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        project = await verify_project_access(novel_id, user_id, db)
        if payload.theme:
            project.theme = payload.theme
        if payload.genre:
            project.genre = payload.genre[:50]

        generated_count = await book_import_service._generate_characters_and_organizations_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            count=payload.count,
            progress_callback=progress_callback,
            progress_range=(10, 92),
        )
        await db.commit()
        return {
            "novel_id": project.id,
            "created_count": generated_count,
        }

    return create_sse_response(_stream_worker(worker))


@router.post("/api/chapters/{chapter_id}/analyze", summary="兼容路由：手动触发章节分析")
async def analyze_chapter(
    chapter_id: str,
    request: Request,
    payload: AnalyzeChapterRequest | None = None,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="analyze_chapter")
    _cleanup_analysis_cache()
    project, chapter = await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

    try:
        force_analysis = bool(force or (payload.force if payload else False))
        payload_idem = (payload.idempotency_key or "").strip() if payload else ""
        analysis_idem = payload_idem or _build_analysis_idempotency_key(project, chapter)
        if force_analysis and not payload_idem:
            analysis_idem = None
        pipeline = await orchestration_service.run_analysis_pipeline(
            db=db,
            chapter=chapter,
            project_id=project.id,
            user_id=user_id,
            ai_service=user_ai_service,
            idempotency_key=analysis_idem,
            force=force_analysis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        msg = str(exc)
        status_code = 409 if "重复" in msg else 502
        raise HTTPException(status_code=status_code, detail=msg) from exc

    _ANALYSIS_RESULTS[chapter_id] = {
        "project_id": project.id,
        "chapter_id": chapter_id,
        "analysis": pipeline.analysis,
        "updated_at": datetime.utcnow().isoformat(),
    }
    _ANALYSIS_TASKS[chapter_id] = {
        "task_id": pipeline.task.id,
        "chapter_id": chapter_id,
        "status": pipeline.task.status,
        "progress": pipeline.task.progress,
        "error_message": pipeline.task.error_message,
        "updated_at": datetime.utcnow().isoformat(),
    }
    return _ANALYSIS_TASKS[chapter_id]


@router.get("/api/chapters/{chapter_id}/analysis", summary="兼容路由：获取章节分析")
async def get_chapter_analysis(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    _cleanup_analysis_cache()
    await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

    persisted_result = await db.execute(select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id))
    persisted = persisted_result.scalar_one_or_none()
    if persisted:
        return {
            "chapter_id": chapter_id,
            "has_analysis": True,
            "analysis": persisted.to_dict(),
            "updated_at": persisted.created_at.isoformat() if persisted.created_at else None,
        }

    result = _ANALYSIS_RESULTS.get(chapter_id)
    if not result:
        return {
            "chapter_id": chapter_id,
            "has_analysis": False,
            "analysis": None,
        }
    return {
        "chapter_id": chapter_id,
        "has_analysis": True,
        "analysis": result["analysis"],
        "updated_at": result["updated_at"],
    }


@router.get("/api/chapters/{chapter_id}/analysis/status", summary="兼容路由：获取分析任务状态")
async def get_chapter_analysis_status(
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    _cleanup_analysis_cache()
    await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

    latest_result = await db.execute(
        select(AnalysisTask)
        .where(AnalysisTask.chapter_id == chapter_id)
        .order_by(AnalysisTask.created_at.desc())
        .limit(1)
    )
    latest_task = latest_result.scalar_one_or_none()
    if latest_task:
        auto_recovered = recovery_service.recover_analysis_task(latest_task)
        if auto_recovered:
            await db.commit()
            await db.refresh(latest_task)
        return {
            "has_task": True,
            "task_id": latest_task.id,
            "chapter_id": chapter_id,
            "status": latest_task.status,
            "progress": latest_task.progress,
            "error_message": latest_task.error_message,
            "auto_recovered": auto_recovered,
            "created_at": latest_task.created_at.isoformat() if latest_task.created_at else None,
            "started_at": latest_task.started_at.isoformat() if latest_task.started_at else None,
            "completed_at": latest_task.completed_at.isoformat() if latest_task.completed_at else None,
        }

    task = _ANALYSIS_TASKS.get(chapter_id)
    if not task:
        return {
            "has_task": False,
            "chapter_id": chapter_id,
            "status": "none",
            "progress": 0,
            "error_message": None,
        }
    return {
        "has_task": True,
        **task,
    }


@router.post("/api/chapters/{chapter_id}/revision/confirm", summary="确认并执行章节修订")
async def confirm_chapter_revision(
    chapter_id: str,
    payload: ChapterRevisionConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    user_id = get_user_id(request)
    _enforce_stream_rate_limit(user_id=user_id, action="confirm_chapter_revision")
    project, chapter = await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

    try:
        revision = await orchestration_service.apply_revision_pipeline(
            db=db,
            chapter=chapter,
            project=project,
            user_id=user_id,
            ai_service=user_ai_service,
            selected_suggestion_indices=payload.selected_suggestion_indices,
            custom_instructions=payload.custom_instructions,
            target_word_count=payload.target_word_count,
            idempotency_key=payload.idempotency_key,
            max_retries=payload.max_retries,
        )
    except RuntimeError as exc:
        msg = str(exc)
        if "重复" in msg:
            raise HTTPException(status_code=409, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc

    return {
        "chapter_id": chapter.id,
        "task_id": revision.task.id,
        "status": revision.task.status,
        "used_cached": revision.used_cached,
        "word_count": chapter.word_count,
        "diff_stats": revision.diff_stats,
        "updated_at": chapter.updated_at.isoformat() if chapter.updated_at else None,
    }


@router.get("/api/novels/{novel_id}/chapters/batch-generate-tasks/{task_id}", summary="批量任务状态与恢复计划")
async def get_batch_generate_task_status(
    novel_id: str,
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    project = await verify_project_access(novel_id, user_id, db)
    task_result = await db.execute(
        select(BatchGenerationTask).where(
            BatchGenerationTask.id == task_id,
            BatchGenerationTask.project_id == project.id,
            BatchGenerationTask.user_id == user_id,
        )
    )
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="批量任务不存在")

    auto_recovered = recovery_service.recover_batch_task(task)
    if auto_recovered:
        await db.commit()
        await db.refresh(task)

    chapters_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project.id, Chapter.id.in_(task.chapter_ids or []))
        .order_by(Chapter.chapter_number.asc())
    )
    chapters = list(chapters_result.scalars().all())
    resume_plan = recovery_service.compute_batch_resume_plan(task=task, chapters=chapters)

    return {
        "auto_recovered": auto_recovered,
        "task": _serialize_batch_task(task),
        "resume_plan": resume_plan,
    }


@router.post(
    "/api/novels/{novel_id}/chapters/batch-generate-tasks/{task_id}/replay-failed-stream",
    summary="重放批量任务失败章节",
)
async def replay_failed_batch_chapters_stream(
    novel_id: str,
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    payload = BatchGenerateStreamRequest(task_id=task_id, replay_failed_only=True)
    return await batch_generate_chapters_stream(
        novel_id=novel_id,
        payload=payload,
        request=request,
        db=db,
        user_ai_service=user_ai_service,
    )
