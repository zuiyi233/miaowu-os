from __future__ import annotations

from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

from deerflow.persistence.engine import close_engine, init_engine


@pytest_asyncio.fixture()
async def main_sqlite_engine(tmp_path):
    db_path = tmp_path / "main.sqlite3"
    await init_engine("sqlite", url=f"sqlite+aiosqlite:///{db_path.as_posix()}", sqlite_dir=str(tmp_path))
    try:
        yield db_path
    finally:
        await close_engine()


def test_novel_database_uses_main_base_and_no_private_db_url() -> None:
    from deerflow.persistence.base import Base as MainBase
    from app.gateway.novel_migrated.core import database

    assert database.Base is MainBase
    assert not hasattr(database, "DATABASE_URL")
    assert all("novel_migrated.db" not in str(value) for key, value in database.__dict__.items() if key != "__doc__")


@pytest.mark.asyncio
async def test_novel_schema_registers_on_main_database_without_compat_user_tables(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, Base, init_db_schema
    from app.gateway.novel_migrated.models.project import Project

    await init_db_schema()

    assert "projects" in Base.metadata.tables
    assert "media_assets" in Base.metadata.tables
    assert "user_passwords" not in Base.metadata.tables

    async with AsyncSessionLocal() as session:
        project = Project(user_id="user-a", title="Unified Project")
        session.add(project)
        await session.commit()

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Project).where(Project.user_id == "user-a"))
        assert result.scalar_one().title == "Unified Project"

    assert main_sqlite_engine.exists()


def test_deprecated_novel_user_module_does_not_register_user_tables() -> None:
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy.exc import NoInspectionAvailable

    from app.gateway.novel_migrated.core.database import Base
    from app.gateway.novel_migrated.models import user as deprecated_user

    assert deprecated_user.User.__module__.endswith("models.user")
    assert "user_passwords" not in Base.metadata.tables
    with pytest.raises(NoInspectionAvailable):
        sa_inspect(deprecated_user.User)
    with pytest.raises(NoInspectionAvailable):
        sa_inspect(deprecated_user.UserPassword)


def test_get_request_user_id_requires_authenticated_user() -> None:
    from app.gateway.novel_migrated.core.user_context import get_request_user_id

    request = SimpleNamespace(state=SimpleNamespace())

    with pytest.raises(HTTPException) as exc_info:
        get_request_user_id(request)

    assert exc_info.value.status_code == 401


def test_get_request_user_id_reads_main_auth_context() -> None:
    from app.gateway.novel_migrated.core.user_context import get_request_user_id

    request = SimpleNamespace(
        state=SimpleNamespace(
            auth=SimpleNamespace(user=SimpleNamespace(id="main-user-1")),
        )
    )

    assert get_request_user_id(request) == "main-user-1"


@pytest.mark.asyncio
async def test_verify_project_access_enforces_user_scope(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.api.common import verify_project_access
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.project import Project

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        project = Project(user_id="owner-a", title="Private Novel")
        session.add(project)
        await session.commit()
        project_id = project.id

    async with AsyncSessionLocal() as session:
        project = await verify_project_access(project_id, "owner-a", session)
        assert project.title == "Private Novel"

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await verify_project_access(project_id, "owner-b", session)
        assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_project_child_resource_lookup_enforces_owner_scope(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.api.common import get_owned_project_resource
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.chapter import Chapter
    from app.gateway.novel_migrated.models.project import Project

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        project = Project(user_id="owner-a", title="Private Novel")
        session.add(project)
        await session.flush()
        chapter = Chapter(project_id=project.id, chapter_number=1, title="Private Chapter")
        session.add(chapter)
        await session.commit()
        chapter_id = chapter.id

    async with AsyncSessionLocal() as session:
        chapter = await get_owned_project_resource(Chapter, chapter_id, "owner-a", session)
        assert chapter.title == "Private Chapter"

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_owned_project_resource(Chapter, chapter_id, "owner-b", session)
        assert exc_info.value.status_code == 404


def test_object_storage_defaults_to_seaweedfs_s3_compatible(monkeypatch) -> None:
    from app.gateway.novel_migrated.core.object_storage import get_object_storage_config

    for key in [
        "MIAOWU_OBJECT_STORAGE_PROVIDER",
        "MIAOWU_OBJECT_STORAGE_ENDPOINT",
        "MIAOWU_OBJECT_STORAGE_BUCKET",
        "MIAOWU_OBJECT_STORAGE_REGION",
        "MIAOWU_OBJECT_STORAGE_ACCESS_KEY",
        "MIAOWU_OBJECT_STORAGE_SECRET_KEY",
        "MIAOWU_OBJECT_STORAGE_PRIVATE",
    ]:
        monkeypatch.delenv(key, raising=False)

    config = get_object_storage_config()

    assert config.provider == "s3"
    assert config.endpoint == "http://172.22.22.170:18334"
    assert config.bucket == "miaowu-novel-assets"
    assert config.private_bucket is True
    assert "minio" not in repr(config).lower()
