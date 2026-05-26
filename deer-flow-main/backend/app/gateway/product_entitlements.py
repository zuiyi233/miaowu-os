"""Miaowu product entitlement consumption and plan-limit enforcement."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from deerflow.persistence.run.model import RunRow
from deerflow.persistence.storage_quota.model import UserAgentRunUsageRow, UserProductEntitlementCacheRow

logger = logging.getLogger(__name__)

PRODUCT_KEY_NOVEL = "novel_product"
PRODUCT_DISPLAY_NAME = "Miaowu OS 小说创作工作台"

FEATURE_BASIC = [
    "basic_editor",
    "reader",
    "import",
    "basic_export",
    "basic_worldbook",
    "character_info",
]
FEATURE_CREATOR = FEATURE_BASIC + [
    "chapter_history",
    "import_export",
    "relationships",
    "chapter_planning",
    "basic_consistency_check",
]
FEATURE_PRO = FEATURE_CREATOR + [
    "advanced_memory",
    "batch_export",
    "batch_import_export",
    "advanced_planning",
    "consistency_check",
    "character_arc_tracking",
    "priority_queue",
    "long_context_planning",
]

DEFAULT_PLAN_ENTITLEMENTS: dict[str, dict[str, Any]] = {
    "free": {
        "backend_storage_quota_bytes": 100 * 1024 * 1024,
        "vector_memory_quota_bytes": 10 * 1024 * 1024,
        "max_projects": 2,
        "monthly_agent_runs": 30,
        "max_concurrent_runs": 1,
        "chapter_history_limit": 10,
        "priority_queue": False,
        "features": FEATURE_BASIC,
    },
    "creator": {
        "backend_storage_quota_bytes": 2 * 1024 * 1024 * 1024,
        "vector_memory_quota_bytes": 100 * 1024 * 1024,
        "max_projects": 20,
        "monthly_agent_runs": 300,
        "max_concurrent_runs": 2,
        "chapter_history_limit": 100,
        "priority_queue": False,
        "features": FEATURE_CREATOR,
    },
    "pro": {
        "backend_storage_quota_bytes": 20 * 1024 * 1024 * 1024,
        "vector_memory_quota_bytes": 1024 * 1024 * 1024,
        "max_projects": 1000,
        "monthly_agent_runs": 3000,
        "max_concurrent_runs": 5,
        "chapter_history_limit": 500,
        "priority_queue": True,
        "features": FEATURE_PRO,
    },
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _coerce_int(value: Any, default: int) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def _coerce_features(value: Any, default: list[str]) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return list(default)


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.lower() in ("true", "1", "yes")
    return default


_VALID_PLAN_KEYS = {"free", "creator", "pro"}


def _validate_plan_key(raw_key: str) -> str:
    normalized = raw_key.strip().lower()
    return normalized if normalized in _VALID_PLAN_KEYS else "free"


def _normalize_entitlements(raw: dict[str, Any], plan_key: str) -> dict[str, Any]:
    defaults = DEFAULT_PLAN_ENTITLEMENTS.get(plan_key, DEFAULT_PLAN_ENTITLEMENTS["free"])
    return {
        "backend_storage_quota_bytes": _coerce_int(
            raw.get("backend_storage_quota_bytes"),
            defaults["backend_storage_quota_bytes"],
        ),
        "vector_memory_quota_bytes": _coerce_int(
            raw.get("vector_memory_quota_bytes"),
            defaults["vector_memory_quota_bytes"],
        ),
        "max_projects": _coerce_int(raw.get("max_projects"), defaults["max_projects"]),
        "monthly_agent_runs": _coerce_int(raw.get("monthly_agent_runs"), defaults["monthly_agent_runs"]),
        "max_concurrent_runs": _coerce_int(raw.get("max_concurrent_runs"), defaults["max_concurrent_runs"]),
        "chapter_history_limit": _coerce_int(raw.get("chapter_history_limit"), defaults["chapter_history_limit"]),
        "priority_queue": _coerce_bool(raw.get("priority_queue"), defaults["priority_queue"]),
        "features": _coerce_features(raw.get("features"), defaults["features"]),
    }


def _datetime_from_unix(value: Any) -> datetime | None:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return None
    if timestamp <= 0:
        return None
    return datetime.fromtimestamp(timestamp, tz=UTC)


def _datetime_to_unix(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp())


def plan_limit_http_error(*, limit_type: str, limit: int, used: int) -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={
            "code": "plan_limit_exceeded",
            "message": "Plan limit exceeded",
            "limit_type": limit_type,
            "limit": limit,
            "used": used,
        },
    )


def product_entitlement_required_http_error(*, feature: str | None = None) -> HTTPException:
    detail: dict[str, Any] = {
        "code": "product_entitlement_required",
        "message": "Active Miaowu product entitlement is required",
        "product_key": PRODUCT_KEY_NOVEL,
    }
    if feature:
        detail["feature"] = feature
    return HTTPException(status_code=403, detail=detail)


@dataclass(frozen=True)
class ProductEntitlement:
    user_id: str
    product_key: str
    plan_key: str
    status: str
    expires_at: datetime | None
    entitlements: dict[str, Any]
    source_type: str | None = None
    source_id: str | None = None
    synced_at: datetime | None = None
    sync_error: str | None = None
    source: str = "fallback"

    @property
    def is_active(self) -> bool:
        if self.status not in {"active", "fallback", "cached"}:
            return False
        return self.expires_at is None or self.expires_at > _utc_now()

    def public_dict(self, *, include_internal: bool = False) -> dict[str, Any]:
        entitlements = dict(self.entitlements)
        if not include_internal:
            entitlements.pop("browser_storage_quota_bytes", None)
        return {
            "product_key": self.product_key,
            "product_display_name": PRODUCT_DISPLAY_NAME,
            "plan_key": self.plan_key,
            "status": self.status,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "expires_at_unix": _datetime_to_unix(self.expires_at),
            "entitlements": entitlements,
            "source_type": self.source_type,
            "source_id": self.source_id,
            "synced_at": self.synced_at.isoformat() if self.synced_at else None,
            "sync_error": self.sync_error if include_internal else ("sync_failed" if self.sync_error else None),
            "source": self.source,
        }


class ProductEntitlementService:
    """Consumes Auth Hub product entitlements and enforces Miaowu plan limits."""

    def default_entitlement(self, user_id: str, *, sync_error: str | None = None) -> ProductEntitlement:
        return ProductEntitlement(
            user_id=user_id,
            product_key=PRODUCT_KEY_NOVEL,
            plan_key="free",
            status="fallback",
            expires_at=None,
            entitlements=_normalize_entitlements({}, "free"),
            synced_at=None,
            sync_error=sync_error,
            source="fallback",
        )

    def _row_to_entitlement(self, row: UserProductEntitlementCacheRow) -> ProductEntitlement:
        try:
            raw = json.loads(row.entitlements_json or "{}")
        except json.JSONDecodeError:
            raw = {}
        return ProductEntitlement(
            user_id=row.user_id,
            product_key=row.product_key,
            plan_key=row.plan_key or "free",
            status=row.status or "cached",
            expires_at=row.expires_at,
            entitlements=_normalize_entitlements(raw if isinstance(raw, dict) else {}, row.plan_key or "free"),
            source_type=row.source_type,
            source_id=row.source_id,
            synced_at=row.synced_at,
            sync_error=row.sync_error,
            source="cache",
        )

    async def get_cached_entitlement(self, db: AsyncSession, user_id: str) -> ProductEntitlement | None:
        row = await db.get(UserProductEntitlementCacheRow, (user_id, PRODUCT_KEY_NOVEL))
        if row is None:
            return None
        entitlement = self._row_to_entitlement(row)
        if entitlement.is_active:
            return entitlement
        return None

    async def get_effective_entitlement(self, db: AsyncSession, user_id: str) -> ProductEntitlement:
        cached = await self.get_cached_entitlement(db, user_id)
        if cached is not None:
            return cached
        return self.default_entitlement(user_id)

    async def get_backend_storage_quota_bytes(self, db: AsyncSession, user_id: str) -> int | None:
        entitlement = await self.get_effective_entitlement(db, user_id)
        value = entitlement.entitlements.get("backend_storage_quota_bytes")
        return _coerce_int(value, DEFAULT_PLAN_ENTITLEMENTS["free"]["backend_storage_quota_bytes"])

    async def get_vector_memory_quota_bytes(self, db: AsyncSession, user_id: str) -> int:
        entitlement = await self.get_effective_entitlement(db, user_id)
        value = entitlement.entitlements.get("vector_memory_quota_bytes")
        return _coerce_int(value, DEFAULT_PLAN_ENTITLEMENTS["free"]["vector_memory_quota_bytes"])

    def _parse_upstream_payload(self, user_id: str, payload: dict[str, Any]) -> ProductEntitlement:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else payload

        if isinstance(data.get("entitlements"), dict):
            product_key = str(data.get("product_key") or PRODUCT_KEY_NOVEL)
            plan_key = str(data.get("plan_key") or "free").strip().lower() or "free"
            status = str(data.get("status") or "active").strip().lower() or "active"
            expires_at = _datetime_from_unix(data.get("expires_at"))
            return ProductEntitlement(
                user_id=user_id,
                product_key=product_key,
                plan_key=plan_key,
                status=status,
                expires_at=expires_at,
                entitlements=_normalize_entitlements(data["entitlements"], plan_key),
                source_type=str(data.get("source_type")) if data.get("source_type") is not None else None,
                source_id=str(data.get("source_id")) if data.get("source_id") is not None else None,
                synced_at=_utc_now(),
                source="auth_hub",
            )

        items = data.get("items") if isinstance(data, dict) else None
        active_novel = None
        if isinstance(items, list):
            now_ts = int(_utc_now().timestamp())
            for item in items:
                if not isinstance(item, dict) or item.get("product_key") != PRODUCT_KEY_NOVEL:
                    continue
                status_raw = item.get("status")
                expires_raw = item.get("expires_at")
                if status_raw not in {1, "1", "active", "enabled", True}:
                    continue
                try:
                    expires_ts = int(expires_raw or 0)
                except (TypeError, ValueError):
                    expires_ts = 0
                if expires_ts and expires_ts < now_ts:
                    continue
                active_novel = item
                break

        if active_novel is None and data.get("has_novel_product") is not True:
            return self.default_entitlement(user_id, sync_error=None)

        plan_key = "free"
        entitlement_overrides: dict[str, Any] = {}
        if active_novel:
            notes = active_novel.get("notes")
            if isinstance(notes, str) and notes.strip().startswith("{"):
                try:
                    parsed_notes = json.loads(notes)
                    if isinstance(parsed_notes, dict):
                        plan_key = _validate_plan_key(str(parsed_notes.get("plan_key") or plan_key))
                        raw_entitlements = parsed_notes.get("entitlements")
                        if isinstance(raw_entitlements, dict):
                            entitlement_overrides = raw_entitlements
                except json.JSONDecodeError:
                    pass
        return ProductEntitlement(
            user_id=user_id,
            product_key=PRODUCT_KEY_NOVEL,
            plan_key=plan_key,
            status="active",
            expires_at=_datetime_from_unix(active_novel.get("expires_at") if active_novel else None),
            entitlements=_normalize_entitlements(entitlement_overrides, plan_key),
            source_type=str(active_novel.get("source_type")) if active_novel and active_novel.get("source_type") is not None else None,
            source_id=str(active_novel.get("source_id")) if active_novel and active_novel.get("source_id") is not None else None,
            synced_at=_utc_now(),
            source="auth_hub",
        )

    async def _fetch_auth_hub_entitlement(self, *, access_token: str | None) -> dict[str, Any]:
        from app.gateway.auth.newapi_oauth import get_newapi_oauth_settings

        settings = get_newapi_oauth_settings()
        issuer = settings.issuer.rstrip("/")
        if not issuer:
            raise RuntimeError("NEWAPI_OAUTH_ISSUER is not configured")
        token = (
            access_token
            or os.getenv("NEWAPI_HUB_ACCESS_TOKEN")
            or os.getenv("NEWAPI_HUB_SYSTEM_ACCESS_TOKEN")
            or ""
        ).strip()
        if not token:
            raise RuntimeError("NewAPI access token is not available for entitlement sync")
        url = f"{issuer}/api/hub/user/entitlements"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                url,
                params={"product_key": PRODUCT_KEY_NOVEL},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            res.raise_for_status()
            payload = res.json()
            if not isinstance(payload, dict):
                raise RuntimeError("Auth Hub entitlement response is not an object")
            return payload

    async def refresh_from_auth_hub(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        access_token: str | None = None,
    ) -> ProductEntitlement:
        try:
            payload = await self._fetch_auth_hub_entitlement(access_token=access_token)
            entitlement = self._parse_upstream_payload(user_id, payload)
            sync_error = None
        except Exception as exc:
            logger.warning("Failed to refresh entitlements from Auth Hub: %s", exc)
            cached = await self.get_cached_entitlement(db, user_id)
            if cached is not None:
                return ProductEntitlement(
                    **{**cached.__dict__, "sync_error": str(exc), "source": "cache"}
                )
            entitlement = self.default_entitlement(user_id, sync_error=str(exc))
            sync_error = str(exc)

        row = await db.get(UserProductEntitlementCacheRow, (user_id, PRODUCT_KEY_NOVEL))
        now = _utc_now()
        if row is None:
            row = UserProductEntitlementCacheRow(user_id=user_id, product_key=PRODUCT_KEY_NOVEL)
            db.add(row)
        row.plan_key = entitlement.plan_key
        row.status = entitlement.status
        row.expires_at = entitlement.expires_at
        row.entitlements_json = json.dumps(entitlement.entitlements, ensure_ascii=False, sort_keys=True)
        row.source_type = entitlement.source_type
        row.source_id = entitlement.source_id
        row.synced_at = now
        row.sync_error = sync_error
        row.updated_at = now
        await db.flush()
        return self._row_to_entitlement(row)

    def _month_window(self, now: datetime | None = None) -> tuple[datetime, datetime]:
        current = now or _utc_now()
        if current.tzinfo is None:
            current = current.replace(tzinfo=UTC)
        start = current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
        return start, end

    async def get_current_agent_run_usage(self, db: AsyncSession, user_id: str) -> dict[str, Any]:
        period_start, period_end = self._month_window()
        row = (
            await db.execute(
                select(UserAgentRunUsageRow).where(
                    UserAgentRunUsageRow.user_id == user_id,
                    UserAgentRunUsageRow.period_start == period_start,
                    UserAgentRunUsageRow.period_end == period_end,
                )
            )
        ).scalar_one_or_none()
        return {
            "used_runs": int(row.used_runs) if row else 0,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
        }

    async def increment_agent_run_usage(self, db: AsyncSession, user_id: str) -> dict[str, Any]:
        period_start, period_end = self._month_window()
        row = (
            await db.execute(
                select(UserAgentRunUsageRow).where(
                    UserAgentRunUsageRow.user_id == user_id,
                    UserAgentRunUsageRow.period_start == period_start,
                    UserAgentRunUsageRow.period_end == period_end,
                )
            )
        ).scalar_one_or_none()
        if row is None:
            row = UserAgentRunUsageRow(
                user_id=user_id,
                period_start=period_start,
                period_end=period_end,
                used_runs=0,
            )
            db.add(row)
        row.used_runs = int(row.used_runs or 0) + 1
        row.updated_at = _utc_now()
        await db.flush()
        return {
            "used_runs": int(row.used_runs),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
        }

    async def count_active_runs(self, db: AsyncSession, user_id: str) -> int:
        return int(
            await db.scalar(
                select(func.count())
                .select_from(RunRow)
                .where(
                    RunRow.user_id == user_id,
                    RunRow.status.in_(("pending", "running")),
                )
            )
            or 0
        )

    async def count_projects(self, db: AsyncSession, user_id: str) -> int:
        from app.gateway.novel_migrated.models.project import Project

        return int(
            await db.scalar(select(func.count(Project.id)).where(Project.user_id == user_id))
            or 0
        )

    async def ensure_project_create_allowed(self, db: AsyncSession, *, user_id: str, current_count: int) -> None:
        entitlement = await self.get_effective_entitlement(db, user_id)
        limit = _coerce_int(entitlement.entitlements.get("max_projects"), DEFAULT_PLAN_ENTITLEMENTS["free"]["max_projects"])
        if current_count >= limit:
            raise plan_limit_http_error(limit_type="max_projects", limit=limit, used=current_count)

    async def ensure_project_create_allowed_for_user(self, db: AsyncSession, *, user_id: str) -> None:
        current_count = await self.count_projects(db, user_id)
        await self.ensure_project_create_allowed(db, user_id=user_id, current_count=current_count)

    async def ensure_run_create_allowed(self, db: AsyncSession, *, user_id: str) -> None:
        entitlement = await self.get_effective_entitlement(db, user_id)
        monthly_limit = _coerce_int(
            entitlement.entitlements.get("monthly_agent_runs"),
            DEFAULT_PLAN_ENTITLEMENTS["free"]["monthly_agent_runs"],
        )
        monthly_usage = await self.get_current_agent_run_usage(db, user_id)
        if monthly_usage["used_runs"] >= monthly_limit:
            raise plan_limit_http_error(
                limit_type="monthly_agent_runs",
                limit=monthly_limit,
                used=monthly_usage["used_runs"],
            )

        concurrent_limit = _coerce_int(
            entitlement.entitlements.get("max_concurrent_runs"),
            DEFAULT_PLAN_ENTITLEMENTS["free"]["max_concurrent_runs"],
        )
        active_runs = await self.count_active_runs(db, user_id)
        if active_runs >= concurrent_limit:
            raise plan_limit_http_error(
                limit_type="max_concurrent_runs",
                limit=concurrent_limit,
                used=active_runs,
            )

    async def require_feature(self, db: AsyncSession, *, user_id: str, feature: str) -> None:
        entitlement = await self.get_effective_entitlement(db, user_id)
        features = set(_coerce_features(entitlement.entitlements.get("features"), []))
        if feature not in features:
            raise product_entitlement_required_http_error(feature=feature)

    async def account_payload(self, db: AsyncSession, *, user_id: str, storage_usage: dict[str, Any]) -> dict[str, Any]:
        entitlement = await self.get_effective_entitlement(db, user_id)
        run_usage = await self.get_current_agent_run_usage(db, user_id)
        project_count = await self.count_projects(db, user_id)
        entitlements = entitlement.public_dict()["entitlements"]
        return {
            "product": entitlement.public_dict(),
            "usage": {
                "backend_storage": storage_usage.get("backend", {}),
                "projects": {
                    "used": project_count,
                    "limit": _coerce_int(entitlements.get("max_projects"), DEFAULT_PLAN_ENTITLEMENTS["free"]["max_projects"]),
                },
                "agent_runs": {
                    **run_usage,
                    "limit": _coerce_int(entitlements.get("monthly_agent_runs"), DEFAULT_PLAN_ENTITLEMENTS["free"]["monthly_agent_runs"]),
                },
                "max_concurrent_runs": _coerce_int(entitlements.get("max_concurrent_runs"), DEFAULT_PLAN_ENTITLEMENTS["free"]["max_concurrent_runs"]),
            },
            "upgrade_url": (lambda u: u if u.startswith("https://") else "")(os.getenv("MIAOWU_PRODUCT_UPGRADE_URL") or ""),
        }


product_entitlement_service = ProductEntitlementService()
