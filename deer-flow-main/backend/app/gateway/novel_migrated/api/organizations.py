"""组织管理API"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.relationship import Organization, OrganizationMember

logger = get_logger(__name__)
router = APIRouter(prefix="/organizations", tags=["organizations"])


class OrganizationUpdateRequest(BaseModel):
    organization_type: Optional[str] = None
    purpose: Optional[str] = None
    hierarchy: Optional[str] = None
    power_level: Optional[int] = None
    location: Optional[str] = None


class MemberAddRequest(BaseModel):
    character_id: str
    position: str = ""
    rank: int = 5
    loyalty: int = 50
    status: str = "active"


class MemberUpdateRequest(BaseModel):
    position: Optional[str] = None
    rank: Optional[int] = None
    loyalty: Optional[int] = None
    status: Optional[str] = None


@router.get("/project/{project_id}")
async def list_organizations(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)
    result = await db.execute(
        select(Character).where(
            Character.project_id == project_id,
            Character.is_organization == True)
        .order_by(Character.created_at))
    orgs = result.scalars().all()

    org_list = []
    for org_char in orgs:
        org_result = await db.execute(
            select(Organization).where(Organization.character_id == org_char.id))
        org_detail = org_result.scalar_one_or_none()

        members_result = await db.execute(
            select(OrganizationMember, Character.name).join(
                Character, OrganizationMember.character_id == Character.id
            ).where(OrganizationMember.organization_id == org_detail.id if org_detail else None))
        members = []
        if org_detail:
            mem_res = await db.execute(
                select(OrganizationMember, Character.name).join(
                    Character, OrganizationMember.character_id == Character.id
                ).where(OrganizationMember.organization_id == org_detail.id))
            members = [{"id": m.id, "character_id": m.character_id, "character_name": name,
                        "position": m.position, "rank": m.rank, "loyalty": m.loyalty,
                        "status": m.status}
                       for m, name in mem_res.all()]

        org_list.append({
            "id": org_char.id, "name": org_char.name,
            "organization_type": org_char.organization_type,
            "organization_purpose": org_char.organization_purpose,
            "personality": org_char.personality,
            "background": org_char.background,
            "hierarchy": org_detail.hierarchy if org_detail else None,
            "power_level": org_detail.power_level if org_detail else None,
            "location": org_detail.location if org_detail else None,
            "members": members,
        })

    return {"organizations": org_list}


@router.get("/{organization_id}")
async def get_organization(
    organization_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Character).where(Character.id == organization_id))
    org_char = result.scalar_one_or_none()
    if not org_char or not org_char.is_organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    await verify_project_access(org_char.project_id, user_id, db)

    org_result = await db.execute(
        select(Organization).where(Organization.character_id == org_char.id))
    org_detail = org_result.scalar_one_or_none()

    members = []
    if org_detail:
        mem_res = await db.execute(
            select(OrganizationMember, Character.name).join(
                Character, OrganizationMember.character_id == Character.id
            ).where(OrganizationMember.organization_id == org_detail.id))
        members = [{"id": m.id, "character_id": m.character_id, "character_name": name,
                    "position": m.position, "rank": m.rank, "loyalty": m.loyalty, "status": m.status}
                   for m, name in mem_res.all()]

    return {
        "id": org_char.id, "name": org_char.name,
        "organization_type": org_char.organization_type,
        "organization_purpose": org_char.organization_purpose,
        "personality": org_char.personality, "background": org_char.background,
        "appearance": org_char.appearance,
        "hierarchy": org_detail.hierarchy if org_detail else None,
        "power_level": org_detail.power_level if org_detail else None,
        "location": org_detail.location if org_detail else None,
        "members": members,
    }


@router.put("/{organization_id}")
async def update_organization(
    organization_id: str,
    req: OrganizationUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Character).where(Character.id == organization_id))
    org_char = result.scalar_one_or_none()
    if not org_char or not org_char.is_organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    await verify_project_access(org_char.project_id, user_id, db)

    org_result = await db.execute(
        select(Organization).where(Organization.character_id == org_char.id))
    org_detail = org_result.scalar_one_or_none()
    if not org_detail:
        org_detail = Organization(character_id=org_char.id, name=org_char.name)
        db.add(org_detail)
        await db.flush()

    for field_name in ['organization_type', 'purpose', 'hierarchy', 'power_level', 'location']:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(org_detail, field_name, value)

    await db.commit()
    return {"message": "Organization updated", "id": organization_id}


@router.post("/{organization_id}/members")
async def add_member(
    organization_id: str,
    req: MemberAddRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Character).where(Character.id == organization_id))
    org_char = result.scalar_one_or_none()
    if not org_char or not org_char.is_organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    await verify_project_access(org_char.project_id, user_id, db)

    char_result = await db.execute(select(Character).where(Character.id == req.character_id))
    member_char = char_result.scalar_one_or_none()
    if not member_char:
        raise HTTPException(status_code=404, detail="Character not found")

    org_result = await db.execute(
        select(Organization).where(Organization.character_id == org_char.id))
    org_detail = org_result.scalar_one_or_none()
    if not org_detail:
        raise HTTPException(status_code=404, detail="Organization detail not found")

    existing = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_detail.id,
            OrganizationMember.character_id == req.character_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Character is already a member")

    member = OrganizationMember(
        organization_id=org_detail.id,
        character_id=req.character_id,
        position=req.position,
        rank=req.rank,
        loyalty=req.loyalty,
        status=req.status,
    )
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return {"id": member.id, "organization_id": org_detail.id,
            "character_id": req.character_id, "position": req.position}


@router.put("/members/{member_id}")
async def update_member(
    member_id: str,
    req: MemberUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(OrganizationMember).where(OrganizationMember.id == member_id))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    org_result = await db.execute(select(Organization).where(Organization.id == member.organization_id))
    org = org_result.scalar_one_or_none()
    if org:
        char_result = await db.execute(select(Character).where(Character.id == org.character_id))
        org_char = char_result.scalar_one_or_none()
        if org_char:
            await verify_project_access(org_char.project_id, user_id, db)

    for field_name in ['position', 'rank', 'loyalty', 'status']:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(member, field_name, value)

    await db.commit()
    return {"message": "Member updated", "id": member_id}


@router.delete("/members/{member_id}")
async def remove_member(
    member_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(OrganizationMember).where(OrganizationMember.id == member_id))
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await db.delete(member)
    await db.commit()
    return {"message": "Member removed"}
