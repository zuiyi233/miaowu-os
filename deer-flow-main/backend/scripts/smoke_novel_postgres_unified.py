"""Smoke-test unified PostgreSQL persistence for Miaowu novel SaaS tables.

Usage:
  $env:DATABASE_URL="postgresql+asyncpg://user:pass@host:5432/miaowu"
  uv run python scripts/smoke_novel_postgres_unified.py

The script creates only synthetic smoke rows and deletes them before exit.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from sqlalchemy import delete, inspect, select

from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.models.project import Project
from deerflow.persistence.engine import close_engine, init_engine
from deerflow.persistence.run.model import RunRow
from deerflow.persistence.user.model import UserRow

SMOKE_USER_A = "smoke-postgres-user-a"
SMOKE_USER_B = "smoke-postgres-user-b"
SMOKE_PROJECT_ID = "smoke-postgres-project-a"
SMOKE_CHAPTER_ID = "smoke-postgres-chapter-a"
SMOKE_CHARACTER_ID = "smoke-postgres-character-a"
SMOKE_ASSET_ID = "smoke-postgres-asset-a"
SMOKE_RUN_ID = "smoke-postgres-run-a"


def _postgres_url() -> str:
    url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or os.getenv("MIAOWU_POSTGRES_URL")
    if not url:
        raise SystemExit("Set DATABASE_URL, POSTGRES_URL, or MIAOWU_POSTGRES_URL to a PostgreSQL SQLAlchemy URL.")
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url.removeprefix("postgresql://")
    return url


def _legacy_novel_db_path() -> Path:
    home = os.getenv("DEER_FLOW_HOME")
    if home:
        return Path(home) / "novel_migrated.db"
    return Path(".deer-flow") / "novel_migrated.db"


async def _table_names() -> set[str]:
    from deerflow.persistence.engine import get_engine

    current_engine = get_engine()
    if current_engine is None:
        raise RuntimeError("Persistence engine is not initialized")
    async with current_engine.connect() as conn:
        return set(await conn.run_sync(lambda sync_conn: inspect(sync_conn).get_table_names()))


async def main() -> None:
    db_url = _postgres_url()
    legacy_db = _legacy_novel_db_path()
    legacy_mtime = legacy_db.stat().st_mtime_ns if legacy_db.exists() else None

    await init_engine("postgres", url=db_url)
    await init_db_schema()

    table_names = await _table_names()
    required_tables = {"users", "runs", "projects", "chapters", "characters", "media_assets"}
    missing = sorted(required_tables - table_names)
    if missing:
        raise SystemExit(f"Missing unified persistence tables in PostgreSQL: {missing}")

    try:
        async with AsyncSessionLocal() as session:
            await session.execute(delete(MediaAsset).where(MediaAsset.id == SMOKE_ASSET_ID))
            await session.execute(delete(Character).where(Character.id == SMOKE_CHARACTER_ID))
            await session.execute(delete(Chapter).where(Chapter.id == SMOKE_CHAPTER_ID))
            await session.execute(delete(Project).where(Project.id == SMOKE_PROJECT_ID))
            await session.execute(delete(RunRow).where(RunRow.run_id == SMOKE_RUN_ID))
            await session.execute(delete(UserRow).where(UserRow.id.in_([SMOKE_USER_A, SMOKE_USER_B])))
            await session.commit()

            session.add(UserRow(id=SMOKE_USER_A, email="smoke-a@example.invalid"))
            session.add(UserRow(id=SMOKE_USER_B, email="smoke-b@example.invalid"))
            session.add(RunRow(run_id=SMOKE_RUN_ID, thread_id="smoke-thread-a", user_id=SMOKE_USER_A, status="success"))
            session.add(Project(id=SMOKE_PROJECT_ID, user_id=SMOKE_USER_A, title="Postgres Smoke Novel"))
            await session.commit()

            session.add(
                Chapter(
                    id=SMOKE_CHAPTER_ID,
                    project_id=SMOKE_PROJECT_ID,
                    chapter_number=1,
                    title="Smoke Chapter",
                    content="Smoke",
                )
            )
            session.add(Character(id=SMOKE_CHARACTER_ID, project_id=SMOKE_PROJECT_ID, name="Smoke Character"))
            session.add(
                MediaAsset(
                    id=SMOKE_ASSET_ID,
                    user_id=SMOKE_USER_A,
                    project_id=SMOKE_PROJECT_ID,
                    purpose="smoke",
                    filename="smoke.txt",
                    mime_type="text/plain",
                    size_bytes=5,
                    storage_backend="s3",
                    bucket="miaowu-novel-assets",
                    object_key="smoke/postgres/smoke.txt",
                    status="active",
                )
            )
            await session.commit()

            own_project = (
                await session.execute(select(Project).where(Project.id == SMOKE_PROJECT_ID, Project.user_id == SMOKE_USER_A))
            ).scalar_one_or_none()
            cross_project = (
                await session.execute(select(Project).where(Project.id == SMOKE_PROJECT_ID, Project.user_id == SMOKE_USER_B))
            ).scalar_one_or_none()
            if own_project is None or cross_project is not None:
                raise SystemExit("Project ownership smoke failed")

            await session.execute(delete(MediaAsset).where(MediaAsset.id == SMOKE_ASSET_ID))
            await session.execute(delete(Character).where(Character.id == SMOKE_CHARACTER_ID))
            await session.execute(delete(Chapter).where(Chapter.id == SMOKE_CHAPTER_ID))
            await session.execute(delete(Project).where(Project.id == SMOKE_PROJECT_ID))
            await session.execute(delete(RunRow).where(RunRow.run_id == SMOKE_RUN_ID))
            await session.execute(delete(UserRow).where(UserRow.id.in_([SMOKE_USER_A, SMOKE_USER_B])))
            await session.commit()

        if legacy_db.exists() and legacy_db.stat().st_mtime_ns != legacy_mtime:
            raise SystemExit(f"Legacy private novel DB was modified: {legacy_db}")

        print("OK unified PostgreSQL smoke passed: users/runs/novel/media tables share one PostgreSQL database.")
    finally:
        await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
