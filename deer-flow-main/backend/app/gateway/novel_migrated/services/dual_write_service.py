from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.gateway.novel_migrated.core.database import async_session_factory
from app.gateway.novel_migrated.models.dual_write_log import DualWriteLog

logger = logging.getLogger(__name__)

_RETRY_BACKOFF_BASE_SECONDS = 30


async def record_dual_write_failure(
    modern_project_id: str,
    legacy_payload: dict[str, Any],
    error: str,
) -> str:
    """Record a dual-write failure for later retry.

    Returns the log entry ID.
    """
    async with async_session_factory() as session:
        entry = DualWriteLog(
            modern_project_id=modern_project_id,
            legacy_payload=json.dumps(legacy_payload, ensure_ascii=False),
            status="pending",
            retry_count=0,
            max_retries=5,
            last_error=error[:2000] if error else None,
            next_retry_at=datetime.now(tz=UTC) + timedelta(seconds=_RETRY_BACKOFF_BASE_SECONDS),
        )
        session.add(entry)
        await session.commit()
        log_id = entry.id
    logger.info("Dual-write failure recorded: id=%s project=%s", log_id, modern_project_id)
    return log_id


async def retry_pending_dual_writes() -> int:
    """Retry all pending dual-write entries that are due.

    Returns the number of successfully retried entries.
    """
    import httpx

    from deerflow.tools.builtins.novel_tool_helpers import build_headers, get_base_url, get_timeout_seconds

    now = datetime.now(tz=UTC)
    success_count = 0

    async with async_session_factory() as session:
        stmt = select(DualWriteLog).where(
            DualWriteLog.status == "pending",
            DualWriteLog.retry_count < DualWriteLog.max_retries,
            DualWriteLog.next_retry_at <= now,
        )
        result = await session.execute(stmt)
        entries = result.scalars().all()

        for entry in entries:
            try:
                payload = json.loads(entry.legacy_payload)
                base_url = get_base_url()
                timeout = httpx.Timeout(get_timeout_seconds())
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.post(
                        f"{base_url}/api/novels",
                        json=payload,
                        headers=build_headers(),
                    )
                    response.raise_for_status()

                entry.status = "success"
                success_count += 1
                logger.info("Dual-write retry success: id=%s project=%s", entry.id, entry.modern_project_id)
            except Exception as exc:
                entry.retry_count += 1
                entry.last_error = str(exc)[:2000]
                backoff = _RETRY_BACKOFF_BASE_SECONDS * (2 ** min(entry.retry_count, 6))
                entry.next_retry_at = now + timedelta(seconds=backoff)
                if entry.retry_count >= entry.max_retries:
                    entry.status = "failed"
                    logger.error(
                        "Dual-write retry exhausted: id=%s project=%s retries=%d",
                        entry.id,
                        entry.modern_project_id,
                        entry.retry_count,
                    )
                else:
                    logger.warning(
                        "Dual-write retry failed (attempt %d/%d): id=%s error=%s",
                        entry.retry_count,
                        entry.max_retries,
                        entry.id,
                        str(exc)[:200],
                    )

        await session.commit()

    return success_count
