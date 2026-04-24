"""Finalize gate report builder.

This module hosts the "gate report" concerns that used to live in the monolithic
`consistency_gate_service.py`.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.lifecycle_service import lifecycle_service
from app.gateway.novel_migrated.services.quality_gate_fusion_service import (
    FusionFallbackMode,
    quality_gate_fusion_service,
)
from deerflow.config.extensions_config import get_extensions_config

from .base import GateBase, GateLevel
from .checker import ConsistencyChecker

logger = get_logger(__name__)


class GateReporter(GateBase):
    """Builds finalize-gate reports and handles fusion feedback utilities."""

    _QUALITY_GATE_FUSION_FEATURE_FLAG = "novel_quality_gate_fusion"
    _QUALITY_GATE_FUSION_FALLBACK_MODE_ENV = "DEERFLOW_QUALITY_GATE_FUSION_FALLBACK_MODE"

    def __init__(self, *, checker: ConsistencyChecker | None = None) -> None:
        self._checker = checker or ConsistencyChecker()

    def _build_check_result(
        self,
        *,
        check_id: str,
        title: str,
        issues: list[dict[str, Any]],
    ) -> dict[str, Any]:
        levels = [issue.get("severity", "warn") for issue in issues]
        result = self._merge_levels(levels or ["pass"])
        message = self._format_gate_message(result, len(issues))

        return {
            "check_id": check_id,
            "title": title,
            "result": result,
            "message": message,
            "issue_count": len(issues),
            "issues": issues,
        }

    @staticmethod
    def _format_gate_message(level: GateLevel, issue_count: int) -> str:
        if level == "pass":
            return "检查通过"
        if level == "warn":
            return f"发现 {issue_count} 条警告"
        return f"发现 {issue_count} 条阻断问题"

    @classmethod
    def _resolve_fusion_fallback_mode(cls, config: Mapping[str, Any]) -> FusionFallbackMode:
        config_mode = str(config.get("fusion_degraded_fallback_mode") or "").strip().lower()
        env_mode = str(os.getenv(cls._QUALITY_GATE_FUSION_FALLBACK_MODE_ENV, "") or "").strip().lower()
        mode = config_mode or env_mode or "rule_only"
        if mode in {"rule_only", "warn_only"}:
            return mode  # type: ignore[return-value]
        return "rule_only"

    def _is_quality_gate_fusion_enabled(
        self,
        *,
        user_id: str | None,
        config: Mapping[str, Any],
    ) -> bool:
        if "quality_gate_fusion_feature_enabled" in config:
            return bool(config.get("quality_gate_fusion_feature_enabled"))
        try:
            cfg = get_extensions_config()
            if hasattr(cfg, "is_feature_enabled_for_user"):
                return bool(
                    cfg.is_feature_enabled_for_user(
                        self._QUALITY_GATE_FUSION_FEATURE_FLAG,
                        user_id=user_id,
                        default=False,
                    )
                )
            return bool(cfg.is_feature_enabled(self._QUALITY_GATE_FUSION_FEATURE_FLAG, default=False))
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning("quality gate fusion feature check failed: %s", exc)
            return False

    @staticmethod
    def _build_rule_signal_from_check(check: Mapping[str, Any]) -> dict[str, Any]:
        issues = check.get("issues") if isinstance(check.get("issues"), list) else []
        issue_messages = [str(issue.get("message") or "").strip() for issue in issues if isinstance(issue, Mapping) and str(issue.get("message") or "").strip()]
        evidence = issue_messages[:5]
        reasons = [str(check.get("message") or "").strip() or "规则门禁结果"]
        return {
            "level": str(check.get("result") or "pass"),
            "reasons": reasons,
            "evidence": evidence,
            "metadata": {
                "check_id": str(check.get("check_id") or ""),
                "issue_count": int(check.get("issue_count") or 0),
            },
        }

    @staticmethod
    def _normalize_model_signal(raw_signal: Any) -> Mapping[str, Any] | None:
        if raw_signal is None:
            return None
        if isinstance(raw_signal, Mapping):
            return raw_signal
        if isinstance(raw_signal, str):
            level = raw_signal.strip().lower()
            if level in {"pass", "warn", "block"}:
                return {"level": level}
        return None

    def _apply_quality_gate_fusion(
        self,
        *,
        checks: list[dict[str, Any]],
        project_id: str,
        feature_enabled: bool,
        degraded_fallback_mode: FusionFallbackMode,
        model_signals: Mapping[str, Any],
        apply_feedback_backflow: bool,
        feedback_evidence_key_prefix: str,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        fused_checks: list[dict[str, Any]] = []
        fusion_details: list[dict[str, Any]] = []

        for check in checks:
            check_id = str(check.get("check_id") or "unknown")
            issue_count = int(check.get("issue_count") or 0)
            rule_level = str(check.get("result") or "pass")
            rule_signal = self._build_rule_signal_from_check(check)
            model_signal = self._normalize_model_signal(model_signals.get(check_id))
            evidence_key = f"{feedback_evidence_key_prefix}:{project_id}:{check_id}"

            decision = quality_gate_fusion_service.fuse_results(
                rule_result=rule_signal,
                model_result=model_signal,
                gate_key=f"novel_finalize:{check_id}",
                feature_enabled=feature_enabled,
                degraded_fallback_mode=degraded_fallback_mode,
                feedback_evidence_key=evidence_key,
                apply_feedback_backflow=apply_feedback_backflow,
            )

            merged = dict(check)
            merged["rule_result"] = rule_level
            merged["result"] = decision.final_level
            merged["message"] = self._format_gate_message(decision.final_level, issue_count)
            merged["fusion"] = {
                "decision_id": decision.decision_id,
                "gate_key": decision.gate_key,
                "rule_level": decision.rule_level,
                "model_level": decision.model_level,
                "decision_path": list(decision.decision_path),
                "merged_evidence": decision.merged_evidence,
                "degraded_fallback": decision.degraded_fallback,
                "feedback_adjusted": decision.feedback_adjusted,
                "feedback_evidence_key": evidence_key,
            }
            fused_checks.append(merged)
            fusion_details.append(
                {
                    "check_id": check_id,
                    "decision_id": decision.decision_id,
                    "final_level": decision.final_level,
                    "rule_level": decision.rule_level,
                    "model_level": decision.model_level,
                    "decision_path": list(decision.decision_path),
                    "degraded_fallback": decision.degraded_fallback,
                    "feedback_adjusted": decision.feedback_adjusted,
                }
            )

        return (
            fused_checks,
            {
                "feature_enabled": feature_enabled,
                "degraded_fallback_mode": degraded_fallback_mode,
                "apply_feedback_backflow": apply_feedback_backflow,
                "checks": fusion_details,
            },
        )

    def record_false_positive_feedback(
        self,
        *,
        decision_id: str,
        gate_key: str,
        evidence_key: str,
        source: str,
        original_level: GateLevel,
        corrected_level: GateLevel,
        reason: str,
        reporter: str,
        note: str = "",
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        record = quality_gate_fusion_service.record_false_positive_feedback(
            decision_id=decision_id,
            gate_key=gate_key,
            evidence_key=evidence_key,
            source=source,  # type: ignore[arg-type]
            original_level=original_level,
            corrected_level=corrected_level,
            reason=reason,
            reporter=reporter,
            note=note,
            metadata=metadata,
        )
        return {
            "feedback_id": record.feedback_id,
            "decision_id": record.decision_id,
            "gate_key": record.gate_key,
            "evidence_key": record.evidence_key,
            "source": record.source,
            "original_level": record.original_level,
            "corrected_level": record.corrected_level,
            "reason": record.reason,
            "reporter": record.reporter,
            "note": record.note,
            "recorded_at": record.recorded_at,
            "metadata": record.metadata,
        }

    def get_false_positive_backflow(
        self,
        *,
        gate_key: str | None = None,
        evidence_key: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        return quality_gate_fusion_service.get_feedback_backflow_view(
            gate_key=gate_key,
            evidence_key=evidence_key,
            limit=limit,
        )

    async def _evaluate_foreshadow_closure(self, db: AsyncSession, project_id: str, max_chapter_number: int) -> list[dict[str, Any]]:
        rows = await db.execute(select(Foreshadow).where(Foreshadow.project_id == project_id))
        foreshadows = rows.scalars().all()

        unresolved_statuses = {"pending", "planted", "partially_resolved"}
        issues: list[dict[str, Any]] = []
        for foreshadow in foreshadows:
            status = self._normalize_text(foreshadow.status)
            if status not in unresolved_statuses:
                continue

            item_name = foreshadow.title
            target_chapter = foreshadow.target_resolve_chapter_number
            chapter_number = target_chapter or foreshadow.plant_chapter_number
            overdue = bool(target_chapter and max_chapter_number >= target_chapter)
            severity: GateLevel = "block" if overdue else "warn"
            message = f"伏笔“{item_name}”已到回收章节（目标第{target_chapter}章）但仍为 {status}。" if overdue else f"伏笔“{item_name}”尚未回收（状态 {status}）。"
            suggestion = "在对应章节补充回收情节并将状态更新为 resolved。" if overdue else "确认该伏笔是否保留；若继续保留，请补充明确的计划回收章节。"
            issues.append(
                self._build_issue(
                    conflict_type="foreshadow_closure",
                    severity=severity,
                    chapter_number=chapter_number,
                    entity_type="foreshadow",
                    entity_name=item_name,
                    field="status",
                    message=message,
                    suggestion=suggestion,
                )
            )
        return issues

    async def _evaluate_low_score_chapters(
        self,
        db: AsyncSession,
        project_id: str,
        *,
        low_score_warn_threshold: float,
        low_score_block_threshold: float,
    ) -> list[dict[str, Any]]:
        chapter_rows = await db.execute(select(Chapter).where(Chapter.project_id == project_id))
        chapters = chapter_rows.scalars().all()
        analysis_rows = await db.execute(select(PlotAnalysis).where(PlotAnalysis.project_id == project_id))
        analysis_map = {analysis.chapter_id: analysis for analysis in analysis_rows.scalars().all()}

        issues: list[dict[str, Any]] = []
        for chapter in chapters:
            if not (chapter.content or "").strip():
                continue
            analysis = analysis_map.get(chapter.id)
            if not analysis:
                issues.append(
                    self._build_issue(
                        conflict_type="low_score_chapter",
                        severity="warn",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=chapter.title,
                        field="analysis",
                        message=f"第{chapter.chapter_number}章缺少质量分析记录。",
                        suggestion="先执行章节分析，补齐评分后再做定稿门禁。",
                    )
                )
                continue

            score = analysis.overall_quality_score
            if score is None:
                issues.append(
                    self._build_issue(
                        conflict_type="low_score_chapter",
                        severity="warn",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=chapter.title,
                        field="overall_quality_score",
                        message=f"第{chapter.chapter_number}章缺少 overall_quality_score。",
                        suggestion="重新运行章节分析并补齐评分字段。",
                    )
                )
                continue

            if score < low_score_block_threshold:
                severity: GateLevel = "block"
            elif score < low_score_warn_threshold:
                severity = "warn"
            else:
                continue

            issues.append(
                self._build_issue(
                    conflict_type="low_score_chapter",
                    severity=severity,
                    chapter_id=chapter.id,
                    chapter_number=chapter.chapter_number,
                    entity_type="chapter",
                    entity_name=chapter.title,
                    field="overall_quality_score",
                    message=f"第{chapter.chapter_number}章评分过低：{score:.1f}。",
                    suggestion="优先根据分析建议修订该章，再重新分析确认评分提升。",
                    extra={
                        "score": score,
                        "warn_threshold": low_score_warn_threshold,
                        "block_threshold": low_score_block_threshold,
                    },
                )
            )
        return issues

    async def _evaluate_sensitive_words(
        self,
        db: AsyncSession,
        project_id: str,
        sensitive_words: list[str],
    ) -> list[dict[str, Any]]:
        chapter_rows = await db.execute(select(Chapter).where(Chapter.project_id == project_id))
        chapters = chapter_rows.scalars().all()

        normalized_terms = [term.strip() for term in sensitive_words if term and term.strip()]
        if not normalized_terms:
            return []

        issues: list[dict[str, Any]] = []
        for chapter in chapters:
            content = chapter.content or ""
            if not content:
                continue

            lowered = content.lower()
            for term in normalized_terms:
                if term.lower() not in lowered:
                    continue
                issues.append(
                    self._build_issue(
                        conflict_type="sensitive_word",
                        severity="block",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=chapter.title,
                        field="content",
                        message=f"第{chapter.chapter_number}章命中敏感词：{term}",
                        suggestion="替换或重写该段内容，确保通过内容安全审核后再定稿。",
                        extra={"matched_term": term},
                    )
                )
        return issues

    async def _evaluate_format_rules(
        self,
        db: AsyncSession,
        project_id: str,
        *,
        min_chapter_length_warn: int,
        min_chapter_length_block: int,
    ) -> list[dict[str, Any]]:
        chapter_rows = await db.execute(select(Chapter).where(Chapter.project_id == project_id))
        chapters = chapter_rows.scalars().all()

        punctuation_pattern = re.compile(r"[。！？!?]")
        issues: list[dict[str, Any]] = []
        for chapter in chapters:
            content = (chapter.content or "").strip()
            title = (chapter.title or "").strip()
            content_length = len(content)

            if not title:
                issues.append(
                    self._build_issue(
                        conflict_type="format_rule",
                        severity="block",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=f"chapter-{chapter.id}",
                        field="title",
                        message=f"第{chapter.chapter_number}章标题为空。",
                        suggestion="补全章节标题后再执行定稿。",
                    )
                )

            if content_length == 0:
                issues.append(
                    self._build_issue(
                        conflict_type="format_rule",
                        severity="block",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=title or f"chapter-{chapter.id}",
                        field="content",
                        message=f"第{chapter.chapter_number}章内容为空。",
                        suggestion="补齐正文内容后再执行定稿。",
                    )
                )
                continue

            if content_length < min_chapter_length_block:
                issues.append(
                    self._build_issue(
                        conflict_type="format_rule",
                        severity="block",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=title,
                        field="content_length",
                        message=f"第{chapter.chapter_number}章正文长度仅 {content_length} 字，低于阻断阈值 {min_chapter_length_block}。",
                        suggestion="扩写章节到合理篇幅，确保情节完整后再定稿。",
                    )
                )
            elif content_length < min_chapter_length_warn:
                issues.append(
                    self._build_issue(
                        conflict_type="format_rule",
                        severity="warn",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=title,
                        field="content_length",
                        message=f"第{chapter.chapter_number}章正文长度 {content_length} 字，低于建议阈值 {min_chapter_length_warn}。",
                        suggestion="建议补充场景或人物动作，避免章节过短影响阅读体验。",
                    )
                )

            if punctuation_pattern.search(content) is None:
                issues.append(
                    self._build_issue(
                        conflict_type="format_rule",
                        severity="warn",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="chapter",
                        entity_name=title,
                        field="punctuation",
                        message=f"第{chapter.chapter_number}章缺少句末标点，格式可读性较差。",
                        suggestion="补充基础标点与段落断句，确保文本可读。",
                    )
                )

            if chapter.word_count and content_length > 0:
                diff_ratio = abs(chapter.word_count - content_length) / max(content_length, 1)
                if diff_ratio > 0.35:
                    issues.append(
                        self._build_issue(
                            conflict_type="format_rule",
                            severity="warn",
                            chapter_id=chapter.id,
                            chapter_number=chapter.chapter_number,
                            entity_type="chapter",
                            entity_name=title,
                            field="word_count",
                            message=f"第{chapter.chapter_number}章 word_count({chapter.word_count}) 与实际长度({content_length})偏差过大。",
                            suggestion="重新同步字数统计，避免后续质量门禁基线失真。",
                        )
                    )

        return issues

    async def build_finalize_gate_report(
        self,
        db: AsyncSession,
        project_id: str,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """执行定稿门禁检查，输出标准化三级结果。"""
        config = config or {}
        low_score_warn_threshold = float(config.get("low_score_warn_threshold", 6.5))
        low_score_block_threshold = float(config.get("low_score_block_threshold", 5.0))
        min_chapter_length_warn = int(config.get("min_chapter_length_warn", 300))
        min_chapter_length_block = int(config.get("min_chapter_length_block", 80))
        sensitive_words = config.get("sensitive_words") or list(self.DEFAULT_SENSITIVE_TERMS)

        chapter_rows = await db.execute(select(Chapter).where(Chapter.project_id == project_id))
        chapters = chapter_rows.scalars().all()
        max_chapter_number = max((chapter.chapter_number for chapter in chapters), default=0)

        consistency_report = await self._checker.build_consistency_report(db, project_id)

        consistency_check = self._build_check_result(
            check_id="consistency",
            title="跨章一致性",
            issues=list(consistency_report.get("conflicts", [])),
        )
        foreshadow_check = self._build_check_result(
            check_id="foreshadow_closure",
            title="伏笔回收检查",
            issues=await self._evaluate_foreshadow_closure(db, project_id, max_chapter_number),
        )
        low_score_check = self._build_check_result(
            check_id="low_score_chapters",
            title="低分章节检查",
            issues=await self._evaluate_low_score_chapters(
                db,
                project_id,
                low_score_warn_threshold=low_score_warn_threshold,
                low_score_block_threshold=low_score_block_threshold,
            ),
        )
        sensitive_check = self._build_check_result(
            check_id="sensitive_words",
            title="敏感词检查",
            issues=await self._evaluate_sensitive_words(db, project_id, list(sensitive_words)),
        )
        format_check = self._build_check_result(
            check_id="format_rules",
            title="格式规则检查",
            issues=await self._evaluate_format_rules(
                db,
                project_id,
                min_chapter_length_warn=min_chapter_length_warn,
                min_chapter_length_block=min_chapter_length_block,
            ),
        )

        checks = [
            consistency_check,
            foreshadow_check,
            low_score_check,
            sensitive_check,
            format_check,
        ]
        project_result = await db.execute(select(Project).where(Project.id == project_id))
        project = project_result.scalar_one_or_none()
        if not project:
            raise ValueError(f"project {project_id} not found")

        fusion_feature_enabled = self._is_quality_gate_fusion_enabled(
            user_id=project.user_id,
            config=config,
        )
        fusion_fallback_mode = self._resolve_fusion_fallback_mode(config)
        model_signals = config.get("model_gate_signals")
        if not isinstance(model_signals, Mapping):
            model_signals = {}
        apply_feedback_backflow = bool(config.get("apply_feedback_backflow", True))
        feedback_evidence_key_prefix = str(config.get("feedback_evidence_key_prefix") or "").strip() or "novel_finalize_gate"

        checks, gate_fusion = self._apply_quality_gate_fusion(
            checks=checks,
            project_id=project_id,
            feature_enabled=fusion_feature_enabled,
            degraded_fallback_mode=fusion_fallback_mode,
            model_signals=model_signals,
            apply_feedback_backflow=apply_feedback_backflow,
            feedback_evidence_key_prefix=feedback_evidence_key_prefix,
        )

        overall_result = self._merge_levels([check["result"] for check in checks])
        total_issues = sum(check["issue_count"] for check in checks)
        block_checks = sum(1 for check in checks if check["result"] == "block")
        warn_checks = sum(1 for check in checks if check["result"] == "warn")

        lifecycle_enabled = lifecycle_service.is_enabled(user_id=project.user_id)
        publish_strategy = lifecycle_service.build_publish_strategy(current_status=project.status)

        return {
            "project_id": project_id,
            "checked_at": datetime.now(tz=UTC).isoformat(),
            "result": overall_result,
            "can_finalize": overall_result != "block",
            "summary": {
                "total_checks": len(checks),
                "block_checks": block_checks,
                "warn_checks": warn_checks,
                "total_issues": total_issues,
            },
            "checks": checks,
            "consistency_report": consistency_report,
            "config": {
                "low_score_warn_threshold": low_score_warn_threshold,
                "low_score_block_threshold": low_score_block_threshold,
                "min_chapter_length_warn": min_chapter_length_warn,
                "min_chapter_length_block": min_chapter_length_block,
                "sensitive_words_count": len(list(sensitive_words)),
                "quality_gate_fusion_feature_enabled": fusion_feature_enabled,
                "fusion_degraded_fallback_mode": fusion_fallback_mode,
                "apply_feedback_backflow": apply_feedback_backflow,
            },
            "gate_fusion": gate_fusion,
            "lifecycle": {
                "feature_enabled": lifecycle_enabled,
                "degraded_fallback": not lifecycle_enabled,
                "current_status": project.status,
                "recommended_gate_status": "gated" if overall_result != "block" else project.status,
                "publish_strategy": publish_strategy,
            },
        }
