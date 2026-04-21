"""Long-task recovery & compensation helpers (WP4)."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.analysis_task import AnalysisTask
from app.gateway.novel_migrated.models.batch_generation_task import BatchGenerationTask
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.regeneration_task import RegenerationTask

logger = get_logger(__name__)


class RecoveryService:
    """Provides state recovery, resume planning and compensation scaffolding."""

    ANALYSIS_TIMEOUT = timedelta(minutes=5)
    REGEN_TIMEOUT = timedelta(minutes=8)
    BATCH_TIMEOUT = timedelta(minutes=15)

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.utcnow()

    def recover_analysis_task(self, task: AnalysisTask) -> bool:
        if task.status != "running":
            return False
        started = task.started_at or task.created_at
        if not started:
            return False
        if self._utcnow() - started <= self.ANALYSIS_TIMEOUT:
            return False

        task.status = "failed"
        task.progress = 0
        task.error_message = "分析任务超时，已自动恢复为失败，可重试"
        task.completed_at = self._utcnow()
        return True

    def recover_regeneration_task(self, task: RegenerationTask) -> bool:
        if task.status != "running":
            return False
        started = task.started_at or task.created_at
        if not started:
            return False
        if self._utcnow() - started <= self.REGEN_TIMEOUT:
            return False

        task.status = "failed"
        task.progress = 0
        task.error_message = "修订任务超时，已自动恢复为失败，可重放"
        task.completed_at = self._utcnow()
        return True

    def recover_batch_task(self, task: BatchGenerationTask) -> bool:
        if task.status != "running":
            return False
        started = task.started_at or task.created_at
        if not started:
            return False
        if self._utcnow() - started <= self.BATCH_TIMEOUT:
            return False

        failures = list(task.failed_chapters or [])
        if task.current_chapter_id:
            failures.append(
                {
                    "chapter_id": task.current_chapter_id,
                    "chapter_number": task.current_chapter_number,
                    "stage": "generation",
                    "error": "任务超时中断，已自动补偿标记",
                    "compensation": {"state": "replayable", "marked_at": self._utcnow().isoformat()},
                }
            )
        task.failed_chapters = failures
        task.status = "failed"
        task.error_message = "批量任务超时，已自动恢复为失败，可继续断点重跑"
        task.completed_at = self._utcnow()
        return True

    def compute_batch_resume_plan(
        self,
        *,
        task: BatchGenerationTask,
        chapters: list[Chapter],
        replay_failed_only: bool = False,
    ) -> dict[str, Any]:
        ordered = sorted(chapters, key=lambda item: int(item.chapter_number or 0))
        failed_by_id: dict[str, dict[str, Any]] = {}
        for item in task.failed_chapters or []:
            chapter_id = str(item.get("chapter_id") or "").strip()
            if chapter_id:
                failed_by_id[chapter_id] = item

        completed_ids: list[str] = []
        replayable_failed_ids: list[str] = []
        pending_ids: list[str] = []

        for chapter in ordered:
            has_content = bool((chapter.content or "").strip())
            if chapter.status == "completed" and has_content:
                completed_ids.append(chapter.id)
                continue

            failed_item = failed_by_id.get(chapter.id)
            if failed_item:
                replayable_failed_ids.append(chapter.id)
                if replay_failed_only:
                    pending_ids.append(chapter.id)
                    continue

            if not replay_failed_only:
                pending_ids.append(chapter.id)

        return {
            "task_id": task.id,
            "status": task.status,
            "completed_ids": completed_ids,
            "replayable_failed_ids": replayable_failed_ids,
            "pending_ids": pending_ids,
            "failed_items": list(failed_by_id.values()),
        }

    def record_batch_failure(
        self,
        *,
        task: BatchGenerationTask,
        chapter: Chapter,
        stage: str,
        error: str,
        retry_count: int,
    ) -> None:
        failures = list(task.failed_chapters or [])

        # Resource-level de-dup by (chapter_id, stage)
        deduped = [
            item
            for item in failures
            if not (
                str(item.get("chapter_id") or "") == chapter.id
                and str(item.get("stage") or "") == stage
            )
        ]

        deduped.append(
            {
                "chapter_id": chapter.id,
                "chapter_number": chapter.chapter_number,
                "title": chapter.title,
                "stage": stage,
                "error": error[:500],
                "retry_count": retry_count,
                "compensation": {
                    "state": "replayable",
                    "replayed": False,
                    "recorded_at": self._utcnow().isoformat(),
                },
            }
        )
        task.failed_chapters = deduped

    def mark_batch_replayed(self, *, task: BatchGenerationTask, chapter_id: str) -> None:
        updated: list[dict[str, Any]] = []
        for item in task.failed_chapters or []:
            if str(item.get("chapter_id") or "") != chapter_id:
                updated.append(item)
                continue
            compensation = dict(item.get("compensation") or {})
            compensation["replayed"] = True
            compensation["replayed_at"] = self._utcnow().isoformat()
            item = dict(item)
            item["compensation"] = compensation
            updated.append(item)
        task.failed_chapters = updated


recovery_service = RecoveryService()
