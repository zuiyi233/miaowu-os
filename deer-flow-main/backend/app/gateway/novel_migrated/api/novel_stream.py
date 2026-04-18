"""Novel migration stream APIs (P0)."""

from __future__ import annotations

import asyncio
import uuid
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
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.project_default_style import ProjectDefaultStyle
from app.gateway.novel_migrated.models.writing_style import WritingStyle
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.book_import_service import book_import_service
from app.gateway.novel_migrated.services.plot_analyzer import get_plot_analyzer
from app.gateway.novel_migrated.utils.sse_response import SSEResponse, WizardProgressTracker, create_sse_response

logger = get_logger(__name__)
router = APIRouter(tags=["novel_stream"])

_ANALYSIS_TASKS: dict[str, dict[str, Any]] = {}
_ANALYSIS_RESULTS: dict[str, dict[str, Any]] = {}


class ChapterGenerateStreamRequest(BaseModel):
    target_word_count: int = Field(default=3000, ge=500, le=10000)
    requirements: str = Field(default="")
    style_id: int | None = None
    model: str | None = None
    narrative_perspective: str | None = None
    max_tokens: int | None = Field(default=None, ge=512, le=16000)


class ChapterContinueStreamRequest(BaseModel):
    continuation_hint: str = Field(default="")
    target_word_count: int = Field(default=1500, ge=200, le=10000)
    model: str | None = None
    max_tokens: int | None = Field(default=None, ge=512, le=16000)


class BatchGenerateStreamRequest(BaseModel):
    chapter_ids: list[str] | None = None
    start_chapter_number: int | None = Field(default=None, ge=1)
    chapter_count: int = Field(default=1, ge=1, le=30)
    target_word_count: int = Field(default=3000, ge=500, le=10000)
    requirements: str = Field(default="")
    style_id: int | None = None
    model: str | None = None
    narrative_perspective: str | None = None
    max_tokens: int | None = Field(default=None, ge=512, le=16000)


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

    action = "续写" if continue_mode else "生成"
    if emit_result:
        yield await tracker.result(
            {
                "novel_id": project.id,
                "chapter_id": chapter.id,
                "chapter_number": chapter.chapter_number,
                "title": chapter.title,
                "word_count": chapter.word_count,
                "status": chapter.status,
                "action": action,
            }
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
    project, chapter, _ = await _ensure_novel_chapter(
        novel_id=novel_id,
        chapter_id=chapter_id,
        request=request,
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
    project = await verify_project_access(novel_id, user_id, db)

    async def event_generator() -> AsyncGenerator[str, None]:
        tracker = WizardProgressTracker("批量章节")
        yield await tracker.start()
        try:
            if payload.chapter_ids:
                chapters_result = await db.execute(
                    select(Chapter)
                    .where(Chapter.project_id == project.id, Chapter.id.in_(payload.chapter_ids))
                    .order_by(Chapter.chapter_number.asc())
                )
                chapters = list(chapters_result.scalars().all())
            else:
                start_number = payload.start_chapter_number or 1
                end_number = start_number + payload.chapter_count - 1
                chapters_result = await db.execute(
                    select(Chapter)
                    .where(
                        Chapter.project_id == project.id,
                        Chapter.chapter_number >= start_number,
                        Chapter.chapter_number <= end_number,
                    )
                    .order_by(Chapter.chapter_number.asc())
                )
                chapters = list(chapters_result.scalars().all())

            if not chapters:
                raise HTTPException(status_code=404, detail="未找到可生成章节")

            total = len(chapters)
            completed: list[dict[str, Any]] = []
            for idx, chapter in enumerate(chapters, start=1):
                progress_base = int(((idx - 1) / total) * 100)
                yield await SSEResponse.send_progress(
                    f"正在生成第{chapter.chapter_number}章（{idx}/{total}）",
                    min(progress_base, 95),
                    "processing",
                )

                req = ChapterGenerateStreamRequest(
                    target_word_count=payload.target_word_count,
                    requirements=payload.requirements,
                    style_id=payload.style_id,
                    model=payload.model,
                    narrative_perspective=payload.narrative_perspective,
                    max_tokens=payload.max_tokens,
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

                completed.append(
                    {
                        "chapter_id": chapter.id,
                        "chapter_number": chapter.chapter_number,
                        "word_count": chapter.word_count,
                        "status": chapter.status,
                    }
                )

            yield await SSEResponse.send_result(
                {
                    "novel_id": project.id,
                    "total": total,
                    "completed": completed,
                }
            )
            yield await tracker.complete("批量章节生成完成")
            yield _complete_event()
        except HTTPException as exc:
            yield _error_event(str(exc.detail), exc.status_code)
        except Exception as exc:  # pragma: no cover
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
    db: AsyncSession = Depends(get_db),
    user_ai_service: AIService = Depends(get_user_ai_service),
):
    user_id = get_user_id(request)
    project, chapter = await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

    if not (chapter.content or "").strip():
        raise HTTPException(status_code=400, detail="章节内容为空，无法分析")

    task_id = str(uuid.uuid4())
    _ANALYSIS_TASKS[chapter_id] = {
        "task_id": task_id,
        "chapter_id": chapter_id,
        "status": "running",
        "progress": 10,
        "error_message": None,
        "updated_at": datetime.utcnow().isoformat(),
    }

    analyzer = get_plot_analyzer(user_ai_service)
    result = await analyzer.analyze_chapter(
        chapter_number=chapter.chapter_number,
        title=chapter.title,
        content=chapter.content or "",
        word_count=chapter.word_count or len(chapter.content or ""),
        user_id=user_id,
        db=db,
    )

    if not result:
        _ANALYSIS_TASKS[chapter_id] = {
            "task_id": task_id,
            "chapter_id": chapter_id,
            "status": "failed",
            "progress": 0,
            "error_message": "AI 分析失败",
            "updated_at": datetime.utcnow().isoformat(),
        }
        raise HTTPException(status_code=502, detail="章节分析失败")

    _ANALYSIS_RESULTS[chapter_id] = {
        "project_id": project.id,
        "chapter_id": chapter_id,
        "analysis": result,
        "updated_at": datetime.utcnow().isoformat(),
    }
    _ANALYSIS_TASKS[chapter_id] = {
        "task_id": task_id,
        "chapter_id": chapter_id,
        "status": "completed",
        "progress": 100,
        "error_message": None,
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
    await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

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
    await _get_chapter_with_project_access(
        chapter_id=chapter_id,
        novel_id=None,
        user_id=user_id,
        db=db,
    )

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
