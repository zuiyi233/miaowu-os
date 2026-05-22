"""Shared helpers for consistency/finalize gate checks."""

from __future__ import annotations

import json
from typing import Any, Literal

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)

GateLevel = Literal["pass", "warn", "block"]


class GateBase:
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
        payload: dict[str, Any] = {
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
