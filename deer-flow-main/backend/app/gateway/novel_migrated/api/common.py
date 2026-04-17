"""API 公共函数模块

包含跨 API 模块共享的通用函数和工具。
"""

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.core.user_context import get_request_user_id, resolve_user_id
from app.gateway.novel_migrated.models.project import Project

logger = get_logger(__name__)


async def verify_project_access(
    project_id: str,
    user_id: str | None,
    db: AsyncSession
) -> Project:
    """
    验证用户是否有权访问指定项目
    
    统一的项目访问验证函数，确保：
    1. user_id 已标准化（缺失时自动回退）
    2. 项目存在
    3. 用户有权访问该项目
    
    Args:
        project_id: 项目ID
        user_id: 用户ID（可为空，为空时自动回退默认用户）
        db: 数据库会话
        
    Returns:
        Project: 验证通过后返回项目对象
        
    Raises:
        HTTPException: 404 项目不存在或用户无权访问
    """
    effective_user_id = resolve_user_id(user_id)

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


def get_user_id(request: Request) -> str:
    """
    从请求中获取用户ID
    
    优先从 request.state 读取 user_id；未提供时回退到单机默认用户。
    
    Args:
        request: FastAPI 请求对象
        
    Returns:
        解析后的用户ID（始终非空）
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
