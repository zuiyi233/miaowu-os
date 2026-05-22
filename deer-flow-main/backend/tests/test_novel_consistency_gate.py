from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from app.gateway.novel_migrated.api import polish
from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.consistency_gate_service import consistency_gate_service
from app.gateway.novel_migrated.services.quality_gate_fusion_service import quality_gate_fusion_service
from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig


async def _cleanup_project(project_id: str) -> None:
    async with AsyncSessionLocal() as session:
        await session.execute(delete(Project).where(Project.id == project_id))
        await session.commit()


@pytest.mark.anyio
async def test_consistency_report_detects_character_item_and_timeline_conflicts() -> None:
    await init_db_schema()
    user_id = f"consistency-user-{uuid.uuid4()}"

    async with AsyncSessionLocal() as session:
        project = Project(user_id=user_id, title="一致性冲突测试")
        session.add(project)
        await session.flush()

        chapter1 = Chapter(
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="林川在古庙中发现青铜钥匙，随后重伤倒下。",
            word_count=22,
            status="completed",
        )
        chapter2 = Chapter(
            project_id=project.id,
            chapter_number=2,
            title="第二章",
            content="林川突然生还，并声称自己一直在追查遗失王冠。",
            word_count=24,
            status="completed",
        )
        chapter3 = Chapter(
            project_id=project.id,
            chapter_number=2,
            title="第二章-重复",
            content="重复章节号用于制造时间线冲突。",
            word_count=14,
            status="draft",
        )
        session.add_all([chapter1, chapter2, chapter3])
        await session.flush()

        analysis1 = PlotAnalysis(
            project_id=project.id,
            chapter_id=chapter1.id,
            character_states=[
                {
                    "character_name": "林川",
                    "survival_status": "deceased",
                    "state_before": "恐惧",
                    "state_after": "死亡",
                }
            ],
            foreshadows=[
                {
                    "title": "青铜钥匙",
                    "content": "钥匙似乎与王冠有关",
                    "category": "item",
                    "type": "planted",
                    "estimated_resolve_chapter": 5,
                }
            ],
            overall_quality_score=7.1,
        )
        analysis2 = PlotAnalysis(
            project_id=project.id,
            chapter_id=chapter2.id,
            character_states=[
                {
                    "character_name": "林川",
                    "survival_status": "active",
                    "state_before": "冷静",
                    "state_after": "激动",
                }
            ],
            foreshadows=[
                {
                    "title": "遗失王冠",
                    "content": "王冠被提前回收",
                    "category": "item",
                    "type": "resolved",
                },
                {
                    "title": "青铜钥匙",
                    "content": "重复埋下且时间目标错误",
                    "category": "item",
                    "type": "planted",
                    "estimated_resolve_chapter": 1,
                },
            ],
            overall_quality_score=6.8,
        )
        session.add_all([analysis1, analysis2])

        wrong_timeline_item = Foreshadow(
            project_id=project.id,
            title="古卷",
            content="古卷写着未来预言",
            category="item",
            status="planted",
            plant_chapter_number=4,
            target_resolve_chapter_number=2,
        )
        session.add(wrong_timeline_item)
        await session.commit()

        report = await consistency_gate_service.build_consistency_report(session, project.id)

    try:
        summary = report["summary"]["conflict_counts"]
        assert summary["character_setting_conflict"] >= 1
        assert summary["item_state_conflict"] >= 1
        assert summary["timeline_conflict"] >= 1

        sample_issue = report["conflicts"][0]
        assert "chapter_number" in sample_issue
        assert "entity" in sample_issue
        assert "field" in sample_issue
        assert sample_issue["suggestion"]
    finally:
        await _cleanup_project(project.id)


@pytest.mark.anyio
async def test_finalize_gate_blocks_and_finalize_endpoint_rejects() -> None:
    await init_db_schema()
    user_id = f"gate-block-user-{uuid.uuid4()}"

    async with AsyncSessionLocal() as session:
        project = Project(user_id=user_id, title="阻断定稿测试")
        session.add(project)
        await session.flush()

        chapter = Chapter(
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content="这里包含炸弹制作教程的敏感内容，用于测试阻断。",
            word_count=24,
            status="completed",
        )
        session.add(chapter)
        await session.flush()

        analysis = PlotAnalysis(
            project_id=project.id,
            chapter_id=chapter.id,
            overall_quality_score=4.2,
        )
        session.add(analysis)

        unresolved = Foreshadow(
            project_id=project.id,
            title="旧誓言",
            content="主角曾立下誓言",
            status="planted",
            plant_chapter_number=1,
            target_resolve_chapter_number=1,
        )
        session.add(unresolved)
        await session.commit()

    app = FastAPI()
    app.include_router(polish.router)
    app.dependency_overrides[polish.get_user_id] = lambda: user_id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        gate_response = await client.post(f"/polish/projects/{project.id}/finalize-gate", json={})
        assert gate_response.status_code == 200
        gate_payload = gate_response.json()
        assert gate_payload["result"] == "block"
        assert any(check["check_id"] == "sensitive_words" and check["result"] == "block" for check in gate_payload["checks"])

        finalize_response = await client.post(f"/polish/projects/{project.id}/finalize", json={})
        assert finalize_response.status_code == 409
        detail = finalize_response.json()["detail"]
        assert detail["gate_report"]["result"] == "block"

        # compatibility route: frontend default proxy path is /api/*
        consistency_response_api = await client.get(f"/api/polish/projects/{project.id}/consistency-report")
        assert consistency_response_api.status_code == 200
        assert "summary" in consistency_response_api.json()

        gate_response_api = await client.post(f"/api/polish/projects/{project.id}/finalize-gate", json={})
        assert gate_response_api.status_code == 200
        assert gate_response_api.json()["result"] == "block"

        finalize_response_api = await client.post(f"/api/polish/projects/{project.id}/finalize", json={})
        assert finalize_response_api.status_code == 409
        assert finalize_response_api.json()["detail"]["gate_report"]["result"] == "block"

    async with AsyncSessionLocal() as verify_session:
        result = await verify_session.execute(select(Project).where(Project.id == project.id))
        refreshed = result.scalar_one()
        assert refreshed.status != "finalized"

    await _cleanup_project(project.id)


@pytest.mark.anyio
async def test_finalize_endpoint_allows_warn_result() -> None:
    await init_db_schema()
    user_id = f"gate-warn-user-{uuid.uuid4()}"

    chapter_content = "夜色压城，江面风浪翻涌。主角沿着旧码头缓慢前行，回想前夜与师父的争执。他在仓库里找到遗失的线索，却仍无法确认幕后之人。章节暂时收束在新的疑问上。远处汽笛再度响起，他决定连夜追查旧案卷宗，给下一章留下明确行动目标。"

    async with AsyncSessionLocal() as session:
        project = Project(user_id=user_id, title="告警可放行测试")
        session.add(project)
        await session.flush()

        chapter = Chapter(
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content=chapter_content,
            word_count=len(chapter_content),
            status="completed",
        )
        session.add(chapter)
        await session.flush()

        analysis = PlotAnalysis(
            project_id=project.id,
            chapter_id=chapter.id,
            overall_quality_score=6.2,
        )
        session.add(analysis)
        await session.commit()

    app = FastAPI()
    app.include_router(polish.router)
    app.dependency_overrides[polish.get_user_id] = lambda: user_id

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(f"/polish/projects/{project.id}/finalize", json={})
        assert response.status_code == 200
        payload = response.json()
        assert payload["finalized"] is True
        assert payload["gate_report"]["result"] in {"pass", "warn"}

    async with AsyncSessionLocal() as verify_session:
        result = await verify_session.execute(select(Project).where(Project.id == project.id))
        refreshed = result.scalar_one()
        assert refreshed.status == "finalized"

    await _cleanup_project(project.id)


@pytest.mark.anyio
async def test_finalize_project_lifecycle_strategy_transitions_when_feature_enabled() -> None:
    await init_db_schema()
    user_id = f"gate-lifecycle-user-{uuid.uuid4()}"
    chapter_content = "晨雾尚未散去，旧城墙上的风铃被北风吹得清响。主角沿着石阶反复确认前夜留下的符号，逐步拼出敌方行军路线。他在驿站与同伴会合后决定分头追踪，确保下一章能无缝推进主线。这一章以新的调查目标收束，同时保留必要悬念。"

    async with AsyncSessionLocal() as session:
        project = Project(user_id=user_id, title="生命周期门禁测试")
        session.add(project)
        await session.flush()

        chapter = Chapter(
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content=chapter_content,
            word_count=len(chapter_content),
            status="completed",
        )
        session.add(chapter)
        await session.flush()

        analysis = PlotAnalysis(
            project_id=project.id,
            chapter_id=chapter.id,
            overall_quality_score=8.0,
        )
        session.add(analysis)
        await session.commit()

    lifecycle_cfg = ExtensionsConfig(features={"novel_lifecycle_v2": FeatureFlagConfig(enabled=True, rollout_percentage=100)})

    async with AsyncSessionLocal() as session:
        with patch(
            "app.gateway.novel_migrated.services.lifecycle_service.get_extensions_config",
            return_value=lifecycle_cfg,
        ):
            passed, report = await consistency_gate_service.finalize_project(
                db=session,
                project_id=project.id,
                config={},
            )
            assert passed is True
            assert report["project_status"] == "finalized"
            assert report["lifecycle"]["feature_enabled"] is True
            transitions = report["lifecycle"]["transitions"]
            assert len(transitions) >= 2
            assert transitions[0]["target_status"] == "gated"
            assert transitions[1]["target_status"] == "finalized"
            assert report["lifecycle"]["publish_strategy"]["can_publish"] is True

    async with AsyncSessionLocal() as verify_session:
        result = await verify_session.execute(select(Project).where(Project.id == project.id))
        refreshed = result.scalar_one()
        assert refreshed.status == "finalized"

    await _cleanup_project(project.id)


@pytest.mark.anyio
async def test_finalize_gate_applies_rule_model_fusion_when_feature_enabled() -> None:
    await init_db_schema()
    user_id = f"gate-fusion-user-{uuid.uuid4()}"
    chapter_content = "夜雾贴着河岸缓慢蔓延，主角在废弃码头找到残破航图。他意识到线索并不完整，决定暂时按兵不动并回收更多证据。"

    async with AsyncSessionLocal() as session:
        project = Project(user_id=user_id, title="融合门禁测试")
        session.add(project)
        await session.flush()

        chapter = Chapter(
            project_id=project.id,
            chapter_number=1,
            title="第一章",
            content=chapter_content,
            word_count=len(chapter_content),
            status="completed",
        )
        session.add(chapter)
        await session.flush()
        session.add(
            PlotAnalysis(
                project_id=project.id,
                chapter_id=chapter.id,
                overall_quality_score=6.0,
            )
        )
        await session.commit()

    fusion_cfg = ExtensionsConfig(features={"novel_quality_gate_fusion": FeatureFlagConfig(enabled=True, rollout_percentage=100)})

    async with AsyncSessionLocal() as session:
        with patch(
            "app.gateway.novel_migrated.services.consistency_gate.reporter.get_extensions_config",
            return_value=fusion_cfg,
        ):
            report = await consistency_gate_service.build_finalize_gate_report(
                db=session,
                project_id=project.id,
                config={
                    "min_chapter_length_warn": 1,
                    "min_chapter_length_block": 1,
                    "model_gate_signals": {
                        "low_score_chapters": {
                            "level": "block",
                            "evidence": ["model:结构风险过高"],
                        }
                    },
                    "apply_feedback_backflow": False,
                },
            )

    try:
        low_score_check = next(item for item in report["checks"] if item["check_id"] == "low_score_chapters")
        assert low_score_check["rule_result"] == "warn"
        assert low_score_check["result"] == "block"
        assert low_score_check["fusion"]["model_level"] == "block"
        assert report["result"] == "block"
        assert report["gate_fusion"]["feature_enabled"] is True
        assert report["gate_fusion"]["degraded_fallback_mode"] in {"rule_only", "warn_only"}
    finally:
        await _cleanup_project(project.id)


@pytest.mark.anyio
async def test_quality_gate_feedback_endpoints_roundtrip() -> None:
    quality_gate_fusion_service.clear_feedback_records()

    app = FastAPI()
    app.include_router(polish.router)
    app.dependency_overrides[polish.get_user_id] = lambda: "feedback-user"

    payload = {
        "decision_id": "decision-001",
        "gate_key": "novel_finalize:low_score_chapters",
        "evidence_key": "novel_finalize_gate:proj-1:low_score_chapters",
        "source": "fusion",
        "original_level": "block",
        "corrected_level": "warn",
        "reason": "人工复核确认误报",
        "reporter": "",
        "note": "允许继续修订流程",
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        submit = await client.post("/polish/quality-gate/false-positive-feedback", json=payload)
        assert submit.status_code == 200
        submit_data = submit.json()
        assert submit_data["feedback_id"] == 1
        assert submit_data["reporter"] == "feedback-user"

        submit_api = await client.post("/api/polish/quality-gate/false-positive-feedback", json=payload)
        assert submit_api.status_code == 200
        assert submit_api.json()["feedback_id"] == 2

        read_back = await client.get(
            "/api/polish/quality-gate/false-positive-feedback",
            params={
                "gate_key": "novel_finalize:low_score_chapters",
                "limit": 10,
            },
        )
        assert read_back.status_code == 200
        body = read_back.json()
        assert body["total"] >= 2
        assert body["by_source"]["fusion"] >= 2
        assert body["records"][0]["gate_key"] == "novel_finalize:low_score_chapters"
