from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete, select

from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.analysis_task import AnalysisTask
from app.gateway.novel_migrated.models.batch_generation_task import BatchGenerationTask
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.intent_session import IntentIdempotencyKey
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.regeneration_task import RegenerationTask
from app.gateway.novel_migrated.services.orchestration_service import orchestration_service
from app.gateway.novel_migrated.services.recovery_service import recovery_service


def test_normalize_suggestions_and_build_instructions():
    analysis = {
        "suggestions": [
            "【节奏】中段冲突推进偏慢，建议增加事件触发",
            {"type": "dialogue", "severity": "high", "content": "对话信息密度偏低"},
            "",
        ]
    }
    normalized = orchestration_service.normalize_revision_suggestions(analysis)
    assert len(normalized) == 2
    assert normalized[0]["index"] == 0
    assert normalized[1]["type"] == "dialogue"

    instructions = orchestration_service.build_revision_instructions(
        normalized,
        selected_indices=[1],
        custom_instructions="保留原有伏笔线索",
    )
    assert "对话信息密度偏低" in instructions
    assert "保留原有伏笔线索" in instructions
    assert "节奏" not in instructions


def test_recovery_service_resume_plan_and_recovery_flags():
    chapter_a = Chapter(id="c1", chapter_number=1, title="A", status="completed", content="done")
    chapter_b = Chapter(id="c2", chapter_number=2, title="B", status="draft", content="")
    chapter_c = Chapter(id="c3", chapter_number=3, title="C", status="planned", content="")

    task = BatchGenerationTask(
        id="t1",
        project_id="p1",
        user_id="u1",
        start_chapter_number=1,
        chapter_count=3,
        chapter_ids=["c1", "c2", "c3"],
        status="failed",
        total_chapters=3,
        completed_chapters=1,
        failed_chapters=[
            {"chapter_id": "c2", "stage": "generation", "error": "network"},
        ],
    )

    plan_all = recovery_service.compute_batch_resume_plan(
        task=task,
        chapters=[chapter_a, chapter_b, chapter_c],
        replay_failed_only=False,
    )
    assert plan_all["completed_ids"] == ["c1"]
    assert plan_all["replayable_failed_ids"] == ["c2"]
    assert plan_all["pending_ids"] == ["c2", "c3"]

    plan_failed = recovery_service.compute_batch_resume_plan(
        task=task,
        chapters=[chapter_a, chapter_b, chapter_c],
        replay_failed_only=True,
    )
    assert plan_failed["pending_ids"] == ["c2"]


def test_recovery_service_timeout_auto_failures():
    now = datetime.utcnow()

    analysis_task = AnalysisTask(
        id="a1",
        chapter_id="c1",
        user_id="u1",
        project_id="p1",
        status="running",
        progress=50,
        started_at=now - timedelta(minutes=10),
    )
    assert recovery_service.recover_analysis_task(analysis_task) is True
    assert analysis_task.status == "failed"

    regen_task = RegenerationTask(
        id="r1",
        chapter_id="c1",
        user_id="u1",
        project_id="p1",
        modification_instructions="x",
        status="running",
        progress=30,
        started_at=now - timedelta(minutes=20),
    )
    assert recovery_service.recover_regeneration_task(regen_task) is True
    assert regen_task.status == "failed"

    batch_task = BatchGenerationTask(
        id="b1",
        project_id="p1",
        user_id="u1",
        start_chapter_number=1,
        chapter_count=2,
        chapter_ids=["c1", "c2"],
        status="running",
        started_at=now - timedelta(minutes=30),
        current_chapter_id="c2",
        current_chapter_number=2,
        failed_chapters=[],
    )
    assert recovery_service.recover_batch_task(batch_task) is True
    assert batch_task.status == "failed"
    assert batch_task.failed_chapters


def test_consume_idempotency_key_deduplicates_in_database():
    async def _run() -> None:
        await init_db_schema()
        key = f"test-idem-{datetime.utcnow().timestamp()}"

        async with AsyncSessionLocal() as db:
            ok_first = await orchestration_service.consume_idempotency_key(
                db,
                key=key,
                user_id="u-test",
                action="test_action",
            )
            ok_second = await orchestration_service.consume_idempotency_key(
                db,
                key=key,
                user_id="u-test",
                action="test_action",
            )
            assert ok_first is True
            assert ok_second is False

            await db.execute(delete(IntentIdempotencyKey).where(IntentIdempotencyKey.key == key))
            await db.commit()

    asyncio.run(_run())


def test_analysis_pipeline_reuses_fresh_cache_and_recomputes_when_chapter_updates():
    class _Analyzer:
        def __init__(self) -> None:
            self.call_count = 0

        async def analyze_chapter(self, **kwargs):
            self.call_count += 1
            return {
                "plot_stage": f"stage-{self.call_count}",
                "conflict": {"level": 5, "types": ["人物"]},
                "emotional_arc": {"primary_emotion": "紧张", "intensity": 7},
                "hooks": [{"strength": 6}],
                "foreshadows": [],
                "plot_points": [],
                "character_states": [],
                "scenes": [],
                "pacing": "moderate",
                "scores": {"overall": 8.0, "pacing": 7.5, "engagement": 8.0, "coherence": 8.2},
                "suggestions": ["补强冲突"],
                "dialogue_ratio": 0.35,
                "description_ratio": 0.65,
            }

        def generate_analysis_summary(self, result):
            return f"summary-{result.get('plot_stage')}"

    async def _run() -> None:
        await init_db_schema()
        unique = uuid4().hex[:10]
        project = Project(id=f"proj-{unique}", user_id="u-cache", title="缓存测试项目")
        chapter = Chapter(
            id=f"chap-{unique}",
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="初始内容",
            word_count=len("初始内容"),
            status="completed",
        )

        analyzer = _Analyzer()
        async with AsyncSessionLocal() as db:
            db.add(project)
            await db.commit()
            db.add(chapter)
            await db.commit()
            await db.refresh(chapter)

            with patch(
                "app.gateway.novel_migrated.services.orchestration_service.get_plot_analyzer",
                return_value=analyzer,
            ):
                first = await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project.id,
                    user_id="u-cache",
                    ai_service=object(),
                )
                assert first.used_cached is False
                assert analyzer.call_count == 1

                second = await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project.id,
                    user_id="u-cache",
                    ai_service=object(),
                )
                assert second.used_cached is True
                assert analyzer.call_count == 1

                chapter.content = "初始内容+补充段落"
                chapter.word_count = len(chapter.content)
                chapter.updated_at = datetime.utcnow() + timedelta(seconds=1)
                await db.commit()
                await db.refresh(chapter)

                third = await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project.id,
                    user_id="u-cache",
                    ai_service=object(),
                )
                assert third.used_cached is False
                assert analyzer.call_count == 2

                persisted_result = await db.execute(
                    select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter.id)
                )
                persisted = persisted_result.scalar_one()
                assert persisted.plot_stage == "stage-2"
                assert int(persisted.word_count or 0) == chapter.word_count

    asyncio.run(_run())


def test_analysis_pipeline_idempotency_retry_after_failure_then_reuse_after_success():
    class _FlakyAnalyzer:
        def __init__(self) -> None:
            self.call_count = 0

        async def analyze_chapter(self, **kwargs):
            self.call_count += 1
            if self.call_count == 1:
                raise RuntimeError("temporary failure")
            return {
                "plot_stage": "retry-success",
                "conflict": {"level": 4, "types": ["环境"]},
                "emotional_arc": {"primary_emotion": "期待", "intensity": 6},
                "hooks": [],
                "foreshadows": [],
                "plot_points": [],
                "character_states": [],
                "scenes": [],
                "pacing": "fast",
                "scores": {"overall": 7.8, "pacing": 7.1, "engagement": 7.9, "coherence": 7.6},
                "suggestions": ["保持推进"],
                "dialogue_ratio": 0.2,
                "description_ratio": 0.8,
            }

        def generate_analysis_summary(self, result):
            return "retry-summary"

    async def _run() -> None:
        await init_db_schema()
        unique = uuid4().hex[:10]
        project = Project(id=f"proj-{unique}", user_id="u-idem", title="幂等测试项目")
        chapter = Chapter(
            id=f"chap-{unique}",
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="稳定内容",
            word_count=len("稳定内容"),
            status="completed",
        )
        idem_key = f"analysis-idem-{unique}"
        analyzer = _FlakyAnalyzer()

        async with AsyncSessionLocal() as db:
            db.add(project)
            await db.commit()
            db.add(chapter)
            await db.commit()
            await db.refresh(chapter)

            with patch(
                "app.gateway.novel_migrated.services.orchestration_service.get_plot_analyzer",
                return_value=analyzer,
            ):
                try:
                    await orchestration_service.run_analysis_pipeline(
                        db=db,
                        chapter=chapter,
                        project_id=project.id,
                        user_id="u-idem",
                        ai_service=object(),
                        idempotency_key=idem_key,
                    )
                    assert False, "首次分析应失败"
                except RuntimeError as exc:
                    assert "分析失败" in str(exc)

                second = await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project.id,
                    user_id="u-idem",
                    ai_service=object(),
                    idempotency_key=idem_key,
                )
                assert second.used_cached is False
                assert analyzer.call_count == 2

                third = await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project.id,
                    user_id="u-idem",
                    ai_service=object(),
                    idempotency_key=idem_key,
                )
                assert third.used_cached is True
                assert analyzer.call_count == 2

                tasks_result = await db.execute(
                    select(AnalysisTask)
                    .where(AnalysisTask.chapter_id == chapter.id)
                    .order_by(AnalysisTask.created_at.asc())
                )
                tasks = list(tasks_result.scalars().all())
                assert len(tasks) == 2
                assert tasks[0].status == "failed"
                assert tasks[1].status == "completed"

    asyncio.run(_run())


def test_analysis_pipeline_recovers_when_idempotency_key_exists_but_task_missing():
    class _Analyzer:
        async def analyze_chapter(self, **kwargs):
            return {
                "plot_stage": "recover",
                "conflict": {"level": 3, "types": ["环境"]},
                "emotional_arc": {"primary_emotion": "平静", "intensity": 5},
                "hooks": [],
                "foreshadows": [],
                "plot_points": [],
                "character_states": [],
                "scenes": [],
                "pacing": "moderate",
                "scores": {"overall": 7.0, "pacing": 7.0, "engagement": 7.0, "coherence": 7.0},
                "suggestions": ["继续推进"],
                "dialogue_ratio": 0.3,
                "description_ratio": 0.7,
            }

        def generate_analysis_summary(self, result):
            return "recover-summary"

    async def _run() -> None:
        await init_db_schema()
        unique = uuid4().hex[:10]
        project = Project(id=f"proj-{unique}", user_id="u-poison", title="幂等毒化恢复测试")
        chapter = Chapter(
            id=f"chap-{unique}",
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="用于测试幂等毒化恢复",
            word_count=len("用于测试幂等毒化恢复"),
            status="completed",
        )
        project_id = project.id
        chapter_id = chapter.id
        idem_key = f"poison-idem-{unique}"

        async with AsyncSessionLocal() as db:
            db.add(project)
            await db.commit()
            db.add(chapter)
            await db.commit()
            await db.refresh(chapter)

            # Simulate poisoned window: key exists but task row is missing.
            consumed = await orchestration_service.consume_idempotency_key(
                db,
                key=idem_key,
                user_id="u-poison",
                action=orchestration_service.ANALYSIS_ACTION,
            )
            assert consumed is True
            await db.refresh(chapter)

            with patch(
                "app.gateway.novel_migrated.services.orchestration_service.get_plot_analyzer",
                return_value=_Analyzer(),
            ):
                result = await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project_id,
                    user_id="u-poison",
                    ai_service=object(),
                    idempotency_key=idem_key,
                )
                assert result.used_cached is False

            task_result = await db.execute(
                select(AnalysisTask)
                .where(AnalysisTask.chapter_id == chapter_id)
                .order_by(AnalysisTask.created_at.desc())
                .limit(1)
            )
            task = task_result.scalar_one_or_none()
            assert task is not None
            assert task.status == "completed"

    asyncio.run(_run())


def test_analysis_pipeline_does_not_release_conflicting_idempotency_owner():
    async def _run() -> None:
        await init_db_schema()
        unique = uuid4().hex[:10]
        project = Project(id=f"proj-{unique}", user_id="u-conflict", title="幂等冲突保护测试")
        chapter = Chapter(
            id=f"chap-{unique}",
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="用于测试幂等 owner 冲突保护",
            word_count=len("用于测试幂等 owner 冲突保护"),
            status="completed",
        )
        project_id = project.id
        chapter_id = chapter.id
        idem_key = f"poison-idem-{unique}"

        async with AsyncSessionLocal() as db:
            db.add(project)
            await db.commit()
            db.add(chapter)
            await db.commit()
            await db.refresh(chapter)

            consumed = await orchestration_service.consume_idempotency_key(
                db,
                key=idem_key,
                user_id="u-other",
                action="other_action",
            )
            assert consumed is True

            try:
                await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project_id,
                    user_id="u-conflict",
                    ai_service=object(),
                    idempotency_key=idem_key,
                )
                assert False, "不同 owner 的幂等键不应被当前请求恢复占用"
            except RuntimeError as exc:
                assert "重复提交" in str(exc)

            key_result = await db.execute(
                select(IntentIdempotencyKey).where(IntentIdempotencyKey.key == idem_key)
            )
            key_row = key_result.scalar_one_or_none()
            assert key_row is not None
            assert key_row.user_id == "u-other"
            assert key_row.action == "other_action"

            task_result = await db.execute(
                select(AnalysisTask).where(AnalysisTask.chapter_id == chapter_id)
            )
            assert task_result.scalar_one_or_none() is None

    asyncio.run(_run())


def test_analysis_pipeline_does_not_release_conflicting_idempotency_same_user_diff_action():
    async def _run() -> None:
        await init_db_schema()
        unique = uuid4().hex[:10]
        shared_user_id = "u-conflict-same-user"
        project = Project(id=f"proj-{unique}", user_id=shared_user_id, title="幂等冲突保护测试-同用户不同动作")
        chapter = Chapter(
            id=f"chap-{unique}",
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="用于测试同用户不同动作的幂等冲突保护",
            word_count=len("用于测试同用户不同动作的幂等冲突保护"),
            status="completed",
        )
        project_id = project.id
        chapter_id = chapter.id
        idem_key = f"poison-idem-{unique}"

        async with AsyncSessionLocal() as db:
            db.add(project)
            await db.commit()
            db.add(chapter)
            await db.commit()
            await db.refresh(chapter)

            consumed = await orchestration_service.consume_idempotency_key(
                db,
                key=idem_key,
                user_id=shared_user_id,
                action="other_action",
            )
            assert consumed is True

            try:
                await orchestration_service.run_analysis_pipeline(
                    db=db,
                    chapter=chapter,
                    project_id=project_id,
                    user_id=shared_user_id,
                    ai_service=object(),
                    idempotency_key=idem_key,
                )
                assert False, "同用户不同动作的幂等键不应被当前请求恢复占用"
            except RuntimeError as exc:
                assert "重复提交" in str(exc)

            key_result = await db.execute(
                select(IntentIdempotencyKey).where(IntentIdempotencyKey.key == idem_key)
            )
            key_row = key_result.scalar_one_or_none()
            assert key_row is not None
            assert key_row.user_id == shared_user_id
            assert key_row.action == "other_action"

            task_result = await db.execute(
                select(AnalysisTask).where(AnalysisTask.chapter_id == chapter_id)
            )
            assert task_result.scalar_one_or_none() is None

    asyncio.run(_run())
