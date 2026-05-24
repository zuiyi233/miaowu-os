"""项目导入导出 API。"""
from __future__ import annotations

import json
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.product_entitlements import product_entitlement_service
from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.import_export_service import get_import_export_service
from app.gateway.novel_migrated.services.object_storage_service import (
    ObjectStorageConfigurationError,
    ObjectStorageError,
)
from app.gateway.novel_migrated.utils.http_headers import safe_download_content_disposition

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
        export_result = await get_import_export_service().export_project(project_id, user_id, db)
    except ValueError as exc:
        logger.warning("导出项目失败: project_id=%s, error=%s", project_id, exc)
        raise HTTPException(status_code=404, detail="项目不存在") from exc
    except ObjectStorageConfigurationError as exc:
        raise HTTPException(status_code=503, detail="对象存储未配置，无法保存导出包") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="对象存储上传失败，无法保存导出包") from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - 运行时兜底
        logger.error("导出项目异常: project_id=%s, error=%s", project_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="导出失败，请稍后重试") from exc

    filename = f"project_{project_id}.zip"
    headers = {"Content-Disposition": safe_download_content_disposition(filename)}
    if export_result.download_path:
        headers["X-Miaowu-Media-Asset-Download"] = export_result.download_path
    if export_result.media_asset_id:
        headers["X-Miaowu-Media-Asset-Id"] = export_result.media_asset_id
    return Response(content=export_result.content, media_type="application/zip", headers=headers)


@router.post("/import", summary="从 ZIP 导入项目")
async def import_project(
    file: UploadFile = File(..., description="项目 ZIP 文件"),
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 .zip 文件")
    await product_entitlement_service.ensure_project_create_allowed_for_user(db, user_id=user_id)

    try:
        zip_bytes = await file.read()
        project_id = await get_import_export_service().import_project(user_id, zip_bytes, db, filename=file.filename)
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
    except ObjectStorageConfigurationError as exc:
        raise HTTPException(status_code=503, detail="对象存储未配置，无法保存导入包") from exc
    except ObjectStorageError as exc:
        raise HTTPException(status_code=502, detail="对象存储上传失败，无法保存导入包") from exc
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - 运行时兜底
        logger.error("导入项目异常: filename=%s, error=%s", file.filename, exc, exc_info=True)
        raise HTTPException(status_code=500, detail="导入失败，请稍后重试") from exc

    return {"project_id": project_id}
