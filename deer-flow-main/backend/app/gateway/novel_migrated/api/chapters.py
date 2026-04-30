"""章节管理API - CRUD、单章/批量生成、重写、局部重写"""
from __future__ import annotations

import hashlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import AliasChoices, BaseModel, Field
from sqlalchemy import and_, case, func, or_, select, update
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
from app.gateway.novel_migrated.services.workspace_document_service import (
    WorkspaceSecurityError,
    workspace_document_service,
)
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


def _compose_chapter_markdown(title: str, content: str) -> str:
    normalized_title = (title or "未命名章节").strip() or "未命名章节"
    normalized_content = (content or "").rstrip()
    if normalized_content:
        return f"# {normalized_title}\n\n{normalized_content}\n"
    return f"# {normalized_title}\n"


def _extract_title_and_body_from_markdown(markdown: str, fallback_title: str) -> tuple[str, str]:
    text = (markdown or "").replace("\r\n", "\n")
    lines = text.split("\n")
    heading_index = next((idx for idx, line in enumerate(lines) if line.strip()), None)
    if heading_index is None:
        return fallback_title, ""

    first = lines[heading_index].strip()
    if first.startswith("#"):
        parsed_title = first.lstrip("#").strip() or fallback_title
        body = "\n".join(lines[heading_index + 1 :]).lstrip("\n")
        return parsed_title, body
    return fallback_title, text


async def _sync_chapter_document(
    *,
    chapter: Chapter,
    user_id: str,
    db: AsyncSession,
) -> dict[str, str]:
    markdown = _compose_chapter_markdown(chapter.title or "", chapter.content or "")
    record = await workspace_document_service.write_document(
        user_id=user_id,
        project_id=chapter.project_id,
        entity_type="chapter",
        entity_id=chapter.id,
        content=markdown,
        title=chapter.title or f"第{chapter.chapter_number}章",
        tags=["chapter"],
    )
    await workspace_document_service.sync_record_to_db(
        db=db,
        user_id=user_id,
        project_id=chapter.project_id,
        record=record,
    )
    return {
        "doc_path": record.path,
        "content_hash": record.content_hash,
        "doc_updated_at": record.mtime,
    }


async def _snapshot_chapter_history_before_mutation(
    *,
    chapter: Chapter,
    user_id: str,
) -> str | None:
    if not (chapter.title or chapter.content):
        return None
    snapshot_content = _compose_chapter_markdown(chapter.title or "", chapter.content or "")
    return await workspace_document_service.snapshot_chapter_history(
        user_id=user_id,
        project_id=chapter.project_id,
        chapter_id=chapter.id,
        content=snapshot_content,
    )


async def _safe_db_call(db: AsyncSession, method_name: str, *args) -> Any:
    method = getattr(db, method_name, None)
    if method is None:
        return None
    return await method(*args)


def _replace_selected_text_with_context(
    *,
    original: str,
    selected_text: str,
    replacement: str,
    context_before: str = "",
    context_after: str = "",
) -> str:
    if not original:
        return replacement
    if not selected_text:
        return original

    match_positions: list[int] = []
    search_from = 0
    while True:
        index = original.find(selected_text, search_from)
        if index < 0:
            break
        match_positions.append(index)
        search_from = index + 1

    if not match_positions:
        return original
    if len(match_positions) == 1:
        pos = match_positions[0]
        return original[:pos] + replacement + original[pos + len(selected_text) :]

    before_anchor = (context_before or "")[-80:]
    after_anchor = (context_after or "")[:80]
    scored: list[tuple[int, int]] = []
    for pos in match_positions:
        score = 0
        if before_anchor:
            left = original[max(0, pos - len(before_anchor)) : pos]
            if left == before_anchor:
                score += 3
            elif left.endswith(before_anchor[-min(20, len(before_anchor)) :]):
                score += 1
        if after_anchor:
            right_start = pos + len(selected_text)
            right = original[right_start : right_start + len(after_anchor)]
            if right == after_anchor:
                score += 3
            elif right.startswith(after_anchor[: min(20, len(after_anchor))]):
                score += 1
        scored.append((score, pos))

    scored.sort(key=lambda item: (item[0], -item[1]), reverse=True)
    _, pos = scored[0]
    return original[:pos] + replacement + original[pos + len(selected_text) :]


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
    try:
        file_payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=chapter.project_id,
            entity_type="chapter",
            entity_id=chapter.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"章节文件不存在: {exc}") from exc
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _serialize_chapter(chapter, file_payload=file_payload)


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
    try:
        supports_flush = hasattr(db, "flush")
        if supports_flush:
            await _safe_db_call(db, "flush")
            await _sync_chapter_document(chapter=chapter, user_id=user_id, db=db)
        await db.commit()
        await _safe_db_call(db, "refresh", chapter)
    except WorkspaceSecurityError as exc:
        await _safe_db_call(db, "rollback")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        await _safe_db_call(db, "rollback")
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        await _safe_db_call(db, "rollback")
        logger.exception("create_chapter file-truth sync failed: project_id=%s chapter_id=%s", project_id, chapter.id)
        raise HTTPException(status_code=500, detail="章节落盘失败")
    if not hasattr(db, "flush"):
        return _serialize_chapter(chapter)
    return await get_chapter(chapter.id, user_id=user_id, db=db)


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
            should_snapshot = req.content is not None or req.title is not None
            if should_snapshot:
                await _snapshot_chapter_history_before_mutation(chapter=chapter, user_id=user_id)
            await optimistic_update(Chapter, chapter_id, updates, db=db)
            result = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
            chapter = result.scalar_one_or_none()
            if chapter is None:
                raise HTTPException(status_code=404, detail="Chapter not found")
            await _sync_chapter_document(chapter=chapter, user_id=user_id, db=db)
            await db.commit()
        except ValueError as exc:
            await _safe_db_call(db, "rollback")
            raise HTTPException(status_code=409, detail=str(exc))
        except WorkspaceSecurityError as exc:
            await _safe_db_call(db, "rollback")
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except HTTPException:
            await _safe_db_call(db, "rollback")
            raise
        except Exception:
            await _safe_db_call(db, "rollback")
            logger.exception("update_chapter file-truth sync failed: chapter_id=%s", chapter_id)
            raise HTTPException(status_code=500, detail="章节落盘失败")

    return await get_chapter(chapter_id, user_id=user_id, db=db)


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
    request: Request,
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
    request: Request,
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
    request: Request,
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

    try:
        await _snapshot_chapter_history_before_mutation(chapter=chapter, user_id=user_id)
        new_content = _replace_selected_text_with_context(
            original=chapter.content or "",
            selected_text=req.selected_text,
            replacement=accumulated,
            context_before=req.context_before,
            context_after=req.context_after,
        )
        chapter.content = new_content
        chapter.word_count = len(new_content)
        await _sync_chapter_document(chapter=chapter, user_id=user_id, db=db)
        await db.commit()
        await db.refresh(chapter)
    except WorkspaceSecurityError as exc:
        await _safe_db_call(db, "rollback")
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        await _safe_db_call(db, "rollback")
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        await _safe_db_call(db, "rollback")
        logger.exception("partial_regenerate file-truth sync failed: chapter_id=%s", chapter.id)
        raise HTTPException(status_code=500, detail="章节落盘失败")
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
        await _safe_db_call(db, "rollback")
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

    chapter_order_map: dict[str, int] = {}
    for item in chapter_orders or []:
        if not isinstance(item, dict):
            continue
        ch_id = str(item.get("id") or "").strip()
        raw_number = item.get("chapter_number")
        if not ch_id or raw_number is None:
            continue
        try:
            new_num = int(raw_number)
        except (TypeError, ValueError):
            logger.warning("Reorder payload has invalid chapter_number for chapter %s: %r", ch_id, raw_number)
            continue
        if new_num < 1:
            logger.warning("Reorder payload has non-positive chapter_number for chapter %s: %s", ch_id, new_num)
            continue
        chapter_order_map[ch_id] = new_num

    if not chapter_order_map:
        await db.commit()
        return {"message": "Chapters reordered"}

    existing_result = await db.execute(
        select(Chapter.id, Chapter.version).where(
            Chapter.project_id == project_id,
            Chapter.id.in_(list(chapter_order_map)),
        )
    )
    existing_versions = {chapter_id: version for chapter_id, version in existing_result.all()}
    if not existing_versions:
        await db.commit()
        return {"message": "Chapters reordered"}

    matched_ids = [chapter_id for chapter_id in chapter_order_map if chapter_id in existing_versions]
    if not matched_ids:
        await db.commit()
        return {"message": "Chapters reordered"}

    version_guards = [
        and_(Chapter.id == chapter_id, Chapter.version == existing_versions[chapter_id])
        for chapter_id in matched_ids
    ]
    update_stmt = (
        update(Chapter)
        .where(Chapter.project_id == project_id, or_(*version_guards))
        .values(
            chapter_number=case(
                {chapter_id: chapter_order_map[chapter_id] for chapter_id in matched_ids},
                value=Chapter.id,
            ),
            version=Chapter.version + 1,
        )
    )
    result = await db.execute(update_stmt)
    if result.rowcount is not None and result.rowcount < len(matched_ids):
        logger.warning(
            "Reorder applied partially for project %s: matched=%d updated=%d",
            project_id,
            len(matched_ids),
            result.rowcount,
        )

    await db.commit()
    return {"message": "Chapters reordered"}


def _serialize_chapter(chapter: Chapter, *, file_payload: dict[str, Any] | None = None) -> dict:
    title = chapter.title
    content = chapter.content
    doc_path = f"chapters/chapter_{chapter.id}.md"
    doc_updated_at = chapter.updated_at.isoformat() if chapter.updated_at else None
    raw_content = content or ""
    content_hash = hashlib.sha256(raw_content.encode("utf-8")).hexdigest() if raw_content else ""

    if file_payload:
        markdown = str(file_payload.get("content", ""))
        parsed_title, parsed_body = _extract_title_and_body_from_markdown(markdown, chapter.title or "未命名章节")
        title = parsed_title
        content = parsed_body
        raw_content = markdown
        doc_path = str(file_payload.get("doc_path") or doc_path)
        content_hash = str(file_payload.get("content_hash") or "")
        doc_updated_at = str(file_payload.get("doc_updated_at") or doc_updated_at)

    return {
        "id": chapter.id,
        "project_id": chapter.project_id,
        "chapter_number": chapter.chapter_number,
        "title": title,
        "content": content,
        "summary": chapter.summary,
        "word_count": chapter.word_count,
        "status": chapter.status,
        "outline_id": chapter.outline_id,
        "sub_index": chapter.sub_index,
        "expansion_plan": chapter.expansion_plan,
        "doc_path": doc_path,
        "content_source": "file",
        "content_hash": content_hash,
        "doc_updated_at": doc_updated_at,
        "created_at": chapter.created_at.isoformat() if chapter.created_at else None,
        "updated_at": chapter.updated_at.isoformat() if chapter.updated_at else None,
    }
