from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from deerflow.persistence.engine import close_engine, get_session_factory, init_engine
from deerflow.persistence.user.model import UserRow


async def _init_db(tmp_path):
    await close_engine()
    await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path / 'admin.db'}", sqlite_dir=str(tmp_path))
    return get_session_factory()


@pytest.mark.anyio
async def test_require_admin_user_rejects_regular_user(monkeypatch):
    from app.gateway.routers import admin as admin_router

    async def fake_current_user(_request):
        return SimpleNamespace(id="user-1", system_role="user")

    monkeypatch.setattr(admin_router, "get_current_user_from_request", fake_current_user)

    with pytest.raises(HTTPException) as exc_info:
        await admin_router.require_admin_user(SimpleNamespace())

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Admin role required"


@pytest.mark.anyio
async def test_require_admin_user_allows_admin(monkeypatch):
    from app.gateway.routers import admin as admin_router

    admin_user = SimpleNamespace(id="admin-1", system_role="admin")

    async def fake_current_user(_request):
        return admin_user

    monkeypatch.setattr(admin_router, "get_current_user_from_request", fake_current_user)

    assert await admin_router.require_admin_user(SimpleNamespace()) is admin_user


@pytest.mark.anyio
async def test_recalculate_all_storage_returns_persistent_task(tmp_path, monkeypatch):
    from app.gateway.routers import admin as admin_router

    async def fake_run_task(task_id: str):
        return None

    class _FakeAsyncio:
        @staticmethod
        def create_task(coro):
            coro.close()
            return None

    monkeypatch.setattr(admin_router, "run_recalculate_all_task", fake_run_task)
    monkeypatch.setattr(admin_router, "asyncio", _FakeAsyncio)

    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="admin-1", email="admin@example.com", password_hash="x", system_role="admin"))
        await db.commit()

    async with sf() as db:
        result = await admin_router.recalculate_all_storage(SimpleNamespace(id="admin-1"), db)

    assert result["status"] == "pending"
    assert isinstance(result["task_id"], str)

    async with sf() as db:
        task = await admin_router.get_recalculate_all_status(result["task_id"], SimpleNamespace(id="admin-1"), db)

    assert task["task_id"] == result["task_id"]
    assert task["status"] == "pending"
    assert task["created_by"] == "admin-1"
    await close_engine()


@pytest.mark.anyio
async def test_get_recalculate_all_status_404(tmp_path):
    from app.gateway.routers import admin as admin_router

    sf = await _init_db(tmp_path)

    async with sf() as db:
        with pytest.raises(HTTPException) as exc_info:
            await admin_router.get_recalculate_all_status("missing", SimpleNamespace(id="admin-1"), db)

    assert exc_info.value.status_code == 404
    await close_engine()
