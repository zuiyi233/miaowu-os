"""章节管理API - CRUD、单章/批量生成、重写、局部重写"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AliasChoices, BaseModel, Field
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.batch_generation_task import BatchGenerationTask
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.regeneration_task import RegenerationTask
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.optimistic_lock import optimistic_update
from app.gateway.novel_migrated.services.recovery_service import recovery_service
from app.gateway.observability.context import update_trace_context

logger = get_logger(__name__)
router = APIRouter(prefix="/chapters", tags=["chapters"])


_IDEMPOTENCY_BODY_KEYS = ("idempotencyKey", "idempotency_key")
_IDEMPOTENCY_HEADER_KEYS = ("x-idempotency-key", "idempotency-key")


class _WriteRequestBase(BaseModel):
    idempotency_key: str | None = Field(
        default=None,
        exclude=True,
        validation_alias=AliasChoices("idempotency_key", "idempotencyKey"),
    )


class ChapterCreateRequest(_WriteRequestBase):
    title: str = ""
    summary: str = ""
    content: str = ""
    outline_id: str | None = None
    chapter_number: int | None = Field(default=None, ge=1)
    sub_index: int | None = None
    expansion_plan: str | None = None


class ChapterUpdateRequest(_WriteRequestBase):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    expansion_plan: str | None = None


class BatchGenerateRequest(_WriteRequestBase):
    project_id: str
    start_chapter_number: int | None = 1
    chapter_count: int = 1
    chapter_ids: list[str] | None = None
    outline_ids: list[str] | None = None
    target_word_count: int = 3000
    style_id: int | None = None
    enable_analysis: bool = False


class RegenerateRequest(_WriteRequestBase):
    project_id: str
    chapter_id: str
    modification_instructions: str = ""
    custom_instructions: str = ""
    target_word_count: int = 3000
    focus_areas: list | None = None
    preserve_elements: dict | None = None


class PartialRegenerateRequest(_WriteRequestBase):
    project_id: str
    chapter_id: str
    selected_text: str
    context_before: str = ""
    context_after: str = ""
    user_instructions: str = ""
    style_id: int | None = None


def _normalize_idempotency_key(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _extract_idempotency_key(request: Request, payload: dict[str, Any] | None = None) -> str | None:
    for key in _IDEMPOTENCY_HEADER_KEYS:
        normalized = _normalize_idempotency_key(request.headers.get(key))
        if normalized:
            return normalized

    if payload:
        for key in _IDEMPOTENCY_BODY_KEYS:
            normalized = _normalize_idempotency_key(payload.get(key))
            if normalized:
                return normalized

    for key in _IDEMPOTENCY_BODY_KEYS:
        normalized = _normalize_idempotency_key(request.query_params.get(key))
        if normalized:
            return normalized

    return None


def _strip_idempotency_fields(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if key not in _IDEMPOTENCY_BODY_KEYS
    }


def _request_payload_for_idempotency(request_model: _WriteRequestBase | None) -> dict[str, Any]:
    if request_model is None:
        return {}
    payload: dict[str, Any] = {}
    if request_model.idempotency_key is not None:
        payload["idempotency_key"] = request_model.idempotency_key
    return payload


def _bind_idempotency_context(request: Request | None, request_model: _WriteRequestBase | None = None) -> str | None:
    if request is None:
        return None
    payload = _request_payload_for_idempotency(request_model)
    idempotency_key = _extract_idempotency_key(request, payload)
    if idempotency_key:
        update_trace_context(idempotency_key=idempotency_key)
    return idempotency_key


@router.get("/project/{project_id}")
async def list_chapters(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    outline_id: str | None = None,
    status: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    await verify_project_access(project_id, user_id, db)
    base_filter = Chapter.project_id == project_id
    if outline_id:
        base_filter = and_(base_filter, Chapter.outline_id == outline_id)
    if status:
        base_filter = and_(base_filter, Chapter.status == status)

    query = select(Chapter, func.count(Chapter.id).over().label("total_count")).where(base_filter)
    query = query.order_by(Chapter.chapter_number, Chapter.sub_index).offset(offset).limit(limit)

    result = await db.execute(query)
    rows = result.all()
    if rows:
        total = rows[0][1] or 0
    else:
        count_result = await db.execute(select(func.count(Chapter.id)).where(base_filter))
        total = count_result.scalar() or 0
    chapters = [row[0] for row in rows]

    return {
        "chapters": [_serialize_chapter(c) for c in chapters],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/{chapter_id}")
async def get_chapter(
    chapter_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    await verify_project_access(chapter.project_id, user_id, db)
    return _serialize_chapter(chapter)


@router.post("/project/{project_id}")
async def create_chapter(
    project_id: str,
    req: ChapterCreateRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    _bind_idempotency_context(request, req)
    await verify_project_access(project_id, user_id, db)

    max_result = await db.execute(
        select(func.max(Chapter.chapter_number)).where(Chapter.project_id == project_id))
    max_num = max_result.scalar() or 0

    chapter = Chapter(
        project_id=project_id,
        chapter_number=req.chapter_number if req.chapter_number else max_num + 1,
        title=req.title or f"第{max_num + 1}章",
        summary=req.summary,
        content=req.content,
        outline_id=req.outline_id,
        sub_index=req.sub_index,
        expansion_plan=req.expansion_plan,
        word_count=len(req.content) if req.content else 0,
        status="draft" if req.content else "planned",
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)
    return _serialize_chapter(chapter)


@router.put("/{chapter_id}")
async def update_chapter(
    chapter_id: str,
    req: ChapterUpdateRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    _bind_idempotency_context(request, req)
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    await verify_project_access(chapter.project_id, user_id, db)

    updates = {}
    if req.title is not None:
        updates["title"] = req.title
    if req.summary is not None:
        updates["summary"] = req.summary
    if req.content is not None:
        updates["content"] = req.content
        updates["word_count"] = len(req.content)
        if chapter.status == "planned":
            updates["status"] = "draft"
    if req.expansion_plan is not None:
        updates["expansion_plan"] = req.expansion_plan

    if updates:
        try:
            await optimistic_update(Chapter, chapter_id, updates, db=db)
            await db.commit()
        except ValueError as exc:
            await db.rollback()
            raise HTTPException(status_code=409, detail=str(exc))

    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    return _serialize_chapter(chapter)


@router.delete("/{chapter_id}")
async def delete_chapter(
    chapter_id: str,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    _bind_idempotency_context(request)
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    await verify_project_access(chapter.project_id, user_id, db)
    await db.delete(chapter)
    await db.commit()
    return {"message": "Chapter deleted"}


@router.post("/batch-generate")
async def batch_generate_chapters(
    req: BatchGenerateRequest,
    request: Request = None,
    user_id: str | None = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    _bind_idempotency_context(request, req)
    effective_user_id = user_id if user_id else get_user_id(request) if request else "local_single_user"
    await verify_project_access(req.project_id, effective_user_id, db)

    chapter_ids: list[str] = []
    start_chapter_number = max(1, int(req.start_chapter_number or 1))
    chapter_count = max(1, int(req.chapter_count or 1))

    if req.chapter_ids or req.outline_ids:
        requested_ids = [chapter_id for chapter_id in (req.chapter_ids or []) if chapter_id]
        if req.outline_ids:
            outline_result = await db.execute(
                select(Chapter.id).where(
                    Chapter.project_id == req.project_id,
                    Chapter.outline_id.in_(req.outline_ids),
                )
            )
            requested_ids.extend(outline_result.scalars().all())

        dedup_ids = list(dict.fromkeys(requested_ids))
        if not dedup_ids:
            raise HTTPException(status_code=404, detail="未找到可生成章节")

        selected_result = await db.execute(
            select(Chapter).where(
                Chapter.project_id == req.project_id,
                Chapter.id.in_(dedup_ids),
            ).order_by(Chapter.chapter_number.asc())
        )
        selected_chapters = list(selected_result.scalars().all())
        if not selected_chapters:
            raise HTTPException(status_code=404, detail="未找到可生成章节")
        chapter_ids = [chapter.id for chapter in selected_chapters]
        start_chapter_number = selected_chapters[0].chapter_number
        chapter_count = len(chapter_ids)
    else:
        chapter_numbers = [start_chapter_number + i for i in range(chapter_count)]
        existing_result = await db.execute(
            select(Chapter).where(
                Chapter.project_id == req.project_id,
                Chapter.chapter_number.in_(chapter_numbers),
            )
        )
        existing_map = {ch.chapter_number: ch for ch in existing_result.scalars().all()}
        for cn in chapter_numbers:
            ch = existing_map.get(cn)
            if not ch:
                ch = Chapter(
                    project_id=req.project_id,
                    chapter_number=cn,
                    title=f"第{cn}章",
                    status="planned",
                )
                db.add(ch)
                await db.flush()
            chapter_ids.append(ch.id)

    task = BatchGenerationTask(
        project_id=req.project_id,
        user_id=effective_user_id,
        start_chapter_number=start_chapter_number,
        chapter_count=chapter_count,
        chapter_ids=chapter_ids,
        style_id=req.style_id,
        target_word_count=req.target_word_count,
        enable_analysis=req.enable_analysis,
        total_chapters=chapter_count,
        status="pending",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return {"task_id": task.id, "status": "pending", "chapter_ids": chapter_ids}


@router.get("/batch-generate/{task_id}")
async def get_batch_task_status(
    task_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(BatchGenerationTask).where(BatchGenerationTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Batch task not found")
    await verify_project_access(task.project_id, user_id, db)

    auto_recovered = recovery_service.recover_batch_task(task)
    if auto_recovered:
        await db.commit()
        await db.refresh(task)

    chapters_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == task.project_id, Chapter.id.in_(task.chapter_ids or []))
        .order_by(Chapter.chapter_number.asc())
    )
    chapters = list(chapters_result.scalars().all())
    resume_plan = recovery_service.compute_batch_resume_plan(task=task, chapters=chapters)
    return {
        "task_id": task.id,
        "status": task.status,
        "total_chapters": task.total_chapters,
        "completed_chapters": task.completed_chapters,
        "current_chapter_number": task.current_chapter_number,
        "failed_chapters": task.failed_chapters,
        "error_message": task.error_message,
        "auto_recovered": auto_recovered,
        "resume_plan": resume_plan,
    }


@router.get("/project/{project_id}/batch-generate/active")
async def get_active_batch_task(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(
        select(BatchGenerationTask)
        .where(
            BatchGenerationTask.project_id == project_id,
            BatchGenerationTask.user_id == user_id,
            BatchGenerationTask.status.in_(["pending", "running", "failed"]),
        )
        .order_by(BatchGenerationTask.created_at.desc())
        .limit(1)
    )
    task = result.scalar_one_or_none()
    if not task:
        return {"has_active_task": False, "task": None}

    auto_recovered = recovery_service.recover_batch_task(task)
    if auto_recovered:
        await db.commit()
        await db.refresh(task)

    return {
        "has_active_task": True,
        "task": {
            "batch_id": task.id,
            "status": task.status,
            "total": task.total_chapters,
            "completed": task.completed_chapters,
            "current_chapter_id": task.current_chapter_id,
            "current_chapter_number": task.current_chapter_number,
            "error_message": task.error_message,
            "auto_recovered": auto_recovered,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        },
    }


@router.post("/regenerate")
async def regenerate_chapter(
    req: RegenerateRequest,
    request: Request = None,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    _bind_idempotency_context(request, req)
    await verify_project_access(req.project_id, user_id, db)

    result = await db.execute(select(Chapter).where(Chapter.id == req.chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    task = RegenerationTask(
        chapter_id=req.chapter_id,
        user_id=user_id,
        project_id=req.project_id,
        modification_instructions=req.modification_instructions,
        custom_instructions=req.custom_instructions,
        target_word_count=req.target_word_count,
        focus_areas=req.focus_areas,
        preserve_elements=req.preserve_elements,
        original_content=chapter.content,
        original_word_count=chapter.word_count,
        status="pending",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return {"task_id": task.id, "status": "pending"}


@router.get("/regenerate/{task_id}")
async def get_regen_task_status(
    task_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RegenerationTask).where(RegenerationTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Regeneration task not found")
    await verify_project_access(task.project_id, user_id, db)

    auto_recovered = recovery_service.recover_regeneration_task(task)
    if auto_recovered:
        await db.commit()
        await db.refresh(task)

    return {
        "task_id": task.id,
        "status": task.status,
        "progress": task.progress,
        "original_word_count": task.original_word_count,
        "regenerated_word_count": task.regenerated_word_count,
        "error_message": task.error_message,
        "auto_recovered": auto_recovered,
    }


@router.post("/partial-regenerate")
async def partial_regenerate(
    req: PartialRegenerateRequest,
    request: Request = None,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    _bind_idempotency_context(request, req)
    await verify_project_access(req.project_id, user_id, db)

    result = await db.execute(select(Chapter).where(Chapter.id == req.chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    from app.gateway.novel_migrated.services.prompt_service import PromptService
    template = PromptService.PARTIAL_REGENERATE
    prompt = template.format(
        context_before=req.context_before,
        selected_text=req.selected_text,
        context_after=req.context_after,
        user_instructions=req.user_instructions,
    )

    chunks: list[str] = []
    async for chunk in ai_service.generate_text_stream(prompt=prompt, temperature=0.7):
        chunks.append(chunk)
    accumulated = "".join(chunks)

    new_content = chapter.content.replace(req.selected_text, accumulated, 1) if chapter.content else accumulated
    chapter.content = new_content
    chapter.word_count = len(new_content)
    await db.commit()
    await db.refresh(chapter)
    return {"chapter_id": chapter.id, "regenerated_text": accumulated, "word_count": len(accumulated)}


@router.put("/{chapter_id}/status")
async def update_chapter_status(
    chapter_id: str,
    request: Request,
    status: str = Query(..., description="New status"),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    _bind_idempotency_context(request)
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    await verify_project_access(chapter.project_id, user_id, db)

    valid_statuses = ["planned", "draft", "completed", "archived"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    try:
        await optimistic_update(Chapter, chapter_id, {"status": status}, db=db)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(exc))

    await db.refresh(chapter)
    return _serialize_chapter(chapter)


@router.put("/reorder")
async def reorder_chapters(
    request: Request,
    project_id: str = Query(...),
    chapter_orders: list[dict[str, Any]] | None = None,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    _bind_idempotency_context(request)
    await verify_project_access(project_id, user_id, db)

    for item in chapter_orders or []:
        ch_id = item.get("id")
        new_num = item.get("chapter_number")
        if ch_id and new_num:
            try:
                await optimistic_update(
                    Chapter, ch_id, {"chapter_number": new_num}, db=db
                )
            except ValueError:
                logger.warning("Reorder conflict on chapter %s, skipping", ch_id)

    await db.commit()
    return {"message": "Chapters reordered"}


def _serialize_chapter(chapter: Chapter) -> dict:
    return {
        "id": chapter.id,
        "project_id": chapter.project_id,
        "chapter_number": chapter.chapter_number,
        "title": chapter.title,
        "content": chapter.content,
        "summary": chapter.summary,
        "word_count": chapter.word_count,
        "status": chapter.status,
        "outline_id": chapter.outline_id,
        "sub_index": chapter.sub_index,
        "expansion_plan": chapter.expansion_plan,
        "created_at": chapter.created_at.isoformat() if chapter.created_at else None,
        "updated_at": chapter.updated_at.isoformat() if chapter.updated_at else None,
    }
