"""组织管理 API（文件真值详情，DB 仅保留运行态关联）"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.relationship import Organization, OrganizationMember
from app.gateway.novel_migrated.services.workspace_document_service import WorkspaceSecurityError, workspace_document_service

router = APIRouter(prefix="/organizations", tags=["organizations"])


class OrganizationUpdateRequest(BaseModel):
    organization_type: str | None = None
    purpose: str | None = None
    hierarchy: str | None = None
    power_level: int | None = None
    location: str | None = None


class MemberAddRequest(BaseModel):
    character_id: str
    position: str = ""
    rank: int = 5
    loyalty: int = 50
    status: str = "active"


class MemberUpdateRequest(BaseModel):
    position: str | None = None
    rank: int | None = None
    loyalty: int | None = None
    status: str | None = None


def _compose_org_markdown(payload: dict[str, Any]) -> str:
    title = str(payload.get("name") or "未命名组织")
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return f"# {title}\n\n```json\n{body}\n```\n"


def _extract_org_payload(markdown: str) -> dict[str, Any] | None:
    text = (markdown or "").replace("\r\n", "\n")
    start = text.find("```json")
    if start < 0:
        return None
    start += len("```json")
    end = text.find("```", start)
    if end < 0:
        return None
    raw = text[start:end].strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def _build_org_payload_from_db(
    *,
    organization_id: str,
    db: AsyncSession,
) -> tuple[Character, dict[str, Any]]:
    char_result = await db.execute(select(Character).where(Character.id == organization_id))
    org_char = char_result.scalar_one_or_none()
    if not org_char or not org_char.is_organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    org_result = await db.execute(select(Organization).where(Organization.character_id == organization_id))
    org_detail = org_result.scalar_one_or_none()

    members: list[dict[str, Any]] = []
    if org_detail:
        mem_res = await db.execute(
            select(OrganizationMember, Character.name)
            .join(Character, OrganizationMember.character_id == Character.id)
            .where(OrganizationMember.organization_id == org_detail.id)
        )
        members = [
            {
                "id": m.id,
                "character_id": m.character_id,
                "character_name": name,
                "position": m.position,
                "rank": m.rank,
                "loyalty": m.loyalty,
                "status": m.status,
            }
            for m, name in mem_res.all()
        ]

    payload = {
        "id": org_char.id,
        "project_id": org_char.project_id,
        "name": org_char.name,
        "organization_type": org_char.organization_type or (org_detail.organization_type if org_detail else None),
        "organization_purpose": org_char.organization_purpose or (org_detail.purpose if org_detail else None),
        "personality": org_char.personality,
        "background": org_char.background,
        "appearance": org_char.appearance,
        "hierarchy": org_detail.hierarchy if org_detail else None,
        "power_level": org_detail.power_level if org_detail else None,
        "location": org_detail.location if org_detail else None,
        "members": members,
    }
    return org_char, payload


async def _sync_org_document(
    *,
    org_char: Character,
    payload: dict[str, Any],
    user_id: str,
    db: AsyncSession,
) -> dict[str, Any]:
    try:
        record = await workspace_document_service.write_document(
            user_id=user_id,
            project_id=org_char.project_id,
            entity_type="organization",
            entity_id=org_char.id,
            content=_compose_org_markdown(payload),
            title=str(payload.get("name") or org_char.name or "组织"),
            tags=["organization"],
        )
        await workspace_document_service.sync_record_to_db(
            db=db,
            user_id=user_id,
            project_id=org_char.project_id,
            record=record,
            status="indexed",
        )
        return {
            "doc_path": record.path,
            "content_source": "file",
            "content_hash": record.content_hash,
            "doc_updated_at": record.mtime,
        }
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


async def _read_org_document_or_404(
    *,
    project_id: str,
    organization_id: str,
    user_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        doc_payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="organization",
            entity_id=organization_id,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"组织文件不存在: {exc}") from exc
    except WorkspaceSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    parsed = _extract_org_payload(str(doc_payload.get("content") or ""))
    if not parsed:
        raise HTTPException(status_code=422, detail="组织文档格式错误")
    return parsed, doc_payload


@router.get("/project/{project_id}")
async def list_organizations(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    result = await db.execute(
        select(Character.id)
        .where(Character.project_id == project_id, Character.is_organization.is_(True))
        .order_by(Character.created_at)
    )
    org_ids = [row[0] for row in result.all()]

    organizations: list[dict[str, Any]] = []
    missing_docs: list[str] = []
    for org_id in org_ids:
        try:
            payload, doc_meta = await _read_org_document_or_404(
                project_id=project_id,
                organization_id=org_id,
                user_id=user_id,
            )
            organizations.append(
                {
                    **payload,
                    "doc_path": doc_meta.get("doc_path"),
                    "content_source": "file",
                    "content_hash": doc_meta.get("content_hash"),
                    "doc_updated_at": doc_meta.get("doc_updated_at"),
                }
            )
        except HTTPException:
            missing_docs.append(org_id)

    if missing_docs:
        raise HTTPException(
            status_code=404,
            detail=f"以下组织缺少文件真值文档，请先执行 workspace/rescan 或重建: {', '.join(missing_docs)}",
        )
    return {"organizations": organizations}


@router.get("/{organization_id}")
async def get_organization(
    organization_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    char_result = await db.execute(select(Character).where(Character.id == organization_id))
    org_char = char_result.scalar_one_or_none()
    if not org_char or not org_char.is_organization:
        raise HTTPException(status_code=404, detail="Organization not found")
    await verify_project_access(org_char.project_id, user_id, db)

    payload, doc_meta = await _read_org_document_or_404(
        project_id=org_char.project_id,
        organization_id=organization_id,
        user_id=user_id,
    )
    return {
        **payload,
        "doc_path": doc_meta.get("doc_path"),
        "content_source": "file",
        "content_hash": doc_meta.get("content_hash"),
        "doc_updated_at": doc_meta.get("doc_updated_at"),
    }


@router.put("/{organization_id}")
async def update_organization(
    organization_id: str,
    req: OrganizationUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    org_char, payload = await _build_org_payload_from_db(organization_id=organization_id, db=db)
    await verify_project_access(org_char.project_id, user_id, db)

    org_result = await db.execute(select(Organization).where(Organization.character_id == org_char.id))
    org_detail = org_result.scalar_one_or_none()
    if not org_detail:
        org_detail = Organization(character_id=org_char.id, name=org_char.name)
        db.add(org_detail)
        await db.flush()

    if req.organization_type is not None:
        org_detail.organization_type = req.organization_type
    if req.purpose is not None:
        org_detail.purpose = req.purpose
    if req.hierarchy is not None:
        org_detail.hierarchy = req.hierarchy
    if req.power_level is not None:
        org_detail.power_level = req.power_level
    if req.location is not None:
        org_detail.location = req.location

    await db.flush()
    _, payload = await _build_org_payload_from_db(organization_id=organization_id, db=db)
    file_meta = await _sync_org_document(org_char=org_char, payload=payload, user_id=user_id, db=db)
    await db.commit()
    return {"message": "Organization updated", "id": organization_id, **file_meta}


@router.post("/{organization_id}/members")
async def add_member(
    organization_id: str,
    req: MemberAddRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    org_char, _ = await _build_org_payload_from_db(organization_id=organization_id, db=db)
    await verify_project_access(org_char.project_id, user_id, db)

    char_result = await db.execute(select(Character).where(Character.id == req.character_id))
    if not char_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Character not found")

    org_result = await db.execute(select(Organization).where(Organization.character_id == organization_id))
    org_detail = org_result.scalar_one_or_none()
    if not org_detail:
        raise HTTPException(status_code=404, detail="Organization detail not found")

    existing = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == org_detail.id,
            OrganizationMember.character_id == req.character_id,
        )
    )
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
    await db.flush()
    _, payload = await _build_org_payload_from_db(organization_id=organization_id, db=db)
    file_meta = await _sync_org_document(org_char=org_char, payload=payload, user_id=user_id, db=db)
    await db.commit()
    return {"id": member.id, "organization_id": org_detail.id, "character_id": req.character_id, "position": req.position, **file_meta}


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
    org_detail = org_result.scalar_one_or_none()
    if not org_detail:
        raise HTTPException(status_code=404, detail="Organization not found")

    char_result = await db.execute(select(Character).where(Character.id == org_detail.character_id))
    org_char = char_result.scalar_one_or_none()
    if not org_char:
        raise HTTPException(status_code=404, detail="Organization not found")
    await verify_project_access(org_char.project_id, user_id, db)

    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is not None:
            setattr(member, key, value)

    await db.flush()
    _, payload = await _build_org_payload_from_db(organization_id=org_char.id, db=db)
    file_meta = await _sync_org_document(org_char=org_char, payload=payload, user_id=user_id, db=db)
    await db.commit()
    return {"message": "Member updated", "id": member_id, **file_meta}


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

    org_result = await db.execute(select(Organization).where(Organization.id == member.organization_id))
    org_detail = org_result.scalar_one_or_none()
    if not org_detail:
        raise HTTPException(status_code=404, detail="Organization not found")

    char_result = await db.execute(select(Character).where(Character.id == org_detail.character_id))
    org_char = char_result.scalar_one_or_none()
    if not org_char:
        raise HTTPException(status_code=404, detail="Organization not found")
    await verify_project_access(org_char.project_id, user_id, db)

    await db.delete(member)
    await db.flush()
    _, payload = await _build_org_payload_from_db(organization_id=org_char.id, db=db)
    file_meta = await _sync_org_document(org_char=org_char, payload=payload, user_id=user_id, db=db)
    await db.commit()
    return {"message": "Member removed", **file_meta}
