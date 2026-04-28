"""项目导入导出服务"""
from __future__ import annotations

import io
import json
import zipfile
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.workspace_document_service import workspace_document_service

logger = get_logger(__name__)


class ImportExportService:

    async def export_project(self, project_id: str, user_id: str, db: AsyncSession) -> bytes:
        project_result = await db.execute(select(Project).where(Project.id == project_id))
        project = project_result.scalar_one_or_none()
        if not project:
            raise ValueError(f"Project {project_id} not found")

        await workspace_document_service.initialize_workspace(
            user_id=user_id,
            project_id=project_id,
            title=project.title or "",
            description=project.description or "",
            theme=project.theme or "",
            genre=project.genre or "",
        )
        workspace = workspace_document_service.workspace_dir(user_id, project_id)

        export_data = {"version": "2.0-file-workspace", "project": self._serialize_model(project)}
        json_bytes = json.dumps(export_data, ensure_ascii=False, default=str, indent=2).encode("utf-8")

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("project_data.json", json_bytes)
            for path in workspace.rglob("*"):
                if not path.is_file():
                    continue
                rel = path.relative_to(workspace).as_posix()
                zf.write(path, arcname=f"workspace/{rel}")
        return buffer.getvalue()

    async def import_project(self, user_id: str, zip_bytes: bytes, db: AsyncSession) -> str:
        buffer = io.BytesIO(zip_bytes)
        with zipfile.ZipFile(buffer, "r") as zf:
            if "project_data.json" in zf.namelist():
                json_str = zf.read("project_data.json").decode("utf-8")
                data = json.loads(json_str)
            else:
                data = {"project": {}}
            archive_files = [name for name in zf.namelist() if name.startswith("workspace/") and not name.endswith("/")]

        project_data = data.get("project", {})

        project = Project(
            user_id=user_id,
            title=project_data.get("title", "导入项目（文件工作区）"),
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

        await workspace_document_service.initialize_workspace(
            user_id=user_id,
            project_id=project.id,
            title=project.title or "",
            description=project.description or "",
            theme=project.theme or "",
            genre=project.genre or "",
        )
        workspace = workspace_document_service.workspace_dir(user_id, project.id)

        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            for member in archive_files:
                rel = member[len("workspace/") :].strip()
                if not rel:
                    continue
                target = (workspace / rel).resolve()
                if not str(target).startswith(str(workspace.resolve())):
                    raise ValueError(f"非法路径: {member}")
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member, "r") as src, open(target, "wb") as dst:
                    dst.write(src.read())

        records = await workspace_document_service.rescan_workspace(user_id=user_id, project_id=project.id)
        await workspace_document_service.sync_records_to_db(
            db=db,
            user_id=user_id,
            project_id=project.id,
            records=records,
        )

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
