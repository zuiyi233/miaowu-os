"""Project finalization executor.

This module hosts the "finalize workflow execution" concerns that used to live in
the monolithic `consistency_gate_service.py`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.lifecycle_service import lifecycle_service

from .reporter import GateReporter

logger = get_logger(__name__)


class FinalizationExecutor:
    """Executes finalize workflow after gate report passes."""

    def __init__(self, *, reporter: GateReporter | None = None) -> None:
        self._reporter = reporter or GateReporter()

    async def finalize_project(
        self,
        db: AsyncSession,
        project_id: str,
        config: dict[str, Any] | None = None,
    ) -> tuple[bool, dict[str, Any]]:
        """执行门禁并在可通过时完成定稿。"""
        report = await self._reporter.build_finalize_gate_report(db, project_id, config=config)
        if report["result"] == "block":
            return False, report

        result = await db.execute(select(Project).where(Project.id == project_id))
        project = result.scalar_one_or_none()
        if not project:
            raise ValueError(f"project {project_id} not found")

        lifecycle_enabled = lifecycle_service.is_enabled(user_id=project.user_id)
        transition_token = str((config or {}).get("idempotency_key") or "").strip() or None
        transition_records: list[dict[str, Any]] = []
        if lifecycle_enabled:
            to_gated = lifecycle_service.transition_status(
                status_holder=project,
                entity_type="project",
                entity_id=project.id,
                target_status="gated",
                user_id=project.user_id,
                idempotency_token=transition_token,
                legacy_target_status="finalized",
            )
            transition_records.append(to_gated.to_dict())
            if to_gated.degraded or not to_gated.valid:
                logger.warning(
                    "finalize lifecycle gated transition degraded project=%s reason=%s",
                    project.id,
                    to_gated.reason,
                )

            to_finalized = lifecycle_service.transition_status(
                status_holder=project,
                entity_type="project",
                entity_id=project.id,
                target_status="finalized",
                user_id=project.user_id,
                idempotency_token=transition_token,
                legacy_target_status="finalized",
            )
            transition_records.append(to_finalized.to_dict())
            if to_finalized.degraded or not to_finalized.valid:
                logger.warning(
                    "finalize lifecycle finalized transition degraded project=%s reason=%s",
                    project.id,
                    to_finalized.reason,
                )
        else:
            project.status = "finalized"
            transition_records.append(
                {
                    "entity_type": "project",
                    "entity_id": project.id,
                    "enabled": False,
                    "current_status": report.get("lifecycle", {}).get("current_status", project.status),
                    "current_lifecycle_status": "draft",
                    "target_status": "finalized",
                    "applied_status": "finalized",
                    "valid": True,
                    "applied": True,
                    "replayed": False,
                    "degraded": True,
                    "reason": "feature_disabled_legacy_fallback",
                    "compensation": {
                        "reason": "feature_disabled",
                        "fallback_status": "finalized",
                    },
                    "idempotency": {
                        "accepted": True,
                        "replayed": False,
                        "reason": "token_missing",
                        "token": None,
                        "previous_target": None,
                    },
                }
            )

        await db.commit()
        await db.refresh(project)

        report["project_status"] = project.status
        report.setdefault("lifecycle", {})
        report["lifecycle"]["feature_enabled"] = lifecycle_enabled
        report["lifecycle"]["degraded_fallback"] = not lifecycle_enabled
        report["lifecycle"]["current_status"] = report.get("lifecycle", {}).get("current_status", project.status)
        report["lifecycle"]["transitions"] = transition_records
        report["lifecycle"]["publish_strategy"] = lifecycle_service.build_publish_strategy(current_status=project.status)
        return True, report
