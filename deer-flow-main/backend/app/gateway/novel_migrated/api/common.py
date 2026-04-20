"""API 公共函数模块

包含跨 API 模块共享的通用函数和工具。
"""

import os
from functools import lru_cache
from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.core.user_context import resolve_user_id
from app.gateway.novel_migrated.models.project import Project

logger = get_logger(__name__)

# ==================== 严格认证模式配置 ====================

@lru_cache(maxsize=1)
def _is_strict_auth_enabled() -> bool:
    """
    检查是否启用严格认证模式

    配置优先级：
    1. 环境变量 NOVEL_MIGRATED_STRICT_AUTH=true/1/yes
    2. 默认 False（保持单机回退行为）

    严格模式：
    - True: 缺失 user_id 返回 401 Unauthorized
    - False: 缺失 user_id 自动回退默认用户（单机模式）

    注意：
    - 使用 lru_cache 缓存结果，避免每次请求重复解析环境变量
    - 如需运行时切换配置，调用 _is_strict_auth_enabled.cache_clear()
    """
    env_value = os.getenv("NOVEL_MIGRATED_STRICT_AUTH", "").lower().strip()

    if env_value in ("true", "1", "yes"):
        return True

    return False


def require_authenticated_user(user_id: str | None, request: Request | None = None) -> str:
    """
    要求已认证用户（严格模式检查）

    Args:
        user_id: 用户ID（可能为空）
        request: FastAPI 请求对象（可选，仅用于调用方语义）

    Returns:
        str: 验证通过后的用户ID

    Raises:
        HTTPException: 401 当严格模式下 user_id 为空时
    """
    if not user_id and _is_strict_auth_enabled():
        logger.warning("严格认证模式：请求缺少用户标识，返回 401")
        raise HTTPException(
            status_code=401,
            detail="未授权：请先登录或提供有效的用户标识",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return resolve_user_id(user_id)


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


def get_user_id(request: Request) -> str:
    """
    从请求中获取用户ID
    
    优先从 request.state 读取 user_id；未提供时回退到单机默认用户。
    
    Args:
        request: FastAPI 请求对象
        
    Returns:
        解析后的用户ID（始终非空）
    """
    raw_user_id = getattr(request.state, "user_id", None)
    return require_authenticated_user(raw_user_id, request)


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
