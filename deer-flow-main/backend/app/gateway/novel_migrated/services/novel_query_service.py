"""Query service for merged novel list endpoints."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class NovelQueryService:
    """Provide stable merged novel-list queries for legacy + migrated stores."""

    async def list_novels(self, *, legacy_result: dict[str, Any], page: int, page_size: int) -> dict[str, Any]:
        legacy_items = self._extract_legacy_items(legacy_result)
        modern_items = await self._fetch_modern_items()

        if not modern_items:
            return legacy_result

        merged = self._merge_by_stable_id(legacy_items=legacy_items, modern_items=modern_items)
        merged.sort(key=lambda item: item.get("updatedAt") or item.get("createdAt") or "", reverse=True)

        total = len(merged)
        start = (page - 1) * page_size
        end = start + page_size
        return {"items": merged[start:end], "total": total, "page": page, "page_size": page_size}

    @staticmethod
    def _extract_legacy_items(legacy_result: dict[str, Any]) -> list[dict[str, Any]]:
        items = legacy_result.get("items", [])
        if not isinstance(items, list):
            return []
        return [dict(item) for item in items if isinstance(item, dict)]

    async def _fetch_modern_items(self) -> list[dict[str, Any]]:
        try:
            from sqlalchemy import select

            from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
            from app.gateway.novel_migrated.models.project import Project

            await init_db_schema()
            async with AsyncSessionLocal() as modern_db:
                result = await modern_db.execute(select(Project).order_by(Project.created_at.desc()))
                projects = result.scalars().all()
                return [self._serialize_project(project) for project in projects]
        except Exception as exc:  # pragma: no cover - defensive fallback path
            logger.debug("list_novels: modern store query skipped (%s)", exc)
            return []

    @staticmethod
    def _serialize_project(project: Any) -> dict[str, Any]:
        return {
            "id": project.id,
            "title": project.title,
            "outline": project.description or "",
            "coverImage": project.cover_image_url,
            "metadata": {
                "genre": project.genre or "",
                "theme": project.theme or "",
                "status": project.status or "",
                "target_words": project.target_words or 0,
                "source": "novel_migrated.projects",
            },
            "volumesCount": 0,
            "chaptersCount": project.chapter_count or 0,
            "wordCount": project.current_words or 0,
            "createdAt": project.created_at.isoformat() if project.created_at else None,
            "updatedAt": project.updated_at.isoformat() if project.updated_at else None,
        }

    @staticmethod
    def _merge_by_stable_id(*, legacy_items: list[dict[str, Any]], modern_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for item in legacy_items:
            item_id = str(item.get("id") or "").strip()
            if item_id:
                seen_ids.add(item_id)
            merged.append(dict(item))

        for item in modern_items:
            item_id = str(item.get("id") or "").strip()
            if item_id and item_id in seen_ids:
                continue
            if item_id:
                seen_ids.add(item_id)
            merged.append(dict(item))

        return merged


novel_query_service = NovelQueryService()

