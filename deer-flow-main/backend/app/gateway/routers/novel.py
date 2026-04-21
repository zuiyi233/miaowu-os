"""Novel AI endpoints for creative writing.

Provides:
- AI chat interface for novel writing (streaming + non-streaming SSE)
- Novel CRUD and structural content management (chapters, entities, timeline, graph)
- Recommendation engine, quality reports, and interaction threads

Reuses the existing DeerFlow model factory to create LLM instances from the app config.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["novel"])


# ---------------------------------------------------------------------------
# In-memory store (to be replaced by persistent DB in later milestones)
# ---------------------------------------------------------------------------

class NovelStore:
    """Simple in-memory store for novel domain data.

    Will be replaced by a persistent database (PostgreSQL / SQLite)
    in M1+ milestones. For M0, provides a contract-complete API surface.
    """

    def __init__(self, storage_path: str | Path | None = None) -> None:
        self._lock = asyncio.Lock()
        self._storage_path = Path(storage_path) if storage_path else (Path(__file__).resolve().parents[1] / "data" / "novel_store.json")
        self._novels: dict[str, dict] = {}
        self._chapters: dict[str, dict] = {}
        self._characters: dict[str, dict] = {}
        self._entities: dict[str, dict] = {}
        self._timeline: dict[str, list[dict]] = {}
        self._graphs: dict[str, dict] = {}
        self._recommendations: dict[str, list[dict]] = {}
        self._interactions: dict[str, list[dict]] = {}
        self._quality_reports: dict[str, dict] = {}
        self._audits: dict[str, list[dict]] = {}
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        if not self._storage_path.exists():
            logger.info("NovelStore data file not found, starting with empty store: %s", self._storage_path)
            return
        try:
            payload = json.loads(self._storage_path.read_text(encoding="utf-8"))
            self._novels = payload.get("novels", {})
            self._chapters = payload.get("chapters", {})
            self._characters = payload.get("characters", {})
            self._entities = payload.get("entities", {})
            self._timeline = payload.get("timeline", {})
            self._graphs = payload.get("graphs", {})
            self._recommendations = payload.get("recommendations", {})
            self._interactions = payload.get("interactions", {})
            self._quality_reports = payload.get("quality_reports", {})
            self._audits = payload.get("audits", {})
            logger.info("NovelStore loaded from disk: %s", self._storage_path)
        except Exception:
            logger.exception("Failed to load NovelStore data file, falling back to empty store: %s", self._storage_path)
            self._novels = {}
            self._chapters = {}
            self._characters = {}
            self._entities = {}
            self._timeline = {}
            self._graphs = {}
            self._recommendations = {}
            self._interactions = {}
            self._quality_reports = {}
            self._audits = {}

    def _persist_locked(self) -> None:
        payload = {
            "novels": self._novels,
            "chapters": self._chapters,
            "characters": self._characters,
            "entities": self._entities,
            "timeline": self._timeline,
            "graphs": self._graphs,
            "recommendations": self._recommendations,
            "interactions": self._interactions,
            "quality_reports": self._quality_reports,
            "audits": self._audits,
        }
        self._storage_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._storage_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self._storage_path)

    @staticmethod
    def _extract_author(payload: dict[str, Any] | None) -> str | None:
        if not payload:
            return None
        for key in ("author", "updatedBy", "createdBy", "operator", "userId"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _record_audit_locked(
        self,
        *,
        novel_id: str,
        action: str,
        entity_type: str,
        entity_id: str | None = None,
        author: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> dict:
        entry = {
            "id": f"audit-{uuid.uuid4().hex[:12]}",
            "novelId": novel_id,
            "action": action,
            "entityType": entity_type,
            "entityId": entity_id,
            "author": author or "system",
            "details": details or {},
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        self._audits.setdefault(novel_id, []).append(entry)
        return entry

    async def list_audits(
        self,
        novel_id: str,
        action: str | None = None,
        entity_type: str | None = None,
        author: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        audits = list(reversed(self._audits.get(novel_id, [])))
        if action:
            audits = [item for item in audits if item.get("action") == action]
        if entity_type:
            audits = [item for item in audits if item.get("entityType") == entity_type]
        if author:
            audits = [item for item in audits if item.get("author") == author]

        normalized: list[dict[str, Any]] = []
        for idx, item in enumerate(audits):
            if not isinstance(item, dict):
                continue

            details = item.get("details")
            entity_name = item.get("entityName")
            if entity_name is None and isinstance(details, dict):
                entity_name = details.get("title") or details.get("name")

            normalized.append({
                "id": item.get("id") or f"audit-{novel_id}-{idx}",
                "timestamp": item.get("timestamp") or item.get("createdAt") or item.get("updatedAt"),
                "action": item.get("action"),
                "entityType": item.get("entityType"),
                "entityId": item.get("entityId"),
                "entityName": entity_name,
                "details": details if details is not None else {},
                "author": item.get("author") or "system",
                "reason": item.get("reason"),
                "before": item.get("before"),
                "after": item.get("after"),
            })

        return normalized[: max(1, limit)]

    # -- Novel CRUD --

    async def list_novels(self, page: int = 1, page_size: int = 20) -> dict:
        items = list(self._novels.values())
        total = len(items)
        start = (page - 1) * page_size
        end = start + page_size
        return {"items": items[start:end], "total": total, "page": page, "page_size": page_size}

    async def get_novel(self, novel_id: str) -> dict | None:
        novel = self._novels.get(novel_id)
        if not novel:
            return None
        chapters = [c for c in self._chapters.values() if c.get("novelId") == novel_id]
        characters = [c for c in self._characters.values() if c.get("novelId") == novel_id]
        entities = [e for e in self._entities.values() if e.get("novelId") == novel_id]
        timeline = self._timeline.get(novel_id, [])
        graph = self._graphs.get(novel_id)
        return {**novel, "chapters": chapters, "characters": characters, "entities": entities, "timeline": timeline, "graph": graph}

    async def create_novel(self, data: dict) -> dict:
        async with self._lock:
            novel_id = data.get("id") or f"novel-{uuid.uuid4().hex[:12]}"
            now = datetime.now(timezone.utc).isoformat()
            novel = {
                "id": novel_id,
                "title": data.get("title", "Untitled"),
                "outline": data.get("outline", ""),
                "coverImage": data.get("coverImage"),
                "metadata": data.get("metadata", {}),
                "syncStatus": "local",
                "version": 1,
                "createdAt": now,
                "updatedAt": now,
            }
            self._novels[novel_id] = novel
            self._record_audit_locked(
                novel_id=novel_id,
                action="novel.create",
                entity_type="novel",
                entity_id=novel_id,
                author=self._extract_author(data),
                details={"title": novel.get("title"), "version": novel.get("version", 1)},
            )
            self._persist_locked()
            return novel

    async def update_novel(self, novel_id: str, updates: dict) -> dict | None:
        async with self._lock:
            novel = self._novels.get(novel_id)
            if not novel:
                return None
            sanitized_updates = {k: v for k, v in updates.items() if k != "id"}
            novel.update(sanitized_updates)
            novel["updatedAt"] = datetime.now(timezone.utc).isoformat()
            novel["version"] = novel.get("version", 1) + 1
            self._record_audit_locked(
                novel_id=novel_id,
                action="novel.update",
                entity_type="novel",
                entity_id=novel_id,
                author=self._extract_author(updates),
                details={"updatedFields": sorted(sanitized_updates.keys()), "version": novel["version"]},
            )
            self._persist_locked()
            return novel

    async def delete_novel(self, novel_id: str) -> bool:
        async with self._lock:
            if novel_id not in self._novels:
                return False
            chapter_count = len([c for c in self._chapters.values() if c.get("novelId") == novel_id])
            entity_count = len([e for e in self._entities.values() if e.get("novelId") == novel_id])
            interaction_count = len(self._interactions.get(novel_id, []))
            timeline_count = len(self._timeline.get(novel_id, []))
            recommendation_count = len(self._recommendations.get(novel_id, []))
            self._record_audit_locked(
                novel_id=novel_id,
                action="novel.delete",
                entity_type="novel",
                entity_id=novel_id,
                details={
                    "removed": {
                        "chapters": chapter_count,
                        "entities": entity_count,
                        "timelineEvents": timeline_count,
                        "recommendations": recommendation_count,
                        "interactions": interaction_count,
                    }
                },
            )
            del self._novels[novel_id]
            self._chapters = {k: v for k, v in self._chapters.items() if v.get("novelId") != novel_id}
            self._characters = {k: v for k, v in self._characters.items() if v.get("novelId") != novel_id}
            self._entities = {k: v for k, v in self._entities.items() if v.get("novelId") != novel_id}
            self._timeline.pop(novel_id, None)
            self._graphs.pop(novel_id, None)
            self._recommendations.pop(novel_id, None)
            self._interactions.pop(novel_id, None)
            self._quality_reports.pop(novel_id, None)
            self._persist_locked()
            return True

    # -- Chapter CRUD --

    async def list_chapters(self, novel_id: str, volume_id: str | None = None) -> list[dict]:
        chapters = [c for c in self._chapters.values() if c.get("novelId") == novel_id]
        if volume_id:
            chapters = [c for c in chapters if c.get("volumeId") == volume_id]
        return sorted(chapters, key=lambda c: c.get("order", 0))

    async def get_chapter(self, chapter_id: str) -> dict | None:
        return self._chapters.get(chapter_id)

    async def create_chapter(self, novel_id: str, data: dict) -> dict:
        async with self._lock:
            if novel_id not in self._novels:
                raise HTTPException(status_code=404, detail="Novel not found")
            chapter_id = data.get("id") or f"chapter-{uuid.uuid4().hex[:12]}"
            now = datetime.now(timezone.utc).isoformat()
            chapter = {
                "id": chapter_id,
                "novelId": novel_id,
                "title": data.get("title", "Untitled"),
                "content": data.get("content", ""),
                "volumeId": data.get("volumeId"),
                "order": data.get("order", 0),
                "description": data.get("description"),
                "summary": data.get("summary"),
                "syncStatus": "local",
                "version": 1,
                "createdAt": now,
                "updatedAt": now,
            }
            self._chapters[chapter_id] = chapter
            self._record_audit_locked(
                novel_id=novel_id,
                action="chapter.create",
                entity_type="chapter",
                entity_id=chapter_id,
                author=self._extract_author(data),
                details={"title": chapter.get("title"), "order": chapter.get("order", 0)},
            )
            self._persist_locked()
            return chapter

    async def update_chapter(self, novel_id: str, chapter_id: str, updates: dict) -> dict | None:
        async with self._lock:
            chapter = self._chapters.get(chapter_id)
            if not chapter or chapter.get("novelId") != novel_id:
                return None
            updates = {k: v for k, v in updates.items() if k not in {"id", "novelId"}}
            chapter.update(updates)
            chapter["updatedAt"] = datetime.now(timezone.utc).isoformat()
            chapter["version"] = chapter.get("version", 1) + 1
            self._record_audit_locked(
                novel_id=novel_id,
                action="chapter.update",
                entity_type="chapter",
                entity_id=chapter_id,
                author=self._extract_author(updates),
                details={"updatedFields": sorted(updates.keys()), "version": chapter["version"]},
            )
            self._persist_locked()
            return chapter

    async def delete_chapter(self, novel_id: str, chapter_id: str) -> bool:
        async with self._lock:
            chapter = self._chapters.get(chapter_id)
            if chapter and chapter.get("novelId") == novel_id:
                self._record_audit_locked(
                    novel_id=novel_id,
                    action="chapter.delete",
                    entity_type="chapter",
                    entity_id=chapter_id,
                    details={"title": chapter.get("title")},
                )
                del self._chapters[chapter_id]
                self._persist_locked()
                return True
            return False

    # -- Entity CRUD --

    async def list_entities(self, novel_id: str, entity_type: str | None = None) -> list[dict]:
        entities = [e for e in self._entities.values() if e.get("novelId") == novel_id]
        if entity_type:
            entities = [e for e in entities if e.get("type") == entity_type]
        return entities

    async def get_entity_by_id(self, entity_id: str) -> dict | None:
        async with self._lock:
            entity = self._entities.get(entity_id)
            if not isinstance(entity, dict):
                return None
            return dict(entity)

    async def create_entity(self, novel_id: str, data: dict) -> dict:
        async with self._lock:
            if novel_id not in self._novels:
                raise HTTPException(status_code=404, detail="Novel not found")
            entity_id = data.get("id") or f"entity-{uuid.uuid4().hex[:12]}"
            now = datetime.now(timezone.utc).isoformat()
            entity = {
                "id": entity_id,
                "novelId": novel_id,
                "name": data.get("name", ""),
                "type": data.get("type", "character"),
                "description": data.get("description", ""),
                "properties": data.get("properties", {}),
                "syncStatus": "local",
                "version": 1,
                "createdAt": now,
                "updatedAt": now,
            }
            self._entities[entity_id] = entity
            self._record_audit_locked(
                novel_id=novel_id,
                action="entity.create",
                entity_type="entity",
                entity_id=entity_id,
                author=self._extract_author(data),
                details={"name": entity.get("name"), "type": entity.get("type")},
            )
            self._persist_locked()
            return entity

    async def update_entity(self, novel_id: str, entity_id: str, updates: dict) -> dict | None:
        async with self._lock:
            entity = self._entities.get(entity_id)
            if not entity or entity.get("novelId") != novel_id:
                return None
            updates = {k: v for k, v in updates.items() if k not in {"id", "novelId"}}
            entity.update(updates)
            entity["updatedAt"] = datetime.now(timezone.utc).isoformat()
            entity["version"] = entity.get("version", 1) + 1
            self._record_audit_locked(
                novel_id=novel_id,
                action="entity.update",
                entity_type="entity",
                entity_id=entity_id,
                author=self._extract_author(updates),
                details={"updatedFields": sorted(updates.keys()), "version": entity["version"]},
            )
            self._persist_locked()
            return entity

    async def update_entity_by_id(self, entity_id: str, updates: dict) -> dict | None:
        async with self._lock:
            entity = self._entities.get(entity_id)
            if not entity:
                return None
            novel_id = entity.get("novelId")
            if not isinstance(novel_id, str) or not novel_id:
                return None
            updates = {k: v for k, v in updates.items() if k not in {"id", "novelId"}}
            entity.update(updates)
            entity["updatedAt"] = datetime.now(timezone.utc).isoformat()
            entity["version"] = entity.get("version", 1) + 1
            self._record_audit_locked(
                novel_id=novel_id,
                action="entity.update",
                entity_type="entity",
                entity_id=entity_id,
                author=self._extract_author(updates),
                details={"updatedFields": sorted(updates.keys()), "version": entity["version"]},
            )
            self._persist_locked()
            return dict(entity)

    async def delete_entity(self, novel_id: str, entity_id: str) -> bool:
        async with self._lock:
            entity = self._entities.get(entity_id)
            if entity and entity.get("novelId") == novel_id:
                self._record_audit_locked(
                    novel_id=novel_id,
                    action="entity.delete",
                    entity_type="entity",
                    entity_id=entity_id,
                    details={"name": entity.get("name"), "type": entity.get("type")},
                )
                del self._entities[entity_id]
                self._persist_locked()
                return True
            return False

    # -- Timeline --

    async def get_timeline(self, novel_id: str) -> list[dict]:
        return self._timeline.get(novel_id, [])

    async def create_timeline_event(self, novel_id: str, data: dict) -> dict:
        async with self._lock:
            if novel_id not in self._novels:
                raise HTTPException(status_code=404, detail="Novel not found")
            event_id = data.get("id") or f"timeline-{uuid.uuid4().hex[:12]}"
            event = {
                "id": event_id,
                "novelId": novel_id,
                "title": data.get("title", ""),
                "description": data.get("description"),
                "dateDisplay": data.get("dateDisplay", ""),
                "sortValue": data.get("sortValue", 0),
                "relatedEntityIds": data.get("relatedEntityIds", []),
                "relatedChapterId": data.get("relatedChapterId"),
                "type": data.get("type", "plot"),
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
            self._timeline.setdefault(novel_id, []).append(event)
            self._record_audit_locked(
                novel_id=novel_id,
                action="timeline.create",
                entity_type="timeline",
                entity_id=event_id,
                author=self._extract_author(data),
                details={"title": event.get("title"), "type": event.get("type")},
            )
            self._persist_locked()
            return event

    async def update_timeline_event(self, novel_id: str, event_id: str, updates: dict) -> dict | None:
        async with self._lock:
            events = self._timeline.get(novel_id, [])
            for event in events:
                if event["id"] == event_id and event.get("novelId") == novel_id:
                    updates = {k: v for k, v in updates.items() if k not in {"id", "novelId"}}
                    event.update(updates)
                    self._record_audit_locked(
                        novel_id=novel_id,
                        action="timeline.update",
                        entity_type="timeline",
                        entity_id=event_id,
                        author=self._extract_author(updates),
                        details={"updatedFields": sorted(updates.keys())},
                    )
                    self._persist_locked()
                    return event
            return None

    async def delete_timeline_event(self, novel_id: str, event_id: str) -> bool:
        async with self._lock:
            events = self._timeline.get(novel_id, [])
            before = len(events)
            self._timeline[novel_id] = [e for e in events if not (e["id"] == event_id and e.get("novelId") == novel_id)]
            deleted = len(self._timeline[novel_id]) < before
            if deleted:
                self._record_audit_locked(
                    novel_id=novel_id,
                    action="timeline.delete",
                    entity_type="timeline",
                    entity_id=event_id,
                )
                self._persist_locked()
            return deleted

    # -- Graph layout --

    async def get_graph(self, novel_id: str) -> dict | None:
        return self._graphs.get(novel_id)

    async def save_graph(self, novel_id: str, data: dict) -> dict:
        async with self._lock:
            now = datetime.now(timezone.utc).isoformat()
            is_create = novel_id not in self._graphs
            graph = {
                "id": data.get("id", novel_id),
                "novelId": novel_id,
                "nodePositions": data.get("nodePositions", {}),
                "isLocked": data.get("isLocked", False),
                "lastUpdated": now,
            }
            self._graphs[novel_id] = graph
            self._record_audit_locked(
                novel_id=novel_id,
                action="graph.create" if is_create else "graph.update",
                entity_type="graph",
                entity_id=graph["id"],
                author=self._extract_author(data),
                details={"nodeCount": len(graph.get("nodePositions", {})), "isLocked": graph.get("isLocked", False)},
            )
            self._persist_locked()
            return graph

    # -- Recommendations --

    async def get_recommendations(self, novel_id: str) -> list[dict]:
        return self._recommendations.get(novel_id, [])

    async def generate_recommendations(self, novel_id: str, context: dict | None = None) -> list[dict]:
        """Generate placeholder recommendations based on novel context."""
        novel = await self.get_novel(novel_id)
        if not novel:
            raise HTTPException(status_code=404, detail="Novel not found")

        recommendations = []
        chapters = novel.get("chapters", [])
        characters = novel.get("characters", [])

        if len(chapters) >= 2:
            recommendations.append({
                "id": f"rec-{uuid.uuid4().hex[:8]}",
                "type": "plot_progression",
                "title": "情节推进建议",
                "content": f"当前已有 {len(chapters)} 章，建议下一章引入新的冲突点或未解决的伏笔。",
                "reason": "基于章节数量分析，情节节奏可能需要新的张力点。",
                "targetType": "chapter",
                "priority": "medium",
                "createdAt": datetime.now(timezone.utc).isoformat(),
            })

        if len(characters) >= 3:
            recommendations.append({
                "id": f"rec-{uuid.uuid4().hex[:8]}",
                "type": "character_consistency",
                "title": "角色一致性检查",
                "content": f"当前有 {len(characters)} 个角色，建议检查各角色的动机是否闭环、性格是否一致。",
                "reason": "多角色小说容易出现动机不一致问题。",
                "targetType": "character",
                "priority": "low",
                "createdAt": datetime.now(timezone.utc).isoformat(),
            })

        recommendations.append({
            "id": f"rec-{uuid.uuid4().hex[:8]}",
            "type": "narrative_pacing",
            "title": "叙事节奏建议",
            "content": "建议审视当前章节的节奏：是否有张有弛？高潮后是否有缓冲段落？",
            "reason": "节奏断点会降低读者沉浸感。",
            "targetType": "chapter",
            "priority": "medium",
            "createdAt": datetime.now(timezone.utc).isoformat(),
        })

        async with self._lock:
            self._recommendations[novel_id] = recommendations
            self._record_audit_locked(
                novel_id=novel_id,
                action="recommendation.generate",
                entity_type="recommendation",
                author=self._extract_author(context),
                details={"generatedCount": len(recommendations)},
            )
            self._persist_locked()
        return recommendations

    async def accept_recommendation(self, novel_id: str, rec_id: str) -> dict | None:
        async with self._lock:
            recs = self._recommendations.get(novel_id, [])
            for rec in recs:
                if rec["id"] == rec_id:
                    rec["status"] = "accepted"
                    self._record_audit_locked(
                        novel_id=novel_id,
                        action="recommendation.accept",
                        entity_type="recommendation",
                        entity_id=rec_id,
                        details={"title": rec.get("title")},
                    )
                    self._persist_locked()
                    return rec
            return None

    # -- Interactions (annotations, collaboration tasks) --

    async def list_interactions(self, novel_id: str) -> list[dict]:
        return self._interactions.get(novel_id, [])

    async def create_interaction(self, novel_id: str, data: dict) -> dict:
        async with self._lock:
            if novel_id not in self._novels:
                raise HTTPException(status_code=404, detail="Novel not found")
            interaction_id = data.get("id") or f"interaction-{uuid.uuid4().hex[:12]}"
            now = datetime.now(timezone.utc).isoformat()
            interaction = {
                "id": interaction_id,
                "novelId": novel_id,
                "type": data.get("type", "annotation"),
                "title": data.get("title", ""),
                "content": data.get("content", ""),
                "anchorText": data.get("anchorText"),
                "chapterId": data.get("chapterId"),
                "rangeStart": data.get("rangeStart"),
                "rangeEnd": data.get("rangeEnd"),
                "status": data.get("status", "pending"),
                "mentions": data.get("mentions", []),
                "aiTask": data.get("aiTask"),
                "createdAt": now,
                "updatedAt": now,
            }
            self._interactions.setdefault(novel_id, []).append(interaction)
            self._record_audit_locked(
                novel_id=novel_id,
                action="interaction.create",
                entity_type="interaction",
                entity_id=interaction_id,
                author=self._extract_author(data),
                details={"type": interaction.get("type"), "status": interaction.get("status")},
            )
            self._persist_locked()
            return interaction

    async def update_interaction(self, novel_id: str, interaction_id: str, updates: dict) -> dict | None:
        async with self._lock:
            interactions = self._interactions.get(novel_id, [])
            for interaction in interactions:
                if interaction["id"] == interaction_id and interaction.get("novelId") == novel_id:
                    updates = {k: v for k, v in updates.items() if k not in {"id", "novelId"}}
                    interaction.update(updates)
                    interaction["updatedAt"] = datetime.now(timezone.utc).isoformat()
                    self._record_audit_locked(
                        novel_id=novel_id,
                        action="interaction.update",
                        entity_type="interaction",
                        entity_id=interaction_id,
                        author=self._extract_author(updates),
                        details={"updatedFields": sorted(updates.keys()), "status": interaction.get("status")},
                    )
                    self._persist_locked()
                    return interaction
            return None

    async def delete_interaction(self, novel_id: str, interaction_id: str) -> bool:
        async with self._lock:
            interactions = self._interactions.get(novel_id, [])
            before = len(interactions)
            self._interactions[novel_id] = [
                i for i in interactions if not (i["id"] == interaction_id and i.get("novelId") == novel_id)
            ]
            deleted = len(self._interactions[novel_id]) < before
            if deleted:
                self._record_audit_locked(
                    novel_id=novel_id,
                    action="interaction.delete",
                    entity_type="interaction",
                    entity_id=interaction_id,
                )
                self._persist_locked()
            return deleted

    # -- Quality report --

    async def get_quality_report(self, novel_id: str) -> dict:
        novel = await self.get_novel(novel_id)
        if not novel:
            raise HTTPException(status_code=404, detail="Novel not found")

        chapters = novel.get("chapters", [])
        characters = novel.get("characters", [])
        timeline = novel.get("timeline", [])

        issues = []
        total_chars = sum(len(c.get("content", "")) for c in chapters)

        if total_chars < 100:
            issues.append({
                "type": "low_word_count",
                "severity": "warning",
                "message": "小说总字数较少，建议继续完善内容。",
                "details": {"wordCount": total_chars},
            })

        char_names = {c.get("name") for c in characters if c.get("name")}
        content_text = " ".join(c.get("content", "") for c in chapters)
        unreferenced_chars = [name for name in char_names if name and name not in content_text]
        if unreferenced_chars:
            issues.append({
                "type": "unreferenced_characters",
                "severity": "info",
                "message": f"以下角色未在正文中被提及: {', '.join(unreferenced_chars[:5])}",
                "details": {"unreferenced": unreferenced_chars},
            })

        score = min(100, max(0, 60 + len(chapters) * 5 + len(characters) * 3))

        report = {
            "novelId": novel_id,
            "score": score,
            "metrics": {
                "wordCount": total_chars,
                "chapterCount": len(chapters),
                "characterCount": len(characters),
                "timelineEventCount": len(timeline),
            },
            "issues": issues,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
        async with self._lock:
            self._quality_reports[novel_id] = report
            self._persist_locked()
        return report


_novel_store = NovelStore()


async def get_legacy_entity_by_id(entity_id: str) -> dict | None:
    """Read a legacy novel entity by ID."""
    return await _novel_store.get_entity_by_id(entity_id)


async def update_legacy_entity_by_id(entity_id: str, updates: dict[str, Any]) -> dict | None:
    """Update a legacy novel entity by ID."""
    return await _novel_store.update_entity_by_id(entity_id, updates)


# ---------------------------------------------------------------------------
# Chat request / response models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1)
    stream: bool = True
    model_name: str | None = None
    temperature: float = 0.7
    max_tokens: int | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_llm(model_name: str | None = None):
    """Create a ChatModel instance from the app config.

    Uses the first model in the config (the "default" model) unless a
    specific model_name is provided that matches a configured model.
    Falls back to a lightweight ChatOpenAI if no config is available.
    """
    try:
        from deerflow.config.app_config import get_app_config
        from deerflow.models.factory import create_chat_model

        app_cfg = get_app_config()
        if not app_cfg.models:
            raise RuntimeError("No models configured")

        if model_name:
            target_name = next((m.name for m in app_cfg.models if m.name == model_name), None)
            if target_name is None:
                logger.warning(
                    "Requested model %r not found, falling back to first configured model",
                    model_name,
                )
                target_name = app_cfg.models[0].name
        else:
            target_name = app_cfg.models[0].name

        resolved_name = str(target_name)
        return create_chat_model(name=resolved_name)
    except Exception:
        logger.exception("Failed to resolve LLM from app config")
        raise


def _convert_messages(raw: list[ChatMessage]) -> list:
    """Convert API message list to LangChain message objects."""
    result = []
    for msg in raw:
        if msg.role == "system":
            result.append(SystemMessage(content=msg.content))
        elif msg.role in ("user", "human"):
            result.append(HumanMessage(content=msg.content))
        elif msg.role in ("assistant", "ai"):
            result.append(AIMessage(content=msg.content))
        else:
            result.append(HumanMessage(content=msg.content))
    return result


# ---------------------------------------------------------------------------
# Novel CRUD endpoints
# ---------------------------------------------------------------------------


@router.get("/novels")
@router.get("/novel/novels", deprecated=True)
async def list_novels(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    """List novels with pagination."""
    return await _novel_store.list_novels(page=page, page_size=page_size)


@router.get("/novels/{novel_id}")
@router.get("/novel/novels/{novel_id}", deprecated=True)
async def get_novel(novel_id: str):
    """Get a novel with its chapters, characters, entities, timeline, graph."""
    novel = await _novel_store.get_novel(novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


@router.post("/novels")
@router.post("/novel/novels", deprecated=True)
async def create_novel(request: Request):
    """Create a new novel project."""
    data = await request.json()
    return await _novel_store.create_novel(data)


@router.put("/novels/{novel_id}")
@router.put("/novel/novels/{novel_id}", deprecated=True)
async def update_novel(novel_id: str, request: Request):
    """Update a novel's metadata."""
    data = await request.json()
    novel = await _novel_store.update_novel(novel_id, data)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    return novel


@router.delete("/novels/{novel_id}")
@router.delete("/novel/novels/{novel_id}", deprecated=True)
async def delete_novel(novel_id: str):
    """Delete a novel and all its associated data."""
    ok = await _novel_store.delete_novel(novel_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Novel not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Chapter endpoints
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/chapters")
@router.get("/novel/novels/{novel_id}/chapters", deprecated=True)
async def list_chapters(novel_id: str, volume_id: str | None = None):
    """List chapters for a novel."""
    return await _novel_store.list_chapters(novel_id, volume_id=volume_id)


@router.get("/novels/{novel_id}/chapters/{chapter_id}")
@router.get("/novel/novels/{novel_id}/chapters/{chapter_id}", deprecated=True)
async def get_chapter(novel_id: str, chapter_id: str):
    """Get a single chapter."""
    chapter = await _novel_store.get_chapter(chapter_id)
    if not chapter or chapter.get("novelId") != novel_id:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


@router.post("/novels/{novel_id}/chapters")
@router.post("/novel/novels/{novel_id}/chapters", deprecated=True)
async def create_chapter(novel_id: str, request: Request):
    """Create a new chapter."""
    data = await request.json()
    return await _novel_store.create_chapter(novel_id, data)


@router.put("/novels/{novel_id}/chapters/{chapter_id}")
@router.put("/novel/novels/{novel_id}/chapters/{chapter_id}", deprecated=True)
async def update_chapter(novel_id: str, chapter_id: str, request: Request):
    """Update a chapter's content."""
    data = await request.json()
    chapter = await _novel_store.update_chapter(novel_id, chapter_id, data)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return chapter


@router.delete("/novels/{novel_id}/chapters/{chapter_id}")
@router.delete("/novel/novels/{novel_id}/chapters/{chapter_id}", deprecated=True)
async def delete_chapter(novel_id: str, chapter_id: str):
    """Delete a chapter."""
    ok = await _novel_store.delete_chapter(novel_id, chapter_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Entity endpoints
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/entities")
@router.get("/novel/novels/{novel_id}/entities", deprecated=True)
async def list_entities(novel_id: str, entity_type: str | None = None):
    """List entities (characters, settings, items, factions) for a novel."""
    return await _novel_store.list_entities(novel_id, entity_type=entity_type)


@router.post("/novels/{novel_id}/entities")
@router.post("/novel/novels/{novel_id}/entities", deprecated=True)
async def create_entity(novel_id: str, request: Request):
    """Create a new entity."""
    data = await request.json()
    return await _novel_store.create_entity(novel_id, data)


@router.put("/novels/{novel_id}/entities/{entity_id}")
@router.put("/novel/novels/{novel_id}/entities/{entity_id}", deprecated=True)
async def update_entity(novel_id: str, entity_id: str, request: Request):
    """Update an entity."""
    data = await request.json()
    entity = await _novel_store.update_entity(novel_id, entity_id, data)
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    return entity


@router.delete("/novels/{novel_id}/entities/{entity_id}")
@router.delete("/novel/novels/{novel_id}/entities/{entity_id}", deprecated=True)
async def delete_entity(novel_id: str, entity_id: str):
    """Delete an entity."""
    ok = await _novel_store.delete_entity(novel_id, entity_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Entity not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Timeline endpoints
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/timeline")
@router.get("/novel/novels/{novel_id}/timeline", deprecated=True)
async def get_timeline(novel_id: str):
    """Get timeline events for a novel."""
    return await _novel_store.get_timeline(novel_id)


@router.post("/novels/{novel_id}/timeline")
@router.post("/novel/novels/{novel_id}/timeline", deprecated=True)
async def create_timeline_event(novel_id: str, request: Request):
    """Create a timeline event."""
    data = await request.json()
    return await _novel_store.create_timeline_event(novel_id, data)


@router.put("/novels/{novel_id}/timeline/{event_id}")
@router.put("/novel/novels/{novel_id}/timeline/{event_id}", deprecated=True)
async def update_timeline_event(novel_id: str, event_id: str, request: Request):
    """Update a timeline event."""
    data = await request.json()
    event = await _novel_store.update_timeline_event(novel_id, event_id, data)
    if not event:
        raise HTTPException(status_code=404, detail="Timeline event not found")
    return event


@router.delete("/novels/{novel_id}/timeline/{event_id}")
@router.delete("/novel/novels/{novel_id}/timeline/{event_id}", deprecated=True)
async def delete_timeline_event(novel_id: str, event_id: str):
    """Delete a timeline event."""
    ok = await _novel_store.delete_timeline_event(novel_id, event_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Timeline event not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Graph layout endpoints
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/graph")
@router.get("/novel/novels/{novel_id}/graph", deprecated=True)
async def get_graph(novel_id: str):
    """Get graph layout for a novel's relationship visualization."""
    graph = await _novel_store.get_graph(novel_id)
    if not graph:
        return {"nodePositions": {}, "isLocked": False}
    return graph


@router.put("/novels/{novel_id}/graph")
@router.put("/novel/novels/{novel_id}/graph", deprecated=True)
async def save_graph(novel_id: str, request: Request):
    """Save graph layout (node positions for relationship visualization)."""
    data = await request.json()
    return await _novel_store.save_graph(novel_id, data)


# ---------------------------------------------------------------------------
# Recommendation endpoints
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/recommendations")
@router.get("/novel/novels/{novel_id}/recommendations", deprecated=True)
async def get_recommendations(novel_id: str):
    """Get AI-generated recommendations for a novel."""
    return await _novel_store.get_recommendations(novel_id)


@router.post("/novels/{novel_id}/recommendations/generate")
@router.post("/novel/novels/{novel_id}/recommendations/generate", deprecated=True)
async def generate_recommendations(novel_id: str, request: Request):
    """Generate new recommendations based on novel context."""
    context = None
    try:
        context = await request.json()
    except Exception:
        pass
    return await _novel_store.generate_recommendations(novel_id, context)


@router.post("/novels/{novel_id}/recommendations/{rec_id}/accept")
@router.post("/novel/novels/{novel_id}/recommendations/{rec_id}/accept", deprecated=True)
async def accept_recommendation(novel_id: str, rec_id: str):
    """Accept a recommendation and mark it as adopted."""
    rec = await _novel_store.accept_recommendation(novel_id, rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return rec


# ---------------------------------------------------------------------------
# Interaction endpoints (annotations, collaboration tasks)
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/interactions")
@router.get("/novel/novels/{novel_id}/interactions", deprecated=True)
async def list_interactions(novel_id: str):
    """List interactions (annotations, collaboration tasks) for a novel."""
    return await _novel_store.list_interactions(novel_id)


@router.post("/novels/{novel_id}/interactions")
@router.post("/novel/novels/{novel_id}/interactions", deprecated=True)
async def create_interaction(novel_id: str, request: Request):
    """Create an interaction (annotation thread, AI collaboration task)."""
    data = await request.json()
    return await _novel_store.create_interaction(novel_id, data)


@router.put("/novels/{novel_id}/interactions/{interaction_id}")
@router.put("/novel/novels/{novel_id}/interactions/{interaction_id}", deprecated=True)
async def update_interaction(novel_id: str, interaction_id: str, request: Request):
    """Update an interaction (change status, add content, etc.)."""
    data = await request.json()
    interaction = await _novel_store.update_interaction(novel_id, interaction_id, data)
    if not interaction:
        raise HTTPException(status_code=404, detail="Interaction not found")
    return interaction


@router.delete("/novels/{novel_id}/interactions/{interaction_id}")
@router.delete("/novel/novels/{novel_id}/interactions/{interaction_id}", deprecated=True)
async def delete_interaction(novel_id: str, interaction_id: str):
    """Delete an interaction."""
    ok = await _novel_store.delete_interaction(novel_id, interaction_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Interaction not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Quality report endpoint
# ---------------------------------------------------------------------------


@router.get("/novels/{novel_id}/quality-report")
@router.get("/novel/novels/{novel_id}/quality-report", deprecated=True)
async def get_quality_report(novel_id: str):
    """Get quality assessment and conflict report for a novel."""
    return await _novel_store.get_quality_report(novel_id)


@router.get("/novels/{novel_id}/audits")
@router.get("/novel/novels/{novel_id}/audits", deprecated=True)
async def get_audits(
    novel_id: str,
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None, alias="entityType"),
    author: str | None = Query(default=None),
    limit: int = Query(200, ge=1, le=1000),
):
    """Get normalized audit records for a novel."""
    novel = await _novel_store.get_novel(novel_id)
    if not novel:
        raise HTTPException(status_code=404, detail="Novel not found")
    return await _novel_store.list_audits(
        novel_id,
        action=action,
        entity_type=entity_type,
        author=author,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# AI Chat endpoints (original)
# ---------------------------------------------------------------------------


@router.post("/novels/{novel_id}/ai/chat")
@router.post("/novel/chat", deprecated=True)
async def chat(request: ChatRequest, fastapi_request: Request, novel_id: str | None = None):
    """Chat with the novel AI assistant.

    Supports both streaming (SSE) and non-streaming responses.
    """
    llm = _resolve_llm(request.model_name)
    messages = _convert_messages(request.messages)

    if request.temperature != 0.7:
        llm = llm.model_copy(update={"temperature": request.temperature})
    if request.max_tokens is not None:
        llm = llm.model_copy(update={"max_tokens": request.max_tokens})

    if not request.stream:
        response = await llm.ainvoke(messages)
        return {"content": response.content, "role": "assistant"}

    async def event_generator():
        try:
            async for chunk in llm.astream(messages):
                if chunk.content:
                    yield {"event": "message", "data": json.dumps({"delta": {"content": chunk.content}})}
            yield {"event": "done", "data": json.dumps({"done": True})}
        except Exception:
            logger.exception("Novel chat stream error")
            yield {"event": "error", "data": json.dumps({"error": "Stream interrupted"})}

    return EventSourceResponse(event_generator())
