"""Smoke-test SeaweedFS/S3-compatible upload, download, DB metadata, and delete.

Required environment:
  MIAOWU_OBJECT_STORAGE_PROVIDER=s3
  MIAOWU_OBJECT_STORAGE_ENDPOINT=http://172.22.22.170:18334
  MIAOWU_OBJECT_STORAGE_BUCKET=miaowu-novel-assets
  MIAOWU_OBJECT_STORAGE_REGION=us-east-1
  MIAOWU_OBJECT_STORAGE_ACCESS_KEY=...
  MIAOWU_OBJECT_STORAGE_SECRET_KEY=...
  MIAOWU_OBJECT_STORAGE_PRIVATE=true

For DB metadata validation set one of:
  DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/miaowu
  or SQLITE_URL=sqlite+aiosqlite:///path/to/local.sqlite3
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from sqlalchemy import delete, select

from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.services.media_asset_service import media_asset_service
from app.gateway.novel_migrated.services.object_storage_service import object_storage_service
from deerflow.persistence.engine import close_engine, init_engine

SMOKE_USER_ID = "smoke-seaweedfs-user"
SMOKE_CONTENT = b"miaowu seaweedfs smoke object\n"


def _require_storage_env() -> None:
    required = [
        "MIAOWU_OBJECT_STORAGE_ACCESS_KEY",
        "MIAOWU_OBJECT_STORAGE_SECRET_KEY",
    ]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise SystemExit(f"Missing required object storage env vars: {missing}")


def _db_config() -> tuple[str, str, str]:
    postgres_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or os.getenv("MIAOWU_POSTGRES_URL")
    if postgres_url:
        if postgres_url.startswith("postgresql://"):
            postgres_url = "postgresql+asyncpg://" + postgres_url.removeprefix("postgresql://")
        return "postgres", postgres_url, ""

    sqlite_url = os.getenv("SQLITE_URL")
    if sqlite_url:
        return "sqlite", sqlite_url, str(Path(".deer-flow").resolve())

    raise SystemExit("Set DATABASE_URL/POSTGRES_URL/MIAOWU_POSTGRES_URL or SQLITE_URL for metadata validation.")


async def main() -> None:
    _require_storage_env()
    backend, url, sqlite_dir = _db_config()
    await init_engine(backend, url=url, sqlite_dir=sqlite_dir)
    await init_db_schema()

    created_object_key: str | None = None
    try:
        async with AsyncSessionLocal() as session:
            created = await media_asset_service.create_asset_from_bytes(
                db=session,
                user_id=SMOKE_USER_ID,
                project_id=None,
                purpose="seaweedfs_smoke",
                filename="seaweedfs-smoke.txt",
                content=SMOKE_CONTENT,
                mime_type="text/plain",
                metadata={"source": "smoke_seaweedfs_media_asset"},
                commit=True,
                refresh=True,
            )
            created_object_key = created.object_key
            asset_id = created.asset.id

            stored = await object_storage_service.get_object(object_key=created_object_key)
            if stored.content != SMOKE_CONTENT:
                raise SystemExit("Downloaded object content does not match uploaded content")

            result = await session.execute(select(MediaAsset).where(MediaAsset.id == asset_id))
            asset = result.scalar_one()
            if asset.object_key != created_object_key or asset.size_bytes != len(SMOKE_CONTENT):
                raise SystemExit("DB metadata does not match uploaded object")
            if SMOKE_CONTENT.decode("utf-8") in (asset.metadata_json or ""):
                raise SystemExit("DB metadata unexpectedly contains raw file bytes")

            await object_storage_service.delete_object(object_key=created_object_key)
            asset.status = "deleted"
            await session.commit()

            await session.execute(delete(MediaAsset).where(MediaAsset.id == asset_id))
            await session.commit()

        print("OK SeaweedFS media asset smoke passed: upload/download/delete succeeded and DB stored metadata only.")
    finally:
        if created_object_key:
            try:
                await object_storage_service.delete_object(object_key=created_object_key)
            except Exception:
                pass
        await close_engine()


if __name__ == "__main__":
    asyncio.run(main())
