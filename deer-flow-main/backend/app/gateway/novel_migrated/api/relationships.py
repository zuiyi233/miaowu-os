"""角色关系管理API"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.relationship import (
    RelationshipType, CharacterRelationship, Organization, OrganizationMember
)

logger = get_logger(__name__)
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
    relationship_name: Optional[str] = None
    intimacy_level: Optional[int] = None
    description: Optional[str] = None
    status: Optional[str] = None


class RelationshipTypeCreateRequest(BaseModel):
    project_id: str
    name: str
    category: str = ""
    description: str = ""


@router.get("/project/{project_id}")
async def list_relationships(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    character_id: Optional[str] = None,
):
    await verify_project_access(project_id, user_id, db)
    query = select(CharacterRelationship).where(CharacterRelationship.project_id == project_id)
    if character_id:
        from sqlalchemy import or_
        query = query.where(or_(
            CharacterRelationship.character_from_id == character_id,
            CharacterRelationship.character_to_id == character_id))
    result = await db.execute(query)
    rels = result.scalars().all()
    return {"relationships": [_serialize_relationship(r) for r in rels]}


@router.post("")
async def create_relationship(
    req: RelationshipCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(req.project_id, user_id, db)

    from_result = await db.execute(select(Character).where(Character.id == req.character_from_id))
    from_char = from_result.scalar_one_or_none()
    to_result = await db.execute(select(Character).where(Character.id == req.character_to_id))
    to_char = to_result.scalar_one_or_none()
    if not from_char or not to_char:
        raise HTTPException(status_code=404, detail="Character not found")

    rel = CharacterRelationship(
        project_id=req.project_id,
        character_from_id=req.character_from_id,
        character_to_id=req.character_to_id,
        relationship_name=req.relationship_name,
        intimacy_level=req.intimacy_level,
        description=req.description,
        status=req.status,
    )
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    return _serialize_relationship(rel)


@router.put("/{relationship_id}")
async def update_relationship(
    relationship_id: str,
    req: RelationshipUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CharacterRelationship).where(CharacterRelationship.id == relationship_id))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    await verify_project_access(rel.project_id, user_id, db)

    for field_name in ['relationship_name', 'intimacy_level', 'description', 'status']:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(rel, field_name, value)

    await db.commit()
    await db.refresh(rel)
    return _serialize_relationship(rel)


@router.delete("/{relationship_id}")
async def delete_relationship(
    relationship_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CharacterRelationship).where(CharacterRelationship.id == relationship_id))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="Relationship not found")
    await verify_project_access(rel.project_id, user_id, db)
    await db.delete(rel)
    await db.commit()
    return {"message": "Relationship deleted"}


@router.get("/types/project/{project_id}")
async def list_relationship_types(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(
        select(RelationshipType).where(RelationshipType.project_id == project_id))
    types = result.scalars().all()
    return {"relationship_types": [_serialize_rel_type(t) for t in types]}


@router.post("/types")
async def create_relationship_type(
    req: RelationshipTypeCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(req.project_id, user_id, db)
    rt = RelationshipType(
        project_id=req.project_id,
        name=req.name,
        category=req.category,
        description=req.description,
    )
    db.add(rt)
    await db.commit()
    await db.refresh(rt)
    return _serialize_rel_type(rt)


@router.get("/graph/{project_id}")
async def get_relationship_graph(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    chars_result = await db.execute(
        select(Character).where(Character.project_id == project_id))
    characters = chars_result.scalars().all()

    rels_result = await db.execute(
        select(CharacterRelationship).where(CharacterRelationship.project_id == project_id))
    relationships = rels_result.scalars().all()

    char_map = {c.id: {"id": c.id, "name": c.name, "is_organization": c.is_organization, "role_type": c.role_type} for c in characters}

    edges = []
    for r in relationships:
        edges.append({
            "source": r.character_from_id,
            "target": r.character_to_id,
            "relationship": r.relationship_name,
            "intimacy_level": r.intimacy_level,
        })

    return {"nodes": list(char_map.values()), "edges": edges}


def _serialize_relationship(r: CharacterRelationship) -> dict:
    return {
        "id": r.id, "project_id": r.project_id,
        "character_from_id": r.character_from_id,
        "character_to_id": r.character_to_id,
        "relationship_name": r.relationship_name,
        "intimacy_level": r.intimacy_level,
        "description": r.description,
        "status": r.status,
        "started_at": r.started_at.isoformat() if r.started_at else None,
    }


def _serialize_rel_type(t: RelationshipType) -> dict:
    return {
        "id": t.id, "project_id": t.project_id,
        "name": t.name, "category": t.category,
        "description": t.description,
    }
