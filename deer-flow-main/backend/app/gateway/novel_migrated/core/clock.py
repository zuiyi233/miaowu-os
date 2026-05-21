"""统一 UTC aware datetime 工具。

避免 datetime.utcnow() / datetime.now() / datetime.now(tz=UTC) 混用导致
Postgres 迁移时出现 naive/aware 不可比较错误。
"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow_aware() -> datetime:
    """返回当前 UTC 时间（带时区信息）。

    替代：
    - datetime.utcnow() → naive UTC
    - datetime.now() → naive 本地时间
    - datetime.now(tz=UTC) → 等价表达式
    """
    return datetime.now(tz=UTC)


def utcnow_naive() -> datetime:
    """返回当前 UTC 时间（不带时区信息），仅用于必须保持 naive 的旧表字段。

    新代码请使用 utcnow_aware()；本函数仅为兼容已存储为 naive 的列。
    """
    return datetime.now(tz=UTC).replace(tzinfo=None)
