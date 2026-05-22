"""API 公共函数模块.

Novel APIs are scoped to the main DeerFlow authenticated user.  Missing
identity is a hard 401; there is no single-user fallback in the unified SaaS
data model.
"""

from typing import Any

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.core.user_context import get_request_user_id, resolve_user_id
from app.gateway.novel_migrated.models.project import Project

logger = get_logger(__name__)


def require_authenticated_user(user_id: str | None, request: Request | None = None) -> str:
    """Require an authenticated main-project user id."""
    if user_id:
        return resolve_user_id(user_id)
    if request is not None:
        return get_request_user_id(request)
    logger.warning("Novel API call missing authenticated user")
    raise HTTPException(
        status_code=401,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def verify_project_access(
    project_id: str,
    user_id: str | None,
    db: AsyncSession
) -> Project:
    """
    验证用户是否有权访问指定项目
    
    统一的项目访问验证函数，确保：
    1. user_id 已来自主项目认证上下文
    2. 项目存在
    3. 用户有权访问该项目
    
    Args:
        project_id: 项目ID
        user_id: 用户ID
        db: 数据库会话
        
    Returns:
        Project: 验证通过后返回项目对象
        
    Raises:
        HTTPException: 404 项目不存在或用户无权访问
    """
    effective_user_id = require_authenticated_user(user_id)

    result = await db.execute(
        select(Project).where(
            Project.id == project_id,
            Project.user_id == effective_user_id
        )
    )
    project = result.scalar_one_or_none()
    
    if not project:
        logger.warning(f"项目访问被拒绝: project_id={project_id}, user_id={effective_user_id}")
        raise HTTPException(status_code=404, detail="项目不存在或无权访问")
    
    return project


async def get_owned_project_resource(
    model: Any,
    resource_id: str,
    user_id: str | None,
    db: AsyncSession,
    *,
    project_id: str | None = None,
    not_found_detail: str = "Resource not found",
) -> Any:
    """Load a project child resource through the owning main-project user."""
    effective_user_id = require_authenticated_user(user_id)
    query = (
        select(model)
        .join(Project, model.project_id == Project.id)
        .where(
            model.id == resource_id,
            Project.user_id == effective_user_id,
        )
    )
    if project_id is not None:
        query = query.where(model.project_id == project_id)

    result = await db.execute(query)
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return resource


async def get_owned_user_resource(
    model: Any,
    resource_id: str | int,
    user_id: str | None,
    db: AsyncSession,
    *,
    not_found_detail: str = "Resource not found",
) -> Any:
    """Load a resource that has its own ``user_id`` ownership column."""
    effective_user_id = require_authenticated_user(user_id)
    result = await db.execute(
        select(model).where(
            model.id == resource_id,
            model.user_id == effective_user_id,
        )
    )
    resource = result.scalar_one_or_none()
    if resource is None:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return resource


def get_user_id(request: Request) -> str:
    """
    从请求中获取用户ID
    
    优先从 request.state.auth.user / request.state.user / request.state.user_id
    读取主项目用户 ID；缺失时返回 401。
    
    Args:
        request: FastAPI 请求对象
        
    Returns:
        解析后的主项目用户 ID
    """
    return get_request_user_id(request)


async def verify_project_access_from_request(
    project_id: str,
    request: Request,
    db: AsyncSession
) -> Project:
    """
    从请求中验证项目访问权限（便捷函数）
    
    结合 get_user_id 和 verify_project_access，简化调用。
    
    Args:
        project_id: 项目ID
        request: FastAPI 请求对象
        db: 数据库会话
        
    Returns:
        Project: 验证通过后返回项目对象
        
    Raises:
        HTTPException: 404
        
    Usage:
        project = await verify_project_access_from_request(project_id, request, db)
    """
    user_id = get_user_id(request)
    return await verify_project_access(project_id, user_id, db)
