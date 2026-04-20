"""管理员 API - 用户管理功能（最小兼容实现）

兼容参考项目 MuMuAINovel 的 admin.py，
适配 deer-flow 认证体系和权限模型。

功能说明：
  - 用户 CRUD 操作（仅管理员）
  - 用户状态管理（启用/禁用）
  - 密码重置
  
取舍说明：
  ✓ 保留核心管理功能
  ✗ 不强制依赖 user_manager/password_manager（按需适配）
  ✗ 认证逻辑通过 common.py 的依赖注入实现
"""
from __future__ import annotations

import bcrypt
import hashlib
import secrets
import string
import logging
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.user_context import get_request_user_id, resolve_user_id
from app.gateway.novel_migrated.models.user import User, UserPassword

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["管理员"])


# ==================== 请求/响应模型 ====================

class CreateUserRequest(BaseModel):
    """创建用户请求"""
    username: str = Field(..., min_length=3, max_length=20, description="用户名")
    display_name: str = Field(..., min_length=2, max_length=50, description="显示名称")
    password: Optional[str] = Field(None, min_length=6, description="初始密码，留空则自动生成")
    avatar_url: Optional[str] = Field(None, description="头像URL")
    trust_level: int = Field(0, ge=-1, le=9, description="信任等级（-1=禁用）")
    is_admin: bool = Field(False, description="是否为管理员")


class UpdateUserRequest(BaseModel):
    """更新用户请求"""
    display_name: Optional[str] = Field(None, min_length=2, max_length=50)
    avatar_url: Optional[str] = None
    trust_level: Optional[int] = Field(None, ge=-1, le=9)
    is_admin: Optional[bool] = None


class ToggleStatusRequest(BaseModel):
    """切换用户状态请求"""
    is_active: bool = Field(..., description="true=启用, false=禁用")


class ResetPasswordRequest(BaseModel):
    """重置密码请求"""
    new_password: Optional[str] = Field(None, min_length=6, description="新密码，留空则自动生成")


class UserResponse(BaseModel):
    """用户响应"""
    user_id: str
    username: str
    display_name: str
    avatar_url: Optional[str]
    trust_level: int
    is_admin: bool
    is_active: bool
    linuxdo_id: Optional[str]
    created_at: Optional[str]
    last_login: Optional[str]


class CreateUserResponse(BaseModel):
    """创建用户响应"""
    success: bool
    message: str
    user: dict
    default_password: Optional[str] = None


# ==================== 权限检查 ====================

async def _check_admin(request: Request, db: AsyncSession) -> User:
    """
    检查管理员权限
    
    使用说明：
    - 从 request.state.user 或 request.state.user_id 获取当前用户
    - 验证用户是否存在且具有管理员权限
    - 适用于 deer-flow 认证体系
    """
    user_id = resolve_user_id(get_request_user_id(request))
    if not user_id:
        raise HTTPException(status_code=401, detail="未登录")

    result = await db.execute(select(User).where(User.user_id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")

    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")

    return user


def _generate_default_password(username: str) -> str:
    """
    生成安全的默认密码（12位随机密码）
    
    安全改进：
    - 使用 cryptographically secure 随机数生成器
    - 包含大小写字母、数字、特殊字符
    - 避免可预测的哈希链
    """
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    password = ''.join(secrets.choice(alphabet) for _ in range(12))
    return password


def _hash_password(password: str) -> str:
    """
    密码哈希（bcrypt）
    
    安全特性：
    - 自动加盐（每次哈希生成唯一盐值）
    - 自适应成本因子（当前 rounds=12，可根据硬件调整）
    - 抗彩虹表攻击
    - 抗暴力破解（慢速哈希算法）
    
    Args:
        password: 明文密码
        
    Returns:
        bcrypt 哈希字符串（60字符，格式：$2b$12$...）
        
    Raises:
        ValueError: 密码为空或格式无效时抛出
        RuntimeError: bcrypt 运行时错误
    """
    if not password or not isinstance(password, str):
        logger.error("密码哈希失败: 输入为空或类型无效 (type=%s)", type(password).__name__)
        raise ValueError("密码不能为空且必须为字符串")

    try:
        salt = bcrypt.gensalt(rounds=12)
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    except UnicodeEncodeError as e:
        logger.error("密码编码失败: %s", e)
        raise ValueError("密码包含非法字符") from e
    except Exception as e:
        logger.error("密码哈希运行时错误: %s", e, exc_info=True)
        raise RuntimeError("密码处理失败，请稍后重试") from e


# ==================== API 端点 ====================

@router.get("/users")
async def get_users(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取用户列表（仅管理员）
    
    返回所有用户的基本信息
    """
    admin = await _check_admin(request, db)

    try:
        result = await db.execute(select(User).order_by(User.created_at.desc()))
        all_users = result.scalars().all()

        users_data = [user.to_dict() for user in all_users]

        logger.info(f"管理员 {admin.user_id} 获取用户列表，共 {len(users_data)} 个用户")

        return {"total": len(users_data), "users": users_data}

    except Exception as e:
        logger.error(f"获取用户列表失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"获取用户列表失败: {str(e)}")


@router.post("/users")
async def create_user(
    data: CreateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    添加用户（仅管理员）
    
    创建新用户并设置初始密码
    """
    admin = await _check_admin(request, db)

    try:
        # 检查用户名是否已存在
        result = await db.execute(select(User).where(User.username == data.username))
        if result.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="用户名已存在")

        # 生成用户ID
        user_id = f"admin_created_{hashlib.md5(data.username.encode()).hexdigest()[:16]}"

        # 创建用户
        new_user = User(
            user_id=user_id,
            username=data.username,
            display_name=data.display_name,
            avatar_url=data.avatar_url,
            trust_level=data.trust_level,
            is_admin=data.is_admin,
            linuxdo_id=user_id,  # 本地用户使用 user_id 作为 linuxdo_id
        )
        db.add(new_user)

        # 设置密码
        actual_password = data.password or _generate_default_password(data.username)
        password_hash = _hash_password(actual_password)

        user_pwd = UserPassword(
            user_id=user_id,
            username=data.username,
            password_hash=password_hash,
            has_custom_password=bool(data.password),
        )
        db.add(user_pwd)

        await db.commit()
        await db.refresh(new_user)

        logger.info(f"管理员 {admin.user_id} 创建了新用户 {new_user.user_id} ({data.username})")

        return CreateUserResponse(
            success=True,
            message="用户创建成功",
            user=new_user.to_dict(),
            default_password=actual_password if not data.password else None,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"创建用户失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"创建用户失败: {str(e)}")


@router.put("/users/{user_id}")
async def update_user(
    user_id: str,
    data: UpdateUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    编辑用户信息（仅管理员）
    """
    admin = await _check_admin(request, db)

    try:
        result = await db.execute(select(User).where(User.user_id == user_id))
        db_user = result.scalar_one_or_none()

        if not db_user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 更新字段
        if data.display_name is not None:
            db_user.display_name = data.display_name
        if data.avatar_url is not None:
            db_user.avatar_url = data.avatar_url
        if data.trust_level is not None:
            db_user.trust_level = data.trust_level
        if data.is_admin is not None:
            # 检查是否是最后一个管理员
            if db_user.is_admin and not data.is_admin:
                admin_count_result = await db.execute(
                    select(func.count(User.user_id)).where(User.is_admin == True)
                )
                admin_count = admin_count_result.scalar_one()
                if admin_count <= 1:
                    raise HTTPException(status_code=400, detail="不能取消最后一个管理员的权限")
            db_user.is_admin = data.is_admin

        await db.commit()
        await db.refresh(db_user)

        logger.info(f"管理员 {admin.user_id} 更新了用户 {user_id} 的信息")

        updated_user_dict = db_user.to_dict()

        return {"success": True, "message": "用户信息更新成功", "user": updated_user_dict}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新用户失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"更新用户失败: {str(e)}")


@router.post("/users/{user_id}/toggle-status")
async def toggle_user_status(
    user_id: str,
    data: ToggleStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    切换用户状态（启用/禁用）（仅管理员）
    
    禁用用户会将其 trust_level 设置为 -1
    """
    admin = await _check_admin(request, db)

    try:
        # 不允许禁用自己
        if user_id == admin.user_id:
            raise HTTPException(status_code=400, detail="不能禁用自己的账号")

        result = await db.execute(select(User).where(User.user_id == user_id))
        db_user = result.scalar_one_or_none()

        if not db_user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 更新状态
        if data.is_active:
            db_user.trust_level = 0  # 启用
        else:
            db_user.trust_level = -1  # 禁用

        await db.commit()

        status_text = "启用" if data.is_active else "禁用"
        logger.info(f"管理员 {admin.user_id} {status_text}了用户 {user_id}")

        return {"success": True, "message": f"用户已{status_text}", "is_active": data.is_active}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"切换用户状态失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"切换用户状态失败: {str(e)}")


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    data: ResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    重置用户密码（仅管理员）
    """
    admin = await _check_admin(request, db)

    try:
        result = await db.execute(select(User).where(User.user_id == user_id))
        target_user = result.scalar_one_or_none()

        if not target_user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 生成或使用指定密码
        actual_password = data.new_password or _generate_default_password(target_user.username)
        password_hash = _hash_password(actual_password)

        # 更新密码
        pwd_result = await db.execute(
            select(UserPassword).where(UserPassword.user_id == user_id)
        )
        pwd_record = pwd_result.scalar_one_or_none()

        if pwd_record:
            pwd_record.password_hash = password_hash
            pwd_record.has_custom_password = bool(data.new_password)
        else:
            new_pwd = UserPassword(
                user_id=user_id,
                username=target_user.username,
                password_hash=password_hash,
                has_custom_password=bool(data.new_password),
            )
            db.add(new_pwd)

        await db.commit()

        logger.info(f"管理员 {admin.user_id} 重置了用户 {user_id} 的密码")

        return {
            "success": True,
            "message": "密码重置成功",
            "new_password": actual_password,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"重置密码失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"重置密码失败: {str(e)}")


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    删除用户（仅管理员，慎用）
    
    ⚠️ 此操作不可逆，会删除用户及其相关数据
    """
    admin = await _check_admin(request, db)

    try:
        # 不允许删除自己
        if user_id == admin.user_id:
            raise HTTPException(status_code=400, detail="不能删除自己的账号")

        result = await db.execute(select(User).where(User.user_id == user_id))
        target_user = result.scalar_one_or_none()

        if not target_user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # 检查是否是最后一个管理员
        if target_user.is_admin:
            admin_count_result = await db.execute(
                select(func.count(User.user_id)).where(User.is_admin == True)
            )
            admin_count = admin_count_result.scalar_one()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="不能删除最后一个管理员账号")

        # 删除用户及密码记录
        await db.delete(target_user)

        pwd_result = await db.execute(
            select(UserPassword).where(UserPassword.user_id == user_id)
        )
        pwd_record = pwd_result.scalar_one_or_none()
        if pwd_record:
            await db.delete(pwd_record)

        await db.commit()

        logger.warning(f"管理员 {admin.user_id} 删除了用户 {user_id}")

        return {"success": True, "message": "用户已删除"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除用户失败: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除用户失败: {str(e)}")
