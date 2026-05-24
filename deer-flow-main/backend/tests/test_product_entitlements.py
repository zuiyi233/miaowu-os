import json
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException

from app.gateway.product_entitlements import product_entitlement_service
from app.gateway.storage_quota import storage_quota_service
from deerflow.persistence.engine import close_engine, get_session_factory, init_engine
from deerflow.persistence.run.model import RunRow
from deerflow.persistence.storage_quota.model import UserAgentRunUsageRow, UserProductEntitlementCacheRow
from deerflow.persistence.user.model import UserRow


async def _init_db(tmp_path):
    await close_engine()
    await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path / 'entitlements.db'}", sqlite_dir=str(tmp_path))
    return get_session_factory()


@pytest.mark.anyio
async def test_product_entitlement_falls_back_to_free(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        entitlement = await product_entitlement_service.get_effective_entitlement(db, "u1")

    assert entitlement.plan_key == "free"
    assert entitlement.entitlements["backend_storage_quota_bytes"] == 100 * 1024 * 1024
    assert entitlement.entitlements["max_projects"] == 2
    assert entitlement.entitlements["monthly_agent_runs"] == 30
    await close_engine()


@pytest.mark.anyio
async def test_storage_quota_uses_entitlement_before_system_default(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        db.add(
            UserProductEntitlementCacheRow(
                user_id="u1",
                product_key="novel_product",
                plan_key="creator",
                status="active",
                entitlements_json=json.dumps({"backend_storage_quota_bytes": 2 * 1024 * 1024 * 1024}),
                synced_at=datetime.now(UTC),
            )
        )
        await db.flush()
        quota = await storage_quota_service.get_effective_quota(db, "u1")

    assert quota.backend_quota_bytes == 2 * 1024 * 1024 * 1024
    assert quota.backend_quota_source == "product_entitlement"
    await close_engine()


@pytest.mark.anyio
async def test_user_override_beats_product_entitlement_quota(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        db.add(
            UserProductEntitlementCacheRow(
                user_id="u1",
                product_key="novel_product",
                plan_key="pro",
                status="active",
                entitlements_json=json.dumps({"backend_storage_quota_bytes": 20 * 1024 * 1024 * 1024}),
                synced_at=datetime.now(UTC),
            )
        )
        await db.flush()
        await storage_quota_service.set_user_quota_override(
            db,
            admin_user_id="u1",
            target_user_id="u1",
            backend_quota_bytes=1234,
            browser_quota_bytes=None,
        )
        quota = await storage_quota_service.get_effective_quota(db, "u1")

    assert quota.backend_quota_bytes == 1234
    assert quota.backend_quota_source == "user_override"
    await close_engine()


@pytest.mark.anyio
async def test_monthly_agent_run_limit_blocks_creation(tmp_path):
    sf = await _init_db(tmp_path)
    now = datetime.now(UTC)
    period_start, period_end = product_entitlement_service._month_window(now)
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        db.add(
            UserProductEntitlementCacheRow(
                user_id="u1",
                product_key="novel_product",
                plan_key="free",
                status="active",
                entitlements_json=json.dumps({"monthly_agent_runs": 1, "max_concurrent_runs": 5}),
                synced_at=now,
            )
        )
        db.add(
            UserAgentRunUsageRow(
                user_id="u1",
                period_start=period_start,
                period_end=period_end,
                used_runs=1,
            )
        )
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await product_entitlement_service.ensure_run_create_allowed(db, user_id="u1")

    assert exc_info.value.detail["code"] == "plan_limit_exceeded"
    assert exc_info.value.detail["limit_type"] == "monthly_agent_runs"
    await close_engine()


@pytest.mark.anyio
async def test_concurrent_agent_run_limit_blocks_creation(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        db.add(
            UserProductEntitlementCacheRow(
                user_id="u1",
                product_key="novel_product",
                plan_key="free",
                status="active",
                entitlements_json=json.dumps({"monthly_agent_runs": 10, "max_concurrent_runs": 1}),
                synced_at=datetime.now(UTC),
            )
        )
        db.add(RunRow(run_id="r1", thread_id="t1", user_id="u1", status="running"))
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await product_entitlement_service.ensure_run_create_allowed(db, user_id="u1")

    assert exc_info.value.detail["code"] == "plan_limit_exceeded"
    assert exc_info.value.detail["limit_type"] == "max_concurrent_runs"
    await close_engine()


@pytest.mark.anyio
async def test_public_entitlement_payload_filters_browser_quota(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(
            UserProductEntitlementCacheRow(
                user_id="u1",
                product_key="novel_product",
                plan_key="creator",
                status="active",
                entitlements_json=json.dumps(
                    {
                        "backend_storage_quota_bytes": 2048,
                        "browser_storage_quota_bytes": 4096,
                        "max_projects": 20,
                    }
                ),
                synced_at=datetime.now(UTC),
            )
        )
        await db.flush()
        entitlement = await product_entitlement_service.get_effective_entitlement(db, "u1")

    public = entitlement.public_dict()
    assert public["entitlements"]["backend_storage_quota_bytes"] == 2048
    assert "browser_storage_quota_bytes" not in public["entitlements"]
    await close_engine()


def test_parse_newapi_hub_direct_product_payload_filters_browser_quota():
    entitlement = product_entitlement_service._parse_upstream_payload(
        "u1",
        {
            "success": True,
            "data": {
                "product_key": "novel_product",
                "plan_key": "pro",
                "status": "active",
                "expires_at": 0,
                "source_type": "subscription",
                "source_id": 5,
                "entitlements": {
                    "backend_storage_quota_bytes": 20 * 1024 * 1024 * 1024,
                    "browser_storage_quota_bytes": 100 * 1024 * 1024,
                    "max_projects": 1000,
                    "monthly_agent_runs": 3000,
                    "max_concurrent_runs": 5,
                    "chapter_history_limit": 500,
                    "priority_queue": True,
                    "features": ["advanced_memory", "long_context_planning"],
                },
            },
        },
    )

    assert entitlement.product_key == "novel_product"
    assert entitlement.plan_key == "pro"
    assert entitlement.source == "auth_hub"
    assert entitlement.entitlements["backend_storage_quota_bytes"] == 20 * 1024 * 1024 * 1024
    assert entitlement.entitlements["max_concurrent_runs"] == 5
    public = entitlement.public_dict()
    assert "browser_storage_quota_bytes" not in public["entitlements"]


@pytest.mark.anyio
async def test_project_create_limit_counts_existing_projects(tmp_path):
    sf = await _init_db(tmp_path)
    from app.gateway.novel_migrated.core.database import init_db_schema
    from app.gateway.novel_migrated.models.project import Project

    await init_db_schema()
    async with sf() as db:
        db.add(UserRow(id="u1", email="u1@example.com", password_hash="x"))
        db.add(Project(user_id="u1", title="p1"))
        db.add(Project(user_id="u1", title="p2"))
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await product_entitlement_service.ensure_project_create_allowed_for_user(db, user_id="u1")

    assert exc_info.value.detail["code"] == "plan_limit_exceeded"
    assert exc_info.value.detail["limit_type"] == "max_projects"
    assert exc_info.value.detail["used"] == 2
    await close_engine()


@pytest.mark.anyio
async def test_feature_gate_requires_entitled_feature(tmp_path):
    sf = await _init_db(tmp_path)
    async with sf() as db:
        db.add(
            UserProductEntitlementCacheRow(
                user_id="u1",
                product_key="novel_product",
                plan_key="creator",
                status="active",
                entitlements_json=json.dumps({"features": ["chapter_planning"]}),
                synced_at=datetime.now(UTC),
            )
        )
        await db.flush()
        await product_entitlement_service.require_feature(db, user_id="u1", feature="chapter_planning")
        with pytest.raises(HTTPException) as exc_info:
            await product_entitlement_service.require_feature(db, user_id="u1", feature="long_context_planning")

    assert exc_info.value.detail["code"] == "product_entitlement_required"
    assert exc_info.value.detail["feature"] == "long_context_planning"
    await close_engine()
