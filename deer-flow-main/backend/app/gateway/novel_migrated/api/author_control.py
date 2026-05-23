"""Author Control Station API.

This module keeps author-control persistence in the novel workspace/RAG layer
while routing model-reasoning work through the main DeerFlow RunManager path.
"""

from __future__ import annotations

import difflib
import hashlib
import json
from collections.abc import AsyncGenerator
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.chapters import _sync_chapter_document
from app.gateway.novel_migrated.api.common import get_owned_project_resource, get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.author_control import NovelDraftVersion, NovelIssue, SceneCard
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.document_index import DocumentIndex
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.memory_service import memory_service
from app.gateway.novel_migrated.services.novel_agent_run_service import NovelAgentRunService, NovelAgentTask
from app.gateway.novel_migrated.services.novel_context_assembler import NovelContextAssembler, NovelContextRequest
from app.gateway.novel_migrated.services.workspace_document_service import workspace_document_service
from app.gateway.novel_migrated.utils.sse_response import SSEResponse, create_sse_response

logger = get_logger(__name__)
router = APIRouter(tags=["author-control"])


def get_novel_agent_run_service() -> NovelAgentRunService:
    return NovelAgentRunService()


class ContextPreviewRequest(BaseModel):
    chapter_id: str | None = None
    task_kind: str = "continue"
    user_instruction: str = ""
    selected_text: str | None = None
    target_scene_id: str | None = None
    token_budget: int | None = Field(default=6000, ge=1000, le=30000)


class SceneCardPayload(BaseModel):
    project_id: str
    chapter_id: str
    order_index: int = 0
    title: str = ""
    scene_goal: str = ""
    pov_character_id: str | None = None
    location: str | None = None
    involved_character_ids: list[str] = Field(default_factory=list)
    conflict: str = ""
    emotional_turn: str = ""
    foreshadow_in: list[Any] = Field(default_factory=list)
    foreshadow_out: list[Any] = Field(default_factory=list)
    required_facts: list[Any] = Field(default_factory=list)
    forbidden_facts: list[Any] = Field(default_factory=list)
    status_delta: dict[str, Any] = Field(default_factory=dict)
    target_word_count: int | None = Field(default=800, ge=100, le=10000)
    draft_status: str = "planned"


class ScenePlanRequest(BaseModel):
    user_instruction: str = ""
    scene_count: int = Field(default=5, ge=3, le=8)
    token_budget: int | None = Field(default=7000, ge=1000, le=30000)


class SceneGenerateRequest(BaseModel):
    instruction: str = ""
    target_word_count: int | None = Field(default=None, ge=100, le=20000)


class SceneReorderRequest(BaseModel):
    items: list[dict[str, Any]]


class CritiqueRequest(BaseModel):
    instruction: str = ""
    focus_types: list[str] = Field(default_factory=list)


class IssueUpdateRequest(BaseModel):
    status: str | None = None
    fix_action: str | None = None
    suggestion: str | None = None


class IssueFixRequest(BaseModel):
    instruction: str = ""


class ReviseRequest(BaseModel):
    selected_text: str | None = None
    issue_ids: list[str] = Field(default_factory=list)
    instruction: str = ""
    preserve_elements: list[str] = Field(default_factory=list)
    scene_id: str | None = None


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 3)


def _context_hash(prompt: str) -> str:
    return _sha256(prompt)[:16]


def _extract_json_payload(text: str) -> Any:
    value = (text or "").strip()
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        start = value.find("[")
        end = value.rfind("]")
        if start >= 0 and end > start:
            try:
                return json.loads(value[start : end + 1])
            except json.JSONDecodeError:
                pass
        start = value.find("{")
        end = value.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(value[start : end + 1])
            except json.JSONDecodeError:
                pass
    return None


def _as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def _issue_severity(severity: Any, evidence_text: str) -> str:
    normalized = str(severity or "low").lower()
    if normalized not in {"low", "medium", "high", "critical"}:
        normalized = "low"
    if normalized in {"high", "critical"} and not evidence_text.strip():
        return "medium"
    return normalized


def _line_diff(base: str, new: str) -> dict[str, Any]:
    base_lines = (base or "").splitlines()
    new_lines = (new or "").splitlines()
    diff_lines = list(difflib.unified_diff(base_lines, new_lines, lineterm="", fromfile="base", tofile="candidate"))
    return {
        "format": "unified",
        "lines": diff_lines[:400],
        "base_word_count": len(base or ""),
        "new_word_count": len(new or ""),
    }


def _diff_summary(base: str, new: str) -> str:
    base_lines = (base or "").splitlines()
    new_lines = (new or "").splitlines()
    changes = list(difflib.ndiff(base_lines, new_lines))
    added = sum(1 for line in changes if line.startswith("+ "))
    removed = sum(1 for line in changes if line.startswith("- "))
    return f"新增 {added} 行，删除 {removed} 行，字数 {len(base or '')} -> {len(new or '')}"


def _serialize_scene(scene: SceneCard) -> dict[str, Any]:
    return {
        "id": scene.id,
        "user_id": scene.user_id,
        "project_id": scene.project_id,
        "chapter_id": scene.chapter_id,
        "order_index": scene.order_index,
        "title": scene.title,
        "scene_goal": scene.scene_goal,
        "pov_character_id": scene.pov_character_id,
        "location": scene.location,
        "involved_character_ids": scene.involved_character_ids or [],
        "conflict": scene.conflict or "",
        "emotional_turn": scene.emotional_turn or "",
        "foreshadow_in": scene.foreshadow_in or [],
        "foreshadow_out": scene.foreshadow_out or [],
        "required_facts": scene.required_facts or [],
        "forbidden_facts": scene.forbidden_facts or [],
        "status_delta": scene.status_delta or {},
        "target_word_count": scene.target_word_count,
        "draft_status": scene.draft_status,
        "created_at": scene.created_at.isoformat() if scene.created_at else None,
        "updated_at": scene.updated_at.isoformat() if scene.updated_at else None,
    }


def _serialize_issue(issue: NovelIssue) -> dict[str, Any]:
    return {
        "id": issue.id,
        "user_id": issue.user_id,
        "project_id": issue.project_id,
        "chapter_id": issue.chapter_id,
        "scene_id": issue.scene_id,
        "issue_type": issue.issue_type,
        "severity": issue.severity,
        "title": issue.title,
        "description": issue.description,
        "evidence_text": issue.evidence_text,
        "evidence_location": issue.evidence_location or {},
        "conflicting_fact": issue.conflicting_fact or "",
        "suggestion": issue.suggestion or "",
        "fix_action": issue.fix_action,
        "status": issue.status,
        "source_run_id": issue.source_run_id,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
    }


def _serialize_version(version: NovelDraftVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "user_id": version.user_id,
        "project_id": version.project_id,
        "chapter_id": version.chapter_id,
        "scene_id": version.scene_id,
        "source_run_id": version.source_run_id,
        "context_hash": version.context_hash,
        "base_content_hash": version.base_content_hash,
        "new_content_hash": version.new_content_hash,
        "diff_summary": version.diff_summary,
        "diff_payload": version.diff_payload or {},
        "content_snapshot_path": version.content_snapshot_path,
        "candidate_content": version.candidate_content,
        "status": version.status,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "updated_at": version.updated_at.isoformat() if version.updated_at else None,
    }


async def _get_chapter(db: AsyncSession, *, user_id: str, project_id: str, chapter_id: str) -> Chapter:
    return await get_owned_project_resource(
        Chapter,
        chapter_id,
        user_id,
        db,
        project_id=project_id,
        not_found_detail="Chapter not found",
    )


async def _context_payload(
    *,
    db: AsyncSession,
    user_id: str,
    project: Project,
    chapter: Chapter | None,
    req: ContextPreviewRequest | ScenePlanRequest | ReviseRequest | CritiqueRequest | SceneGenerateRequest,
    task_kind: str,
) -> tuple[dict[str, Any], str]:
    chapters_result = await db.execute(
        select(Chapter)
        .where(Chapter.project_id == project.id)
        .order_by(Chapter.chapter_number.desc())
        .limit(3)
    )
    recent_chapters = list(chapters_result.scalars().all())

    outlines_result = await db.execute(
        select(Outline).where(Outline.project_id == project.id).order_by(Outline.order_index.asc()).limit(5)
    )
    outlines = list(outlines_result.scalars().all())

    characters_result = await db.execute(
        select(Character).where(Character.project_id == project.id).order_by(Character.updated_at.desc()).limit(8)
    )
    characters = list(characters_result.scalars().all())

    foreshadows_result = await db.execute(
        select(Foreshadow)
        .where(Foreshadow.project_id == project.id, Foreshadow.include_in_context.is_(True))
        .order_by(Foreshadow.urgency.desc(), Foreshadow.updated_at.desc())
        .limit(8)
    )
    foreshadows = list(foreshadows_result.scalars().all())

    doc_result = await db.execute(
        select(DocumentIndex)
        .where(DocumentIndex.user_id == user_id, DocumentIndex.project_id == project.id)
        .order_by(DocumentIndex.indexed_at.desc())
        .limit(8)
    )
    workspace_documents = list(doc_result.scalars().all())

    rag_query = " ".join(
        part
        for part in [
            project.title,
            chapter.title if chapter else "",
            getattr(req, "user_instruction", "") or getattr(req, "instruction", ""),
            getattr(req, "selected_text", "") or "",
        ]
        if part
    )

    async def _rag(user: str, project_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        try:
            return await memory_service.search_memories(user, project_id, query, limit=limit)
        except Exception:
            logger.warning("author control RAG preview failed", exc_info=True)
            return []

    assembled = await NovelContextAssembler(rag_retriever=_rag).assemble(
        db=db,
        request=NovelContextRequest(
            user_id=user_id,
            project=project,
            chapter=chapter,
            task_type=task_kind,
            current_request=getattr(req, "user_instruction", "") or getattr(req, "instruction", ""),
            recent_context={
                "recent_chapters": [
                    f"第{item.chapter_number}章《{item.title}》: {(item.summary or item.content or '')[:240]}"
                    for item in recent_chapters
                ],
                "outline_context": [f"{item.title}: {(item.content or item.structure or '')[:240]}" for item in outlines],
                "character_states": [
                    f"{item.name}: 状态={item.status}; 心理={item.current_state or ''}; 性格={item.personality or ''}"[:300]
                    for item in characters
                ],
                "foreshadows": [item.to_context_string() for item in foreshadows],
            },
            rag_query=rag_query,
            rag_limit=8,
            max_chars=getattr(req, "token_budget", None) or 7000,
        ),
    )
    payload = {
        "user_memory_summary": "由主 DeerFlow DynamicContextMiddleware 注入；作者控制台不批量读取或写入主 memory。",
        "project_metadata": {
            "id": project.id,
            "title": project.title,
            "genre": project.genre,
            "theme": project.theme,
            "status": project.status,
            "current_words": project.current_words,
        },
        "chapter_context": {
            "id": chapter.id if chapter else None,
            "title": chapter.title if chapter else "",
            "summary": chapter.summary if chapter else "",
            "word_count": chapter.word_count if chapter else 0,
            "status": chapter.status if chapter else "",
        },
        "outline_context": [
            {"id": item.id, "title": item.title, "content": item.content, "structure": item.structure}
            for item in outlines
        ],
        "character_states": [
            {
                "id": item.id,
                "name": item.name,
                "status": item.status,
                "current_state": item.current_state,
                "state_updated_chapter": item.state_updated_chapter,
            }
            for item in characters
        ],
        "foreshadows": [item.to_dict() for item in foreshadows],
        "rag_hits": assembled.rag_results,
        "workspace_documents": [
            {
                "id": item.id,
                "entity_type": item.entity_type,
                "entity_id": item.entity_id,
                "title": item.title,
                "doc_path": item.doc_path,
                "content_hash": item.content_hash,
                "status": item.status,
            }
            for item in workspace_documents
        ],
        "excluded_context_reason": [
            "章节正文、剧情事实和角色状态只进入 Novel RAG/workspace，不写入主 DeerFlow memory。",
        ],
        "estimated_tokens": _estimate_tokens(assembled.prompt),
        "context_hash": _context_hash(assembled.prompt),
        "warnings": [] if assembled.rag_results else ["本次未命中 Novel RAG；将主要依赖项目/章节/结构化上下文。"],
    }
    return payload, assembled.prompt


async def _create_version(
    *,
    db: AsyncSession,
    user_id: str,
    project_id: str,
    chapter: Chapter,
    candidate_content: str,
    source_run_id: str | None,
    context_hash: str | None,
    scene_id: str | None = None,
) -> NovelDraftVersion:
    base = chapter.content or ""
    version = NovelDraftVersion(
        user_id=user_id,
        project_id=project_id,
        chapter_id=chapter.id,
        scene_id=scene_id,
        source_run_id=source_run_id,
        context_hash=context_hash,
        base_content_hash=_sha256(base),
        new_content_hash=_sha256(candidate_content),
        diff_summary=_diff_summary(base, candidate_content),
        diff_payload=_line_diff(base, candidate_content),
        candidate_content=candidate_content,
        base_content=base,
        status="candidate",
    )
    db.add(version)
    await db.flush()
    return version


async def _sync_summary_to_workspace(
    *,
    db: AsyncSession,
    user_id: str,
    project_id: str,
    entity_id: str,
    title: str,
    content: str,
) -> None:
    try:
        record = await workspace_document_service.write_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="author_control",
            entity_id=entity_id,
            content=content,
            title=title,
            tags=["author-control", "summary"],
        )
        await workspace_document_service.sync_record_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            record=record,
            status="pending",
        )
        await memory_service.sync_workspace_documents_incremental(
            user_id=user_id,
            project_id=project_id,
            db=db,
            limit=3,
        )
    except Exception:
        logger.warning("author control workspace/RAG sync failed", exc_info=True)


@router.post("/projects/{project_id}/author-control/context-preview")
async def context_preview(
    project_id: str,
    req: ContextPreviewRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    project = await verify_project_access(project_id, user_id, db)
    chapter = await _get_chapter(db, user_id=user_id, project_id=project_id, chapter_id=req.chapter_id) if req.chapter_id else None
    payload, _ = await _context_payload(db=db, user_id=user_id, project=project, chapter=chapter, req=req, task_kind=req.task_kind)
    return payload


@router.get("/projects/{project_id}/chapters/{chapter_id}/scenes")
async def list_scenes(
    project_id: str,
    chapter_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    await _get_chapter(db, user_id=user_id, project_id=project_id, chapter_id=chapter_id)
    result = await db.execute(
        select(SceneCard)
        .where(SceneCard.user_id == user_id, SceneCard.project_id == project_id, SceneCard.chapter_id == chapter_id)
        .order_by(SceneCard.order_index.asc(), SceneCard.created_at.asc())
    )
    return {"items": [_serialize_scene(item) for item in result.scalars().all()]}


@router.post("/projects/{project_id}/chapters/{chapter_id}/scenes/plan")
async def plan_scenes(
    project_id: str,
    chapter_id: str,
    req: ScenePlanRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    novel_agent_run_service: NovelAgentRunService = Depends(get_novel_agent_run_service),
):
    project = await verify_project_access(project_id, user_id, db)
    chapter = await _get_chapter(db, user_id=user_id, project_id=project_id, chapter_id=chapter_id)
    context_payload, prompt = await _context_payload(db=db, user_id=user_id, project=project, chapter=chapter, req=req, task_kind="plan_scenes")
    result = await novel_agent_run_service.run_task(
        request=request,
        task=NovelAgentTask(
            prompt=(
                f"{prompt}\n\n请生成 {req.scene_count} 张场景卡，严格返回 JSON 数组。"
                "字段包含 title, scene_goal, conflict, emotional_turn, required_facts, forbidden_facts, target_word_count。"
            ),
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id,
            task_type="plan_scenes",
            metadata={"context_hash": context_payload["context_hash"]},
            requested_skills=["novel-control-station"],
        ),
    )
    raw_items = _extract_json_payload(result.content)
    items = raw_items if isinstance(raw_items, list) else []
    if not items:
        items = [
            {"title": f"场景 {idx + 1}", "scene_goal": req.user_instruction or f"推进《{chapter.title}》第 {idx + 1} 个关键 beat"}
            for idx in range(req.scene_count)
        ]
    max_result = await db.execute(
        select(func.max(SceneCard.order_index)).where(SceneCard.project_id == project_id, SceneCard.chapter_id == chapter_id)
    )
    next_index = int(max_result.scalar() or 0)
    scenes: list[SceneCard] = []
    for offset, item in enumerate(items[: req.scene_count]):
        if not isinstance(item, dict):
            continue
        scene = SceneCard(
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id,
            order_index=next_index + offset + 1,
            title=str(item.get("title") or f"场景 {offset + 1}")[:200],
            scene_goal=str(item.get("scene_goal") or item.get("goal") or ""),
            pov_character_id=item.get("pov_character_id"),
            location=item.get("location"),
            involved_character_ids=_as_list(item.get("involved_character_ids")),
            conflict=str(item.get("conflict") or ""),
            emotional_turn=str(item.get("emotional_turn") or ""),
            foreshadow_in=_as_list(item.get("foreshadow_in")),
            foreshadow_out=_as_list(item.get("foreshadow_out")),
            required_facts=_as_list(item.get("required_facts")),
            forbidden_facts=_as_list(item.get("forbidden_facts")),
            status_delta=item.get("status_delta") if isinstance(item.get("status_delta"), dict) else {},
            target_word_count=int(item.get("target_word_count") or 800),
        )
        db.add(scene)
        scenes.append(scene)
    await _sync_summary_to_workspace(
        db=db,
        user_id=user_id,
        project_id=project_id,
        entity_id=f"scene-plan-{chapter_id}",
        title=f"场景计划：{chapter.title}",
        content=json.dumps([_serialize_scene(item) for item in scenes], ensure_ascii=False, indent=2),
    )
    await db.commit()
    return {
        "items": [_serialize_scene(item) for item in scenes],
        "run_id": result.run_id,
        "thread_id": result.thread_id,
        "context_hash": context_payload["context_hash"],
    }


@router.post("/scenes")
async def create_scene(
    payload: SceneCardPayload,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(payload.project_id, user_id, db)
    await _get_chapter(db, user_id=user_id, project_id=payload.project_id, chapter_id=payload.chapter_id)
    scene = SceneCard(user_id=user_id, **payload.model_dump())
    db.add(scene)
    await db.commit()
    await db.refresh(scene)
    return _serialize_scene(scene)


@router.patch("/scenes/{scene_id}")
async def update_scene(
    scene_id: str,
    payload: dict[str, Any],
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    scene = await get_owned_project_resource(SceneCard, scene_id, user_id, db, not_found_detail="Scene not found")
    allowed = set(SceneCardPayload.model_fields) - {"project_id", "chapter_id"}
    for key, value in payload.items():
        if key in allowed:
            setattr(scene, key, value)
    await db.commit()
    await db.refresh(scene)
    return _serialize_scene(scene)


@router.delete("/scenes/{scene_id}")
async def delete_scene(
    scene_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    scene = await get_owned_project_resource(SceneCard, scene_id, user_id, db, not_found_detail="Scene not found")
    await db.delete(scene)
    await db.commit()
    return {"message": "Scene deleted"}


@router.post("/scenes/reorder")
async def reorder_scenes(
    req: SceneReorderRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    for item in req.items:
        scene_id = str(item.get("id") or "")
        if not scene_id:
            continue
        await db.execute(
            update(SceneCard)
            .where(SceneCard.id == scene_id, SceneCard.user_id == user_id)
            .values(order_index=int(item.get("order_index") or 0))
        )
    await db.commit()
    return {"message": "Scenes reordered"}


@router.post("/scenes/{scene_id}/generate-stream")
async def generate_scene_stream(
    scene_id: str,
    req: SceneGenerateRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    novel_agent_run_service: NovelAgentRunService = Depends(get_novel_agent_run_service),
):
    scene = await get_owned_project_resource(SceneCard, scene_id, user_id, db, not_found_detail="Scene not found")
    project = await verify_project_access(scene.project_id, user_id, db)
    chapter = await _get_chapter(db, user_id=user_id, project_id=scene.project_id, chapter_id=scene.chapter_id)
    context_payload, prompt = await _context_payload(
        db=db,
        user_id=user_id,
        project=project,
        chapter=chapter,
        req=req,
        task_kind="generate_scene",
    )

    async def _events() -> AsyncGenerator[str, None]:
        full_content = ""
        run_id = None
        thread_id = None
        try:
            task = NovelAgentTask(
                prompt=(
                    f"{prompt}\n\n根据以下场景卡生成正文候选，不要直接覆盖章节："
                    f"\n{json.dumps(_serialize_scene(scene), ensure_ascii=False)}"
                ),
                user_id=user_id,
                project_id=scene.project_id,
                chapter_id=scene.chapter_id,
                task_type="generate_scene",
                metadata={"context_hash": context_payload["context_hash"], "scene_id": scene.id},
                requested_skills=["novel-control-station"],
            )
            async for event in novel_agent_run_service.stream_task(request=request, task=task):
                if event.type == "metadata":
                    run_id = event.run_id
                    thread_id = event.thread_id
                    yield SSEResponse.format_sse(
                        {"type": "progress", "message": "主 Agent 运行已启动", "run_id": run_id, "thread_id": thread_id},
                        event="progress",
                    )
                elif event.type == "content" and event.content:
                    full_content += event.content
                    yield SSEResponse.format_sse({"type": "content", "content": event.content}, event="content")
                elif event.type == "heartbeat":
                    yield SSEResponse.format_sse({"type": "progress", "message": "生成中"}, event="progress")
            version = await _create_version(
                db=db,
                user_id=user_id,
                project_id=scene.project_id,
                chapter=chapter,
                scene_id=scene.id,
                candidate_content=(chapter.content or "") + ("\n\n" if chapter.content else "") + full_content,
                source_run_id=run_id,
                context_hash=context_payload["context_hash"],
            )
            scene.draft_status = "drafted"
            await db.commit()
            yield SSEResponse.format_sse(
                {"type": "result", "content": full_content, "version": _serialize_version(version)},
                event="result",
            )
            yield SSEResponse.format_sse({"type": "complete", "run_id": run_id, "thread_id": thread_id}, event="complete")
        except Exception as exc:
            logger.exception("scene generation failed scene_id=%s", scene_id)
            yield SSEResponse.format_sse({"type": "error", "message": str(exc)}, event="error")

    return create_sse_response(_events())


@router.get("/projects/{project_id}/issues")
async def list_issues(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
):
    await verify_project_access(project_id, user_id, db)
    query = select(NovelIssue).where(NovelIssue.user_id == user_id, NovelIssue.project_id == project_id)
    if status:
        query = query.where(NovelIssue.status == status)
    result = await db.execute(query.order_by(NovelIssue.created_at.desc()))
    return {"items": [_serialize_issue(item) for item in result.scalars().all()]}


@router.post("/projects/{project_id}/chapters/{chapter_id}/critique")
async def critique_chapter(
    project_id: str,
    chapter_id: str,
    req: CritiqueRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    novel_agent_run_service: NovelAgentRunService = Depends(get_novel_agent_run_service),
):
    project = await verify_project_access(project_id, user_id, db)
    chapter = await _get_chapter(db, user_id=user_id, project_id=project_id, chapter_id=chapter_id)
    context_payload, prompt = await _context_payload(db=db, user_id=user_id, project=project, chapter=chapter, req=req, task_kind="critique")
    result = await novel_agent_run_service.run_task(
        request=request,
        task=NovelAgentTask(
            prompt=(
                f"{prompt}\n\n请审校当前章节，返回 JSON 数组。每项必须包含 issue_type,severity,title,description,"
                "evidence_text,evidence_location,conflicting_fact,suggestion,fix_action。"
            ),
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id,
            task_type="critique",
            metadata={"context_hash": context_payload["context_hash"]},
            requested_skills=["novel-control-station"],
        ),
    )
    raw_items = _extract_json_payload(result.content)
    items = raw_items if isinstance(raw_items, list) else []
    if not items:
        sample = (chapter.content or chapter.summary or chapter.title or "")[:120]
        items = [{
            "issue_type": "pacing",
            "severity": "low",
            "title": "需要人工复核的章节节奏",
            "description": "主 Agent 未返回结构化 issue，已生成低风险复核项。",
            "evidence_text": sample,
            "suggestion": "重新审校或补充更明确的审校重点。",
            "fix_action": "add_todo",
        }]
    issues: list[NovelIssue] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        evidence = str(item.get("evidence_text") or "")
        issue = NovelIssue(
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id,
            scene_id=item.get("scene_id"),
            issue_type=str(item.get("issue_type") or "style"),
            severity=_issue_severity(item.get("severity"), evidence),
            title=str(item.get("title") or "未命名问题")[:200],
            description=str(item.get("description") or ""),
            evidence_text=evidence,
            evidence_location=item.get("evidence_location") if isinstance(item.get("evidence_location"), dict) else {},
            conflicting_fact=str(item.get("conflicting_fact") or ""),
            suggestion=str(item.get("suggestion") or ""),
            fix_action=str(item.get("fix_action") or "revise_selection"),
            source_run_id=result.run_id,
        )
        db.add(issue)
        issues.append(issue)
    await db.commit()
    return {"items": [_serialize_issue(item) for item in issues], "run_id": result.run_id, "context_hash": context_payload["context_hash"]}


@router.patch("/issues/{issue_id}")
async def update_issue(
    issue_id: str,
    req: IssueUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    issue = await get_owned_project_resource(NovelIssue, issue_id, user_id, db, not_found_detail="Issue not found")
    if req.status is not None:
        issue.status = req.status
    if req.fix_action is not None:
        issue.fix_action = req.fix_action
    if req.suggestion is not None:
        issue.suggestion = req.suggestion
    await db.commit()
    await db.refresh(issue)
    return _serialize_issue(issue)


@router.post("/issues/{issue_id}/fix")
async def fix_issue(
    issue_id: str,
    req: IssueFixRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    novel_agent_run_service: NovelAgentRunService = Depends(get_novel_agent_run_service),
):
    issue = await get_owned_project_resource(NovelIssue, issue_id, user_id, db, not_found_detail="Issue not found")
    if not issue.chapter_id:
        raise HTTPException(status_code=400, detail="Issue is not linked to a chapter")
    return await revise_chapter(
        chapter_id=issue.chapter_id,
        req=ReviseRequest(
            selected_text=issue.evidence_text,
            issue_ids=[issue.id],
            instruction=req.instruction or issue.suggestion or issue.description,
        ),
        request=request,
        user_id=user_id,
        db=db,
        novel_agent_run_service=novel_agent_run_service,
    )


@router.get("/chapters/{chapter_id}/versions")
async def list_versions(
    chapter_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    chapter = await get_owned_project_resource(Chapter, chapter_id, user_id, db, not_found_detail="Chapter not found")
    result = await db.execute(
        select(NovelDraftVersion)
        .where(NovelDraftVersion.user_id == user_id, NovelDraftVersion.chapter_id == chapter.id)
        .order_by(NovelDraftVersion.created_at.desc())
    )
    return {"items": [_serialize_version(item) for item in result.scalars().all()]}


@router.post("/chapters/{chapter_id}/revise")
async def revise_chapter(
    chapter_id: str,
    req: ReviseRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    novel_agent_run_service: NovelAgentRunService = Depends(get_novel_agent_run_service),
):
    chapter = await get_owned_project_resource(Chapter, chapter_id, user_id, db, not_found_detail="Chapter not found")
    project = await verify_project_access(chapter.project_id, user_id, db)
    issues: list[NovelIssue] = []
    if req.issue_ids:
        result = await db.execute(
            select(NovelIssue).where(
                NovelIssue.user_id == user_id,
                NovelIssue.project_id == project.id,
                NovelIssue.id.in_(req.issue_ids),
            )
        )
        issues = list(result.scalars().all())
    context_payload, prompt = await _context_payload(db=db, user_id=user_id, project=project, chapter=chapter, req=req, task_kind="revise")
    issue_context = "\n".join(
        f"- {item.title}: {item.description}; 证据={item.evidence_text}; 建议={item.suggestion}"
        for item in issues
    )
    result = await novel_agent_run_service.run_task(
        request=request,
        task=NovelAgentTask(
            prompt=(
                f"{prompt}\n\n请生成修订后的完整章节候选，只输出正文，不要解释。\n"
                f"选区: {req.selected_text or '(无)'}\n"
                f"问题: {issue_context or '(无)'}\n"
                f"保留元素: {', '.join(req.preserve_elements) or '(无)'}"
            ),
            user_id=user_id,
            project_id=project.id,
            chapter_id=chapter.id,
            task_type="revise",
            metadata={"context_hash": context_payload["context_hash"], "issue_ids": req.issue_ids},
            requested_skills=["novel-control-station"],
        ),
    )
    candidate = result.content.strip()
    if not candidate:
        raise HTTPException(status_code=502, detail="主 Agent 未返回修订候选")
    version = await _create_version(
        db=db,
        user_id=user_id,
        project_id=project.id,
        chapter=chapter,
        scene_id=req.scene_id,
        candidate_content=candidate,
        source_run_id=result.run_id,
        context_hash=context_payload["context_hash"],
    )
    await db.commit()
    return {"version": _serialize_version(version), "run_id": result.run_id, "context_hash": context_payload["context_hash"]}


async def _set_version_status(
    *,
    version_id: str,
    user_id: str,
    db: AsyncSession,
    status: Literal["accepted", "rejected", "rolled_back"],
) -> NovelDraftVersion:
    result = await db.execute(select(NovelDraftVersion).where(NovelDraftVersion.id == version_id, NovelDraftVersion.user_id == user_id))
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=404, detail="Version not found")
    version.status = status
    return version


@router.post("/versions/{version_id}/accept")
async def accept_version(
    version_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    version = await _set_version_status(version_id=version_id, user_id=user_id, db=db, status="accepted")
    chapter = await get_owned_project_resource(Chapter, version.chapter_id, user_id, db, not_found_detail="Chapter not found")
    chapter.content = version.candidate_content
    chapter.word_count = len(version.candidate_content)
    chapter.status = "draft" if chapter.status == "planned" else chapter.status
    await _sync_chapter_document(chapter=chapter, user_id=user_id, db=db)
    await _sync_summary_to_workspace(
        db=db,
        user_id=user_id,
        project_id=version.project_id,
        entity_id=f"accepted-version-{version.id}",
        title="已接受修订摘要",
        content=version.diff_summary,
    )
    await db.commit()
    await db.refresh(version)
    return {"version": _serialize_version(version), "chapter_id": chapter.id}


@router.post("/versions/{version_id}/reject")
async def reject_version(
    version_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    version = await _set_version_status(version_id=version_id, user_id=user_id, db=db, status="rejected")
    await db.commit()
    await db.refresh(version)
    return {"version": _serialize_version(version)}


@router.post("/versions/{version_id}/rollback")
async def rollback_version(
    version_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    version = await _set_version_status(version_id=version_id, user_id=user_id, db=db, status="rolled_back")
    chapter = await get_owned_project_resource(Chapter, version.chapter_id, user_id, db, not_found_detail="Chapter not found")
    chapter.content = version.base_content
    chapter.word_count = len(version.base_content)
    await _sync_chapter_document(chapter=chapter, user_id=user_id, db=db)
    await db.commit()
    await db.refresh(version)
    return {"version": _serialize_version(version), "chapter_id": chapter.id}
