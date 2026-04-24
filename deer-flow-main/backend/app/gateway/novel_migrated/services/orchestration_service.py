"""Novel chapter orchestration service (WP1).

Implements a persisted pipeline for:
- chapter analysis task lifecycle
- revision suggestion normalization
- confirmation-based chapter revision

The service intentionally reuses existing novel_migrated models to keep
compatibility with already-merged chains and avoid schema-heavy refactors.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, InvalidRequestError
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.analysis_task import AnalysisTask
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.intent_session import IntentIdempotencyKey
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.regeneration_task import RegenerationTask
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.chapter_regenerator import get_chapter_regenerator
from app.gateway.novel_migrated.services.lifecycle_service import lifecycle_service
from app.gateway.novel_migrated.services.plot_analyzer import get_plot_analyzer

logger = get_logger(__name__)


@dataclass(slots=True)
class AnalysisPipelineResult:
    task: AnalysisTask
    analysis: dict[str, Any]
    used_cached: bool = False


@dataclass(slots=True)
class RevisionPipelineResult:
    task: RegenerationTask
    chapter: Chapter
    diff_stats: dict[str, Any]
    used_cached: bool = False


class ChapterOrchestrationService:
    """Encapsulates novel chapter analysis/revision orchestration."""

    ANALYSIS_ACTION = "novel_chapter_analysis"
    REVISION_ACTION = "novel_chapter_revision"

    async def consume_idempotency_key(
        self,
        db: AsyncSession,
        *,
        key: str | None,
        user_id: str,
        action: str,
    ) -> bool:
        """Consume idempotency key in DB.

        Returns True when key is first seen (or key is empty), False when duplicated.
        """
        normalized_key = (key or "").strip()
        if not normalized_key:
            return True

        record = IntentIdempotencyKey(key=normalized_key, user_id=user_id, action=action)
        db.add(record)
        try:
            await db.commit()
            return True
        except IntegrityError:
            await db.rollback()
            try:
                db.expunge(record)
            except InvalidRequestError:
                pass
            return False

    async def release_idempotency_key(
        self,
        db: AsyncSession,
        *,
        key: str | None,
        user_id: str,
        action: str,
    ) -> bool:
        """Release idempotency key for retry flows."""
        normalized_key = (key or "").strip()
        if not normalized_key:
            return False
        result = await db.execute(
            delete(IntentIdempotencyKey).where(
                IntentIdempotencyKey.key == normalized_key,
                IntentIdempotencyKey.user_id == user_id,
                IntentIdempotencyKey.action == action,
            )
        )
        await db.commit()
        return bool(result.rowcount)

    @staticmethod
    def make_idempotency_key(*parts: str) -> str:
        raw = ":".join(p.strip() for p in parts if p and p.strip())
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]

    @staticmethod
    def _mask_idempotency_key(key: str) -> str:
        if not key:
            return ""
        if len(key) <= 10:
            return f"{key[:2]}***{key[-2:]}"
        return f"{key[:6]}***{key[-4:]}"

    @staticmethod
    def _chapter_effective_word_count(chapter: Chapter) -> int:
        return int(chapter.word_count or len(chapter.content or ""))

    @classmethod
    def _is_analysis_stale(cls, chapter: Chapter, analysis: PlotAnalysis) -> bool:
        analysis_time = analysis.created_at
        if analysis_time is None:
            return True

        chapter_updated = chapter.updated_at or chapter.created_at
        if chapter_updated and chapter_updated > analysis_time:
            return True

        stored_word_count = int(analysis.word_count or 0)
        chapter_word_count = cls._chapter_effective_word_count(chapter)
        if stored_word_count != chapter_word_count:
            return True

        return False

    @staticmethod
    def _make_cached_analysis_result(
        *,
        chapter_id: str,
        project_id: str,
        user_id: str,
        analysis: PlotAnalysis,
        task: AnalysisTask | None = None,
    ) -> AnalysisPipelineResult:
        task_ref = task
        if task_ref is None:
            task_ref = AnalysisTask(
                chapter_id=chapter_id,
                user_id=user_id,
                project_id=project_id,
                status="completed",
                progress=100,
                started_at=analysis.created_at,
                completed_at=analysis.created_at,
            )
            task_ref.id = f"cached-{chapter_id}"
        return AnalysisPipelineResult(task=task_ref, analysis=analysis.to_dict(), used_cached=True)

    @staticmethod
    def normalize_revision_suggestions(analysis: dict[str, Any] | None) -> list[dict[str, Any]]:
        suggestions = []
        if not analysis:
            return suggestions

        raw_suggestions = analysis.get("suggestions") or []
        for idx, raw in enumerate(raw_suggestions):
            if isinstance(raw, dict):
                detail = str(raw.get("content") or raw.get("text") or "").strip()
                suggestion_type = str(raw.get("type") or "general").strip() or "general"
                severity = str(raw.get("severity") or "medium").strip() or "medium"
            else:
                detail = str(raw).strip()
                suggestion_type = "general"
                severity = "medium"

            if not detail:
                continue

            suggestions.append(
                {
                    "index": idx,
                    "type": suggestion_type,
                    "severity": severity,
                    "detail": detail,
                    "title": detail[:28] + ("..." if len(detail) > 28 else ""),
                }
            )
        return suggestions

    @staticmethod
    def build_revision_instructions(
        normalized_suggestions: list[dict[str, Any]],
        *,
        selected_indices: list[int] | None,
        custom_instructions: str = "",
    ) -> str:
        selected_set = set(selected_indices or [])
        if selected_set:
            picked = [item for item in normalized_suggestions if int(item.get("index", -1)) in selected_set]
        else:
            picked = normalized_suggestions

        lines = ["# 自动修订指令", ""]
        if picked:
            lines.append("## 来自章节分析的修订建议")
            for item in picked:
                lines.append(
                    f"- [{item.get('severity', 'medium')}/{item.get('type', 'general')}] {item.get('detail', '')}"
                )
            lines.append("")

        if custom_instructions.strip():
            lines.append("## 用户补充要求")
            lines.append(custom_instructions.strip())
            lines.append("")

        if not picked and not custom_instructions.strip():
            lines.append("- 无显式建议，执行最小编辑：提升连贯性与可读性。")

        return "\n".join(lines).strip()

    async def run_analysis_pipeline(
        self,
        *,
        db: AsyncSession,
        chapter: Chapter,
        project_id: str,
        user_id: str,
        ai_service: AIService,
        idempotency_key: str | None = None,
        force: bool = False,
    ) -> AnalysisPipelineResult:
        """Run chapter analysis and persist both task and result."""
        if not (chapter.content or "").strip():
            raise ValueError("章节内容为空，无法分析")

        chapter_id = chapter.id
        chapter_number = chapter.chapter_number
        chapter_title = chapter.title
        chapter_content = chapter.content or ""
        chapter_word_count = self._chapter_effective_word_count(chapter)

        existing_analysis_result = await db.execute(
            select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id)
        )
        existing_analysis = existing_analysis_result.scalar_one_or_none()
        analysis_is_fresh = bool(
            existing_analysis and not self._is_analysis_stale(chapter, existing_analysis)
        )

        if not force and existing_analysis and analysis_is_fresh:
            return self._make_cached_analysis_result(
                chapter_id=chapter_id,
                project_id=project_id,
                user_id=user_id,
                analysis=existing_analysis,
            )

        normalized_idempotency_key = (idempotency_key or "").strip()
        consume_ok = True
        latest_task = None
        if normalized_idempotency_key:
            consume_ok = await self.consume_idempotency_key(
                db,
                key=normalized_idempotency_key,
                user_id=user_id,
                action=self.ANALYSIS_ACTION,
            )

        if not consume_ok:
            latest_task_result = await db.execute(
                select(AnalysisTask)
                .where(AnalysisTask.chapter_id == chapter_id)
                .order_by(AnalysisTask.created_at.desc())
                .limit(1)
            )
            latest_task = latest_task_result.scalar_one_or_none()

            if latest_task is None:
                # Recovery path for poisoned key window:
                # key consumed successfully in a previous crashed attempt,
                # but task row was never written.
                # Concurrency guard: another request may have just consumed the key
                # but hasn't committed the task row yet. Poll briefly before treating
                # it as a poisoned-key recovery case.
                poll_attempts = 4
                poll_delay_sec = 0.05
                for _ in range(poll_attempts):
                    await asyncio.sleep(poll_delay_sec)
                    latest_task_result = await db.execute(
                        select(AnalysisTask)
                        .where(AnalysisTask.chapter_id == chapter_id)
                        .order_by(AnalysisTask.created_at.desc())
                        .limit(1)
                    )
                    latest_task = latest_task_result.scalar_one_or_none()
                    if latest_task is not None:
                        break

                if latest_task is not None:
                    logger.info(
                        "idempotency_key conflict resolved after polling (task row appeared): key=%s",
                        self._mask_idempotency_key(normalized_idempotency_key),
                    )
                else:
                    released = await self.release_idempotency_key(
                        db,
                        key=normalized_idempotency_key,
                        user_id=user_id,
                        action=self.ANALYSIS_ACTION,
                    )
                    if not released:
                        owner_result = await db.execute(
                            select(IntentIdempotencyKey).where(
                                IntentIdempotencyKey.key == normalized_idempotency_key
                            )
                        )
                        owner = owner_result.scalar_one_or_none()
                        if owner is None:
                            released = True
                        elif owner.user_id == user_id and owner.action == self.ANALYSIS_ACTION:
                            await db.execute(
                                delete(IntentIdempotencyKey).where(
                                    IntentIdempotencyKey.key == normalized_idempotency_key,
                                    IntentIdempotencyKey.user_id == user_id,
                                    IntentIdempotencyKey.action == self.ANALYSIS_ACTION,
                                )
                            )
                            await db.commit()
                            released = True
                        else:
                            logger.warning(
                                "idempotency_key conflict owner mismatch: key=%s owner_user=%s owner_action=%s current_user=%s current_action=%s",
                                self._mask_idempotency_key(normalized_idempotency_key),
                                owner.user_id,
                                owner.action,
                                user_id,
                                self.ANALYSIS_ACTION,
                            )
                    if released:
                        consume_ok = await self.consume_idempotency_key(
                            db,
                            key=normalized_idempotency_key,
                            user_id=user_id,
                            action=self.ANALYSIS_ACTION,
                        )

            if latest_task and latest_task.status == "failed":
                # Failed requests should be retryable with the same key.
                await self.release_idempotency_key(
                    db,
                    key=normalized_idempotency_key,
                    user_id=user_id,
                    action=self.ANALYSIS_ACTION,
                )
                consume_ok = await self.consume_idempotency_key(
                    db,
                    key=normalized_idempotency_key,
                    user_id=user_id,
                    action=self.ANALYSIS_ACTION,
                )

            if (
                not consume_ok
                and latest_task
                and latest_task.status == "completed"
                and existing_analysis
                and analysis_is_fresh
            ):
                return self._make_cached_analysis_result(
                    chapter_id=chapter_id,
                    project_id=project_id,
                    user_id=user_id,
                    analysis=existing_analysis,
                    task=latest_task,
                )
        if not consume_ok and latest_task and latest_task.status == "running":
            raise RuntimeError("分析任务正在执行中，请稍后刷新任务状态")
        if not consume_ok:
            raise RuntimeError("分析请求重复提交，请稍后刷新任务状态")

        lifecycle_begin = lifecycle_service.transition_status(
            status_holder=chapter,
            entity_type="chapter",
            entity_id=chapter_id,
            target_status="analyzing",
            user_id=user_id,
            idempotency_token=normalized_idempotency_key,
        )
        if lifecycle_begin.degraded or not lifecycle_begin.valid:
            logger.warning(
                "analysis lifecycle begin degraded chapter=%s reason=%s target=%s",
                chapter_id,
                lifecycle_begin.reason,
                lifecycle_begin.target_status,
            )

        task = AnalysisTask(
            chapter_id=chapter_id,
            user_id=user_id,
            project_id=project_id,
            status="running",
            progress=10,
            started_at=datetime.utcnow(),
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)

        async def on_retry(attempt: int, max_retries: int, wait_time: int, error_reason: str) -> None:
            task.status = "running"
            task.progress = min(85, 20 + attempt * 20)
            task.error_message = f"重试中({attempt}/{max_retries})：{error_reason[:120]}"
            await db.commit()

        analyzer = get_plot_analyzer(ai_service)
        try:
            result = await analyzer.analyze_chapter(
                chapter_number=chapter_number,
                title=chapter_title,
                content=chapter_content,
                word_count=chapter_word_count,
                user_id=user_id,
                db=db,
                on_retry=on_retry,
            )
        except Exception as exc:
            lifecycle_fail = lifecycle_service.transition_status(
                status_holder=chapter,
                entity_type="chapter",
                entity_id=chapter_id,
                target_status="draft",
                user_id=user_id,
                idempotency_token=normalized_idempotency_key,
            )
            if lifecycle_fail.degraded or not lifecycle_fail.valid:
                logger.warning(
                    "analysis lifecycle failure degraded chapter=%s reason=%s target=%s",
                    chapter_id,
                    lifecycle_fail.reason,
                    lifecycle_fail.target_status,
                )
            task.status = "failed"
            task.progress = 0
            task.error_message = f"AI 分析异常: {exc}"
            task.completed_at = datetime.utcnow()
            await db.commit()
            if normalized_idempotency_key:
                await self.release_idempotency_key(
                    db,
                    key=normalized_idempotency_key,
                    user_id=user_id,
                    action=self.ANALYSIS_ACTION,
                )
            raise RuntimeError("章节分析失败") from exc

        if not result:
            lifecycle_empty = lifecycle_service.transition_status(
                status_holder=chapter,
                entity_type="chapter",
                entity_id=chapter_id,
                target_status="draft",
                user_id=user_id,
                idempotency_token=normalized_idempotency_key,
            )
            if lifecycle_empty.degraded or not lifecycle_empty.valid:
                logger.warning(
                    "analysis lifecycle empty-result degraded chapter=%s reason=%s target=%s",
                    chapter_id,
                    lifecycle_empty.reason,
                    lifecycle_empty.target_status,
                )
            task.status = "failed"
            task.progress = 0
            task.error_message = "AI 分析失败"
            task.completed_at = datetime.utcnow()
            await db.commit()
            if normalized_idempotency_key:
                await self.release_idempotency_key(
                    db,
                    key=normalized_idempotency_key,
                    user_id=user_id,
                    action=self.ANALYSIS_ACTION,
                )
            raise RuntimeError("章节分析失败")

        existing = existing_analysis

        analysis_time = datetime.utcnow()
        payload = {
            "plot_stage": result.get("plot_stage"),
            "conflict_level": (result.get("conflict") or {}).get("level"),
            "conflict_types": (result.get("conflict") or {}).get("types"),
            "emotional_tone": (result.get("emotional_arc") or {}).get("primary_emotion"),
            "emotional_intensity": ((result.get("emotional_arc") or {}).get("intensity", 0) or 0) / 10,
            "emotional_curve": result.get("emotional_arc"),
            "hooks": result.get("hooks"),
            "hooks_count": len(result.get("hooks", [])),
            "hooks_avg_strength": (
                sum((hook.get("strength") or 0) for hook in result.get("hooks", []))
                / max(1, len(result.get("hooks", [])))
            ),
            "foreshadows": result.get("foreshadows"),
            "foreshadows_planted": sum(1 for item in result.get("foreshadows", []) if item.get("type") == "planted"),
            "foreshadows_resolved": sum(1 for item in result.get("foreshadows", []) if item.get("type") == "resolved"),
            "plot_points": result.get("plot_points"),
            "plot_points_count": len(result.get("plot_points", [])),
            "character_states": result.get("character_states"),
            "scenes": result.get("scenes"),
            "pacing": result.get("pacing"),
            "overall_quality_score": (result.get("scores") or {}).get("overall"),
            "pacing_score": (result.get("scores") or {}).get("pacing"),
            "engagement_score": (result.get("scores") or {}).get("engagement"),
            "coherence_score": (result.get("scores") or {}).get("coherence"),
            "analysis_report": analyzer.generate_analysis_summary(result),
            "suggestions": result.get("suggestions"),
            "word_count": chapter_word_count,
            "dialogue_ratio": result.get("dialogue_ratio"),
            "description_ratio": result.get("description_ratio"),
        }

        if existing:
            for key, value in payload.items():
                setattr(existing, key, value)
            existing.created_at = analysis_time
        else:
            db.add(
                PlotAnalysis(
                    project_id=project_id,
                    chapter_id=chapter_id,
                    created_at=analysis_time,
                    **payload,
                )
            )

        lifecycle_complete = lifecycle_service.transition_status(
            status_holder=chapter,
            entity_type="chapter",
            entity_id=chapter_id,
            target_status="revising",
            user_id=user_id,
            idempotency_token=normalized_idempotency_key,
        )
        if lifecycle_complete.degraded or not lifecycle_complete.valid:
            logger.warning(
                "analysis lifecycle complete degraded chapter=%s reason=%s target=%s",
                chapter_id,
                lifecycle_complete.reason,
                lifecycle_complete.target_status,
            )

        task.status = "completed"
        task.progress = 100
        task.error_message = None
        task.completed_at = datetime.utcnow()
        await db.commit()

        stored_result = await db.execute(select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id))
        stored = stored_result.scalar_one()
        return AnalysisPipelineResult(task=task, analysis=stored.to_dict(), used_cached=False)

    async def apply_revision_pipeline(
        self,
        *,
        db: AsyncSession,
        chapter: Chapter,
        project: Project,
        user_id: str,
        ai_service: AIService,
        selected_suggestion_indices: list[int] | None,
        custom_instructions: str,
        target_word_count: int,
        idempotency_key: str | None = None,
        max_retries: int = 2,
    ) -> RevisionPipelineResult:
        """Apply chapter revision after confirmation."""
        analysis_result = await db.execute(select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter.id))
        analysis = analysis_result.scalar_one_or_none()
        if not analysis:
            raise RuntimeError("当前章节没有分析结果，无法执行修订")

        normalized = self.normalize_revision_suggestions(analysis.to_dict())
        modification_instructions = self.build_revision_instructions(
            normalized,
            selected_indices=selected_suggestion_indices,
            custom_instructions=custom_instructions,
        )

        idem_key = (idempotency_key or "").strip()
        version_note = f"idem:{idem_key}" if idem_key else None

        lifecycle_revision_begin = lifecycle_service.transition_status(
            status_holder=chapter,
            entity_type="chapter",
            entity_id=chapter.id,
            target_status="revising",
            user_id=user_id,
            idempotency_token=idem_key,
        )
        if lifecycle_revision_begin.degraded or not lifecycle_revision_begin.valid:
            logger.warning(
                "revision lifecycle begin degraded chapter=%s reason=%s target=%s",
                chapter.id,
                lifecycle_revision_begin.reason,
                lifecycle_revision_begin.target_status,
            )

        if idem_key:
            existing_task_result = await db.execute(
                select(RegenerationTask)
                .where(
                    RegenerationTask.chapter_id == chapter.id,
                    RegenerationTask.user_id == user_id,
                    RegenerationTask.version_note == version_note,
                )
                .order_by(RegenerationTask.created_at.desc())
                .limit(1)
            )
            existing_task = existing_task_result.scalar_one_or_none()
            if existing_task and existing_task.status == "completed":
                regenerator = get_chapter_regenerator(ai_service)
                return RevisionPipelineResult(
                    task=existing_task,
                    chapter=chapter,
                    diff_stats=regenerator.calculate_content_diff(
                        existing_task.original_content or "",
                        existing_task.regenerated_content or "",
                    ),
                    used_cached=True,
                )

            consume_ok = await self.consume_idempotency_key(
                db,
                key=idem_key,
                user_id=user_id,
                action=self.REVISION_ACTION,
            )
            if not consume_ok and existing_task and existing_task.status == "running":
                raise RuntimeError("修订任务正在执行中，请稍后重试")
            if not consume_ok:
                raise RuntimeError("修订请求重复提交")

        task = RegenerationTask(
            chapter_id=chapter.id,
            analysis_id=analysis.id,
            user_id=user_id,
            project_id=project.id,
            modification_instructions=modification_instructions,
            original_suggestions=analysis.suggestions or [],
            selected_suggestion_indices=selected_suggestion_indices or [],
            custom_instructions=custom_instructions,
            target_word_count=target_word_count,
            original_content=chapter.content,
            original_word_count=chapter.word_count,
            status="running",
            progress=5,
            started_at=datetime.utcnow(),
            version_note=version_note,
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)

        regenerator = get_chapter_regenerator(ai_service)
        generated = ""
        last_error: Exception | None = None

        for attempt in range(1, max(1, max_retries) + 1):
            generated = ""
            task.progress = min(90, 10 + attempt * 10)
            task.error_message = None if attempt == 1 else f"修订重试中({attempt}/{max_retries})"
            await db.commit()
            try:
                async for event in regenerator.regenerate_with_feedback(
                    chapter=chapter,
                    analysis=analysis,
                    modification_instructions=modification_instructions,
                    project_context={
                        "title": project.title,
                        "genre": project.genre,
                        "theme": project.theme,
                    },
                    target_word_count=target_word_count,
                    custom_instructions=custom_instructions,
                ):
                    if event.get("type") == "chunk":
                        generated += str(event.get("content") or "")
                if generated.strip():
                    break
                raise RuntimeError("修订生成为空")
            except Exception as exc:  # pragma: no cover - exercised in integration path
                last_error = exc
                logger.warning(
                    "revision attempt failed (%s/%s) chapter=%s error=%s",
                    attempt,
                    max_retries,
                    chapter.id,
                    exc,
                )

        if not generated.strip():
            lifecycle_revision_fail = lifecycle_service.transition_status(
                status_holder=chapter,
                entity_type="chapter",
                entity_id=chapter.id,
                target_status="draft",
                user_id=user_id,
                idempotency_token=idem_key,
            )
            if lifecycle_revision_fail.degraded or not lifecycle_revision_fail.valid:
                logger.warning(
                    "revision lifecycle failure degraded chapter=%s reason=%s target=%s",
                    chapter.id,
                    lifecycle_revision_fail.reason,
                    lifecycle_revision_fail.target_status,
                )
            task.status = "failed"
            task.progress = 0
            task.error_message = f"修订失败: {last_error}" if last_error else "修订失败"
            task.completed_at = datetime.utcnow()
            await db.commit()
            raise RuntimeError(task.error_message)

        old_word_count = chapter.word_count or 0
        chapter.content = generated.strip()
        chapter.word_count = len(chapter.content)
        if lifecycle_service.is_enabled(user_id=user_id):
            lifecycle_revision_done = lifecycle_service.transition_status(
                status_holder=chapter,
                entity_type="chapter",
                entity_id=chapter.id,
                target_status="revising",
                user_id=user_id,
                idempotency_token=idem_key,
                legacy_target_status="completed",
            )
            if lifecycle_revision_done.degraded or not lifecycle_revision_done.valid:
                logger.warning(
                    "revision lifecycle complete degraded chapter=%s reason=%s target=%s",
                    chapter.id,
                    lifecycle_revision_done.reason,
                    lifecycle_revision_done.target_status,
                )
        else:
            chapter.status = "completed"
        project.current_words = max(0, int(project.current_words or 0) - old_word_count + chapter.word_count)

        task.status = "completed"
        task.progress = 100
        task.error_message = None
        task.regenerated_content = chapter.content
        task.regenerated_word_count = chapter.word_count
        task.completed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(chapter)
        await db.refresh(task)

        return RevisionPipelineResult(
            task=task,
            chapter=chapter,
            diff_stats=regenerator.calculate_content_diff(task.original_content or "", chapter.content or ""),
            used_cached=False,
        )


orchestration_service = ChapterOrchestrationService()
