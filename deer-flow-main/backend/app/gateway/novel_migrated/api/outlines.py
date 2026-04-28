"""大纲管理API - CRUD、续写、展开"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService
from app.gateway.novel_migrated.services.workspace_document_service import (
    WorkspaceSecurityError,
    workspace_document_service,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/outlines", tags=["outlines"])


class OutlineCreateRequest(BaseModel):
    title: str
    content: str
    structure: Optional[str] = None
    order_index: Optional[int] = None


class OutlineUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    structure: Optional[str] = None
    order_index: Optional[int] = None


class OutlineContinueRequest(BaseModel):
    project_id: str
    chapter_count: int = 5
    plot_stage_instruction: str = ""
    story_direction: str = ""
    requirements: str = ""


class OutlineExpandRequest(BaseModel):
    project_id: str
    outline_id: str
    target_chapter_count: int = 3
    expansion_strategy: str = "balanced"
    batch_size: int = 5


def _compose_outline_markdown(title: str, content: str) -> str:
    normalized_title = (title or "未命名大纲").strip() or "未命名大纲"
    normalized_content = (content or "").rstrip()
    if normalized_content:
        return f"# {normalized_title}\n\n{normalized_content}\n"
    return f"# {normalized_title}\n"


def _extract_outline_from_markdown(markdown: str, fallback_title: str) -> tuple[str, str]:
    text = (markdown or "").replace("\r\n", "\n")
    lines = text.split("\n")
    first_non_empty = next((idx for idx, line in enumerate(lines) if line.strip()), None)
    if first_non_empty is None:
        return fallback_title, ""
    first_line = lines[first_non_empty].strip()
    if first_line.startswith("#"):
        title = first_line.lstrip("#").strip() or fallback_title
        body = "\n".join(lines[first_non_empty + 1 :]).lstrip("\n")
        return title, body
    return fallback_title, text


async def _sync_outline_document(
    *,
    outline: Outline,
    user_id: str,
    db: AsyncSession,
) -> dict[str, str]:
    markdown = _compose_outline_markdown(outline.title or "", outline.content or "")
    record = await workspace_document_service.write_document(
        user_id=user_id,
        project_id=outline.project_id,
        entity_type="outline",
        entity_id=outline.id,
        content=markdown,
        title=outline.title or "大纲",
        tags=["outline"],
    )
    await workspace_document_service.sync_record_to_db(
        db=db,
        user_id=user_id,
        project_id=outline.project_id,
        record=record,
    )
    return {
        "doc_path": record.path,
        "content_hash": record.content_hash,
        "doc_updated_at": record.mtime,
    }


@router.get("/project/{project_id}")
async def list_outlines(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(
        select(Outline).where(Outline.project_id == project_id)
        .order_by(Outline.order_index))
    outlines = result.scalars().all()
    return {"outlines": [_serialize_outline(o) for o in outlines]}


@router.get("/{outline_id}")
async def get_outline(
    outline_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Outline).where(Outline.id == outline_id))
    outline = result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")
    await verify_project_access(outline.project_id, user_id, db)
    try:
        file_payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=outline.project_id,
            entity_type="outline",
            entity_id=outline.id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"大纲文件不存在: {exc}") from exc
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _serialize_outline(outline, file_payload=file_payload)


@router.post("/project/{project_id}")
async def create_outline(
    project_id: str,
    req: OutlineCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    if req.order_index is None:
        max_result = await db.execute(
            select(func.max(Outline.order_index)).where(Outline.project_id == project_id))
        order_index = (max_result.scalar() or 0) + 1
    else:
        order_index = req.order_index

    outline = Outline(
        project_id=project_id,
        title=req.title,
        content=req.content,
        structure=req.structure,
        order_index=order_index,
    )
    db.add(outline)
    try:
        await db.flush()
        await _sync_outline_document(outline=outline, user_id=user_id, db=db)
        await db.commit()
        await db.refresh(outline)
    except WorkspaceSecurityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        await db.rollback()
        logger.exception("create_outline file-truth sync failed: project_id=%s outline_id=%s", project_id, outline.id)
        raise HTTPException(status_code=500, detail="大纲落盘失败")
    return await get_outline(outline.id, user_id=user_id, db=db)


@router.put("/{outline_id}")
async def update_outline(
    outline_id: str,
    req: OutlineUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Outline).where(Outline.id == outline_id))
    outline = result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")
    await verify_project_access(outline.project_id, user_id, db)

    if req.title is not None:
        outline.title = req.title
    if req.content is not None:
        outline.content = req.content
    if req.structure is not None:
        outline.structure = req.structure
    if req.order_index is not None:
        outline.order_index = req.order_index

    try:
        await _sync_outline_document(outline=outline, user_id=user_id, db=db)
        await db.commit()
        await db.refresh(outline)
    except WorkspaceSecurityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        await db.rollback()
        logger.exception("update_outline file-truth sync failed: outline_id=%s", outline_id)
        raise HTTPException(status_code=500, detail="大纲落盘失败")
    return await get_outline(outline_id, user_id=user_id, db=db)


@router.delete("/{outline_id}")
async def delete_outline(
    outline_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Outline).where(Outline.id == outline_id))
    outline = result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")
    await verify_project_access(outline.project_id, user_id, db)
    await db.delete(outline)
    await db.commit()
    return {"message": "Outline deleted"}


@router.post("/continue")
async def continue_outlines(
    req: OutlineContinueRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    project_result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    outlines_result = await db.execute(
        select(Outline).where(Outline.project_id == req.project_id)
        .order_by(Outline.order_index.desc()).limit(10))
    recent_outlines = outlines_result.scalars().all()
    recent_outlines_text = "\n\n".join([
        f"第{o.order_index}节《{o.title}》：{o.content[:300]}"
        for o in reversed(recent_outlines)
    ])

    characters_result = await db.execute(
        select(Character).where(Character.project_id == req.project_id))
    characters = characters_result.scalars().all()
    characters_info = "\n".join([
        f"- {c.name} ({c.role_type}): {c.personality[:80] if c.personality else '暂无'}"
        for c in characters
    ])

    current_count_result = await db.execute(
        select(func.count(Outline.id)).where(Outline.project_id == req.project_id))
    current_count = current_count_result.scalar() or 0
    start_chapter = current_count + 1
    end_chapter = start_chapter + req.chapter_count - 1

    template = PromptService.OUTLINE_CONTINUE
    prompt = template.format(
        current_chapter_count=current_count,
        start_chapter=start_chapter,
        end_chapter=end_chapter,
        chapter_count=req.chapter_count,
        plot_stage_instruction=req.plot_stage_instruction or "发展阶段",
        story_direction=req.story_direction or "自然推进",
        title=project.title or "", theme=project.theme or "",
        genre=project.genre or "",
        narrative_perspective=project.narrative_perspective or "第三人称",
        time_period=project.world_time_period or "未设定",
        location=project.world_location or "未设定",
        atmosphere=project.world_atmosphere or "未设定",
        rules=project.world_rules or "未设定",
        recent_outlines=recent_outlines_text or "暂无已有大纲",
        characters_info=characters_info or "暂无角色",
        requirements=req.requirements or "无特殊要求",
        mcp_references=""
    )

    accumulated = ""
    async for chunk in ai_service.generate_text_stream(prompt=prompt, temperature=0.7):
        accumulated += chunk

    try:
        cleaned = ai_service._clean_json_response(accumulated)
        outlines_data = json.loads(cleaned)
        if not isinstance(outlines_data, list):
            outlines_data = [outlines_data]

        created = []
        for od in outlines_data:
            oi = (current_count + len(created) + 1)
            outline = Outline(
                project_id=req.project_id,
                title=od.get("title", f"第{oi}节"),
                content=od.get("summary", ""),
                structure=json.dumps(od, ensure_ascii=False) if isinstance(od, dict) else None,
                order_index=oi,
            )
            db.add(outline)
            created.append(outline)

        await db.flush()
        for outline in created:
            await _sync_outline_document(outline=outline, user_id=user_id, db=db)
        await db.commit()
        for o in created:
            await db.refresh(o)

        return {"outlines": [_serialize_outline(o) for o in created]}

    except (json.JSONDecodeError, Exception) as e:
        logger.error(f"Parse outline continue response failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI response parse error: {str(e)}")


@router.post("/expand")
async def expand_outline(
    req: OutlineExpandRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    from app.gateway.novel_migrated.services.plot_expansion_service import PlotExpansionService
    service = PlotExpansionService(ai_service)

    outline_result = await db.execute(select(Outline).where(Outline.id == req.outline_id))
    outline = outline_result.scalar_one_or_none()
    if not outline:
        raise HTTPException(status_code=404, detail="Outline not found")

    project_result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    chapter_plans = await service.analyze_outline_for_chapters(
        outline=outline, project=project, db=db,
        target_chapter_count=req.target_chapter_count,
        expansion_strategy=req.expansion_strategy,
        batch_size=req.batch_size
    )

    chapters = await service.create_chapters_from_plans(
        outline_id=req.outline_id,
        chapter_plans=chapter_plans,
        project_id=req.project_id,
        db=db
    )

    return {
        "outline_id": req.outline_id,
        "chapters_created": len(chapters),
        "chapters": [
            {
                "id": c.id,
                "chapter_number": c.chapter_number,
                "title": c.title,
                "summary": c.summary,
                "sub_index": c.sub_index,
            }
            for c in chapters
        ]
    }


@router.put("/reorder")
async def reorder_outlines(
    project_id: str = Query(...),
    outline_orders: list = [],
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    for item in outline_orders:
        oid = item.get("id")
        new_idx = item.get("order_index")
        if oid and new_idx is not None:
            result = await db.execute(select(Outline).where(Outline.id == oid))
            o = result.scalar_one_or_none()
            if o and o.project_id == project_id:
                o.order_index = new_idx
    await db.commit()
    return {"message": "Outlines reordered"}


def _serialize_outline(outline: Outline, *, file_payload: dict[str, Any] | None = None) -> dict:
    title = outline.title
    content = outline.content
    doc_path = f"outlines/{outline.id}.md"
    doc_updated_at = outline.updated_at.isoformat() if outline.updated_at else None

    if file_payload:
        markdown = str(file_payload.get("content", ""))
        parsed_title, parsed_content = _extract_outline_from_markdown(markdown, outline.title or "未命名大纲")
        title = parsed_title
        content = parsed_content
        doc_path = str(file_payload.get("doc_path") or doc_path)
        doc_updated_at = str(file_payload.get("doc_updated_at") or doc_updated_at)
        content_hash = str(file_payload.get("content_hash") or "")
    else:
        hash_payload = {
            "title": outline.title,
            "content": outline.content,
            "structure": outline.structure,
        }
        content_hash = hashlib.sha256(json.dumps(hash_payload, ensure_ascii=False).encode("utf-8")).hexdigest()

    return {
        "id": outline.id,
        "project_id": outline.project_id,
        "title": title,
        "content": content,
        "structure": outline.structure,
        "order_index": outline.order_index,
        "doc_path": doc_path,
        "content_source": "file",
        "content_hash": content_hash,
        "doc_updated_at": doc_updated_at,
        "created_at": outline.created_at.isoformat() if outline.created_at else None,
        "updated_at": outline.updated_at.isoformat() if outline.updated_at else None,
    }
