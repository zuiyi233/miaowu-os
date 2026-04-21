"""跨章一致性与定稿门禁服务。"""
from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.lifecycle_service import lifecycle_service
from app.gateway.novel_migrated.services.quality_gate_fusion_service import (
    FusionFallbackMode,
    quality_gate_fusion_service,
)
from deerflow.config.extensions_config import get_extensions_config

logger = get_logger(__name__)

GateLevel = Literal["pass", "warn", "block"]


class ConsistencyGateService:
    """跨章一致性与定稿门禁聚合服务。"""

    _QUALITY_GATE_FUSION_FEATURE_FLAG = "novel_quality_gate_fusion"
    _QUALITY_GATE_FUSION_FALLBACK_MODE_ENV = "DEERFLOW_QUALITY_GATE_FUSION_FALLBACK_MODE"

    DEFAULT_SENSITIVE_TERMS = (
        "炸弹制作",
        "毒品配方",
        "儿童色情",
        "恐怖袭击指南",
        "种族灭绝",
    )

    STATUS_ALIVE = {"active"}
    STATUS_SPECIAL = {"missing", "retired"}
    STATUS_DEAD = {"deceased", "destroyed"}

    def _merge_levels(self, levels: list[GateLevel]) -> GateLevel:
        if "block" in levels:
            return "block"
        if "warn" in levels:
            return "warn"
        return "pass"

    def _normalize_text(self, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip().lower()

    def _normalize_status(self, value: Any) -> str:
        status = self._normalize_text(value)
        if not status:
            return ""
        if status in self.STATUS_DEAD:
            return "deceased"
        if status in self.STATUS_ALIVE:
            return "active"
        if status in self.STATUS_SPECIAL:
            return status
        return status

    def _text_consistent(self, left: str, right: str) -> bool:
        if left == right:
            return True
        if left and right and (left in right or right in left):
            return True
        return False

    def _as_list(self, value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return []
            if isinstance(parsed, list):
                return [item for item in parsed if isinstance(item, dict)]
        return []

    def _to_int(self, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        try:
            return int(value)
        except Exception:
            return None

    def _build_issue(
        self,
        *,
        conflict_type: str,
        severity: GateLevel,
        message: str,
        suggestion: str,
        chapter_id: str | None = None,
        chapter_number: int | None = None,
        entity_type: str = "unknown",
        entity_name: str | None = None,
        field: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "conflict_type": conflict_type,
            "severity": severity,
            "chapter_id": chapter_id,
            "chapter_number": chapter_number,
            "entity": {
                "type": entity_type,
                "name": entity_name or "",
            },
            "field": field or "",
            "message": message,
            "suggestion": suggestion,
        }
        if extra:
            payload["extra"] = extra
        return payload

    def _deduplicate_issues(self, issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[Any, ...]] = set()
        for issue in issues:
            entity = issue.get("entity") or {}
            key = (
                issue.get("conflict_type"),
                issue.get("severity"),
                issue.get("chapter_id"),
                issue.get("chapter_number"),
                entity.get("type"),
                entity.get("name"),
                issue.get("field"),
                issue.get("message"),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(issue)
        return deduped

    def _build_chapter_snapshots(
        self,
        chapters: list[Chapter],
        analysis_map: dict[str, PlotAnalysis],
    ) -> list[dict[str, Any]]:
        snapshots: list[dict[str, Any]] = []
        for chapter in chapters:
            analysis = analysis_map.get(chapter.id)
            character_states = self._as_list(analysis.character_states if analysis else None)
            foreshadows = self._as_list(analysis.foreshadows if analysis else None)

            character_snapshot = []
            for item in character_states:
                name = str(item.get("character_name") or "").strip()
                if not name:
                    continue
                character_snapshot.append(
                    {
                        "character_name": name,
                        "survival_status": self._normalize_status(item.get("survival_status")),
                        "state_before": str(item.get("state_before") or "").strip(),
                        "state_after": str(item.get("state_after") or "").strip(),
                    }
                )

            item_snapshot = []
            for item in foreshadows:
                category = self._normalize_text(item.get("category"))
                if category != "item":
                    continue
                title = str(item.get("title") or "").strip()
                fallback_content = str(item.get("content") or "").strip()
                item_name = title or fallback_content[:30]
                if not item_name:
                    continue
                item_snapshot.append(
                    {
                        "item_name": item_name,
                        "state": self._normalize_text(item.get("type")),
                        "reference_chapter": self._to_int(item.get("reference_chapter")),
                        "reference_foreshadow_id": str(item.get("reference_foreshadow_id") or "").strip() or None,
                        "estimated_resolve_chapter": self._to_int(item.get("estimated_resolve_chapter")),
                    }
                )

            snapshots.append(
                {
                    "chapter_id": chapter.id,
                    "chapter_number": chapter.chapter_number,
                    "title": chapter.title,
                    "status": chapter.status,
                    "characters": character_snapshot,
                    "items": item_snapshot,
                    "timeline": {
                        "plot_stage": getattr(analysis, "plot_stage", None),
                        "conflict_level": getattr(analysis, "conflict_level", None),
                        "foreshadow_events": len(foreshadows),
                    },
                }
            )

        snapshots.sort(key=lambda item: item.get("chapter_number") or 0)
        return snapshots

    def _detect_character_setting_conflicts(
        self,
        snapshots: list[dict[str, Any]],
        known_character_names: set[str],
    ) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        latest_status: dict[str, tuple[str, int, str]] = {}
        latest_state_after: dict[str, tuple[str, int, str]] = {}
        unknown_seen: set[str] = set()
        chapter_status_seen: dict[tuple[int, str], str] = {}

        for snapshot in snapshots:
            chapter_id = snapshot.get("chapter_id")
            chapter_number = snapshot.get("chapter_number")

            for character in snapshot.get("characters", []):
                name = str(character.get("character_name") or "").strip()
                if not name:
                    continue
                normalized_name = self._normalize_text(name)
                current_status = self._normalize_status(character.get("survival_status"))
                state_before = self._normalize_text(character.get("state_before"))
                state_after = self._normalize_text(character.get("state_after"))

                if normalized_name and normalized_name not in known_character_names and normalized_name not in unknown_seen:
                    unknown_seen.add(normalized_name)
                    issues.append(
                        self._build_issue(
                            conflict_type="character_setting_conflict",
                            severity="warn",
                            chapter_id=chapter_id,
                            chapter_number=chapter_number,
                            entity_type="character",
                            entity_name=name,
                            field="character_name",
                            message=f"第{chapter_number}章出现未建档角色“{name}”，可能导致跨章设定漂移。",
                            suggestion="请先在角色库补全该角色，再重新执行章节分析以建立一致的追踪基线。",
                        )
                    )

                chapter_key = (chapter_number or 0, normalized_name)
                if current_status:
                    chapter_prev_status = chapter_status_seen.get(chapter_key)
                    if chapter_prev_status and chapter_prev_status != current_status:
                        issues.append(
                            self._build_issue(
                                conflict_type="character_setting_conflict",
                                severity="block",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="character",
                                entity_name=name,
                                field="survival_status",
                                message=f"第{chapter_number}章内角色“{name}”存在互斥生存状态（{chapter_prev_status} 与 {current_status}）。",
                                suggestion="合并或修正该章分析结果，确保同一角色在同章只保留一个生存状态。",
                            )
                        )
                    chapter_status_seen[chapter_key] = current_status

                previous_status_entry = latest_status.get(normalized_name)
                if previous_status_entry and current_status:
                    previous_status, previous_chapter, previous_chapter_id = previous_status_entry
                    if previous_status == "deceased" and current_status != "deceased":
                        issues.append(
                            self._build_issue(
                                conflict_type="character_setting_conflict",
                                severity="block",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="character",
                                entity_name=name,
                                field="survival_status",
                                message=f"角色“{name}”在第{previous_chapter}章已标记死亡，但在第{chapter_number}章回退为“{current_status}”。",
                                suggestion="核对死亡章节与后续剧情：若角色复活需补充明确事件；否则将后续状态改为 deceased。",
                                extra={
                                    "previous_chapter_id": previous_chapter_id,
                                    "previous_chapter_number": previous_chapter,
                                },
                            )
                        )
                    elif previous_status in self.STATUS_SPECIAL and current_status == "active":
                        issues.append(
                            self._build_issue(
                                conflict_type="character_setting_conflict",
                                severity="warn",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="character",
                                entity_name=name,
                                field="survival_status",
                                message=f"角色“{name}”在第{previous_chapter}章状态为“{previous_status}”，第{chapter_number}章恢复为 active。",
                                suggestion="若确有回归剧情，请在正文中补充事件锚点并更新角色状态说明。",
                            )
                        )

                previous_state_entry = latest_state_after.get(normalized_name)
                if previous_state_entry and state_before:
                    previous_state_after, previous_chapter, _previous_chapter_id = previous_state_entry
                    if previous_state_after and not self._text_consistent(previous_state_after, state_before):
                        issues.append(
                            self._build_issue(
                                conflict_type="character_setting_conflict",
                                severity="warn",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="character",
                                entity_name=name,
                                field="state_before",
                                message=f"角色“{name}”第{chapter_number}章 state_before 与第{previous_chapter}章 state_after 不连续。",
                                suggestion="回看两章衔接段，统一角色心理/行为过渡描述，保持前后状态可追踪。",
                            )
                        )

                if current_status:
                    latest_status[normalized_name] = (current_status, chapter_number or 0, chapter_id or "")
                if state_after:
                    latest_state_after[normalized_name] = (state_after, chapter_number or 0, chapter_id or "")

        return issues

    def _detect_item_and_timeline_conflicts(
        self,
        snapshots: list[dict[str, Any]],
        foreshadows: list[Foreshadow],
    ) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []

        planted_items: dict[str, tuple[int, str]] = {}
        resolved_items: dict[str, tuple[int, str]] = {}

        for snapshot in snapshots:
            chapter_id = snapshot.get("chapter_id")
            chapter_number = snapshot.get("chapter_number")

            for item in snapshot.get("items", []):
                item_name = str(item.get("item_name") or "").strip()
                if not item_name:
                    continue
                key = self._normalize_text(item_name)
                state = self._normalize_text(item.get("state"))
                reference_chapter = item.get("reference_chapter")
                reference_foreshadow_id = item.get("reference_foreshadow_id")
                estimated_resolve_chapter = item.get("estimated_resolve_chapter")

                if state == "resolved":
                    if key not in planted_items and not reference_foreshadow_id:
                        issues.append(
                            self._build_issue(
                                conflict_type="item_state_conflict",
                                severity="block",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="item",
                                entity_name=item_name,
                                field="type",
                                message=f"物品“{item_name}”在第{chapter_number}章被标记为 resolved，但未找到已埋下记录。",
                                suggestion="先补齐该物品的 planted 记录，或为回收项填写正确的 reference_foreshadow_id。",
                            )
                        )
                    if key in resolved_items:
                        issues.append(
                            self._build_issue(
                                conflict_type="item_state_conflict",
                                severity="warn",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="item",
                                entity_name=item_name,
                                field="type",
                                message=f"物品“{item_name}”在多章重复标记 resolved，可能存在重复回收。",
                                suggestion="检查回收逻辑，保留一次有效回收并把其他记录改为铺垫或删除。",
                            )
                        )
                    resolved_items[key] = (chapter_number or 0, chapter_id or "")

                if state == "planted":
                    if key in planted_items and key not in resolved_items:
                        issues.append(
                            self._build_issue(
                                conflict_type="item_state_conflict",
                                severity="warn",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="item",
                                entity_name=item_name,
                                field="type",
                                message=f"物品“{item_name}”在未回收前被重复 planted。",
                                suggestion="合并重复铺垫点，或在后续章节补充一次明确回收，避免状态悬空。",
                            )
                        )
                    if key in resolved_items:
                        issues.append(
                            self._build_issue(
                                conflict_type="item_state_conflict",
                                severity="warn",
                                chapter_id=chapter_id,
                                chapter_number=chapter_number,
                                entity_type="item",
                                entity_name=item_name,
                                field="type",
                                message=f"物品“{item_name}”在已回收后再次 planted，存在状态回滚风险。",
                                suggestion="若是新一轮伏笔，请使用新标题或补充版本标记，避免与已回收状态混淆。",
                            )
                        )
                    planted_items[key] = (chapter_number or 0, chapter_id or "")

                if estimated_resolve_chapter is not None and chapter_number is not None and estimated_resolve_chapter < chapter_number:
                    issues.append(
                        self._build_issue(
                            conflict_type="timeline_conflict",
                            severity="warn",
                            chapter_id=chapter_id,
                            chapter_number=chapter_number,
                            entity_type="item",
                            entity_name=item_name,
                            field="estimated_resolve_chapter",
                            message=f"物品“{item_name}”在第{chapter_number}章标注回收目标为第{estimated_resolve_chapter}章（早于当前章）。",
                            suggestion="调整 estimated_resolve_chapter 到当前章或未来章节，保持时间线单向推进。",
                        )
                    )

                if reference_chapter is not None and chapter_number is not None and reference_chapter >= chapter_number:
                    issues.append(
                        self._build_issue(
                            conflict_type="timeline_conflict",
                            severity="block",
                            chapter_id=chapter_id,
                            chapter_number=chapter_number,
                            entity_type="item",
                            entity_name=item_name,
                            field="reference_chapter",
                            message=f"物品“{item_name}”在第{chapter_number}章引用未来/同章 reference_chapter={reference_chapter}。",
                            suggestion="将 reference_chapter 改为实际埋下该物品伏笔的历史章节号。",
                        )
                    )

        for foreshadow in foreshadows:
            if self._normalize_text(foreshadow.category) != "item":
                continue

            item_name = foreshadow.title or (foreshadow.content or "")[:30]
            status = self._normalize_text(foreshadow.status)
            plant_chapter = foreshadow.plant_chapter_number
            target_chapter = foreshadow.target_resolve_chapter_number
            actual_chapter = foreshadow.actual_resolve_chapter_number

            if status in {"resolved", "partially_resolved"} and actual_chapter and plant_chapter and actual_chapter < plant_chapter:
                issues.append(
                    self._build_issue(
                        conflict_type="timeline_conflict",
                        severity="block",
                        chapter_number=actual_chapter,
                        entity_type="item",
                        entity_name=item_name,
                        field="actual_resolve_chapter_number",
                        message=f"物品“{item_name}”实际回收章节({actual_chapter})早于埋下章节({plant_chapter})。",
                        suggestion="修正 plant/actual 章节号，或回滚错误的回收记录。",
                    )
                )

            if status in {"pending", "planted", "partially_resolved"} and target_chapter and plant_chapter and target_chapter < plant_chapter:
                issues.append(
                    self._build_issue(
                        conflict_type="timeline_conflict",
                        severity="block",
                        chapter_number=plant_chapter,
                        entity_type="item",
                        entity_name=item_name,
                        field="target_resolve_chapter_number",
                        message=f"物品“{item_name}”计划回收章节({target_chapter})早于埋下章节({plant_chapter})。",
                        suggestion="将目标回收章节设为埋下章节之后，或调整埋下章节号。",
                    )
                )

            if status in {"resolved", "partially_resolved"} and actual_chapter and not plant_chapter:
                issues.append(
                    self._build_issue(
                        conflict_type="item_state_conflict",
                        severity="warn",
                        chapter_number=actual_chapter,
                        entity_type="item",
                        entity_name=item_name,
                        field="plant_chapter_number",
                        message=f"物品“{item_name}”存在回收记录但缺失埋下章节。",
                        suggestion="补录 plant_chapter_number，保证物品状态可追溯。",
                    )
                )

        return issues

    def _detect_timeline_conflicts(self, chapters: list[Chapter]) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        chapter_number_map: dict[int, list[Chapter]] = defaultdict(list)
        for chapter in chapters:
            chapter_number_map[chapter.chapter_number].append(chapter)

        for chapter_number, grouped in chapter_number_map.items():
            if len(grouped) <= 1:
                continue
            for chapter in grouped:
                issues.append(
                    self._build_issue(
                        conflict_type="timeline_conflict",
                        severity="block",
                        chapter_id=chapter.id,
                        chapter_number=chapter.chapter_number,
                        entity_type="timeline",
                        entity_name=f"章节号 {chapter_number}",
                        field="chapter_number",
                        message=f"检测到重复章节号：第{chapter_number}章存在 {len(grouped)} 条记录。",
                        suggestion="统一章节排序并修复重复 chapter_number，确保时间线唯一。",
                    )
                )

        sorted_numbers = sorted(chapter_number_map.keys())
        for index in range(1, len(sorted_numbers)):
            previous_num = sorted_numbers[index - 1]
            current_num = sorted_numbers[index]
            if current_num - previous_num <= 1:
                continue

            sample = chapter_number_map[current_num][0]
            issues.append(
                self._build_issue(
                    conflict_type="timeline_conflict",
                    severity="warn",
                    chapter_id=sample.id,
                    chapter_number=current_num,
                    entity_type="timeline",
                    entity_name=f"{previous_num}->{current_num}",
                    field="chapter_number",
                    message=f"章节号从第{previous_num}章跳到第{current_num}章，存在时间线缺口。",
                    suggestion="确认是否缺失中间章节；如为刻意跳章，建议在章节摘要中补充时间跳转说明。",
                )
            )

        return issues

    async def build_consistency_report(self, db: AsyncSession, project_id: str) -> dict[str, Any]:
        """构建项目级跨章一致性报告。"""
        chapter_rows = await db.execute(
            select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.chapter_number, Chapter.created_at)
        )
        chapters = chapter_rows.scalars().all()

        analysis_rows = await db.execute(select(PlotAnalysis).where(PlotAnalysis.project_id == project_id))
        analyses = analysis_rows.scalars().all()
        analysis_map = {analysis.chapter_id: analysis for analysis in analyses}

        foreshadow_rows = await db.execute(select(Foreshadow).where(Foreshadow.project_id == project_id))
        foreshadows = foreshadow_rows.scalars().all()

        character_rows = await db.execute(select(Character).where(Character.project_id == project_id))
        characters = character_rows.scalars().all()
        known_character_names = {self._normalize_text(character.name) for character in characters if character.name}

        chapter_snapshots = self._build_chapter_snapshots(chapters, analysis_map)

        conflicts: list[dict[str, Any]] = []
        conflicts.extend(self._detect_character_setting_conflicts(chapter_snapshots, known_character_names))
        conflicts.extend(self._detect_item_and_timeline_conflicts(chapter_snapshots, foreshadows))
        conflicts.extend(self._detect_timeline_conflicts(chapters))
        conflicts = self._deduplicate_issues(conflicts)

        severity_counter = Counter(issue.get("severity") for issue in conflicts)
        conflict_counter = Counter(issue.get("conflict_type") for issue in conflicts)
        level = self._merge_levels([issue.get("severity", "pass") for issue in conflicts] or ["pass"])

        return {
            "project_id": project_id,
            "generated_at": datetime.now(tz=UTC).isoformat(),
            "result": level,
            "summary": {
                "total_chapters": len(chapters),
                "analyzed_chapters": len(analyses),
                "total_conflicts": len(conflicts),
                "severity_counts": {
                    "block": severity_counter.get("block", 0),
                    "warn": severity_counter.get("warn", 0),
                    "pass": 0,
                },
                "conflict_counts": {
                    "character_setting_conflict": conflict_counter.get("character_setting_conflict", 0),
                    "item_state_conflict": conflict_counter.get("item_state_conflict", 0),
                    "timeline_conflict": conflict_counter.get("timeline_conflict", 0),
                },
            },
            "chapter_snapshots": chapter_snapshots,
            "conflicts": conflicts,
        }

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
        issue_messages = [
            str(issue.get("message") or "").strip()
            for issue in issues
            if isinstance(issue, Mapping) and str(issue.get("message") or "").strip()
        ]
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
            message = (
                f"伏笔“{item_name}”已到回收章节（目标第{target_chapter}章）但仍为 {status}。"
                if overdue
                else f"伏笔“{item_name}”尚未回收（状态 {status}）。"
            )
            suggestion = (
                "在对应章节补充回收情节并将状态更新为 resolved。"
                if overdue
                else "确认该伏笔是否保留；若继续保留，请补充明确的计划回收章节。"
            )
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

        consistency_report = await self.build_consistency_report(db, project_id)

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

    async def finalize_project(
        self,
        db: AsyncSession,
        project_id: str,
        config: dict[str, Any] | None = None,
    ) -> tuple[bool, dict[str, Any]]:
        """执行门禁并在可通过时完成定稿。"""
        report = await self.build_finalize_gate_report(db, project_id, config=config)
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


consistency_gate_service = ConsistencyGateService()
