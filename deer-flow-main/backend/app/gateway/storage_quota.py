"""Account storage quota services shared by gateway and novel APIs."""

from __future__ import annotations

import os
import asyncio
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from deerflow.persistence.storage_quota.model import (
    AdminAuditLogRow,
    StorageRecalculateTaskRow,
    SystemSettingRow,
    UserQuotaOverrideRow,
    UserStorageObjectRow,
    UserStorageUsageRow,
)
from deerflow.persistence.user.model import UserRow
from deerflow.config.paths import get_paths
from deerflow.persistence.engine import get_session_factory
from app.gateway.product_entitlements import product_entitlement_service

DEFAULT_STORAGE_QUOTA_BYTES = 100 * 1024 * 1024
BACKEND_QUOTA_BYTES_KEY = "backend_storage_quota_bytes"
BROWSER_QUOTA_BYTES_KEY = "browser_storage_quota_bytes"
BACKEND_QUOTA_ENABLED_KEY = "backend_storage_quota_enabled"
BROWSER_QUOTA_ENABLED_KEY = "browser_storage_quota_enabled"

DEFAULT_SYSTEM_SETTINGS: dict[str, tuple[str, str]] = {
    BACKEND_QUOTA_BYTES_KEY: (str(DEFAULT_STORAGE_QUOTA_BYTES), "int"),
    BROWSER_QUOTA_BYTES_KEY: (str(DEFAULT_STORAGE_QUOTA_BYTES), "int"),
    BACKEND_QUOTA_ENABLED_KEY: ("true", "bool"),
    BROWSER_QUOTA_ENABLED_KEY: ("true", "bool"),
}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_int(value: str | None, default: int) -> int:
    try:
        parsed = int(value) if value is not None else default
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


def quota_http_error(*, used_bytes: int, quota_bytes: int, incoming_bytes: int) -> HTTPException:
    return HTTPException(
        status_code=413,
        detail={
            "code": "storage_quota_exceeded",
            "message": "Storage quota exceeded",
            "quota_bytes": quota_bytes,
            "used_bytes": used_bytes,
            "incoming_bytes": incoming_bytes,
            "remaining_bytes": max(0, quota_bytes - used_bytes),
        },
    )


def quota_not_initialized_http_error(*, user_id: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "storage_quota_not_initialized",
            "message": "Storage quota usage is not initialized",
            "user_id": user_id,
        },
    )


@dataclass(frozen=True)
class EffectiveQuota:
    backend_quota_bytes: int
    browser_quota_bytes: int
    backend_quota_enabled: bool
    browser_quota_enabled: bool
    backend_quota_source: str
    browser_quota_source: str


@dataclass(frozen=True)
class StorageReservation:
    user_id: str
    source: str
    resource_id: str
    incoming_bytes: int
    previous_bytes: int
    delta_bytes: int
    quota: EffectiveQuota


class StorageQuotaService:
    """Enforces backend storage quota and tracks controlled objects."""

    async def ensure_default_settings(self, db: AsyncSession, *, updated_by: str | None = None) -> None:
        changed = False
        for key, (value, value_type) in DEFAULT_SYSTEM_SETTINGS.items():
            existing = await db.get(SystemSettingRow, key)
            if existing is not None:
                continue
            db.add(SystemSettingRow(key=key, value=value, value_type=value_type, updated_by=updated_by))
            changed = True
        if changed:
            await db.flush()

    async def get_system_settings(self, db: AsyncSession) -> dict[str, Any]:
        await self.ensure_default_settings(db)
        rows = (await db.execute(select(SystemSettingRow))).scalars().all()
        raw = {row.key: row.value for row in rows}
        updated_at = max((row.updated_at for row in rows), default=None)
        return {
            "backend_storage_quota_bytes": _parse_int(raw.get(BACKEND_QUOTA_BYTES_KEY), DEFAULT_STORAGE_QUOTA_BYTES),
            "browser_storage_quota_bytes": _parse_int(raw.get(BROWSER_QUOTA_BYTES_KEY), DEFAULT_STORAGE_QUOTA_BYTES),
            "backend_storage_quota_enabled": _parse_bool(raw.get(BACKEND_QUOTA_ENABLED_KEY), True),
            "browser_storage_quota_enabled": _parse_bool(raw.get(BROWSER_QUOTA_ENABLED_KEY), True),
            "updated_at": updated_at.isoformat() if updated_at else None,
        }

    async def update_system_settings(
        self,
        db: AsyncSession,
        *,
        admin_user_id: str,
        values: dict[str, int | bool],
    ) -> dict[str, Any]:
        await self.ensure_default_settings(db, updated_by=admin_user_id)
        for key, value in values.items():
            if key not in DEFAULT_SYSTEM_SETTINGS:
                continue
            row = await db.get(SystemSettingRow, key)
            if row is None:
                default_value, value_type = DEFAULT_SYSTEM_SETTINGS[key]
                row = SystemSettingRow(key=key, value=default_value, value_type=value_type)
                db.add(row)
            old_value = row.value
            new_value = "true" if isinstance(value, bool) and value else "false" if isinstance(value, bool) else str(max(0, int(value)))
            if old_value == new_value:
                continue
            row.value = new_value
            row.value_type = "bool" if isinstance(value, bool) else "int"
            row.updated_by = admin_user_id
            row.updated_at = _utc_now()
            db.add(
                AdminAuditLogRow(
                    admin_user_id=admin_user_id,
                    target_user_id=None,
                    action="update_system_settings",
                    field=key,
                    old_value=old_value,
                    new_value=new_value,
                )
            )
        await db.flush()
        return await self.get_system_settings(db)

    async def get_effective_quota(self, db: AsyncSession, user_id: str) -> EffectiveQuota:
        settings = await self.get_system_settings(db)
        override = await db.get(UserQuotaOverrideRow, user_id)
        backend_quota = settings["backend_storage_quota_bytes"]
        browser_quota = settings["browser_storage_quota_bytes"]
        backend_source = "system"
        browser_source = "system"
        entitlement_backend_quota = await product_entitlement_service.get_backend_storage_quota_bytes(db, user_id)
        if entitlement_backend_quota is not None:
            backend_quota = entitlement_backend_quota
            backend_source = "product_entitlement"
        if override and override.backend_quota_bytes is not None:
            backend_quota = max(0, int(override.backend_quota_bytes))
            backend_source = "user_override"
        if override and override.browser_quota_bytes is not None:
            browser_quota = max(0, int(override.browser_quota_bytes))
            browser_source = "user_override"
        return EffectiveQuota(
            backend_quota_bytes=backend_quota,
            browser_quota_bytes=browser_quota,
            backend_quota_enabled=bool(settings["backend_storage_quota_enabled"]),
            browser_quota_enabled=bool(settings["browser_storage_quota_enabled"]),
            backend_quota_source=backend_source,
            browser_quota_source=browser_source,
        )

    async def ensure_usage_row(self, db: AsyncSession, user_id: str) -> UserStorageUsageRow:
        row = await db.get(UserStorageUsageRow, user_id)
        if row is None:
            quota = await self.get_effective_quota(db, user_id)
            row = UserStorageUsageRow(user_id=user_id, used_bytes=0, quota_bytes=quota.backend_quota_bytes)
            db.add(row)
            await db.flush()
        return row

    async def reserve(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        source: str,
        resource_id: str,
        incoming_bytes: int,
    ) -> StorageReservation:
        incoming = max(0, int(incoming_bytes))
        await self._raise_if_usage_not_initialized(db, user_id=user_id)
        quota = await self.get_effective_quota(db, user_id)
        usage = await self.ensure_usage_row(db, user_id)
        usage.quota_bytes = quota.backend_quota_bytes

        existing = (
            await db.execute(
                select(UserStorageObjectRow).where(
                    UserStorageObjectRow.user_id == user_id,
                    UserStorageObjectRow.source == source,
                    UserStorageObjectRow.resource_id == resource_id,
                    UserStorageObjectRow.status == "active",
                )
            )
        ).scalar_one_or_none()
        previous = int(existing.size_bytes) if existing else 0
        delta = max(0, incoming - previous)
        if quota.backend_quota_enabled and usage.used_bytes + delta > quota.backend_quota_bytes:
            raise quota_http_error(
                used_bytes=int(usage.used_bytes),
                quota_bytes=quota.backend_quota_bytes,
                incoming_bytes=delta,
            )
        return StorageReservation(
            user_id=user_id,
            source=source,
            resource_id=resource_id,
            incoming_bytes=incoming,
            previous_bytes=previous,
            delta_bytes=delta,
            quota=quota,
        )

    async def commit_reservation(
        self,
        db: AsyncSession,
        reservation: StorageReservation,
        *,
        storage_path: str | None = None,
        content_hash: str | None = None,
    ) -> None:
        usage = await self.ensure_usage_row(db, reservation.user_id)
        obj = (
            await db.execute(
                select(UserStorageObjectRow).where(
                    UserStorageObjectRow.user_id == reservation.user_id,
                    UserStorageObjectRow.source == reservation.source,
                    UserStorageObjectRow.resource_id == reservation.resource_id,
                )
            )
        ).scalar_one_or_none()
        if obj is None:
            obj = UserStorageObjectRow(
                user_id=reservation.user_id,
                source=reservation.source,
                resource_id=reservation.resource_id,
            )
            db.add(obj)
        old_size = int(obj.size_bytes or 0) if obj.status == "active" else 0
        obj.size_bytes = reservation.incoming_bytes
        obj.status = "active"
        obj.storage_path = storage_path
        obj.content_hash = content_hash
        obj.client_reported = False
        obj.updated_at = _utc_now()
        usage.used_bytes = max(0, int(usage.used_bytes or 0) + reservation.incoming_bytes - old_size)
        usage.quota_bytes = reservation.quota.backend_quota_bytes
        usage.updated_at = _utc_now()
        await db.flush()

    async def release_object(self, db: AsyncSession, *, user_id: str, source: str, resource_id: str) -> int:
        obj = (
            await db.execute(
                select(UserStorageObjectRow).where(
                    UserStorageObjectRow.user_id == user_id,
                    UserStorageObjectRow.source == source,
                    UserStorageObjectRow.resource_id == resource_id,
                    UserStorageObjectRow.status == "active",
                )
            )
        ).scalar_one_or_none()
        if obj is None:
            return 0
        released = int(obj.size_bytes or 0)
        obj.status = "deleted"
        obj.updated_at = _utc_now()
        usage = await self.ensure_usage_row(db, user_id)
        usage.used_bytes = max(0, int(usage.used_bytes or 0) - released)
        usage.updated_at = _utc_now()
        await db.flush()
        return released

    async def release_by_prefix(self, db: AsyncSession, *, user_id: str, source_prefix: str, resource_prefix: str) -> int:
        rows = (
            await db.execute(
                select(UserStorageObjectRow).where(
                    UserStorageObjectRow.user_id == user_id,
                    UserStorageObjectRow.source.like(f"{source_prefix}%"),
                    UserStorageObjectRow.resource_id.like(f"{resource_prefix}%"),
                    UserStorageObjectRow.status == "active",
                )
            )
        ).scalars().all()
        released = 0
        for obj in rows:
            released += int(obj.size_bytes or 0)
            obj.status = "deleted"
            obj.updated_at = _utc_now()
        if rows:
            usage = await self.ensure_usage_row(db, user_id)
            usage.used_bytes = max(0, int(usage.used_bytes or 0) - released)
            usage.updated_at = _utc_now()
            await db.flush()
        return released

    async def upsert_tracked_object(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        source: str,
        resource_id: str,
        size_bytes: int,
        storage_path: str | None = None,
        content_hash: str | None = None,
        client_reported: bool = False,
    ) -> None:
        obj = (
            await db.execute(
                select(UserStorageObjectRow).where(
                    UserStorageObjectRow.user_id == user_id,
                    UserStorageObjectRow.source == source,
                    UserStorageObjectRow.resource_id == resource_id,
                )
            )
        ).scalar_one_or_none()
        if obj is None:
            obj = UserStorageObjectRow(
                user_id=user_id,
                source=source,
                resource_id=resource_id,
            )
            db.add(obj)
        obj.size_bytes = max(0, int(size_bytes))
        obj.status = "active"
        obj.storage_path = storage_path
        obj.content_hash = content_hash
        obj.client_reported = client_reported
        obj.updated_at = _utc_now()
        await db.flush()

    async def _refresh_usage_from_objects(self, db: AsyncSession, *, user_id: str) -> dict[str, Any]:
        total = (
            await db.execute(
                select(func.coalesce(func.sum(UserStorageObjectRow.size_bytes), 0)).where(
                    UserStorageObjectRow.user_id == user_id,
                    UserStorageObjectRow.status == "active",
                    UserStorageObjectRow.client_reported.is_(False),
                )
            )
        ).scalar_one()
        usage = await self.ensure_usage_row(db, user_id)
        quota = await self.get_effective_quota(db, user_id)
        usage.used_bytes = int(total or 0)
        usage.quota_bytes = quota.backend_quota_bytes
        usage.recalculated_at = _utc_now()
        usage.updated_at = _utc_now()
        await db.flush()
        return await self.get_account_usage(db, user_id)

    @staticmethod
    def _iter_files(root: Path):
        if not root.exists():
            return
        for path in root.rglob("*"):
            if path.is_file():
                yield path

    async def _has_active_objects(self, db: AsyncSession, *, user_id: str) -> bool:
        count = (
            await db.execute(
                select(func.count()).select_from(UserStorageObjectRow).where(
                    UserStorageObjectRow.user_id == user_id,
                    UserStorageObjectRow.status == "active",
                    UserStorageObjectRow.client_reported.is_(False),
                )
            )
        ).scalar_one()
        return int(count or 0) > 0

    def _has_backend_files(self, *, user_id: str) -> bool:
        paths = get_paths()
        user_dir = paths.user_dir(user_id)
        return any(self._iter_files(user_dir) or [])

    async def _raise_if_usage_not_initialized(self, db: AsyncSession, *, user_id: str) -> None:
        usage = await db.get(UserStorageUsageRow, user_id)
        if usage is not None and usage.recalculated_at is not None:
            return
        if await self._has_active_objects(db, user_id=user_id):
            return
        if self._has_backend_files(user_id=user_id):
            raise quota_not_initialized_http_error(user_id=user_id)

    @staticmethod
    def _relative_id(prefix: str, root: Path, path: Path) -> str:
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:
            rel = path.name
        return f"{prefix}:{rel}"

    async def scan_thread_storage(self, db: AsyncSession, *, user_id: str, thread_id: str) -> dict[str, Any]:
        """Scan a user-scoped thread directory and register generated files."""
        paths = get_paths()
        roots: list[tuple[str, str, Path]] = [
            ("thread_workspace", f"{thread_id}:workspace", paths.sandbox_work_dir(thread_id, user_id=user_id)),
            ("thread_upload", f"{thread_id}:uploads", paths.sandbox_uploads_dir(thread_id, user_id=user_id)),
            ("thread_output", f"{thread_id}:outputs", paths.sandbox_outputs_dir(thread_id, user_id=user_id)),
            ("thread_artifact", f"{thread_id}:acp-workspace", paths.acp_workspace_dir(thread_id, user_id=user_id)),
            ("draft_media", f"{thread_id}:draft-media", paths.thread_dir(thread_id, user_id=user_id) / "draft-media"),
        ]
        for source, resource_prefix, root in roots:
            await self.release_by_prefix(db, user_id=user_id, source_prefix=source, resource_prefix=resource_prefix)
            for path in self._iter_files(root) or []:
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                await self.upsert_tracked_object(
                    db,
                    user_id=user_id,
                    source=source,
                    resource_id=self._relative_id(resource_prefix, root, path),
                    size_bytes=size,
                    storage_path=str(path),
                )
        return await self._refresh_usage_from_objects(db, user_id=user_id)

    def _thread_resource_for_path(self, *, user_id: str, thread_id: str, path: Path) -> tuple[str, str] | None:
        paths = get_paths()
        roots: list[tuple[str, str, Path]] = [
            ("thread_workspace", f"{thread_id}:workspace", paths.sandbox_work_dir(thread_id, user_id=user_id)),
            ("thread_upload", f"{thread_id}:uploads", paths.sandbox_uploads_dir(thread_id, user_id=user_id)),
            ("thread_output", f"{thread_id}:outputs", paths.sandbox_outputs_dir(thread_id, user_id=user_id)),
            ("thread_artifact", f"{thread_id}:acp-workspace", paths.acp_workspace_dir(thread_id, user_id=user_id)),
            ("draft_media", f"{thread_id}:draft-media", paths.thread_dir(thread_id, user_id=user_id) / "draft-media"),
        ]
        resolved_path = path.resolve()
        for source, resource_prefix, root in roots:
            resolved_root = root.resolve()
            try:
                resolved_path.relative_to(resolved_root)
            except ValueError:
                continue
            return source, self._relative_id(resource_prefix, resolved_root, resolved_path)
        return None

    async def reserve_thread_file_write(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        thread_id: str,
        path: Path,
        incoming_bytes: int,
    ) -> StorageReservation | None:
        resource = self._thread_resource_for_path(user_id=user_id, thread_id=thread_id, path=path)
        if resource is None:
            return None
        source, resource_id = resource
        return await self.reserve(
            db,
            user_id=user_id,
            source=source,
            resource_id=resource_id,
            incoming_bytes=incoming_bytes,
        )

    async def commit_thread_file_write(
        self,
        db: AsyncSession,
        reservation: StorageReservation | None,
        *,
        path: Path,
    ) -> None:
        if reservation is None:
            return
        try:
            actual_size = path.stat().st_size
        except OSError:
            actual_size = reservation.incoming_bytes
        actual = StorageReservation(
            user_id=reservation.user_id,
            source=reservation.source,
            resource_id=reservation.resource_id,
            incoming_bytes=actual_size,
            previous_bytes=reservation.previous_bytes,
            delta_bytes=max(0, actual_size - reservation.previous_bytes),
            quota=reservation.quota,
        )
        await self.commit_reservation(db, actual, storage_path=str(path))

    async def enforce_thread_storage_quota(self, db: AsyncSession, *, user_id: str, thread_id: str) -> dict[str, Any]:
        usage = await self.scan_thread_storage(db, user_id=user_id, thread_id=thread_id)
        quota = await self.get_effective_quota(db, user_id)
        used = int(usage["backend"]["used_bytes"])
        if quota.backend_quota_enabled and used > quota.backend_quota_bytes:
            raise quota_http_error(
                used_bytes=used,
                quota_bytes=quota.backend_quota_bytes,
                incoming_bytes=max(0, used - quota.backend_quota_bytes),
            )
        return usage

    async def scan_user_storage(self, db: AsyncSession, *, user_id: str) -> dict[str, Any]:
        """Scan all app-controlled backend files for a user and refresh usage."""
        paths = get_paths()
        user_dir = paths.user_dir(user_id)
        thread_root = user_dir / "threads"
        if thread_root.exists():
            for thread_dir in thread_root.iterdir():
                if thread_dir.is_dir():
                    await self.scan_thread_storage(db, user_id=user_id, thread_id=thread_dir.name)

        roots: list[tuple[str, str, Path]] = [
            ("agent_file", "agents", paths.user_agents_dir(user_id)),
            ("agent_memory", "agents", paths.user_agents_dir(user_id)),
            ("user_memory", "memory", paths.user_memory_file(user_id).parent),
            ("user_profile", "profile", paths.user_profile_file(user_id).parent),
            ("media_asset", "media-assets", user_dir / "media-assets"),
        ]
        for source, resource_prefix, root in roots:
            await self.release_by_prefix(db, user_id=user_id, source_prefix=source, resource_prefix=resource_prefix)
            for path in self._iter_files(root) or []:
                if source == "agent_file" and path.name == "memory.json":
                    continue
                if source == "agent_memory" and path.name != "memory.json":
                    continue
                if source == "user_memory" and path != paths.user_memory_file(user_id):
                    continue
                if source == "user_profile" and path != paths.user_profile_file(user_id):
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                await self.upsert_tracked_object(
                    db,
                    user_id=user_id,
                    source=source,
                    resource_id=self._relative_id(resource_prefix, root, path),
                    size_bytes=size,
                    storage_path=str(path),
                )
        return await self._refresh_usage_from_objects(db, user_id=user_id)

    async def report_browser_usage(self, db: AsyncSession, *, user_id: str, used_bytes: int) -> dict[str, Any]:
        usage = await self.ensure_usage_row(db, user_id)
        usage.browser_reported_used_bytes = max(0, int(used_bytes))
        usage.browser_reported_at = _utc_now()
        await db.flush()
        return await self.get_account_usage(db, user_id)

    async def get_account_usage(self, db: AsyncSession, user_id: str) -> dict[str, Any]:
        quota = await self.get_effective_quota(db, user_id)
        usage = await self.ensure_usage_row(db, user_id)
        return {
            "backend": {
                "used_bytes": int(usage.used_bytes or 0),
                "quota_bytes": quota.backend_quota_bytes,
                "remaining_bytes": max(0, quota.backend_quota_bytes - int(usage.used_bytes or 0)),
                "enabled": quota.backend_quota_enabled,
                "quota_source": quota.backend_quota_source,
                "recalculated_at": usage.recalculated_at.isoformat() if usage.recalculated_at else None,
            },
            "browser": {
                "reported_used_bytes": int(usage.browser_reported_used_bytes or 0),
                "quota_bytes": quota.browser_quota_bytes,
                "remaining_bytes": max(0, quota.browser_quota_bytes - int(usage.browser_reported_used_bytes or 0)),
                "enabled": quota.browser_quota_enabled,
                "quota_source": quota.browser_quota_source,
                "reported_at": usage.browser_reported_at.isoformat() if usage.browser_reported_at else None,
                "client_reported": True,
            },
        }

    async def set_user_quota_override(
        self,
        db: AsyncSession,
        *,
        admin_user_id: str,
        target_user_id: str,
        backend_quota_bytes: int | None,
        browser_quota_bytes: int | None,
    ) -> dict[str, Any]:
        row = await db.get(UserQuotaOverrideRow, target_user_id)
        if row is None:
            row = UserQuotaOverrideRow(user_id=target_user_id)
            db.add(row)
        changes = {
            "backend_quota_bytes": backend_quota_bytes,
            "browser_quota_bytes": browser_quota_bytes,
        }
        for field, value in changes.items():
            old = getattr(row, field)
            normalized = None if value is None else max(0, int(value))
            if old == normalized:
                continue
            setattr(row, field, normalized)
            db.add(
                AdminAuditLogRow(
                    admin_user_id=admin_user_id,
                    target_user_id=target_user_id,
                    action="update_user_quota",
                    field=field,
                    old_value=None if old is None else str(old),
                    new_value=None if normalized is None else str(normalized),
                )
            )
        row.updated_by = admin_user_id
        row.updated_at = _utc_now()
        usage = await self.ensure_usage_row(db, target_user_id)
        quota = await self.get_effective_quota(db, target_user_id)
        usage.quota_bytes = quota.backend_quota_bytes
        await db.flush()
        return await self.get_account_usage(db, target_user_id)

    async def list_admin_users(self, db: AsyncSession, *, search: str | None = None, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        stmt = select(UserRow).order_by(UserRow.created_at.desc()).limit(max(1, min(limit, 500))).offset(max(0, offset))
        if search:
            stmt = stmt.where(UserRow.email.contains(search))
        users = (await db.execute(stmt)).scalars().all()
        result: list[dict[str, Any]] = []
        for user in users:
            usage = await self.get_account_usage(db, user.id)
            result.append(
                {
                    "id": user.id,
                    "email": user.email,
                    "system_role": user.system_role,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "backend_used_bytes": usage["backend"]["used_bytes"],
                    "backend_quota_bytes": usage["backend"]["quota_bytes"],
                    "backend_quota_source": usage["backend"]["quota_source"],
                    "browser_reported_used_bytes": usage["browser"]["reported_used_bytes"],
                    "browser_quota_bytes": usage["browser"]["quota_bytes"],
                    "browser_quota_source": usage["browser"]["quota_source"],
                    "browser_reported_at": usage["browser"]["reported_at"],
                }
            )
        return result

    async def recalculate_user(self, db: AsyncSession, *, user_id: str) -> dict[str, Any]:
        return await self.scan_user_storage(db, user_id=user_id)

    async def recalculate_all(self, db: AsyncSession) -> dict[str, Any]:
        user_ids = (await db.execute(select(UserRow.id))).scalars().all()
        count = 0
        for user_id in user_ids:
            await self.recalculate_user(db, user_id=user_id)
            count += 1
        return {"status": "completed", "users_recalculated": count, "completed_at": _utc_now().isoformat()}

    async def storage_overview(self, db: AsyncSession) -> dict[str, Any]:
        total = (
            await db.execute(
                select(func.coalesce(func.sum(UserStorageUsageRow.used_bytes), 0))
            )
        ).scalar_one()
        active_objects = (
            await db.execute(
                select(func.count()).select_from(UserStorageObjectRow).where(UserStorageObjectRow.status == "active")
            )
        ).scalar_one()
        deleted_objects = (
            await db.execute(
                select(func.count()).select_from(UserStorageObjectRow).where(UserStorageObjectRow.status == "deleted")
            )
        ).scalar_one()
        users = await self.list_admin_users(db, limit=500)
        over_quota = [user for user in users if user["backend_used_bytes"] > user["backend_quota_bytes"]]
        return {
            "total_backend_used_bytes": int(total or 0),
            "active_object_count": int(active_objects or 0),
            "deleted_object_count": int(deleted_objects or 0),
            "over_quota_users": over_quota,
            "orphan_object_count": 0,
        }

    async def list_audit_logs(self, db: AsyncSession, *, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
        rows = (
            await db.execute(
                select(AdminAuditLogRow)
                .order_by(AdminAuditLogRow.created_at.desc())
                .limit(max(1, min(limit, 500)))
                .offset(max(0, offset))
            )
        ).scalars().all()
        return [
            {
                "id": row.id,
                "admin_user_id": row.admin_user_id,
                "target_user_id": row.target_user_id,
                "action": row.action,
                "field": row.field,
                "old_value": row.old_value,
                "new_value": row.new_value,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]

    async def create_recalculate_all_task(self, db: AsyncSession, *, created_by: str | None = None) -> str:
        task_id = uuid.uuid4().hex
        db.add(
            StorageRecalculateTaskRow(
                task_id=task_id,
                status="pending",
                users_recalculated=0,
                created_by=created_by,
            )
        )
        await db.flush()
        return task_id

    async def update_recalculate_task(
        self,
        db: AsyncSession,
        *,
        task_id: str,
        status: str,
        users_recalculated: int | None = None,
        error: str | None = None,
        result: dict[str, Any] | None = None,
        started: bool = False,
        completed: bool = False,
    ) -> None:
        task = await db.get(StorageRecalculateTaskRow, task_id)
        if task is None:
            return
        task.status = status
        if users_recalculated is not None:
            task.users_recalculated = max(0, int(users_recalculated))
        task.error = error
        if result is not None:
            task.result_json = json.dumps(result, ensure_ascii=False)
        now = _utc_now()
        if started and task.started_at is None:
            task.started_at = now
        if completed:
            task.completed_at = now
        task.updated_at = now
        await db.flush()

    async def get_recalculate_task(self, db: AsyncSession, *, task_id: str) -> dict[str, Any] | None:
        task = await db.get(StorageRecalculateTaskRow, task_id)
        if task is None:
            return None
        result = None
        if task.result_json:
            try:
                result = json.loads(task.result_json)
            except json.JSONDecodeError:
                result = None
        payload: dict[str, Any] = {
            "task_id": task.task_id,
            "status": task.status,
            "users_recalculated": int(task.users_recalculated or 0),
            "error": task.error,
            "created_by": task.created_by,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        }
        if result is not None:
            payload.update(result)
        return payload

    async def track_existing_file(
        self,
        db: AsyncSession,
        *,
        user_id: str,
        source: str,
        resource_id: str,
        path: Path,
    ) -> None:
        try:
            size = os.path.getsize(path)
        except OSError:
            size = 0
        reservation = await self.reserve(db, user_id=user_id, source=source, resource_id=resource_id, incoming_bytes=size)
        await self.commit_reservation(db, reservation, storage_path=str(path))


storage_quota_service = StorageQuotaService()


async def create_recalculate_all_task(db: AsyncSession, *, created_by: str | None = None) -> str:
    return await storage_quota_service.create_recalculate_all_task(db, created_by=created_by)


async def run_recalculate_all_task(task_id: str) -> None:
    sf = get_session_factory()
    if sf is None:
        return
    try:
        async with sf() as db:
            await storage_quota_service.update_recalculate_task(
                db,
                task_id=task_id,
                status="running",
                started=True,
            )
            await db.commit()
        async with sf() as db:
            result = await storage_quota_service.recalculate_all(db)
            await storage_quota_service.update_recalculate_task(
                db,
                task_id=task_id,
                status="completed",
                users_recalculated=int(result.get("users_recalculated", 0)),
                result=result,
                completed=True,
            )
            await db.commit()
    except Exception as exc:
        async with sf() as db:
            await storage_quota_service.update_recalculate_task(
                db,
                task_id=task_id,
                status="error",
                error=str(exc),
                completed=True,
            )
            await db.commit()


async def get_recalculate_task(db: AsyncSession, *, task_id: str) -> dict[str, Any] | None:
    return await storage_quota_service.get_recalculate_task(db, task_id=task_id)


async def _reserve_file_bytes(
    *,
    user_id: str,
    source: str,
    resource_id: str,
    incoming_bytes: int,
) -> StorageReservation | None:
    sf = get_session_factory()
    if sf is None:
        return None
    async with sf() as db:
        reservation = await storage_quota_service.reserve(
            db,
            user_id=user_id,
            source=source,
            resource_id=resource_id,
            incoming_bytes=incoming_bytes,
        )
        await db.commit()
        return reservation


async def _commit_file_bytes(reservation: StorageReservation | None, *, storage_path: str) -> None:
    if reservation is None:
        return
    sf = get_session_factory()
    if sf is None:
        return
    async with sf() as db:
        await storage_quota_service.commit_reservation(db, reservation, storage_path=storage_path)
        await db.commit()


async def _reserve_thread_file_write(
    *,
    user_id: str,
    thread_id: str,
    path: str,
    incoming_bytes: int,
) -> StorageReservation | None:
    sf = get_session_factory()
    if sf is None:
        return None
    async with sf() as db:
        reservation = await storage_quota_service.reserve_thread_file_write(
            db,
            user_id=user_id,
            thread_id=thread_id,
            path=Path(path),
            incoming_bytes=incoming_bytes,
        )
        await db.commit()
        return reservation


async def _commit_thread_file_write(reservation: StorageReservation | None, *, path: str) -> None:
    if reservation is None:
        return
    sf = get_session_factory()
    if sf is None:
        return
    async with sf() as db:
        await storage_quota_service.commit_thread_file_write(db, reservation, path=Path(path))
        await db.commit()


async def _enforce_thread_storage_quota(*, user_id: str, thread_id: str) -> None:
    sf = get_session_factory()
    if sf is None:
        return
    async with sf() as db:
        await storage_quota_service.enforce_thread_storage_quota(db, user_id=user_id, thread_id=thread_id)
        await db.commit()


def _run_coro_sync(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(coro)).result()


def reserve_file_bytes_sync(*, user_id: str, source: str, resource_id: str, incoming_bytes: int) -> StorageReservation | None:
    return _run_coro_sync(
        _reserve_file_bytes(
            user_id=user_id,
            source=source,
            resource_id=resource_id,
            incoming_bytes=incoming_bytes,
        )
    )


def commit_file_bytes_sync(reservation: StorageReservation | None, *, storage_path: str) -> None:
    _run_coro_sync(_commit_file_bytes(reservation, storage_path=storage_path))


def reserve_thread_file_write_sync(*, user_id: str, thread_id: str, path: str, incoming_bytes: int) -> StorageReservation | None:
    return _run_coro_sync(
        _reserve_thread_file_write(
            user_id=user_id,
            thread_id=thread_id,
            path=path,
            incoming_bytes=incoming_bytes,
        )
    )


def commit_thread_file_write_sync(reservation: StorageReservation | None, *, path: str) -> None:
    _run_coro_sync(_commit_thread_file_write(reservation, path=path))


def enforce_thread_storage_quota_sync(*, user_id: str, thread_id: str) -> None:
    _run_coro_sync(_enforce_thread_storage_quota(user_id=user_id, thread_id=thread_id))
