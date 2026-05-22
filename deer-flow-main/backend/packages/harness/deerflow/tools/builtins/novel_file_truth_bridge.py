from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from deerflow.tools.builtins.novel_internal import get_internal_db, load_attr, resolve_user_id

logger = logging.getLogger(__name__)

_HEAVY_CONTENT_KEYS = {
    "content",
    "text",
    "raw",
    "analysis",
    "memories",
    "characters",
    "outlines",
    "chapters",
    "main_careers",
    "sub_careers",
    "polished_text",
    "regenerated_text",
    "result",
}
_PREFERRED_META_KEYS = {
    "success",
    "error",
    "message",
    "source",
    "status",
    "task_id",
    "project_id",
    "chapter_id",
    "outline_id",
    "character_id",
    "id",
    "reason",
    "action",
    "skipped",
}


@dataclass(frozen=True)
class DocumentSpec:
    entity_type: str
    entity_id: str
    content: Any
    title: str = ""
    tags: tuple[str, ...] = ()


async def persist_workspace_documents(
    *,
    project_id: str,
    documents: list[DocumentSpec],
) -> list[dict[str, Any]]:
    """Persist tool outputs into file-truth workspace and sync index cache.

    Best-effort helper. Returns empty list when internal bridge is unavailable
    or persistence fails, without breaking the tool's main response.
    """
    project_id = (project_id or "").strip()
    if not project_id or not documents:
        return []

    workspace_service = load_attr(
        "app.gateway.novel_migrated.services.workspace_document_service",
        "workspace_document_service",
    )
    if workspace_service is None:
        logger.debug("workspace_document_service unavailable, skip file-truth persistence")
        return []

    try:
        AsyncSessionLocal = await get_internal_db()
    except Exception as exc:
        logger.warning("file-truth persistence skipped: internal db unavailable (%s)", exc)
        return []

    user_id = resolve_user_id(None)
    records: list[dict[str, Any]] = []

    try:
        await workspace_service.initialize_workspace(
            user_id=user_id,
            project_id=project_id,
        )
        async with AsyncSessionLocal() as db:
            for spec in documents:
                record = await workspace_service.write_document(
                    user_id=user_id,
                    project_id=project_id,
                    entity_type=spec.entity_type,
                    entity_id=spec.entity_id,
                    content=spec.content,
                    title=spec.title or None,
                    tags=list(spec.tags),
                )
                await workspace_service.sync_record_to_db(
                    db=db,
                    user_id=user_id,
                    project_id=project_id,
                    record=record,
                )
                records.append(
                    {
                        "entity_type": record.entity_type,
                        "entity_id": record.entity_id,
                        "doc_path": record.path,
                        "content_hash": record.content_hash,
                        "doc_updated_at": record.mtime,
                        "size": record.size,
                        "tags": list(record.tags),
                    }
                )
            await db.commit()
    except Exception as exc:
        logger.warning("file-truth persistence failed: project=%s error=%s", project_id, exc)
        return []

    return records


def attach_file_truth_meta(result: dict[str, Any], writes: list[dict[str, Any]]) -> dict[str, Any]:
    """Attach unified file-truth metadata to a tool result.

    为避免正文大 payload 回流到工具响应，这里只保留轻量字段（状态/任务ID/错误等），
    并统一补充 written_documents + index_status 元信息。
    """
    enriched: dict[str, Any] = {}
    for key, value in (result or {}).items():
        if key in _HEAVY_CONTENT_KEYS:
            continue
        if key in _PREFERRED_META_KEYS:
            enriched[key] = value
            continue
        if isinstance(value, (str, int, float, bool)) and len(str(value)) <= 300:
            enriched[key] = value

    enriched["content_source"] = "file"
    enriched["index_status"] = "synced" if writes else "skipped"
    enriched["written_documents"] = writes
    if writes:
        first = writes[0]
        enriched["doc_path"] = first.get("doc_path")
        enriched["content_hash"] = first.get("content_hash")
        enriched["doc_updated_at"] = first.get("doc_updated_at")
    return enriched


def to_pretty_json(data: Any) -> str:
    try:
        return json.dumps(data, ensure_ascii=False, indent=2)
    except Exception:
        return str(data)
