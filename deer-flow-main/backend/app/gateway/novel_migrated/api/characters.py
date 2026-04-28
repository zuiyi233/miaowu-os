"""角色管理API - CRUD、批量生成、单个生成"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AliasChoices, BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.career import Career, CharacterCareer
from app.gateway.novel_migrated.models.relationship import CharacterRelationship, Organization, OrganizationMember
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService

logger = get_logger(__name__)
router = APIRouter(prefix="/characters", tags=["characters"])


class CharacterCreateRequest(BaseModel):
    name: str
    is_organization: bool = False
    role_type: str = "supporting"
    personality: str = ""
    background: str = ""
    appearance: str = ""
    age: Optional[str] = None
    gender: Optional[str] = None
    organization_type: Optional[str] = None
    organization_purpose: Optional[str] = None
    traits: Optional[list] = None
    relationships: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("relationships", "relationships_text"),
    )


class CharacterUpdateRequest(BaseModel):
    name: Optional[str] = None
    role_type: Optional[str] = None
    personality: Optional[str] = None
    background: Optional[str] = None
    appearance: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    organization_type: Optional[str] = None
    organization_purpose: Optional[str] = None
    current_state: Optional[str] = None
    traits: Optional[list] = None
    relationships: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("relationships", "relationships_text"),
    )


class SingleGenerateRequest(BaseModel):
    project_id: str
    user_input: str = ""
    is_organization: bool = False


@router.get("/project/{project_id}")
async def list_characters(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    is_organization: Optional[bool] = None,
    role_type: Optional[str] = None,
):
    await verify_project_access(project_id, user_id, db)
    query = select(Character).where(Character.project_id == project_id)
    if is_organization is not None:
        query = query.where(Character.is_organization == is_organization)
    if role_type:
        query = query.where(Character.role_type == role_type)

    result = await db.execute(query.order_by(Character.created_at))
    characters = result.scalars().all()
    return {"characters": [_serialize_character(c) for c in characters]}


@router.get("/{character_id}")
async def get_character(
    character_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    await verify_project_access(character.project_id, user_id, db)
    return _serialize_character(character)


@router.post("/project/{project_id}")
async def create_character(
    project_id: str,
    req: CharacterCreateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    character = Character(
        project_id=project_id,
        name=req.name,
        is_organization=req.is_organization,
        role_type=req.role_type,
        personality=req.personality,
        background=req.background,
        appearance=req.appearance,
        age=req.age,
        gender=req.gender,
        organization_type=req.organization_type,
        organization_purpose=req.organization_purpose,
        traits=json.dumps(req.traits, ensure_ascii=False) if req.traits else None,
        relationships=req.relationships,
    )
    db.add(character)
    await db.commit()
    await db.refresh(character)
    return _serialize_character(character)


@router.put("/{character_id}")
async def update_character(
    character_id: str,
    req: CharacterUpdateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    await verify_project_access(character.project_id, user_id, db)

    update_fields = ['name', 'role_type', 'personality', 'background', 'appearance',
                      'age', 'gender', 'organization_type', 'organization_purpose',
                      'current_state', 'relationships']
    for field_name in update_fields:
        value = getattr(req, field_name, None)
        if value is not None:
            setattr(character, field_name, value)

    if req.traits is not None:
        character.traits = json.dumps(req.traits, ensure_ascii=False)

    await db.commit()
    await db.refresh(character)
    return _serialize_character(character)


@router.delete("/{character_id}")
async def delete_character(
    character_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Character).where(Character.id == character_id))
    character = result.scalar_one_or_none()
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    await verify_project_access(character.project_id, user_id, db)
    await db.delete(character)
    await db.commit()
    return {"message": "Character deleted"}


@router.post("/generate")
async def generate_single_character(
    req: SingleGenerateRequest,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
    ai_service: AIService = Depends(get_user_ai_service),
):
    await verify_project_access(req.project_id, user_id, db)

    project_result = await db.execute(select(Project).where(Project.id == req.project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    characters_result = await db.execute(
        select(Character).where(Character.project_id == req.project_id))
    characters = characters_result.scalars().all()

    careers_result = await db.execute(
        select(Career).where(Career.project_id == req.project_id))
    careers = careers_result.scalars().all()

    project_context = f"""书名：{project.title}
类型：{project.genre or '未设定'}
主题：{project.theme or '未设定'}
时间背景：{project.world_time_period or '未设定'}
地理位置：{project.world_location or '未设定'}
氛围基调：{project.world_atmosphere or '未设定'}
世界规则：{project.world_rules or '未设定'}

已有角色：
{chr(10).join(f'- {c.name} ({c.role_type})' for c in characters) if characters else '暂无角色'}

可用主职业列表：
{chr(10).join(f'- {c.name} (共{c.max_stage}阶)' for c in careers if c.type == 'main') if careers else '暂无职业'}

可用副职业列表：
{chr(10).join(f'- {c.name}' for c in careers if c.type == 'sub') if careers else '暂无副职业'}"""

    template = PromptService.SINGLE_ORGANIZATION_GENERATION if req.is_organization else PromptService.SINGLE_CHARACTER_GENERATION
    prompt = template.format(
        project_context=project_context,
        user_input=req.user_input or "请生成一个符合项目设定的角色"
    )

    chunks: list[str] = []
    async for chunk in ai_service.generate_text_stream(prompt=prompt, temperature=0.7):
        chunks.append(chunk)
    accumulated = "".join(chunks)

    try:
        cleaned = AIService.clean_json_response(accumulated)
        char_data = json.loads(cleaned)

        character = Character(
            project_id=req.project_id,
            name=char_data.get("name", "未命名"),
            is_organization=char_data.get("is_organization", req.is_organization),
            role_type=char_data.get("role_type", "supporting"),
            personality=char_data.get("personality", ""),
            background=char_data.get("background", ""),
            appearance=char_data.get("appearance", ""),
            age=str(char_data.get("age", "")) if char_data.get("age") else None,
            gender=char_data.get("gender"),
            organization_type=char_data.get("organization_type"),
            organization_purpose=char_data.get("organization_purpose"),
            traits=json.dumps(char_data.get("traits", []), ensure_ascii=False),
            relationships=char_data.get("relationships") or char_data.get("relationships_text"),
        )
        db.add(character)
        await db.flush()

        if not req.is_organization and char_data.get("relationships"):
            for rel in char_data["relationships"]:
                target_name = rel.get("target_character_name", "")
                target_result = await db.execute(
                    select(Character).where(
                        Character.project_id == req.project_id,
                        Character.name == target_name))
                target = target_result.scalar_one_or_none()
                if target:
                    rel_obj = CharacterRelationship(
                        project_id=req.project_id,
                        character_from_id=character.id,
                        character_to_id=target.id,
                        relationship_name=rel.get("relationship_type", "相关"),
                        intimacy_level=rel.get("intimacy_level", 50),
                        description=rel.get("description", ""),
                    )
                    db.add(rel_obj)

        if req.is_organization and char_data.get("is_organization"):
            org = Organization(
                character_id=character.id,
                name=character.name,
                organization_type=char_data.get("organization_type", ""),
                purpose=char_data.get("organization_purpose", ""),
            )
            db.add(org)

        await db.commit()
        await db.refresh(character)
        return _serialize_character(character)

    except json.JSONDecodeError as e:
        logger.error(f"Parse character generation failed (invalid JSON): {e}")
        raise HTTPException(status_code=500, detail=f"AI response parse error: {str(e)}")
    except Exception as e:
        logger.error(f"Parse character generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"AI response parse error: {str(e)}")


@router.get("/project/{project_id}/summary")
async def get_characters_summary(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    total_result = await db.execute(
        select(func.count(Character.id)).where(Character.project_id == project_id))
    total = total_result.scalar() or 0

    char_result = await db.execute(
        select(func.count(Character.id)).where(
            Character.project_id == project_id, Character.is_organization == False))
    char_count = char_result.scalar() or 0

    org_result = await db.execute(
        select(func.count(Character.id)).where(
            Character.project_id == project_id, Character.is_organization == True))
    org_count = org_result.scalar() or 0

    role_result = await db.execute(
        select(Character.role_type, func.count(Character.id))
        .where(Character.project_id == project_id)
        .group_by(Character.role_type))
    role_distribution = {row[0]: row[1] for row in role_result.all()}

    return {
        "total": total,
        "characters_count": char_count,
        "organizations_count": org_count,
        "role_distribution": role_distribution,
    }


def _serialize_character(c: Character) -> dict:
    traits = None
    if c.traits:
        try:
            traits = json.loads(c.traits) if isinstance(c.traits, str) else c.traits
        except json.JSONDecodeError:
            traits = c.traits

    return {
        "id": c.id,
        "project_id": c.project_id,
        "name": c.name,
        "is_organization": c.is_organization,
        "role_type": c.role_type,
        "personality": c.personality,
        "background": c.background,
        "appearance": c.appearance,
        "age": c.age,
        "gender": c.gender,
        "organization_type": c.organization_type,
        "organization_purpose": c.organization_purpose,
        "current_state": c.current_state,
        "traits": traits,
        "relationships": c.relationships,
        "main_career_id": c.main_career_id,
        "main_career_stage": c.main_career_stage,
        "avatar_url": c.avatar_url,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
