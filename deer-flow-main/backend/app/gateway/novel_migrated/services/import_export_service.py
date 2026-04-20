"""项目导入导出服务"""
from __future__ import annotations

import json
import zipfile
import io
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.career import Career
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.memory import StoryMemory, PlotAnalysis
from app.gateway.novel_migrated.models.relationship import (
    CharacterRelationship, Organization, OrganizationMember, RelationshipType
)
from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class ImportExportService:

    async def export_project(self, project_id: str, db: AsyncSession) -> bytes:
        project_result = await db.execute(select(Project).where(Project.id == project_id))
        project = project_result.scalar_one_or_none()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        export_data = {"version": "1.0", "project": self._serialize_model(project)}

        for model_cls, key in [
            (Chapter, "chapters"), (Character, "characters"),
            (Outline, "outlines"), (Career, "careers"),
            (Foreshadow, "foreshadows"), (StoryMemory, "memories"),
            (PlotAnalysis, "plot_analyses"),
            (CharacterRelationship, "relationships"),
            (Organization, "organizations"),
            (OrganizationMember, "organization_members"),
            (RelationshipType, "relationship_types"),
        ]:
            result = await db.execute(select(model_cls).where(model_cls.project_id == project_id))
            items = result.scalars().all()
            export_data[key] = [self._serialize_model(item) for item in items]

        json_bytes = json.dumps(export_data, ensure_ascii=False, default=str, indent=2).encode('utf-8')

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("project_data.json", json_bytes)
        return buffer.getvalue()

    async def import_project(self, user_id: str, zip_bytes: bytes, db: AsyncSession) -> str:
        buffer = io.BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, 'r') as zf:
            json_str = zf.read("project_data.json").decode('utf-8')

        data = json.loads(json_str)
        project_data = data.get("project", {})

        project = Project(
            user_id=user_id,
            title=project_data.get("title", "导入项目"),
            description=project_data.get("description", ""),
            theme=project_data.get("theme", ""),
            genre=project_data.get("genre", ""),
            target_words=project_data.get("target_words", 100000),
            chapter_count=project_data.get("chapter_count", 30),
            narrative_perspective=project_data.get("narrative_perspective", "第三人称"),
            outline_mode=project_data.get("outline_mode", "one-to-one"),
            world_time_period=project_data.get("world_time_period", ""),
            world_location=project_data.get("world_location", ""),
            world_atmosphere=project_data.get("world_atmosphere", ""),
            world_rules=project_data.get("world_rules", ""),
            status="created",
        )
        db.add(project)
        await db.flush()

        old_to_new_ids: Dict[str, Dict[str, str]] = {}

        for model_cls, key, id_field in [
            (Character, "characters", "id"),
            (Outline, "outlines", "id"),
            (Career, "careers", "id"),
        ]:
            old_to_new_ids[key] = {}
            for item_data in data.get(key, []):
                old_id = item_data.get(id_field)
                item = model_cls(project_id=project.id, **{
                    k: v for k, v in item_data.items()
                    if k not in [id_field, "project_id", "created_at", "updated_at"]
                })
                db.add(item)
                await db.flush()
                old_to_new_ids[key][old_id] = item.id

        for item_data in data.get("chapters", []):
            old_outline_id = item_data.get("outline_id")
            new_outline_id = old_to_new_ids.get("outlines", {}).get(old_outline_id) if old_outline_id else None
            chapter = Chapter(
                project_id=project.id,
                outline_id=new_outline_id,
                **{k: v for k, v in item_data.items()
                   if k not in ["id", "project_id", "outline_id", "created_at", "updated_at"]}
            )
            db.add(chapter)

        await db.commit()
        return project.id

    def _serialize_model(self, model) -> dict:
        result = {}
        for col in model.__table__.columns:
            value = getattr(model, col.name)
            if value is not None:
                result[col.name] = str(value) if hasattr(value, 'isoformat') else value
        return result


_import_export_service = None

def get_import_export_service() -> ImportExportService:
    global _import_export_service
    if _import_export_service is None:
        _import_export_service = ImportExportService()
    return _import_export_service
