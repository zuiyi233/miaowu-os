"""提示词工坊 API

兼容参考项目 MuMuAINovel 的 prompt_workshop.py，
适配 deer-flow 认证体系和架构。

功能说明：
  - 公开 API：浏览、搜索、导入提示词
  - 用户 API：提交、点赞、查看我的提交
  - 管理 API：审核提交、管理条目（仅管理员）
  
架构说明：
  - 支持两种模式：
    1. 服务端模式（is_workshop_server=True）：直接操作本地数据库
    2. 客户端模式（is_workshop_server=False）：代理请求到云端服务
  - 默认使用客户端模式（兼容 deer-flow 单机部署场景）
"""
from __future__ import annotations

import importlib
import logging
import uuid
from datetime import datetime
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id, resolve_user_id
from app.gateway.novel_migrated.models.prompt_workshop import (
    PromptSubmission,
    PromptWorkshopItem,
    PromptWorkshopLike,
)
from app.gateway.novel_migrated.models.writing_style import WritingStyle
from app.gateway.novel_migrated.services.workshop_client import (
    WorkshopClientError,
    workshop_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prompt-workshop", tags=["prompt-workshop"])


@lru_cache(maxsize=1)
def _get_runtime_config_module():
    try:
        return importlib.import_module("app.gateway.novel_migrated.core.config")
    except ImportError:
        return None


def _is_workshop_server() -> bool:
    """
    检查是否为工坊服务器模式
    
    使用说明：
    - 默认返回 False（客户端模式）
    - 如果配置了 WORKSHOP_MODE="server"，则返回 True
    - 适用于 deer-flow 单机部署或私有化部署场景
    """
    config_module = _get_runtime_config_module()
    if config_module is None:
        return False
    return getattr(config_module, "WORKSHOP_MODE", "client") == "server"


# ==================== 请求/响应模型 ====================

class ImportRequest(BaseModel):
    """导入请求"""
    custom_name: Optional[str] = Field(None, description="自定义名称")


class DownloadRequest(BaseModel):
    """下载记录请求"""
    instance_id: str = Field(..., description="实例ID")
    user_identifier: str = Field(..., description="用户标识")


class PromptSubmissionCreate(BaseModel):
    """提交请求"""
    name: str = Field(..., min_length=1, max_length=100, description="名称")
    description: Optional[str] = Field(None, max_length=500, description="描述")
    prompt_content: str = Field(..., min_length=10, description="提示词内容")
    category: str = Field("general", description="分类")
    tags: Optional[list] = Field(None, description="标签列表")
    author_display_name: Optional[str] = Field(None, description="希望显示的作者名")
    is_anonymous: bool = Field(False, description="是否匿名发布")


class ReviewRequest(BaseModel):
    """审核请求"""
    action: str = Field(..., pattern="^(approve|reject)$", description="操作：approve/reject")
    category: Optional[str] = Field(None, description="分类（通过时指定）")
    tags: Optional[list] = Field(None, description="标签（通过时指定）")
    review_note: Optional[str] = Field(None, description="审核备注")


class AdminItemCreate(BaseModel):
    """创建官方提示词请求"""
    name: str = Field(..., description="名称")
    description: Optional[str] = None
    prompt_content: str = Field(..., description="内容")
    category: str = Field("general", description="分类")
    tags: Optional[list] = None


class AdminItemUpdate(BaseModel):
    """更新提示词请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    prompt_content: Optional[str] = None
    category: Optional[str] = None
    tags: Optional[list] = None
    status: Optional[str] = None


# ==================== 辅助函数 ====================

def _get_current_user_id(request: Request) -> str:
    """获取当前登录用户ID"""
    user_id = resolve_user_id(get_request_user_id(request))
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")
    return user_id


def _get_user_identifier(user_id: str) -> str:
    """
    生成云端用户标识
    
    格式：instance_id:user_id
    """
    config_module = _get_runtime_config_module()
    instance_id = getattr(config_module, "INSTANCE_ID", "local") if config_module is not None else "local"
    return f"{instance_id}:{user_id}"


def _get_optional_user_identifier(request: Request) -> Optional[str]:
    """
    获取可选的用户标识（用于公开API）
    """
    try:
        user_id = resolve_user_id(get_request_user_id(request))
        if not user_id:
            return None
        return _get_user_identifier(user_id)
    except Exception:
        return None


def _item_to_dict(item: PromptWorkshopItem, is_liked: bool = False) -> dict:
    """将模型转换为字典"""
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "prompt_content": item.prompt_content,
        "category": item.category,
        "tags": item.tags,
        "author_name": item.author_name,
        "is_official": item.is_official,
        "download_count": item.download_count,
        "like_count": item.like_count,
        "is_liked": is_liked,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def _submission_to_dict(submission: PromptSubmission) -> dict:
    """将提交记录转换为字典"""
    return {
        "id": submission.id,
        "name": submission.name,
        "description": submission.description,
        "prompt_content": submission.prompt_content,
        "category": submission.category,
        "tags": submission.tags,
        "author_display_name": submission.author_display_name,
        "is_anonymous": submission.is_anonymous,
        "status": submission.status,
        "review_note": submission.review_note,
        "reviewed_at": submission.reviewed_at.isoformat() if submission.reviewed_at else None,
        "created_at": submission.created_at.isoformat() if submission.created_at else None,
        "source_instance": submission.source_instance,
        "submitter_name": submission.submitter_name,
    }


async def _check_workshop_admin(request: Request):
    """
    检查是否为工坊管理员
    
    说明：
    - 仅在服务端模式下可用
    - 需要用户具有 is_admin 权限
    - 适用于私有化部署的管理场景
    """
    if not _is_workshop_server():
        raise HTTPException(status_code=403, detail="此功能仅在服务端模式可用")

    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")

    if not getattr(user, "is_admin", False):
        raise HTTPException(status_code=403, detail="需要管理员权限")

    return user


# ==================== 公开 API ====================

@router.get("/status")
async def get_status():
    """
    获取服务状态
    
    返回当前工作模式（client/server）和连接状态
    """
    result = {"mode": "server" if _is_workshop_server() else "client"}

    if not _is_workshop_server():
        try:
            base_url = getattr(workshop_client, "base_url", "")
            if base_url:
                result["cloud_url"] = base_url
                result["cloud_connected"] = await workshop_client.check_connection()
            else:
                result["cloud_connected"] = False
                result["message"] = "未配置云端服务地址"
        except Exception as e:
            result["cloud_connected"] = False
            result["error"] = str(e)

    return result


@router.get("/items")
async def get_items(
    request: Request,
    category: Optional[str] = None,
    search: Optional[str] = None,
    tags: Optional[str] = None,
    sort: str = "newest",
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """
    获取提示词列表（公开接口）
    
    支持按分类、搜索关键词、标签筛选，支持排序。
    """
    user_identifier = _get_optional_user_identifier(request)

    if _is_workshop_server():
        return await _get_items_local(db, category, search, tags, sort, page, limit, user_identifier)
    else:
        try:
            return await workshop_client.get_items(
                category=category,
                search=search,
                tags=tags,
                sort=sort,
                page=page,
                limit=limit,
                user_identifier=user_identifier,
            )
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


async def _get_items_local(
    db: AsyncSession,
    category: Optional[str],
    search: Optional[str],
    tags: Optional[str],
    sort: str,
    page: int,
    limit: int,
    user_identifier: Optional[str],
) -> dict:
    """本地查询提示词列表"""
    query = select(PromptWorkshopItem).where(PromptWorkshopItem.status == "active")
    count_query = select(func.count(PromptWorkshopItem.id)).where(
        PromptWorkshopItem.status == "active"
    )

    if category:
        query = query.where(PromptWorkshopItem.category == category)
        count_query = count_query.where(PromptWorkshopItem.category == category)

    if search:
        search_filter = or_(
            PromptWorkshopItem.name.ilike(f"%{search}%"),
            PromptWorkshopItem.description.ilike(f"%{search}%"),
        )
        query = query.where(search_filter)
        count_query = count_query.where(search_filter)

    # 排序
    if sort == "popular":
        query = query.order_by(PromptWorkshopItem.like_count.desc())
    elif sort == "downloads":
        query = query.order_by(PromptWorkshopItem.download_count.desc())
    else:  # newest
        query = query.order_by(PromptWorkshopItem.created_at.desc())

    # 计数
    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    # 分页
    query = query.offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    items = result.scalars().all()

    # 获取用户点赞状态
    liked_ids = set()
    if user_identifier:
        like_result = await db.execute(
            select(PromptWorkshopLike.workshop_item_id).where(
                PromptWorkshopLike.user_identifier == user_identifier
            )
        )
        liked_ids = {row[0] for row in like_result.fetchall()}

    # 获取分类统计
    cat_result = await db.execute(
        select(
            PromptWorkshopItem.category,
            func.count(PromptWorkshopItem.id),
        )
        .where(PromptWorkshopItem.status == "active")
        .group_by(PromptWorkshopItem.category)
    )
    categories = [
        {"id": cat, "name": cat, "count": count} for cat, count in cat_result.fetchall()
    ]

    return {
        "success": True,
        "data": {
            "total": total,
            "page": page,
            "limit": limit,
            "items": [_item_to_dict(item, is_liked=(item.id in liked_ids)) for item in items],
            "categories": categories,
        },
    }


@router.get("/items/{item_id}")
async def get_item(item_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """获取单个提示词详情"""
    user_identifier = _get_optional_user_identifier(request)

    if _is_workshop_server():
        result = await db.execute(
            select(PromptWorkshopItem).where(
                PromptWorkshopItem.id == item_id,
                PromptWorkshopItem.status == "active",
            )
        )
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="提示词不存在")
        return {"success": True, "data": _item_to_dict(item)}
    else:
        try:
            return await workshop_client.get_item(item_id, user_identifier=user_identifier)
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


@router.post("/items/{item_id}/import")
async def import_item(
    item_id: str,
    data: ImportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    导入提示词到本地写作风格
    
    将工坊中的提示词导入为用户的自定义写作风格
    """
    user_id = _get_current_user_id(request)
    user_identifier = _get_user_identifier(user_id)

    # 获取提示词详情
    if _is_workshop_server():
        result = await db.execute(
            select(PromptWorkshopItem).where(PromptWorkshopItem.id == item_id)
        )
        item = result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="提示词不存在")
        item_data = _item_to_dict(item)

        # 增加下载计数
        item.download_count += 1
        await db.commit()
    else:
        try:
            result = await workshop_client.get_item(item_id, user_identifier=user_identifier)
            item_data = result.get("data", result)

            # 通知云端增加下载计数
            try:
                await workshop_client.record_download(item_id, user_identifier)
            except Exception as e:
                logger.warning(f"通知云端下载计数失败: {e}")
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))

    # 创建本地写作风格
    count_result = await db.execute(
        select(func.count(WritingStyle.id)).where(WritingStyle.user_id == user_id)
    )
    max_order = count_result.scalar_one()

    new_style = WritingStyle(
        user_id=user_id,
        name=data.custom_name or item_data["name"],
        style_type="custom",
        description=f"从提示词工坊导入: {item_data.get('description', '') or ''}",
        prompt_content=item_data["prompt_content"],
        order_index=max_order + 1,
    )
    db.add(new_style)
    await db.commit()
    await db.refresh(new_style)

    return {
        "success": True,
        "message": "导入成功",
        "writing_style": {
            "id": new_style.id,
            "name": new_style.name,
            "style_type": new_style.style_type,
            "prompt_content": new_style.prompt_content,
        },
    }


@router.post("/items/{item_id}/like")
async def toggle_like(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """点赞/取消点赞"""
    user_identifier = _get_user_identifier(_get_current_user_id(request))

    if _is_workshop_server():
        result = await db.execute(
            select(PromptWorkshopLike).where(
                PromptWorkshopLike.user_identifier == user_identifier,
                PromptWorkshopLike.workshop_item_id == item_id,
            )
        )
        existing_like = result.scalar_one_or_none()

        item_result = await db.execute(
            select(PromptWorkshopItem).where(PromptWorkshopItem.id == item_id)
        )
        item = item_result.scalar_one_or_none()
        if not item:
            raise HTTPException(status_code=404, detail="提示词不存在")

        if existing_like:
            await db.delete(existing_like)
            item.like_count = max(0, item.like_count - 1)
            liked = False
        else:
            new_like = PromptWorkshopLike(
                id=str(uuid.uuid4()),
                user_identifier=user_identifier,
                workshop_item_id=item_id,
            )
            db.add(new_like)
            item.like_count += 1
            liked = True

        await db.commit()
        return {"success": True, "liked": liked, "like_count": item.like_count}
    else:
        try:
            return await workshop_client.toggle_like(item_id, user_identifier)
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


@router.post("/items/{item_id}/download")
async def download_item(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    下载提示词（记录下载次数）

    与 import 端点的区别：
    - download: 仅记录下载次数，返回提示词内容（用于预览或手动复制）
    - import: 将提示词导入为本地写作风格

    客户端在用户点击"下载"按钮时调用此端点。
    """
    user_identifier = _get_optional_user_identifier(request)

    if _is_workshop_server():
        result = await db.execute(
            select(PromptWorkshopItem).where(
                PromptWorkshopItem.id == item_id,
                PromptWorkshopItem.status == "active",
            )
        )
        item = result.scalar_one_or_none()

        if not item:
            raise HTTPException(status_code=404, detail="提示词不存在")

        # 增加下载计数
        item.download_count += 1
        await db.commit()
        await db.refresh(item)

        logger.info(f"用户 {user_identifier or 'anonymous'} 下载了提示词 {item_id}")

        return {
            "success": True,
            "data": {
                **_item_to_dict(item),
                "downloaded_at": datetime.utcnow().isoformat(),
            },
            "message": "下载成功",
        }
    else:
        try:
            # 云端模式：通知云端增加下载计数并返回数据
            result = await workshop_client.get_item(item_id, user_identifier=user_identifier)

            # 异步通知云端增加下载计数（不阻塞响应）
            try:
                await workshop_client.record_download(item_id, user_identifier or "anonymous")
            except Exception as e:
                logger.warning(f"通知云端下载计数失败: {e}")

            return {
                "success": True,
                "data": result.get("data", result),
                "message": "下载成功",
            }
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


# ==================== 用户 API ====================

@router.post("/submit")
async def submit_prompt(
    data: PromptSubmissionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    提交提示词到工坊
    
    提交后等待管理员审核，审核通过后将公开发布
    """
    user_identifier = _get_user_identifier(_get_current_user_id(request))

    # 获取提交者名称
    submitter_name = data.author_display_name
    if not submitter_name:
        user = getattr(request.state, "user", None)
        if user:
            submitter_name = getattr(user, "display_name", "未知用户")
        else:
            submitter_name = "未知用户"

    if _is_workshop_server():
        source_instance = request.headers.get("X-Instance-ID") or _get_user_identifier("system")

        submission = PromptSubmission(
            id=str(uuid.uuid4()),
            submitter_id=user_identifier,
            submitter_name=submitter_name,
            source_instance=source_instance,
            name=data.name,
            description=data.description,
            prompt_content=data.prompt_content,
            category=data.category,
            tags=data.tags,
            author_display_name=data.author_display_name or submitter_name,
            is_anonymous=data.is_anonymous,
            status="pending",
        )
        db.add(submission)
        await db.commit()
        await db.refresh(submission)

        return {
            "success": True,
            "message": "提交成功，等待管理员审核",
            "submission": {
                "id": submission.id,
                "status": submission.status,
                "created_at": submission.created_at.isoformat() if submission.created_at else None,
            },
        }
    else:
        try:
            return await workshop_client.submit(
                user_identifier=user_identifier,
                submitter_name=submitter_name,
                data=data.model_dump(),
            )
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


@router.get("/my-submissions")
async def get_my_submissions(
    request: Request,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """获取我的提交记录"""
    user_identifier = _get_user_identifier(_get_current_user_id(request))

    if _is_workshop_server():
        query = select(PromptSubmission).where(PromptSubmission.submitter_id == user_identifier)
        if status:
            query = query.where(PromptSubmission.status == status)
        query = query.order_by(PromptSubmission.created_at.desc())

        result = await db.execute(query)
        submissions = result.scalars().all()

        return {
            "success": True,
            "data": {
                "total": len(submissions),
                "items": [_submission_to_dict(s) for s in submissions],
            },
        }
    else:
        try:
            return await workshop_client.get_submissions(user_identifier, status)
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


@router.delete("/submissions/{submission_id}")
async def withdraw_submission(
    submission_id: str,
    request: Request,
    force: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    删除提交记录
    
    - 待审核(pending)的提交可以直接撤回
    - 已审核(approved/rejected)的提交需要 force=True 参数才能删除
    """
    user_identifier = _get_user_identifier(_get_current_user_id(request))

    if _is_workshop_server():
        result = await db.execute(
            select(PromptSubmission).where(
                PromptSubmission.id == submission_id,
                PromptSubmission.submitter_id == user_identifier,
            )
        )
        submission = result.scalar_one_or_none()

        if not submission:
            raise HTTPException(status_code=404, detail="提交记录不存在")

        if submission.status != "pending" and not force:
            raise HTTPException(
                status_code=400,
                detail="只能撤回待审核的提交，删除已审核记录请使用 force 参数",
            )

        await db.delete(submission)
        await db.commit()

        if submission.status == "pending":
            return {"success": True, "message": "撤回成功"}
        else:
            return {"success": True, "message": "删除成功"}
    else:
        try:
            return await workshop_client.withdraw_submission(submission_id, user_identifier, force)
        except WorkshopClientError as e:
            raise HTTPException(status_code=503, detail=str(e))


# ==================== 管理员 API（仅服务端模式） ====================

@router.get("/admin/submissions")
async def admin_get_submissions(
    request: Request,
    status: Optional[str] = None,
    source: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """获取待审核列表（管理员）"""
    await _check_workshop_admin(request)

    query = select(PromptSubmission)
    count_query = select(func.count(PromptSubmission.id))

    if status and status != "all":
        query = query.where(PromptSubmission.status == status)
        count_query = count_query.where(PromptSubmission.status == status)
    if source:
        query = query.where(PromptSubmission.source_instance == source)
        count_query = count_query.where(PromptSubmission.source_instance == source)

    count_result = await db.execute(count_query)
    total = count_result.scalar_one()

    pending_result = await db.execute(
        select(func.count(PromptSubmission.id)).where(PromptSubmission.status == "pending")
    )
    pending_count = pending_result.scalar_one()

    query = query.order_by(PromptSubmission.created_at.desc())
    query = query.offset((page - 1) * limit).limit(limit)
    result = await db.execute(query)
    submissions = result.scalars().all()

    return {
        "success": True,
        "data": {
            "total": total,
            "pending_count": pending_count,
            "page": page,
            "limit": limit,
            "items": [_submission_to_dict(s) for s in submissions],
        },
    }


@router.post("/admin/submissions/{submission_id}/review")
async def admin_review_submission(
    submission_id: str,
    data: ReviewRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """审核提交（管理员）"""
    admin = await _check_workshop_admin(request)

    result = await db.execute(
        select(PromptSubmission).where(PromptSubmission.id == submission_id)
    )
    submission = result.scalar_one_or_none()

    if not submission:
        raise HTTPException(status_code=404, detail="提交记录不存在")
    if submission.status != "pending":
        raise HTTPException(status_code=400, detail="该提交已被审核")

    admin_user_id = getattr(admin, "user_id", str(admin))

    if data.action == "approve":
        new_item = PromptWorkshopItem(
            id=str(uuid.uuid4()),
            name=submission.name,
            description=submission.description,
            prompt_content=submission.prompt_content,
            category=data.category or submission.category,
            tags=data.tags or submission.tags,
            author_id=None if submission.is_anonymous else submission.submitter_id,
            author_name=submission.author_display_name if not submission.is_anonymous else None,
            source_instance=submission.source_instance,
            is_official=False,
            status="active",
        )
        db.add(new_item)

        submission.status = "approved"
        submission.workshop_item_id = new_item.id
        submission.reviewer_id = admin_user_id
        submission.review_note = data.review_note
        submission.reviewed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(new_item)

        return {
            "success": True,
            "message": "已通过审核并发布",
            "workshop_item": _item_to_dict(new_item),
        }
    else:
        submission.status = "rejected"
        submission.reviewer_id = admin_user_id
        submission.review_note = data.review_note
        submission.reviewed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(submission)

        return {
            "success": True,
            "message": "已拒绝",
            "submission": _submission_to_dict(submission),
        }


@router.post("/admin/items")
async def admin_create_item(
    data: AdminItemCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """添加官方提示词（管理员）"""
    await _check_workshop_admin(request)

    new_item = PromptWorkshopItem(
        id=str(uuid.uuid4()),
        name=data.name,
        description=data.description,
        prompt_content=data.prompt_content,
        category=data.category,
        tags=data.tags,
        author_name="官方",
        is_official=True,
        status="active",
    )
    db.add(new_item)
    await db.commit()
    await db.refresh(new_item)

    return {"success": True, "item": _item_to_dict(new_item)}


@router.put("/admin/items/{item_id}")
async def admin_update_item(
    item_id: str,
    data: AdminItemUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """编辑提示词（管理员）"""
    await _check_workshop_admin(request)

    result = await db.execute(
        select(PromptWorkshopItem).where(PromptWorkshopItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="提示词不存在")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)

    await db.commit()
    await db.refresh(item)

    return {"success": True, "item": _item_to_dict(item)}


@router.delete("/admin/items/{item_id}")
async def admin_delete_item(
    item_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """删除提示词（管理员）"""
    await _check_workshop_admin(request)

    result = await db.execute(
        select(PromptWorkshopItem).where(PromptWorkshopItem.id == item_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="提示词不存在")

    await db.delete(item)
    await db.commit()

    return {"success": True, "message": "删除成功"}


@router.get("/admin/stats")
async def admin_get_stats(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取统计数据（管理员）"""
    await _check_workshop_admin(request)

    items_count = await db.execute(
        select(func.count(PromptWorkshopItem.id)).where(PromptWorkshopItem.status == "active")
    )
    total_items = items_count.scalar_one()

    official_count = await db.execute(
        select(func.count(PromptWorkshopItem.id)).where(
            PromptWorkshopItem.status == "active",
            PromptWorkshopItem.is_official == True,
        )
    )
    total_official = official_count.scalar_one()

    pending_count = await db.execute(
        select(func.count(PromptSubmission.id)).where(PromptSubmission.status == "pending")
    )
    total_pending = pending_count.scalar_one()

    downloads_sum = await db.execute(select(func.sum(PromptWorkshopItem.download_count)))
    total_downloads = downloads_sum.scalar_one() or 0

    likes_sum = await db.execute(select(func.sum(PromptWorkshopItem.like_count)))
    total_likes = likes_sum.scalar_one() or 0

    return {
        "success": True,
        "data": {
            "total_items": total_items,
            "total_official": total_official,
            "total_pending": total_pending,
            "total_downloads": total_downloads,
            "total_likes": total_likes,
        },
    }
