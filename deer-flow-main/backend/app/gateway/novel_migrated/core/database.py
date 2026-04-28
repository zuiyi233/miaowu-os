"""Minimal async database bridge for novel_migrated."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy import text
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
    connect_args={
        "check_same_thread": False,
    },
)

_WAL_INITIALIZED = asyncio.Event()
_WAL_INIT_LOCK = asyncio.Lock()


async def _ensure_wal_and_pragma(conn) -> None:
    if _WAL_INITIALIZED.is_set():
        return
    async with _WAL_INIT_LOCK:
        if _WAL_INITIALIZED.is_set():
            return
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA synchronous=NORMAL"))
        await conn.execute(text("PRAGMA cache_size=-64000"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        _WAL_INITIALIZED.set()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

async_session_factory = AsyncSessionLocal

_schema_initialized = asyncio.Event()
_SCHEMA_INIT_LOCK = asyncio.Lock()
_SCHEMA_MODE_ENV = "NOVEL_FILE_TRUTH_SCHEMA_MODE"
_SCHEMA_MODE_FULL = "full"
_SCHEMA_MODE_MINIMAL = "minimal_file_truth"


def _load_models_for_schema_mode(schema_mode: str) -> None:
    if schema_mode == _SCHEMA_MODE_MINIMAL:
        from app.gateway.novel_migrated.models import (  # noqa: F401
            ai_metric,
            analysis_task,
            batch_generation_task,
            document_index,
            dual_write_log,
            generation_history,
            intent_session,
            mcp_plugin,
            novel_agent_config,
            project,
            project_default_style,
            prompt_template,
            prompt_workshop,
            regeneration_task,
            settings,
            user,
            writing_style,
        )
        return

    from app.gateway.novel_migrated.models import (  # noqa: F401
        ai_metric,
        analysis_task,
        batch_generation_task,
        career,
        chapter,
        character,
        document_index,
        dual_write_log,
        foreshadow,
        generation_history,
        intent_session,
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


async def init_db_schema() -> None:
    """Initialize migrated novel tables once."""
    if _schema_initialized.is_set():
        return
    async with _SCHEMA_INIT_LOCK:
        if _schema_initialized.is_set():
            return

        schema_mode = (os.getenv(_SCHEMA_MODE_ENV) or _SCHEMA_MODE_FULL).strip().lower()
        if schema_mode not in {_SCHEMA_MODE_FULL, _SCHEMA_MODE_MINIMAL}:
            schema_mode = _SCHEMA_MODE_FULL

        # Ensure mapped tables are registered before create_all.
        _load_models_for_schema_mode(schema_mode)

        async with engine.begin() as conn:
            await _ensure_wal_and_pragma(conn)
            await conn.run_sync(Base.metadata.create_all)
        _schema_initialized.set()


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
