"""角色关系管理API（文件真值版）"""

from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.models.document_index import DocumentIndex
from app.gateway.novel_migrated.services.workspace_document_service import WorkspaceSecurityError, workspace_document_service

router = APIRouter(prefix="/relationships", tags=["relationships"])


class RelationshipCreateRequest(BaseModel):
    project_id: str
    character_from_id: str
    character_to_id: str
    relationship_name: str
    intimacy_level: int = 50
    description: str = ""
    status: str = "active"


class RelationshipUpdateRequest(BaseModel):
    relationship_name: str | None = None
    intimacy_level: int | None = None
    description: str | None = None
    status: str | None = None


class RelationshipTypeCreateRequest(BaseModel):
    project_id: str
    name: str
    category: str = ""
    description: str = ""


def _normalize_relationship_store(raw_content: str) -> dict[str, Any]:
    text = (raw_content or "").strip()
    if not text:
        return {"relationships": [], "relationship_types": []}

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"relationships": [], "relationship_types": []}

    if isinstance(parsed, list):
        return {"relationships": parsed, "relationship_types": []}
    if isinstance(parsed, dict):
        relationships = parsed.get("relationships")
        relationship_types = parsed.get("relationship_types")
        return {
            "relationships": relationships if isinstance(relationships, list) else [],
            "relationship_types": relationship_types if isinstance(relationship_types, list) else [],
        }
    return {"relationships": [], "relationship_types": []}


async def _load_relationship_store(
    *,
    project_id: str,
    user_id: str,
    db: AsyncSession,
) -> tuple[dict[str, Any], dict[str, Any]]:
    await workspace_document_service.initialize_workspace(
        user_id=user_id,
        project_id=project_id,
    )
    try:
        payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="relationship",
            entity_id="relationships",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"关系文件不存在: {exc}") from exc
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    store = _normalize_relationship_store(str(payload.get("content") or ""))
    return store, payload


async def _find_store_by_relationship_id(
    *,
    relationship_id: str,
    user_id: str,
    db: AsyncSession,
) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    stmt = (
        select(DocumentIndex.project_id)
        .where(
            DocumentIndex.user_id == user_id,
            DocumentIndex.entity_type == "relationship",
            DocumentIndex.status != "stale",
        )
        .distinct()
    )
    result = await db.execute(stmt)
    for project_id in [row[0] for row in result.all()]:
        try:
            store, doc_meta = await _load_relationship_store(project_id=project_id, user_id=user_id, db=db)
        except HTTPException:
            continue
        for item in store.get("relationships", []):
            if isinstance(item, dict) and str(item.get("id") or "") == relationship_id:
                return project_id, store, doc_meta
    return None


async def _save_relationship_store(
    *,
    project_id: str,
    user_id: str,
    db: AsyncSession,
    store: dict[str, Any],
) -> dict[str, Any]:
    try:
        record = await workspace_document_service.write_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="relationship",
            entity_id="relationships",
            content=store,
            title="关系网络",
            tags=["relationship"],
        )
        await workspace_document_service.sync_record_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            record=record,
            status="indexed",
        )
        await db.commit()
    except WorkspaceSecurityError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"关系文件写入失败: {exc}") from exc

    return {
        "doc_path": record.path,
        "content_source": "file",
        "content_hash": record.content_hash,
        "doc_updated_at": record.mtime,
        "index_status": "synced",
    }


def _serialize_relationship(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(item.get("id") or ""),
        "project_id": str(item.get("project_id") or ""),
        "character_from_id": str(item.get("character_from_id") or ""),
        "character_to_id": str(item.get("character_to_id") or ""),
        "relationship_name": str(item.get("relationship_name") or ""),
        "intimacy_level": int(item.get("intimacy_level") or 0),
        "description": str(item.get("description") or ""),
        "status": str(item.get("status") or "active"),
        "started_at": item.get("started_at"),
    }


def _serialize_relationship_type(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(item.get("id") or ""),
        "project_id": str(item.get("project_id") or ""),
        "name": str(item.get("name") or ""),
        "category": str(item.get("category") or ""),
        "description": str(item.get("description") or ""),
    }


def _extract_character_node(content: str, character_id: str) -> dict[str, Any]:
    text = (content or "").replace("\r\n", "\n")
    name = character_id
    first_line = next((line.strip() for line in text.split("\n") if line.strip()), "")
    if first_line.startswith("#"):
        name = first_line.lstrip("#").strip() or character_id
    parsed = _extract_json_block(text)
    return {
        "id": character_id,
        "name": str(parsed.get("name") if isinstance(parsed, dict) else name or character_id),
        "is_organization": bool(parsed.get("is_organization")) if isinstance(parsed, dict) else False,
        "role_type": str(parsed.get("role_type") or "supporting") if isinstance(parsed, dict) else "supporting",
    }


def _extract_json_block(markdown: str) -> dict[str, Any] | None:
    start = markdown.find("```json")
    if start < 0:
        return None
    start += len("```json")
    end = markdown.find("```", start)
    if end < 0:
        return None
    raw = markdown[start:end].strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


@router.get("/project/{project_id}")
async def list_relationships(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    character_id: str | None = None,
):
    await verify_project_access(project_id, user_id, db)
    store, doc_meta = await _load_relationship_store(project_id=project_id, user_id=user_id, db=db)
    relationships = [_serialize_relationship(item) for item in store.get("relationships", []) if isinstance(item, dict)]
    if character_id:
        relationships = [
            rel
            for rel in relationships
            if rel.get("character_from_id") == character_id or rel.get("character_to_id") == character_id
        ]
    return {
        "relationships": relationships,
        "doc_path": doc_meta.get("doc_path"),
        "content_source": "file",
        "content_hash": doc_meta.get("content_hash"),
        "doc_updated_at": doc_meta.get("doc_updated_at"),
    }


@router.post("")
async def create_relationship(
    req: RelationshipCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(req.project_id, user_id, db)
    for character_id in (req.character_from_id, req.character_to_id):
        try:
            await workspace_document_service.read_document(
                user_id=user_id,
                project_id=req.project_id,
                entity_type="character",
                entity_id=character_id,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=f"Character file not found: {character_id}") from exc

    store, _ = await _load_relationship_store(project_id=req.project_id, user_id=user_id, db=db)
    relation = {
        "id": str(uuid.uuid4()),
        "project_id": req.project_id,
        "character_from_id": req.character_from_id,
        "character_to_id": req.character_to_id,
        "relationship_name": req.relationship_name,
        "intimacy_level": req.intimacy_level,
        "description": req.description,
        "status": req.status,
        "started_at": None,
    }
    store.setdefault("relationships", []).append(relation)
    file_meta = await _save_relationship_store(project_id=req.project_id, user_id=user_id, db=db, store=store)
    return {**_serialize_relationship(relation), **file_meta}


@router.put("/{relationship_id}")
async def update_relationship(
    relationship_id: str,
    req: RelationshipUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    resolved = await _find_store_by_relationship_id(relationship_id=relationship_id, user_id=user_id, db=db)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    target_project_id, store, _ = resolved
    relationships = store.get("relationships", [])

    target: dict[str, Any] | None = None
    for item in relationships:
        if not isinstance(item, dict):
            continue
        if str(item.get("id") or "") == relationship_id:
            target = item
            break

    if not target:
        raise HTTPException(status_code=404, detail="Relationship not found")
    await verify_project_access(target_project_id, user_id, db)

    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            target[key] = value

    file_meta = await _save_relationship_store(project_id=target_project_id, user_id=user_id, db=db, store=store)
    return {**_serialize_relationship(target), **file_meta}


@router.delete("/{relationship_id}")
async def delete_relationship(
    relationship_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    resolved = await _find_store_by_relationship_id(relationship_id=relationship_id, user_id=user_id, db=db)
    if resolved is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    fallback_project, store, _ = resolved
    relationships = [item for item in store.get("relationships", []) if isinstance(item, dict)]

    removed: dict[str, Any] | None = None
    remained: list[dict[str, Any]] = []
    for item in relationships:
        if str(item.get("id") or "") == relationship_id and removed is None:
            removed = item
            continue
        remained.append(item)

    if removed is None:
        raise HTTPException(status_code=404, detail="Relationship not found")

    project_id = str(removed.get("project_id") or fallback_project)
    await verify_project_access(project_id, user_id, db)
    store["relationships"] = remained
    file_meta = await _save_relationship_store(project_id=project_id, user_id=user_id, db=db, store=store)
    return {"message": "Relationship deleted", **file_meta}


@router.get("/types/project/{project_id}")
async def list_relationship_types(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    store, doc_meta = await _load_relationship_store(project_id=project_id, user_id=user_id, db=db)
    rel_types = [_serialize_relationship_type(item) for item in store.get("relationship_types", []) if isinstance(item, dict)]
    return {
        "relationship_types": rel_types,
        "doc_path": doc_meta.get("doc_path"),
        "content_source": "file",
        "content_hash": doc_meta.get("content_hash"),
        "doc_updated_at": doc_meta.get("doc_updated_at"),
    }


@router.post("/types")
async def create_relationship_type(
    req: RelationshipTypeCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(req.project_id, user_id, db)
    store, _ = await _load_relationship_store(project_id=req.project_id, user_id=user_id, db=db)
    rel_type = {
        "id": str(uuid.uuid4()),
        "project_id": req.project_id,
        "name": req.name,
        "category": req.category,
        "description": req.description,
    }
    store.setdefault("relationship_types", []).append(rel_type)
    file_meta = await _save_relationship_store(project_id=req.project_id, user_id=user_id, db=db, store=store)
    return {**_serialize_relationship_type(rel_type), **file_meta}


@router.get("/graph/{project_id}")
async def get_relationship_graph(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    store, doc_meta = await _load_relationship_store(project_id=project_id, user_id=user_id, db=db)
    character_indexes = await workspace_document_service.list_index_records(
        db=db,
        user_id=user_id,
        project_id=project_id,
        entity_type="character",
    )
    nodes = []
    for idx in character_indexes:
        doc_payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="character",
            entity_id=idx.entity_id,
        )
        nodes.append(_extract_character_node(str(doc_payload.get("content") or ""), idx.entity_id))

    edges = []
    for rel in store.get("relationships", []):
        if not isinstance(rel, dict):
            continue
        if str(rel.get("project_id") or project_id) != project_id:
            continue
        edges.append(
            {
                "source": rel.get("character_from_id"),
                "target": rel.get("character_to_id"),
                "relationship": rel.get("relationship_name"),
                "intimacy_level": rel.get("intimacy_level"),
            }
        )

    return {
        "nodes": nodes,
        "edges": edges,
        "doc_path": doc_meta.get("doc_path"),
        "content_source": "file",
        "content_hash": doc_meta.get("content_hash"),
        "doc_updated_at": doc_meta.get("doc_updated_at"),
    }
