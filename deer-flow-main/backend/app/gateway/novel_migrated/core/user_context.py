"""novel_migrated 用户上下文工具。

提供单机单用户模式下的 user_id 解析逻辑：
1. 优先使用 request.state.user_id；
2. 未提供时回退到固定 user_id；
3. 固定值可通过环境变量覆盖。
"""

from __future__ import annotations

import os

from fastapi import Request

DEFAULT_USER_ID_ENV = "NOVEL_MIGRATED_DEFAULT_USER_ID"
DEFAULT_USER_ID = "local_single_user"


def get_default_user_id() -> str:
    """获取默认 user_id（支持环境变量覆盖）。"""
    env_user_id = (os.getenv(DEFAULT_USER_ID_ENV) or "").strip()
    return env_user_id or DEFAULT_USER_ID


def resolve_user_id(user_id: str | None) -> str:
    """标准化 user_id；为空时回退到默认 user_id。"""
    normalized = (user_id or "").strip()
    return normalized or get_default_user_id()


def get_request_user_id(request: Request) -> str:
    """从请求上下文读取 user_id；缺失时自动回退。"""
    return resolve_user_id(getattr(request.state, "user_id", None))
