"""章节管理API - CRUD、单章/批量生成、重写、局部重写"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.batch_generation_task import BatchGenerationTask
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.regeneration_task import RegenerationTask
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.recovery_service import recovery_service

logger = get_logger(__name__)
router = APIRouter(prefix="/chapters", tags=["chapters"])


class ChapterCreateRequest(BaseModel):
    title: str = ""
    summary: str = ""
    content: str = ""
    outline_id: str | None = None
    chapter_number: int | None = Field(default=None, ge=1)
    sub_index: int | None = None
    expansion_plan: str | None = None


class ChapterUpdateRequest(BaseModel):
    title: str | None = None
    summary: str | None = None
    content: str | None = None
    expansion_plan: str | None = None


class BatchGenerateRequest(BaseModel):
    project_id: str
    start_chapter_number: int
    chapter_count: int = 1
    target_word_count: int = 3000
    style_id: int | None = None
    enable_analysis: bool = False


class RegenerateRequest(BaseModel):
    project_id: str
    chapter_id: str
    modification_instructions: str = ""
    custom_instructions: str = ""
    target_word_count: int = 3000
    focus_areas: list | None = None
    preserve_elements: dict | None = None


class PartialRegenerateRequest(BaseModel):
    project_id: str
    chapter_id: str
    selected_text: str
    context_before: str = ""
    context_after: str = ""
    user_instructions: str = ""
    style_id: int | None = None


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
    query = select(Chapter).where(Chapter.project_id == project_id)
    if outline_id:
        query = query.where(Chapter.outline_id == outline_id)
    if status:
        query = query.where(Chapter.status == status)
    query = query.order_by(Chapter.chapter_number, Chapter.sub_index).offset(offset).limit(limit)

    result = await db.execute(query)
    chapters = result.scalars().all()

    count_result = await db.execute(
        select(func.count(Chapter.id)).where(Chapter.project_id == project_id))
    total = count_result.scalar() or 0

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
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
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
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    await verify_project_access(chapter.project_id, user_id, db)

    if req.title is not None:
        chapter.title = req.title
    if req.summary is not None:
        chapter.summary = req.summary
    if req.content is not None:
        chapter.content = req.content
        chapter.word_count = len(req.content)
        if chapter.status == "planned":
            chapter.status = "draft"
    if req.expansion_plan is not None:
        chapter.expansion_plan = req.expansion_plan

    await db.commit()
    await db.refresh(chapter)
    return _serialize_chapter(chapter)


@router.delete("/{chapter_id}")
async def delete_chapter(
    chapter_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
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
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    chapter_ids = []
    for i in range(req.chapter_count):
        cn = req.start_chapter_number + i
        existing = await db.execute(
            select(Chapter).where(
                Chapter.project_id == req.project_id,
                Chapter.chapter_number == cn))
        ch = existing.scalar_one_or_none()
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
        user_id=user_id,
        start_chapter_number=req.start_chapter_number,
        chapter_count=req.chapter_count,
        chapter_ids=chapter_ids,
        style_id=req.style_id,
        target_word_count=req.target_word_count,
        enable_analysis=req.enable_analysis,
        total_chapters=req.chapter_count,
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
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
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
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
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

    accumulated = ""
    async for chunk in ai_service.generate_text_stream(prompt=prompt, temperature=0.7):
        accumulated += chunk

    new_content = chapter.content.replace(req.selected_text, accumulated) if chapter.content else accumulated
    chapter.content = new_content
    chapter.word_count = len(new_content)
    await db.commit()
    await db.refresh(chapter)
    return {"chapter_id": chapter.id, "regenerated_text": accumulated, "word_count": len(accumulated)}


@router.put("/{chapter_id}/status")
async def update_chapter_status(
    chapter_id: str,
    status: str = Query(..., description="New status"),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
    chapter = result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    await verify_project_access(chapter.project_id, user_id, db)

    valid_statuses = ["planned", "draft", "completed", "archived"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    chapter.status = status
    await db.commit()
    return _serialize_chapter(chapter)


@router.put("/reorder")
async def reorder_chapters(
    project_id: str = Query(...),
    chapter_orders: list = [],
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    for item in chapter_orders:
        ch_id = item.get("id")
        new_num = item.get("chapter_number")
        if ch_id and new_num:
            result = await db.execute(select(Chapter).where(Chapter.id == ch_id))
            ch = result.scalar_one_or_none()
            if ch and ch.project_id == project_id:
                ch.chapter_number = new_num

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
