"""Minimal async database bridge for novel_migrated."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy import text

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
    connect_args={
        "check_same_thread": False,
    },
)

_WAL_INITIALIZED = False


async def _ensure_wal_and_pragma(conn) -> None:
    global _WAL_INITIALIZED
    if _WAL_INITIALIZED:
        return
    await conn.execute(text("PRAGMA journal_mode=WAL"))
    await conn.execute(text("PRAGMA synchronous=NORMAL"))
    await conn.execute(text("PRAGMA cache_size=-64000"))
    await conn.execute(text("PRAGMA foreign_keys=ON"))
    _WAL_INITIALIZED = True

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
        ai_metric,
        analysis_task,
        batch_generation_task,
        career,
        chapter,
        character,
        foreshadow,
        generation_history,
        mcp_plugin,
        memory,
        novel_agent_config,
        outline,
        project,
        project_default_style,
        prompt_template,
        prompt_workshop,
        regeneration_task,
        relationship,
        settings,
        user,
        writing_style,
    )

    async with engine.begin() as conn:
        await _ensure_wal_and_pragma(conn)
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
