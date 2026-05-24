import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.gateway.storage_quota import DEFAULT_STORAGE_QUOTA_BYTES, storage_quota_service
from deerflow.config.paths import Paths
from deerflow.persistence.engine import close_engine, get_session_factory, init_engine
from deerflow.persistence.storage_quota.model import UserStorageObjectRow
from deerflow.persistence.user.model import UserRow


async def _init_db(tmp_path):
    await close_engine()
    await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path / 'quota.db'}", sqlite_dir=str(tmp_path))
    return get_session_factory()


@pytest.mark.anyio
async def test_quota_exceeded_returns_stable_detail(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        await storage_quota_service.set_user_quota_override(
            db,
            admin_user_id="u1",
            target_user_id="u1",
            backend_quota_bytes=100,
            browser_quota_bytes=None,
        )
        first = await storage_quota_service.reserve(
            db,
            user_id="u1",
            source="test",
            resource_id="a",
            incoming_bytes=99,
        )
        await storage_quota_service.commit_reservation(db, first)
        await db.commit()

    async with sf() as db:
        with pytest.raises(HTTPException) as exc_info:
            await storage_quota_service.reserve(
                db,
                user_id="u1",
                source="test",
                resource_id="b",
                incoming_bytes=2,
            )
        detail = exc_info.value.detail
        assert detail["code"] == "storage_quota_exceeded"
        assert detail["quota_bytes"] == 100
        assert detail["used_bytes"] == 99
        assert detail["incoming_bytes"] == 2
    await close_engine()


@pytest.mark.anyio
async def test_overwrite_tracks_delta_and_delete_releases(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        first = await storage_quota_service.reserve(db, user_id="u1", source="test", resource_id="same", incoming_bytes=50)
        await storage_quota_service.commit_reservation(db, first)
        bigger = await storage_quota_service.reserve(db, user_id="u1", source="test", resource_id="same", incoming_bytes=70)
        assert bigger.delta_bytes == 20
        await storage_quota_service.commit_reservation(db, bigger)
        usage = await storage_quota_service.get_account_usage(db, "u1")
        assert usage["backend"]["used_bytes"] == 70
        await storage_quota_service.release_object(db, user_id="u1", source="test", resource_id="same")
        usage = await storage_quota_service.get_account_usage(db, "u1")
        assert usage["backend"]["used_bytes"] == 0
    await close_engine()


@pytest.mark.anyio
async def test_default_settings_are_100mb(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        settings = await storage_quota_service.get_system_settings(db)
        assert settings["backend_storage_quota_bytes"] == DEFAULT_STORAGE_QUOTA_BYTES
        assert settings["browser_storage_quota_bytes"] == DEFAULT_STORAGE_QUOTA_BYTES
        assert settings["backend_storage_quota_enabled"] is True
        assert settings["browser_storage_quota_enabled"] is True
    await close_engine()


@pytest.mark.anyio
async def test_scan_thread_storage_registers_workspace_and_outputs(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)
    paths.ensure_thread_dirs("t1", user_id="u1")
    (paths.sandbox_work_dir("t1", user_id="u1") / "draft.txt").write_bytes(b"abc")
    (paths.sandbox_outputs_dir("t1", user_id="u1") / "result.json").write_bytes(b"12345")

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        usage = await storage_quota_service.scan_thread_storage(db, user_id="u1", thread_id="t1")
        await db.commit()

    assert usage["backend"]["used_bytes"] == 8
    await close_engine()


@pytest.mark.anyio
async def test_recalculate_user_scans_memory_and_profile(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)
    paths.user_dir("u1").mkdir(parents=True)
    paths.user_memory_file("u1").write_bytes(b"mem")
    paths.user_profile_file("u1").write_bytes(b"profile")

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        usage = await storage_quota_service.recalculate_user(db, user_id="u1")
        await db.commit()

    assert usage["backend"]["used_bytes"] == 10
    await close_engine()


@pytest.mark.anyio
async def test_recalculate_user_tracks_agent_memory_separately(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)
    agent_dir = paths.user_agent_dir("u1", "writer")
    agent_dir.mkdir(parents=True)
    (agent_dir / "config.yaml").write_bytes(b"agent")
    (agent_dir / "memory.json").write_bytes(b"memory")

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        usage = await storage_quota_service.recalculate_user(db, user_id="u1")
        rows = (
            await db.execute(
                select(UserStorageObjectRow.source, UserStorageObjectRow.resource_id, UserStorageObjectRow.size_bytes)
                .where(UserStorageObjectRow.user_id == "u1", UserStorageObjectRow.status == "active")
                .order_by(UserStorageObjectRow.source, UserStorageObjectRow.resource_id)
            )
        ).all()
        await db.commit()

    assert usage["backend"]["used_bytes"] == 11
    assert rows == [
        ("agent_file", "agents:writer/config.yaml", 5),
        ("agent_memory", "agents:writer/memory.json", 6),
    ]
    await close_engine()


@pytest.mark.anyio
async def test_empty_user_can_reserve_without_storage_initialization(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        reservation = await storage_quota_service.reserve(
            db,
            user_id="u1",
            source="test",
            resource_id="first",
            incoming_bytes=3,
        )
        await storage_quota_service.commit_reservation(db, reservation)
        usage = await storage_quota_service.get_account_usage(db, "u1")
        await db.commit()

    assert usage["backend"]["used_bytes"] == 3
    await close_engine()


@pytest.mark.anyio
async def test_existing_untracked_user_files_require_storage_recalculation(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)
    paths.user_dir("u1").mkdir(parents=True)
    paths.user_profile_file("u1").write_bytes(b"profile")

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await storage_quota_service.reserve(
                db,
                user_id="u1",
                source="test",
                resource_id="new",
                incoming_bytes=1,
            )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "storage_quota_not_initialized"
    await close_engine()


@pytest.mark.anyio
async def test_thread_file_write_reservation_enforces_quota_before_sandbox_write(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)
    paths.ensure_thread_dirs("t1", user_id="u1")
    target = paths.sandbox_work_dir("t1", user_id="u1") / "too-large.txt"

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        await storage_quota_service.set_user_quota_override(
            db,
            admin_user_id="u1",
            target_user_id="u1",
            backend_quota_bytes=4,
            browser_quota_bytes=None,
        )
        with pytest.raises(HTTPException) as exc_info:
            await storage_quota_service.reserve_thread_file_write(
                db,
                user_id="u1",
                thread_id="t1",
                path=target,
                incoming_bytes=5,
            )

    assert exc_info.value.detail["code"] == "storage_quota_exceeded"
    await close_engine()


@pytest.mark.anyio
async def test_enforce_thread_storage_quota_scans_after_sandbox_command(tmp_path, monkeypatch):
    sf = await _init_db(tmp_path)
    paths = Paths(tmp_path / "files")
    monkeypatch.setattr("app.gateway.storage_quota.get_paths", lambda: paths)
    paths.ensure_thread_dirs("t1", user_id="u1")
    (paths.sandbox_outputs_dir("t1", user_id="u1") / "result.bin").write_bytes(b"12345")

    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        await db.flush()
        await storage_quota_service.set_user_quota_override(
            db,
            admin_user_id="u1",
            target_user_id="u1",
            backend_quota_bytes=4,
            browser_quota_bytes=None,
        )
        with pytest.raises(HTTPException) as exc_info:
            await storage_quota_service.enforce_thread_storage_quota(db, user_id="u1", thread_id="t1")

    assert exc_info.value.detail["code"] == "storage_quota_exceeded"
    assert exc_info.value.detail["used_bytes"] == 5
    await close_engine()


@pytest.mark.anyio
async def test_recalculate_all_task_is_persisted(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="admin-1", email="admin@example.com", password_hash="x", system_role="admin"))
        await db.flush()
        task_id = await storage_quota_service.create_recalculate_all_task(db, created_by="admin-1")
        await db.commit()

    async with sf() as db:
        task = await storage_quota_service.get_recalculate_task(db, task_id=task_id)

    assert task is not None
    assert task["task_id"] == task_id
    assert task["status"] == "pending"
    assert task["created_by"] == "admin-1"
    await close_engine()
