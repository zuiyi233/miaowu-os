"""Cross-chapter consistency checker."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.foreshadow import Foreshadow
from app.gateway.novel_migrated.models.memory import PlotAnalysis

from .base import GateBase


class ConsistencyChecker(GateBase):
    """Detects cross-chapter contradictions and consistency risks."""

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
                        "state_before": str(item.get("state_before") or "").strip(),
                        "state_after": str(item.get("state_after") or "").strip(),
                        "foreshadow_type": self._normalize_text(item.get("type")),
                        "estimated_resolve_chapter": self._to_int(item.get("estimated_resolve_chapter") or item.get("target_resolve_chapter") or item.get("target_resolve_chapter_number")),
                        "chapter_number": chapter.chapter_number,
                    }
                )

            snapshots.append(
                {
                    "chapter_id": chapter.id,
                    "chapter_number": chapter.chapter_number,
                    "title": chapter.title,
                    "characters": character_snapshot,
                    "items": item_snapshot,
                }
            )
        return snapshots

    def _detect_character_setting_conflicts(
        self,
        chapter_snapshots: list[dict[str, Any]],
        known_character_names: set[str],
    ) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        seen_status: dict[str, str] = {}
        seen_state_after: dict[str, str] = {}

        for snapshot in chapter_snapshots:
            chapter_id = snapshot.get("chapter_id")
            chapter_number = self._to_int(snapshot.get("chapter_number"))
            for character in snapshot.get("characters") or []:
                name = str(character.get("character_name") or "").strip()
                if not name:
                    continue
                normalized = self._normalize_text(name)
                # 当 Character 表为空时（本地/测试环境常见），不应因为“未登记角色”而跳过冲突检测。
                if known_character_names and normalized not in known_character_names:
                    continue

                status = self._normalize_status(character.get("survival_status"))
                if status and normalized in seen_status and status != seen_status[normalized]:
                    issues.append(
                        self._build_issue(
                            conflict_type="character_setting_conflict",
                            severity="warn",
                            chapter_id=str(chapter_id) if chapter_id else None,
                            chapter_number=chapter_number,
                            entity_type="character",
                            entity_name=name,
                            field="survival_status",
                            message=f"角色{name}在不同章节出现存活状态不一致：{seen_status[normalized]} vs {status}。",
                            suggestion="检查该角色在章节间的生死/消失设定，必要时补充过渡说明或统一状态字段。",
                            extra={"previous_status": seen_status[normalized], "current_status": status},
                        )
                    )
                if status:
                    seen_status[normalized] = status

                state_after = str(character.get("state_after") or "").strip()
                if (
                    state_after
                    and normalized in seen_state_after
                    and not self._text_consistent(
                        self._normalize_text(state_after),
                        self._normalize_text(seen_state_after[normalized]),
                    )
                ):
                    issues.append(
                        self._build_issue(
                            conflict_type="character_setting_conflict",
                            severity="warn",
                            chapter_id=str(chapter_id) if chapter_id else None,
                            chapter_number=chapter_number,
                            entity_type="character",
                            entity_name=name,
                            field="state_after",
                            message=f"角色{name}的状态描述可能冲突：{seen_state_after[normalized]} vs {state_after}。",
                            suggestion="检查角色的关键状态变化是否在前文交代；如是新变化，请补充因果链或调整描述一致性。",
                            extra={"previous_state_after": seen_state_after[normalized], "current_state_after": state_after},
                        )
                    )
                if state_after:
                    seen_state_after[normalized] = state_after

        return issues

    def _detect_item_and_timeline_conflicts(
        self,
        chapter_snapshots: list[dict[str, Any]],
        foreshadows: list[Foreshadow],
    ) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []

        # Build known foreshadow items (for better item name normalization)
        foreshadow_items: set[str] = set()
        for foreshadow in foreshadows:
            name = str(getattr(foreshadow, "title", "") or "").strip()
            if name:
                foreshadow_items.add(self._normalize_text(name))

        seen_item_state: dict[str, str] = {}
        seen_item_chapter: dict[str, int] = {}
        seen_item_estimated_resolve: dict[str, int] = {}

        for snapshot in chapter_snapshots:
            chapter_id = snapshot.get("chapter_id")
            chapter_number = self._to_int(snapshot.get("chapter_number")) or 0
            for item in snapshot.get("items") or []:
                raw_name = str(item.get("item_name") or "").strip()
                if not raw_name:
                    continue
                normalized = self._normalize_text(raw_name)
                if foreshadow_items and normalized not in foreshadow_items:
                    # Skip unknown items unless it's referenced multiple times.
                    pass

                estimated_resolve = self._to_int(item.get("estimated_resolve_chapter"))
                if estimated_resolve is not None:
                    previous_estimated = seen_item_estimated_resolve.get(normalized)
                    if previous_estimated is not None and previous_estimated != estimated_resolve:
                        issues.append(
                            self._build_issue(
                                conflict_type="item_state_conflict",
                                severity="warn",
                                chapter_id=str(chapter_id) if chapter_id else None,
                                chapter_number=chapter_number,
                                entity_type="item",
                                entity_name=raw_name,
                                field="estimated_resolve_chapter",
                                message=(f"物品/伏笔“{raw_name}”的预计回收章节出现不一致：第{seen_item_chapter.get(normalized, 0)}章={previous_estimated} vs 第{chapter_number}章={estimated_resolve}。"),
                                suggestion="检查伏笔/物品的回收计划是否被重写；如确有调整，请统一预计回收章节并补充过渡说明。",
                                extra={
                                    "previous_chapter_number": seen_item_chapter.get(normalized),
                                    "previous_estimated_resolve_chapter": previous_estimated,
                                    "current_estimated_resolve_chapter": estimated_resolve,
                                },
                            )
                        )
                    seen_item_estimated_resolve[normalized] = estimated_resolve

                state_after = str(item.get("state_after") or "").strip()
                if not state_after:
                    # Fallback to foreshadow `type` (planted/resolved/...) when state_after is absent.
                    state_after = str(item.get("foreshadow_type") or "").strip()
                if not state_after:
                    continue

                if normalized in seen_item_state:
                    previous_state = seen_item_state[normalized]
                    if not self._text_consistent(self._normalize_text(previous_state), self._normalize_text(state_after)):
                        issues.append(
                            self._build_issue(
                                conflict_type="item_state_conflict",
                                severity="warn",
                                chapter_id=str(chapter_id) if chapter_id else None,
                                chapter_number=chapter_number,
                                entity_type="item",
                                entity_name=raw_name,
                                field="state_after",
                                message=(f"物品/伏笔“{raw_name}”状态可能冲突：第{seen_item_chapter.get(normalized, 0)}章={previous_state} vs 第{chapter_number}章={state_after}。"),
                                suggestion="核对该物品/伏笔在章节间的状态延续；如发生变化请补充变化原因或调整前后描述。",
                                extra={
                                    "previous_chapter_number": seen_item_chapter.get(normalized),
                                    "previous_state_after": previous_state,
                                    "current_state_after": state_after,
                                },
                            )
                        )

                seen_item_state[normalized] = state_after
                seen_item_chapter[normalized] = chapter_number

        return issues

    def _detect_timeline_conflicts(self, chapters: list[Chapter]) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []

        chapter_number_map: dict[int, list[Chapter]] = defaultdict(list)
        for chapter in chapters:
            if chapter.chapter_number is None:
                continue
            chapter_number_map[int(chapter.chapter_number)].append(chapter)

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

        ordered_numbers = sorted(chapter_number_map.keys())
        if not ordered_numbers:
            return issues

        previous_num = ordered_numbers[0]
        for current_num in ordered_numbers[1:]:
            if current_num - previous_num <= 1:
                previous_num = current_num
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
            previous_num = current_num

        return issues

    async def build_consistency_report(self, db: AsyncSession, project_id: str) -> dict[str, Any]:
        """构建项目级跨章一致性报告。"""
        chapter_rows = await db.execute(select(Chapter).where(Chapter.project_id == project_id).order_by(Chapter.chapter_number, Chapter.created_at))
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
