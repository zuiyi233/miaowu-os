from __future__ import annotations

from io import BytesIO
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
    from app.gateway.novel_migrated.core import database
    from deerflow.persistence.base import Base as MainBase

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


@pytest.mark.asyncio
async def test_user_owned_resource_lookup_enforces_owner_scope(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.api.common import get_owned_user_resource
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.mcp_plugin import MCPPlugin

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        plugin = MCPPlugin(
            user_id="owner-a",
            plugin_name="owner-plugin",
            display_name="Owner Plugin",
        )
        session.add(plugin)
        await session.commit()
        plugin_id = plugin.id

    async with AsyncSessionLocal() as session:
        plugin = await get_owned_user_resource(MCPPlugin, plugin_id, "owner-a", session)
        assert plugin.plugin_name == "owner-plugin"

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_owned_user_resource(MCPPlugin, plugin_id, "owner-b", session)
        assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_generation_task_status_queries_are_user_scoped(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.api.chapters import get_batch_task_status, get_regen_task_status
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.batch_generation_task import BatchGenerationTask
    from app.gateway.novel_migrated.models.chapter import Chapter
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.models.regeneration_task import RegenerationTask

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        project = Project(id="project-a", user_id="owner-a", title="Owner Project")
        session.add(project)
        await session.commit()

    async with AsyncSessionLocal() as session:
        chapter = Chapter(id="chapter-a", project_id="project-a", chapter_number=1, title="Chapter A")
        session.add(chapter)
        await session.commit()

    async with AsyncSessionLocal() as session:
        batch_task = BatchGenerationTask(
            project_id="project-a",
            user_id="owner-a",
            start_chapter_number=1,
            chapter_count=1,
            chapter_ids=[],
            total_chapters=1,
            status="pending",
        )
        regen_task = RegenerationTask(
            chapter_id="chapter-a",
            user_id="owner-a",
            project_id="project-a",
            modification_instructions="revise",
            status="pending",
        )
        session.add_all([batch_task, regen_task])
        await session.commit()
        batch_id = batch_task.id
        regen_id = regen_task.id

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_batch_task_status(batch_id, user_id="owner-b", db=session)
        assert exc_info.value.status_code == 404

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_regen_task_status(regen_id, user_id="owner-b", db=session)
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


@pytest.mark.asyncio
async def test_media_asset_upload_uses_object_storage_and_hides_object_key(main_sqlite_engine, monkeypatch) -> None:
    from fastapi import UploadFile

    from app.gateway.novel_migrated.api.media_assets import upload_media_asset
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.services import object_storage_service as storage_module

    await init_db_schema()

    uploaded: dict[str, object] = {}

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        uploaded.update({"object_key": object_key, "data": data, "content_type": content_type})
        return {"etag": '"test"', "size_bytes": len(data)}

    monkeypatch.setattr(storage_module.object_storage_service, "put_object", fake_put_object)

    async with AsyncSessionLocal() as session:
        session.add(Project(id="project-media", user_id="owner-a", title="Media Project"))
        await session.commit()

    async with AsyncSessionLocal() as session:
        file = UploadFile(filename="cover.png", file=BytesIO(b"fake image bytes"))
        response = await upload_media_asset(
            file=file,
            purpose="cover",
            project_id="project-media",
            metadata_json='{"slot":"cover"}',
            user_id="owner-a",
            db=session,
        )

        assert response["id"]
        assert response["project_id"] == "project-media"
        assert response["content_hash"]
        assert response["metadata"] == {"slot": "cover"}
        assert "object_key" not in response
        assert "endpoint" not in response
        assert uploaded["data"] == b"fake image bytes"
        assert str(uploaded["object_key"]).startswith("users/owner-a/novel-assets/")

        result = await session.execute(select(MediaAsset).where(MediaAsset.id == response["id"]))
        asset = result.scalar_one()
        assert asset.user_id == "owner-a"
        assert asset.project_id == "project-media"
        assert asset.object_key == uploaded["object_key"]


@pytest.mark.asyncio
async def test_media_asset_metadata_is_user_scoped(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.api.media_assets import get_media_asset
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        asset = MediaAsset(
            id="asset-owner-a",
            user_id="owner-a",
            project_id=None,
            purpose="attachment",
            filename="source.txt",
            mime_type="text/plain",
            size_bytes=11,
            storage_backend="s3",
            bucket="miaowu-novel-assets",
            object_key="users/owner-a/novel-assets/asset-owner-a/source.txt",
            status="active",
        )
        session.add(asset)
        await session.commit()

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_media_asset("asset-owner-a", user_id="owner-b", db=session)
        assert exc_info.value.status_code == 404

    async with AsyncSessionLocal() as session:
        response = await get_media_asset("asset-owner-a", user_id="owner-a", db=session)
        assert response["id"] == "asset-owner-a"
        assert "object_key" not in response


@pytest.mark.asyncio
async def test_organization_model_accepts_api_fields(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.character import Character
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.models.relationship import Organization

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        project = Project(id="project-org", user_id="owner-a", title="Org Project")
        session.add(project)
        await session.flush()

        character = Character(
            id="org-character",
            project_id="project-org",
            name="星门协会",
            is_organization=True,
            organization_type="guild",
            organization_purpose="探索星门",
        )
        session.add(character)
        await session.flush()

        organization = Organization(
            id="organization-detail",
            character_id="org-character",
            project_id="project-org",
            name="星门协会",
            organization_type="guild",
            purpose="探索星门",
            hierarchy="council",
        )
        session.add(organization)
        await session.commit()

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Organization).where(Organization.id == "organization-detail"))
        loaded = result.scalar_one()
        assert loaded.project_id == "project-org"
        assert loaded.name == "星门协会"
        assert loaded.organization_type == "guild"
        assert loaded.purpose == "探索星门"
        assert loaded.hierarchy == "council"
