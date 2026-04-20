"""提示词模板管理 API

兼容参考项目 MuMuAINovel 的 prompt_templates.py，
适配 deer-flow 认证体系和数据库结构。
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id, resolve_user_id
from app.gateway.novel_migrated.models.prompt_template import PromptTemplate
from app.gateway.novel_migrated.services.prompt_service import PromptService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prompt-templates", tags=["提示词模板管理"])


def calculate_content_hash(content: str) -> str:
    """计算模板内容的SHA256哈希值（前16位）"""
    return hashlib.sha256(content.strip().encode("utf-8")).hexdigest()[:16]


# ==================== 请求/响应模型 ====================

class PromptTemplateCreate(BaseModel):
    """创建/更新模板请求"""
    template_key: str = Field(..., description="模板唯一标识")
    template_name: str = Field(..., description="模板名称")
    template_content: str = Field(..., description="模板内容")
    description: Optional[str] = Field(None, description="模板描述")
    category: Optional[str] = Field("general", description="分类")
    parameters: Optional[str] = Field(None, description="参数JSON")
    is_active: Optional[bool] = Field(True, description="是否启用")


class PromptTemplateUpdate(BaseModel):
    """更新模板请求"""
    template_name: Optional[str] = None
    template_content: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    parameters: Optional[str] = None
    is_active: Optional[bool] = None


class PromptTemplatePreviewRequest(BaseModel):
    """预览请求"""
    template_content: str = Field(..., description="模板内容")
    parameters: dict = Field(default_factory=dict, description="渲染参数")


# ==================== API 端点 ====================

@router.get("")
async def get_all_templates(
    request: Request,
    category: Optional[str] = Query(None, description="按分类筛选"),
    is_active: Optional[bool] = Query(None, description="按启用状态筛选"),
    db: AsyncSession = Depends(get_db),
):
    """
    获取用户所有提示词模板
    """
    user_id = resolve_user_id(get_request_user_id(request))

    query = select(PromptTemplate).where(PromptTemplate.user_id == user_id)

    if category:
        query = query.where(PromptTemplate.category == category)
    if is_active is not None:
        query = query.where(PromptTemplate.is_active == is_active)

    query = query.order_by(PromptTemplate.category, PromptTemplate.template_key)

    result = await db.execute(query)
    templates = result.scalars().all()

    categories_result = await db.execute(
        select(PromptTemplate.category)
        .where(PromptTemplate.user_id == user_id)
        .distinct()
    )
    categories = [c for c in categories_result.scalars().all() if c]

    return {
        "templates": templates,
        "total": len(templates),
        "categories": sorted(categories),
    }


@router.get("/categories")
async def get_templates_by_category(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    按分类获取提示词模板（合并用户自定义和系统默认）
    """
    user_id = resolve_user_id(get_request_user_id(request))

    result = await db.execute(
        select(PromptTemplate)
        .where(PromptTemplate.user_id == user_id)
        .order_by(PromptTemplate.category, PromptTemplate.template_key)
    )
    user_templates = result.scalars().all()

    system_templates = PromptService.get_all_system_templates()

    user_template_keys = {t.template_key for t in user_templates}

    all_templates = []
    current_time = datetime.now()

    for user_template in user_templates:
        user_template.is_system_default = False
        all_templates.append(user_template)

    for sys_template in system_templates:
        if sys_template["template_key"] not in user_template_keys:
            template_obj = PromptTemplate(
                id=sys_template["template_key"],
                user_id=user_id,
                template_key=sys_template["template_key"],
                template_name=sys_template["template_name"],
                template_content=sys_template["content"],
                description=sys_template["description"],
                category=sys_template["category"],
                parameters=json.dumps(sys_template["parameters"]),
                is_active=True,
                is_system_default=True,
                created_at=current_time,
                updated_at=current_time,
            )
            all_templates.append(template_obj)

    category_dict = {}
    for template in all_templates:
        cat = template.category or "未分类"
        if cat not in category_dict:
            category_dict[cat] = []
        category_dict[cat].append(template)

    response = []
    for category, temps in sorted(category_dict.items()):
        temps.sort(key=lambda t: t.template_key)
        response.append({
            "category": category,
            "count": len(temps),
            "templates": temps,
        })

    return response


@router.get("/system-defaults")
async def get_system_defaults(request: Request):
    """
    获取所有系统默认提示词模板
    """
    user_id = resolve_user_id(get_request_user_id(request))

    system_templates = PromptService.get_all_system_templates()

    return {
        "templates": system_templates,
        "total": len(system_templates),
    }


@router.get("/{template_key}")
async def get_template(
    template_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取指定的提示词模板
    """
    user_id = resolve_user_id(get_request_user_id(request))

    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.user_id == user_id,
            PromptTemplate.template_key == template_key,
        )
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail=f"模板 {template_key} 不存在")

    return template


@router.post("")
async def create_or_update_template(
    data: PromptTemplateCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    创建或更新提示词模板（Upsert）
    """
    user_id = resolve_user_id(get_request_user_id(request))

    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.user_id == user_id,
            PromptTemplate.template_key == data.template_key,
        )
    )
    template = result.scalar_one_or_none()

    if template:
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(template, key, value)
        logger.info(f"用户 {user_id} 更新模板 {data.template_key}")
    else:
        template = PromptTemplate(user_id=user_id, **data.model_dump())
        db.add(template)
        logger.info(f"用户 {user_id} 创建模板 {data.template_key}")

    await db.commit()
    await db.refresh(template)

    return template


@router.put("/{template_key}")
async def update_template(
    template_key: str,
    data: PromptTemplateUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    更新提示词模板
    """
    user_id = resolve_user_id(get_request_user_id(request))

    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.user_id == user_id,
            PromptTemplate.template_key == template_key,
        )
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail=f"模板 {template_key} 不存在")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    await db.commit()
    await db.refresh(template)
    logger.info(f"用户 {user_id} 更新模板 {template_key}")

    return template


@router.delete("/{template_key}")
async def delete_template(
    template_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    删除自定义提示词模板
    """
    user_id = resolve_user_id(get_request_user_id(request))

    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.user_id == user_id,
            PromptTemplate.template_key == template_key,
        )
    )
    template = result.scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail=f"模板 {template_key} 不存在")

    await db.delete(template)
    await db.commit()
    logger.info(f"用户 {user_id} 删除模板 {template_key}")

    return {"message": "模板已删除", "template_key": template_key}


@router.post("/{template_key}/reset")
async def reset_to_default(
    template_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    重置为系统默认模板（删除用户自定义版本）
    """
    user_id = resolve_user_id(get_request_user_id(request))

    system_template = PromptService.get_system_template_info(template_key)
    if not system_template:
        raise HTTPException(status_code=404, detail=f"系统默认模板 {template_key} 不存在")

    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.user_id == user_id,
            PromptTemplate.template_key == template_key,
        )
    )
    template = result.scalar_one_or_none()

    if template:
        await db.delete(template)
        await db.commit()
        logger.info(f"用户 {user_id} 删除自定义模板 {template_key}，恢复为系统默认")
        return {"message": "已重置为系统默认", "template_key": template_key}
    else:
        logger.info(f"用户 {user_id} 的模板 {template_key} 本来就是系统默认")
        return {"message": "已是系统默认状态", "template_key": template_key}


@router.post("/{template_key}/preview")
async def preview_template(
    template_key: str,
    data: PromptTemplatePreviewRequest,
    request: Request,
):
    """
    预览提示词模板（渲染变量）
    """
    user_id = resolve_user_id(get_request_user_id(request))

    try:
        rendered = PromptService.format_prompt(data.template_content, **data.parameters)

        return {
            "success": True,
            "rendered_content": rendered,
            "parameters_used": list(data.parameters.keys()),
        }
    except KeyError as e:
        return {
            "success": False,
            "error": f"缺少必需的参数: {str(e)}",
            "rendered_content": None,
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"渲染失败: {str(e)}",
            "rendered_content": None,
        }


class ExportRequest(BaseModel):
    """导出请求"""
    template_keys: Optional[List[str]] = Field(None, description="要导出的模板键名列表（为空则导出全部）")
    include_system_defaults: bool = Field(False, description="是否包含系统默认模板")


class ImportTemplatesRequest(BaseModel):
    """导入请求"""
    templates: List[dict] = Field(..., min_length=1, description="要导入的模板列表")
    overwrite: bool = Field(False, description="是否覆盖已存在的模板")


@router.post("/export")
async def export_templates(
    data: ExportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    导出提示词模板（JSON格式）

    支持导出自定义模板和系统默认模板，用于备份或迁移。
    """
    user_id = resolve_user_id(get_request_user_id(request))

    result = await db.execute(
        select(PromptTemplate).where(PromptTemplate.user_id == user_id)
    )
    templates = result.scalars().all()

    if data.template_keys:
        templates = [t for t in templates if t.template_key in data.template_keys]

    export_data = {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "user_id": user_id,
        "count": len(templates),
        "templates": [t.to_dict() for t in templates],
    }

    if data.include_system_defaults:
        system_templates = PromptService.get_all_system_templates()
        existing_keys = {t.template_key for t in templates}
        system_export = [t for t in system_templates if t["template_key"] not in existing_keys]
        export_data["system_defaults"] = system_export
        export_data["total_count"] = len(templates) + len(system_export)

    logger.info(f"用户 {user_id} 导出了 {len(templates)} 个自定义模板")
    return export_data


@router.post("/import")
async def import_templates(
    data: ImportTemplatesRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    导入提示词模板（从JSON格式）

    支持批量导入，可选择是否覆盖已存在的模板。
    """
    user_id = resolve_user_id(get_request_user_id(request))

    imported_count = 0
    skipped_count = 0
    error_count = 0
    errors = []

    for template_data in data.templates:
        try:
            template_key = template_data.get("template_key")
            if not template_key:
                errors.append({"error": "缺少 template_key", "data": template_data})
                error_count += 1
                continue

            existing = await db.execute(
                select(PromptTemplate).where(
                    PromptTemplate.user_id == user_id,
                    PromptTemplate.template_key == template_key,
                )
            )
            existing_template = existing.scalar_one_or_none()

            if existing_template and not data.overwrite:
                skipped_count += 1
                continue

            template_params = {
                "template_key": template_key,
                "template_name": template_data.get("template_name", template_key),
                "template_content": template_data.get("template_content", ""),
                "description": template_data.get("description"),
                "category": template_data.get("category", "general"),
                "parameters": json.dumps(template_data.get("parameters", {})) if template_data.get("parameters") else None,
                "is_active": template_data.get("is_active", True),
                "is_system_default": False,  # 导入的模板永远不是系统默认
                "user_id": user_id,
            }

            if existing_template:
                for key, value in template_params.items():
                    if key != "user_id" and value is not None:
                        setattr(existing_template, key, value)
            else:
                new_template = PromptTemplate(**{k: v for k, v in template_params.items() if v is not None})
                db.add(new_template)

            imported_count += 1

        except Exception as e:
            errors.append({"error": str(e), "data": template_data})
            error_count += 1
            logger.warning(f"导入模板 {template_data.get('template_key', 'unknown')} 失败: {e}")

    await db.commit()

    logger.info(f"用户 {user_id} 导入了 {imported_count} 个模板，跳过 {skipped_count} 个，失败 {error_count} 个")

    return {
        "success": True,
        "imported": imported_count,
        "skipped": skipped_count,
        "errors": error_count,
        "error_details": errors[:10],  # 最多返回前10个错误详情
        "message": f"成功导入 {imported_count} 个模板" + (f"，跳过 {skipped_count} 个已存在模板" if skipped_count else ""),
    }
