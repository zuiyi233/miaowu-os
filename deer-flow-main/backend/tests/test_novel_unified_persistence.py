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
        "STORAGE_BACKEND",
        "S3_ENDPOINT",
        "S3_BUCKET_NAME",
        "S3_BUCKET",
        "S3_REGION",
        "AWS_REGION",
        "S3_ACCESS_KEY_ID",
        "AWS_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "AWS_SECRET_ACCESS_KEY",
    ]:
        monkeypatch.delenv(key, raising=False)

    config = get_object_storage_config()

    assert config.provider == "s3"
    assert config.endpoint == "http://172.22.22.170:18334"
    assert config.bucket == "miaowu-novel-assets"
    assert config.private_bucket is True
    assert "minio" not in repr(config).lower()


def test_object_storage_accepts_generic_s3_aliases(monkeypatch) -> None:
    from app.gateway.novel_migrated.core.object_storage import get_object_storage_config

    for key in [
        "MIAOWU_OBJECT_STORAGE_PROVIDER",
        "MIAOWU_OBJECT_STORAGE_ENDPOINT",
        "MIAOWU_OBJECT_STORAGE_BUCKET",
        "MIAOWU_OBJECT_STORAGE_REGION",
        "MIAOWU_OBJECT_STORAGE_ACCESS_KEY",
        "MIAOWU_OBJECT_STORAGE_SECRET_KEY",
    ]:
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_ENDPOINT", "http://storage.example:8333")
    monkeypatch.setenv("S3_BUCKET_NAME", "miaowu-prod")
    monkeypatch.setenv("S3_REGION", "auto")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "alias-ak")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "alias-sk")

    config = get_object_storage_config()

    assert config.provider == "s3"
    assert config.endpoint == "http://storage.example:8333"
    assert config.bucket == "miaowu-prod"
    assert config.region == "auto"
    assert config.access_key == "alias-ak"
    assert config.secret_key == "alias-sk"


def test_object_storage_miaowu_env_takes_precedence_over_generic_aliases(monkeypatch) -> None:
    from app.gateway.novel_migrated.core.object_storage import get_object_storage_config

    monkeypatch.setenv("MIAOWU_OBJECT_STORAGE_ENDPOINT", "http://miaowu-storage:18334")
    monkeypatch.setenv("MIAOWU_OBJECT_STORAGE_BUCKET", "miaowu-bucket")
    monkeypatch.setenv("MIAOWU_OBJECT_STORAGE_ACCESS_KEY", "miaowu-ak")
    monkeypatch.setenv("MIAOWU_OBJECT_STORAGE_SECRET_KEY", "miaowu-sk")
    monkeypatch.setenv("S3_ENDPOINT", "http://generic-storage:8333")
    monkeypatch.setenv("S3_BUCKET_NAME", "generic-bucket")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "generic-ak")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "generic-sk")

    config = get_object_storage_config()

    assert config.endpoint == "http://miaowu-storage:18334"
    assert config.bucket == "miaowu-bucket"
    assert config.access_key == "miaowu-ak"
    assert config.secret_key == "miaowu-sk"


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
async def test_media_asset_upload_deletes_object_when_db_commit_fails(monkeypatch) -> None:
    from fastapi import UploadFile

    from app.gateway.novel_migrated.api.media_assets import upload_media_asset
    from app.gateway.novel_migrated.services import object_storage_service as storage_module

    uploaded_key: str | None = None
    deleted_keys: list[str] = []

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        nonlocal uploaded_key
        uploaded_key = object_key
        return {"etag": '"test"', "size_bytes": len(data)}

    async def fake_delete_object(*, object_key: str) -> None:
        deleted_keys.append(object_key)

    class FailingDB:
        def add(self, _asset):
            return None

        async def commit(self):
            raise RuntimeError("db failed")

        async def rollback(self):
            return None

    monkeypatch.setattr(storage_module.object_storage_service, "put_object", fake_put_object)
    monkeypatch.setattr(storage_module.object_storage_service, "delete_object", fake_delete_object)

    file = UploadFile(filename="asset.txt", file=BytesIO(b"asset bytes"))
    with pytest.raises(RuntimeError, match="db failed"):
        await upload_media_asset(
            file=file,
            purpose="attachment",
            project_id=None,
            metadata_json=None,
            user_id="owner-a",
            db=FailingDB(),
        )

    assert uploaded_key is not None
    assert deleted_keys == [uploaded_key]


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
async def test_import_export_service_scopes_export_by_user(main_sqlite_engine) -> None:
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.services.import_export_service import ImportExportService

    await init_db_schema()

    async with AsyncSessionLocal() as session:
        project = Project(id="export-project-a", user_id="owner-a", title="Export Project")
        session.add(project)
        await session.commit()

    service = ImportExportService()

    async with AsyncSessionLocal() as session:
        with pytest.raises(ValueError):
            await service.export_project("export-project-a", "owner-b", session)


@pytest.mark.asyncio
async def test_import_export_service_stores_export_zip_as_media_asset(main_sqlite_engine, monkeypatch) -> None:
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.services import object_storage_service as storage_module
    from app.gateway.novel_migrated.services.import_export_service import ImportExportService

    await init_db_schema()

    uploaded: dict[str, object] = {}

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        uploaded.update({"object_key": object_key, "data": data, "content_type": content_type})
        return {"etag": '"export"', "size_bytes": len(data)}

    monkeypatch.setattr(storage_module.object_storage_service, "put_object", fake_put_object)

    async with AsyncSessionLocal() as session:
        session.add(Project(id="export-project-asset", user_id="owner-a", title="Export Asset"))
        await session.commit()

    service = ImportExportService()

    async with AsyncSessionLocal() as session:
        result = await service.export_project("export-project-asset", "owner-a", session)

        assert result.content.startswith(b"PK")
        assert result.media_asset_id
        assert result.download_path == f"/media-assets/{result.media_asset_id}/download"
        assert uploaded["content_type"] == "application/zip"
        assert str(uploaded["object_key"]).startswith("users/owner-a/novel-assets/")

        db_result = await session.execute(select(MediaAsset).where(MediaAsset.id == result.media_asset_id))
        asset = db_result.scalar_one()
        assert asset.project_id == "export-project-asset"
        assert asset.user_id == "owner-a"
        assert asset.purpose == "project_export"
        assert asset.object_key == uploaded["object_key"]


@pytest.mark.asyncio
async def test_import_export_service_stores_import_zip_as_media_asset(main_sqlite_engine, monkeypatch) -> None:
    import json
    import zipfile

    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset
    from app.gateway.novel_migrated.services import object_storage_service as storage_module
    from app.gateway.novel_migrated.services.import_export_service import ImportExportService

    await init_db_schema()

    uploaded: dict[str, object] = {}

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        uploaded.update({"object_key": object_key, "data": data, "content_type": content_type})
        return {"etag": '"import"', "size_bytes": len(data)}

    monkeypatch.setattr(storage_module.object_storage_service, "put_object", fake_put_object)

    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "project_data.json",
            json.dumps({"project": {"title": "Imported Project"}}, ensure_ascii=False),
        )
        zf.writestr("workspace/chapters/001.md", "# chapter")

    service = ImportExportService()

    async with AsyncSessionLocal() as session:
        project_id = await service.import_project("owner-a", zip_buffer.getvalue(), session, filename="imported.zip")

    async with AsyncSessionLocal() as session:
        db_result = await session.execute(select(MediaAsset).where(MediaAsset.project_id == project_id))
        asset = db_result.scalar_one()
        assert asset.user_id == "owner-a"
        assert asset.purpose == "project_import_source"
        assert asset.filename == "imported.zip"
        assert asset.object_key == uploaded["object_key"]
        assert uploaded["content_type"] == "application/zip"


@pytest.mark.asyncio
async def test_book_import_create_task_stores_source_txt_as_media_asset(main_sqlite_engine, monkeypatch) -> None:
    from fastapi import UploadFile

    from app.gateway.novel_migrated.api.book_import import create_book_import_task
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset
    from app.gateway.novel_migrated.services import object_storage_service as storage_module
    from app.gateway.novel_migrated.services.book_import_service import book_import_service

    await init_db_schema()

    uploaded: dict[str, object] = {}
    captured: dict[str, object] = {}

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        uploaded.update({"object_key": object_key, "data": data, "content_type": content_type})
        return {"etag": '"source"', "size_bytes": len(data)}

    async def fake_create_task(**kwargs):
        captured.update(kwargs)
        return {"task_id": "task-source", "status": "pending"}

    monkeypatch.setattr(storage_module.object_storage_service, "put_object", fake_put_object)
    monkeypatch.setattr(book_import_service, "create_task", fake_create_task)

    request = SimpleNamespace(state=SimpleNamespace(user_id="owner-a"))
    source_bytes = "第一章 开始\n正文".encode()
    file = UploadFile(filename='source"\r\nbad.txt', file=BytesIO(source_bytes))

    async with AsyncSessionLocal() as session:
        response = await create_book_import_task(
            request=request,
            file=file,
            project_id=None,
            create_new_project=True,
            import_mode="append",
            extract_mode="tail",
            tail_chapter_count=10,
            db=session,
        )

        assert response == {"task_id": "task-source", "status": "pending"}
        assert captured["source_asset_id"]
        assert uploaded["data"] == source_bytes
        assert uploaded["content_type"] == "text/plain"

        db_result = await session.execute(select(MediaAsset).where(MediaAsset.id == captured["source_asset_id"]))
        asset = db_result.scalar_one()
        assert asset.user_id == "owner-a"
        assert asset.project_id is None
        assert asset.purpose == "book_import_source"
        assert "\r" not in asset.filename
        assert "\n" not in asset.filename
        assert '"' not in asset.filename
        assert asset.object_key == uploaded["object_key"]


@pytest.mark.asyncio
async def test_cover_generation_stores_cover_as_media_asset(main_sqlite_engine, monkeypatch) -> None:
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.models.settings import Settings
    from app.gateway.novel_migrated.services import cover_generation_service as cover_module

    await init_db_schema()

    uploaded: dict[str, object] = {}

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        uploaded.update({"object_key": object_key, "data": data, "content_type": content_type})
        return {"etag": '"cover"', "size_bytes": len(data)}

    class FakeProvider:
        async def generate_cover(self, *, prompt: str, model: str, width: int, height: int) -> dict[str, object]:
            return {
                "content": b"cover-bytes",
                "file_extension": "png",
                "provider": "fake-provider",
                "model": model,
                "revised_prompt": prompt,
            }

    monkeypatch.setattr(cover_module.object_storage_service, "put_object", fake_put_object)
    monkeypatch.setattr(
        cover_module.cover_generation_service,
        "_build_provider",
        lambda _settings: FakeProvider(),
    )

    async with AsyncSessionLocal() as session:
        session.add(Project(id="cover-project-a", user_id="owner-a", title="Cover Project"))
        session.add(
            Settings(
                user_id="owner-a",
                cover_enabled=True,
                cover_api_provider="fake",
                cover_api_key="encrypted-key",
                cover_image_model="fake-image-model",
            )
        )
        await session.commit()

    async with AsyncSessionLocal() as session:
        response = await cover_module.cover_generation_service.generate_cover(
            db=session,
            user_id="owner-a",
            project_id="cover-project-a",
        )

        assert response["cover_status"] == "ready"
        assert response["cover_image_url"].startswith("/media-assets/")
        assert response["cover_image_url"].endswith("/download")
        assert "object_key" not in response
        assert uploaded["data"] == b"cover-bytes"
        assert str(uploaded["object_key"]).startswith("users/owner-a/novel-assets/")

        result = await session.execute(select(MediaAsset).where(MediaAsset.project_id == "cover-project-a"))
        asset = result.scalar_one()
        assert asset.user_id == "owner-a"
        assert asset.purpose == "cover"
        assert asset.object_key == uploaded["object_key"]


@pytest.mark.asyncio
async def test_cover_generation_deletes_object_when_db_commit_fails(monkeypatch) -> None:
    from app.gateway.novel_migrated.services import cover_generation_service as cover_module

    deleted_keys: list[str] = []

    async def fake_put_object(*, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, object]:
        return {"etag": '"cover"', "size_bytes": len(data)}

    async def fake_delete_object(*, object_key: str) -> None:
        deleted_keys.append(object_key)

    class FailingDB:
        def add(self, _asset):
            return None

        async def rollback(self):
            return None

    monkeypatch.setattr(cover_module.object_storage_service, "put_object", fake_put_object)
    monkeypatch.setattr(cover_module.object_storage_service, "delete_object", fake_delete_object)

    db = FailingDB()
    image_url, object_key = await cover_module.cover_generation_service._save_cover_asset(
        db=db,
        user_id="owner-a",
        project_id="cover-project-a",
        content=b"cover-bytes",
        file_extension="png",
        provider="fake-provider",
        model="fake-model",
    )
    await cover_module.cover_generation_service._delete_uploaded_cover_object(object_key)

    assert image_url.startswith("/media-assets/")
    assert deleted_keys == [object_key]


def test_safe_download_content_disposition_sanitizes_user_filename() -> None:
    from app.gateway.novel_migrated.utils.http_headers import safe_download_content_disposition

    header = safe_download_content_disposition('坏标题"\r\nX-Bad: 1.png')

    assert "\r" not in header
    assert "\n" not in header
    assert "X-Bad" in header
    assert "filename=" in header
    assert "filename*=UTF-8''" in header


@pytest.mark.asyncio
async def test_delete_project_marks_media_assets_deleted(main_sqlite_engine, monkeypatch) -> None:
    from app.gateway.novel_migrated.api.projects import delete_project
    from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
    from app.gateway.novel_migrated.models.media_asset import MediaAsset
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.novel_migrated.services import memory_service as memory_module
    from app.gateway.novel_migrated.services import object_storage_service as storage_module
    from app.gateway.novel_migrated.services import workspace_document_service as workspace_module

    await init_db_schema()

    deleted_keys: list[str] = []

    async def fake_delete_object(*, object_key: str) -> None:
        deleted_keys.append(object_key)

    async def fake_delete_project_memories(*_args, **_kwargs) -> bool:
        return True

    async def fake_delete_project_workspace(*_args, **_kwargs) -> bool:
        return True

    monkeypatch.setattr(storage_module.object_storage_service, "delete_object", fake_delete_object)
    monkeypatch.setattr(memory_module.memory_service, "delete_project_memories", fake_delete_project_memories)
    monkeypatch.setattr(
        workspace_module.workspace_document_service,
        "delete_project_workspace",
        fake_delete_project_workspace,
    )

    async with AsyncSessionLocal() as session:
        session.add(Project(id="project-delete-media", user_id="owner-a", title="Delete Media"))
        session.add(
            MediaAsset(
                id="asset-delete-media",
                user_id="owner-a",
                project_id="project-delete-media",
                purpose="cover",
                filename="cover.png",
                mime_type="image/png",
                size_bytes=11,
                storage_backend="s3",
                bucket="miaowu-novel-assets",
                object_key="users/owner-a/novel-assets/asset-delete-media/cover.png",
                status="active",
            )
        )
        await session.commit()

    async with AsyncSessionLocal() as session:
        response = await delete_project("project-delete-media", user_id="owner-a", db=session)
        assert response == {"message": "Project deleted"}

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(MediaAsset).where(MediaAsset.id == "asset-delete-media"))
        asset = result.scalar_one()
        assert asset.status == "deleted"
        assert deleted_keys == ["users/owner-a/novel-assets/asset-delete-media/cover.png"]


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
