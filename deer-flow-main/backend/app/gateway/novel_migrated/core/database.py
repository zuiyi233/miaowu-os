"""Minimal async database bridge for novel_migrated."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

Base = declarative_base()

_BACKEND_ROOT = Path(__file__).resolve().parents[4]
_DB_DIR = _BACKEND_ROOT / ".deer-flow"
_DB_DIR.mkdir(parents=True, exist_ok=True)
_DB_PATH = _DB_DIR / "novel_migrated.db"

DATABASE_URL = f"sqlite+aiosqlite:///{_DB_PATH.as_posix()}"

engine = create_async_engine(
    DATABASE_URL,
    future=True,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

_schema_initialized = False


async def init_db_schema() -> None:
    """Initialize migrated novel tables once."""
    global _schema_initialized
    if _schema_initialized:
        return

    # Ensure all mapped tables are registered on Base.metadata before create_all.
    from app.gateway.novel_migrated.models import (  # noqa: F401
        career,
        chapter,
        character,
        foreshadow,
        mcp_plugin,
        memory,
        outline,
        project,
        project_default_style,
        relationship,
        settings,
        writing_style,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    _schema_initialized = True


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session."""
    await init_db_schema()
    async with AsyncSessionLocal() as session:
        yield session


async def get_engine(user_id: str | None = None):
    """兼容旧服务签名：返回共享异步 engine。"""
    del user_id
    await init_db_schema()
    return engine
