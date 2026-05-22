"""Novel ORM integration with the main DeerFlow persistence engine.

The novel module no longer owns a separate ``novel_migrated.db`` or a
separate SQLAlchemy metadata tree.  All novel tables are registered on the
main ``deerflow.persistence.base.Base`` and sessions are created from the
main ``deerflow.persistence.engine`` session factory.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import HTTPException
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from deerflow.persistence.base import Base
from deerflow.persistence.engine import get_engine as get_main_engine
from deerflow.persistence.engine import get_session_factory

logger = logging.getLogger(__name__)

_schema_initialized = asyncio.Event()
_schema_initialized_engine: AsyncEngine | None = None
_SCHEMA_INIT_LOCK = asyncio.Lock()
_SCHEMA_MODE_ENV = "NOVEL_FILE_TRUTH_SCHEMA_MODE"
_SCHEMA_MODE_FULL = "full"
_SCHEMA_MODE_MINIMAL = "minimal_file_truth"


class _MainSessionFactoryProxy:
    """Callable proxy preserving the old ``AsyncSessionLocal()`` shape."""

    def __call__(self, *args: Any, **kwargs: Any) -> AsyncSession:
        session_factory = get_session_factory()
        if session_factory is None:
            raise RuntimeError(
                "Main persistence session factory is not initialized. "
                "Initialize deerflow.persistence.engine before using novel APIs."
            )
        return session_factory(*args, **kwargs)


AsyncSessionLocal = _MainSessionFactoryProxy()
async_session_factory = AsyncSessionLocal


def _load_models_for_schema_mode(schema_mode: str) -> None:
    """Register novel ORM models on the shared DeerFlow metadata.

    ``models.user`` is intentionally not imported here.  Main DeerFlow already
    owns the ``users`` table via ``deerflow.persistence.user.model.UserRow``.
    The old novel user/password models are deprecated compatibility code and
    must not become part of the unified production schema.
    """
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
            media_asset,
            novel_agent_config,
            project,
            project_default_style,
            prompt_template,
            prompt_workshop,
            regeneration_task,
            settings,
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
        media_asset,
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
        writing_style,
    )


def _resolve_schema_mode() -> str:
    schema_mode = (os.getenv(_SCHEMA_MODE_ENV) or _SCHEMA_MODE_FULL).strip().lower()
    if schema_mode not in {_SCHEMA_MODE_FULL, _SCHEMA_MODE_MINIMAL}:
        return _SCHEMA_MODE_FULL
    return schema_mode


async def init_db_schema() -> None:
    """Register and create novel tables in the shared main database."""
    global _schema_initialized_engine

    engine = get_main_engine()
    if engine is None:
        raise RuntimeError(
            "Main persistence engine is not initialized. "
            "Novel schema cannot be created outside DeerFlow persistence."
        )

    if _schema_initialized.is_set() and _schema_initialized_engine is engine:
        return

    async with _SCHEMA_INIT_LOCK:
        engine = get_main_engine()
        if engine is None:
            raise RuntimeError(
                "Main persistence engine is not initialized. "
                "Novel schema cannot be created outside DeerFlow persistence."
            )

        if _schema_initialized.is_set() and _schema_initialized_engine is engine:
            return

        _load_models_for_schema_mode(_resolve_schema_mode())

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _ensure_version_columns(conn)

        _schema_initialized_engine = engine
        _schema_initialized.set()


async def _ensure_version_columns(conn) -> None:
    version_tables = ["characters", "outlines", "careers"]
    for table_name in version_tables:
        try:
            col_names = [
                c["name"]
                for c in await conn.run_sync(
                    lambda sync_conn, tn=table_name: sa_inspect(sync_conn).get_columns(tn)
                )
            ]
            if "version" not in col_names:
                await conn.execute(
                    text(f"ALTER TABLE {table_name} ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
                )
                logger.info("Added version column to table %s", table_name)
        except Exception:
            logger.warning("Failed to ensure version column for table %s", table_name, exc_info=True)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session from the main DeerFlow engine."""
    try:
        await init_db_schema()
        async with AsyncSessionLocal() as session:
            yield session
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


async def get_engine(user_id: str | None = None) -> AsyncEngine:
    """Return the shared DeerFlow async engine."""
    del user_id
    await init_db_schema()
    engine = get_main_engine()
    if engine is None:
        raise RuntimeError("Main persistence engine is not initialized")
    return engine
