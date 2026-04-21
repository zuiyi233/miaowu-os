"""项目导入导出 API。"""
from __future__ import annotations

import json
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.import_export_service import get_import_export_service

router = APIRouter(prefix="/projects", tags=["import_export"])
logger = get_logger(__name__)
EXPORT_PROJECT_ROUTE_TEMPLATE = "/projects/{project_id}/export"


def build_export_download_path(project_id: str) -> str:
    """构建项目导出下载路径（与 FastAPI 路由保持一致）。"""
    return EXPORT_PROJECT_ROUTE_TEMPLATE.format(project_id=project_id)


@router.get("/{project_id}/export", summary="导出项目为 ZIP")
async def export_project(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    await verify_project_access(project_id, user_id, db)

    try:
        zip_bytes = await get_import_export_service().export_project(project_id, db)
    except ValueError as exc:
        logger.warning("导出项目失败: project_id=%s, error=%s", project_id, exc)
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - 运行时兜底
        logger.error("导出项目异常: project_id=%s, error=%s", project_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="导出失败，请稍后重试") from exc

    filename = f"project_{project_id}.zip"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=zip_bytes, media_type="application/zip", headers=headers)


@router.post("/import", summary="从 ZIP 导入项目")
async def import_project(
    file: UploadFile = File(..., description="项目 ZIP 文件"),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 .zip 文件")

    try:
        zip_bytes = await file.read()
        project_id = await get_import_export_service().import_project(user_id, zip_bytes, db)
    except zipfile.BadZipFile as exc:
        logger.warning("导入项目失败: 非法ZIP, filename=%s", file.filename)
        raise HTTPException(status_code=400, detail="ZIP 文件格式无效") from exc
    except KeyError as exc:
        logger.warning("导入项目失败: 缺少 project_data.json, filename=%s", file.filename)
        raise HTTPException(status_code=400, detail="ZIP 缺少 project_data.json") from exc
    except json.JSONDecodeError as exc:
        logger.warning("导入项目失败: JSON 解析错误, filename=%s, error=%s", file.filename, exc)
        raise HTTPException(status_code=400, detail="项目数据 JSON 格式无效") from exc
    except ValueError as exc:
        logger.warning("导入项目失败: filename=%s, error=%s", file.filename, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - 运行时兜底
        logger.error("导入项目异常: filename=%s, error=%s", file.filename, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="导入失败，请稍后重试") from exc

    return {"project_id": project_id}
