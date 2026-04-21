from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from threading import Lock
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.deps import get_checkpointer
from deerflow.media import draft_media_store
from app.gateway.novel_migrated.core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["media-drafts"])


TargetType = Literal["project", "character", "scene"]


class DraftAttachRequest(BaseModel):
    target_type: TargetType = Field(description="Attach target type")
    target_id: str = Field(description="Target identifier")


class DraftAttachResponse(BaseModel):
    success: bool
    asset_id: str | None = None
    content_url: str | None = None
    mime_type: str | None = None
    kind: str | None = None
    target_updated: bool = False
    target_update_error: str | None = None


class MediaDraftMetricsResponse(BaseModel):
    metrics: dict[str, int]


_MEDIA_DRAFT_METRICS_LOCK = Lock()
_MEDIA_DRAFT_METRICS: dict[str, int] = {
    "content_requests_total": 0,
    "content_not_found_total": 0,
    "content_expired_total": 0,
    "delete_requests_total": 0,
    "delete_success_total": 0,
    "delete_not_found_total": 0,
    "attach_requests_total": 0,
    "attach_success_total": 0,
    "attach_validation_failed_total": 0,
    "attach_not_found_total": 0,
    "attach_expired_total": 0,
    "attach_error_total": 0,
    "attach_scene_success_total": 0,
    "attach_target_update_failed_total": 0,
}


def _increment_metric(name: str, value: int = 1) -> None:
    with _MEDIA_DRAFT_METRICS_LOCK:
        _MEDIA_DRAFT_METRICS[name] = int(_MEDIA_DRAFT_METRICS.get(name, 0)) + value


def _snapshot_metrics() -> dict[str, int]:
    with _MEDIA_DRAFT_METRICS_LOCK:
        return dict(_MEDIA_DRAFT_METRICS)


def _build_inline_headers(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'inline; filename="{filename}"'}


def _read_channel_values(checkpoint_tuple: Any) -> dict[str, Any]:
    checkpoint = getattr(checkpoint_tuple, "checkpoint", {}) or {}
    raw = checkpoint.get("channel_values", {}) or {}
    return dict(raw) if isinstance(raw, dict) else {}


async def _patch_thread_draft_media(
    *,
    request: Request,
    thread_id: str,
    mutate: "callable[[dict[str, Any]], dict[str, Any]]",
    as_node: str,
) -> None:
    """Patch thread.channel_values.draft_media by writing a new checkpoint snapshot."""
    checkpointer = get_checkpointer(request)
    cfg = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
    checkpoint_tuple = await checkpointer.aget_tuple(cfg)
    if checkpoint_tuple is None:
        return

    checkpoint: dict[str, Any] = dict(getattr(checkpoint_tuple, "checkpoint", {}) or {})
    metadata: dict[str, Any] = dict(getattr(checkpoint_tuple, "metadata", {}) or {})
    channel_values = _read_channel_values(checkpoint_tuple)

    draft_media = channel_values.get("draft_media")
    if not isinstance(draft_media, dict):
        draft_media = {}
    next_draft_media = mutate(dict(draft_media))
    channel_values["draft_media"] = next_draft_media

    checkpoint["channel_values"] = channel_values
    metadata["updated_at"] = time.time()
    metadata["source"] = "update"
    metadata["step"] = metadata.get("step", 0) + 1
    metadata["writes"] = {as_node: {"draft_media": {"_patched": True}}}

    await checkpointer.aput(cfg, checkpoint, metadata, {})


@router.get("/threads/{thread_id}/media/drafts/{draft_id}/content")
async def get_draft_content(thread_id: str, draft_id: str, request: Request) -> Response:
    _increment_metric("content_requests_total")
    meta = draft_media_store.load_metadata(thread_id=thread_id, draft_id=draft_id)
    if meta is None:
        _increment_metric("content_not_found_total")
        raise HTTPException(status_code=404, detail="Draft not found")

    # Expiration check (best-effort cleanup)
    expires_at = meta.get("expires_at")
    if isinstance(expires_at, str) and expires_at.strip():
        try:
            parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            if parsed.timestamp() <= time.time():
                _increment_metric("content_expired_total")
                draft_media_store.delete_draft(thread_id=thread_id, draft_id=draft_id)
                try:
                    await _patch_thread_draft_media(
                        request=request,
                        thread_id=thread_id,
                        mutate=lambda current: {k: v for k, v in current.items() if k != draft_id},
                        as_node="media_drafts.expire",
                    )
                except Exception:
                    logger.debug("Failed to patch thread draft_media after expiry", exc_info=True)
                raise HTTPException(status_code=410, detail="Draft expired")
        except HTTPException:
            raise
        except Exception:
            # If parsing fails, do not block access.
            pass

    content_path = meta.get("content_path")
    if not isinstance(content_path, str) or not content_path:
        raise HTTPException(status_code=404, detail="Draft content missing")

    mime_type = meta.get("mime_type")
    if not isinstance(mime_type, str) or not mime_type:
        mime_type = "application/octet-stream"

    filename = f"{draft_id}"
    return FileResponse(
        path=content_path,
        media_type=mime_type,
        headers=_build_inline_headers(filename),
    )


@router.delete("/threads/{thread_id}/media/drafts/{draft_id}")
async def delete_draft(thread_id: str, draft_id: str, request: Request) -> dict:
    _increment_metric("delete_requests_total")
    deleted = draft_media_store.delete_draft(thread_id=thread_id, draft_id=draft_id)
    try:
        await _patch_thread_draft_media(
            request=request,
            thread_id=thread_id,
            mutate=lambda current: {k: v for k, v in current.items() if k != draft_id},
            as_node="media_drafts.delete",
        )
    except Exception:
        logger.debug("Failed to patch thread draft_media after deletion", exc_info=True)
    if not deleted:
        _increment_metric("delete_not_found_total")
        raise HTTPException(status_code=404, detail="Draft not found")
    _increment_metric("delete_success_total")
    return {"success": True}


@router.post("/threads/{thread_id}/media/drafts/{draft_id}/attach", response_model=DraftAttachResponse)
async def attach_draft(
    thread_id: str,
    draft_id: str,
    body: DraftAttachRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> DraftAttachResponse:
    _increment_metric("attach_requests_total")
    from sqlalchemy import select

    from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
    from app.gateway.novel_migrated.models.character import Character
    from app.gateway.novel_migrated.models.project import Project
    from app.gateway.routers.novel import get_legacy_entity_by_id, update_legacy_entity_by_id

    scene_entity: dict[str, Any] | None = None

    if body.target_type == "project":
        user_id = get_user_id(request)
        await verify_project_access(body.target_id, user_id, db)
        result = await db.execute(select(Project).where(Project.id == body.target_id))
        if result.scalar_one_or_none() is None:
            _increment_metric("attach_validation_failed_total")
            raise HTTPException(status_code=404, detail="Project not found")
    elif body.target_type == "character":
        user_id = get_user_id(request)
        result = await db.execute(select(Character).where(Character.id == body.target_id))
        character = result.scalar_one_or_none()
        if character is None:
            _increment_metric("attach_validation_failed_total")
            raise HTTPException(status_code=404, detail="Character not found")
        await verify_project_access(character.project_id, user_id, db)
    elif body.target_type == "scene":
        scene_entity = await get_legacy_entity_by_id(body.target_id)
        if scene_entity is None:
            _increment_metric("attach_validation_failed_total")
            raise HTTPException(status_code=404, detail="Scene entity not found")
        scene_type = scene_entity.get("type")
        if not isinstance(scene_type, str):
            _increment_metric("attach_validation_failed_total")
            raise HTTPException(status_code=422, detail="Scene entity type is invalid")
        if scene_type not in {"scene", "setting", "settings"}:
            _increment_metric("attach_validation_failed_total")
            raise HTTPException(status_code=422, detail=f"Entity type '{scene_type}' does not support scene media attachment")

    try:
        asset = draft_media_store.attach_draft_to_asset(
            thread_id=thread_id,
            draft_id=draft_id,
            target_type=body.target_type,
            target_id=body.target_id,
        )
    except TimeoutError:
        _increment_metric("attach_expired_total")
        raise HTTPException(status_code=410, detail="Draft expired")
    except FileNotFoundError:
        _increment_metric("attach_not_found_total")
        raise HTTPException(status_code=404, detail="Draft not found")
    except Exception as exc:
        _increment_metric("attach_error_total")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Remove from thread state (drafts are ephemeral).
    try:
        await _patch_thread_draft_media(
            request=request,
            thread_id=thread_id,
            mutate=lambda current: {k: v for k, v in current.items() if k != draft_id},
            as_node="media_drafts.attach",
        )
    except Exception:
        logger.debug("Failed to patch thread draft_media after attach", exc_info=True)

    # Attach success means the asset has been durably linked to the target metadata.
    # For image targets we additionally try to sync known novel_migrated fields.
    target_updated = True
    target_update_error: str | None = None
    kind = str(asset.get("kind") or "")
    content_url = str(asset.get("content_url") or "")
    asset_id = str(asset.get("asset_id") or "")

    if kind == "image" and body.target_type in ("project", "character"):
        try:
            if body.target_type == "project":
                result = await db.execute(select(Project).where(Project.id == body.target_id))
                project = result.scalar_one_or_none()
                if project is None:
                    raise RuntimeError("Project not found")
                project.cover_image_url = content_url
                project.cover_status = "ready"
                project.cover_updated_at = datetime.now(tz=UTC)
                await db.commit()
            elif body.target_type == "character":
                result = await db.execute(select(Character).where(Character.id == body.target_id))
                character = result.scalar_one_or_none()
                if character is None:
                    raise RuntimeError("Character not found")
                character.avatar_url = content_url
                await db.commit()
        except Exception as exc:
            target_updated = False
            target_update_error = str(exc)
    elif body.target_type == "scene":
        try:
            existing_properties = scene_entity.get("properties") if isinstance(scene_entity, dict) else {}
            normalized_properties = dict(existing_properties) if isinstance(existing_properties, dict) else {}
            existing_media = normalized_properties.get("media")
            normalized_media = dict(existing_media) if isinstance(existing_media, dict) else {}

            scene_updates: dict[str, Any] = {"last_asset_id": asset_id}
            if kind == "image":
                scene_updates["image_url"] = content_url
                normalized_media["image_url"] = content_url
            elif kind == "audio":
                scene_updates["audio_url"] = content_url
                normalized_media["audio_url"] = content_url
            normalized_media["asset_id"] = asset_id
            normalized_media["kind"] = kind
            normalized_properties["media"] = normalized_media
            scene_updates["properties"] = normalized_properties
            updated_entity = await update_legacy_entity_by_id(body.target_id, scene_updates)
            if updated_entity is None:
                raise RuntimeError("Scene entity disappeared before writeback")
        except Exception as exc:
            target_updated = False
            target_update_error = str(exc)

    _increment_metric("attach_success_total")
    if body.target_type == "scene":
        _increment_metric("attach_scene_success_total")
    if target_updated is False:
        _increment_metric("attach_target_update_failed_total")

    return DraftAttachResponse(
        success=True,
        asset_id=asset_id,
        content_url=content_url or None,
        mime_type=str(asset.get("mime_type") or "") or None,
        kind=kind or None,
        target_updated=target_updated,
        target_update_error=target_update_error,
    )


@router.get("/media/drafts/metrics", response_model=MediaDraftMetricsResponse)
async def get_media_draft_metrics() -> MediaDraftMetricsResponse:
    return MediaDraftMetricsResponse(metrics=_snapshot_metrics())


@router.get("/media/assets/{asset_id}/content")
async def get_asset_content(asset_id: str) -> Response:
    paths = draft_media_store.load_asset_paths(asset_id=asset_id)
    if paths is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    try:
        meta = json.loads(paths.meta_path.read_text(encoding="utf-8"))
    except Exception:
        meta = {}
    mime_type = meta.get("mime_type") if isinstance(meta, dict) else None
    if not isinstance(mime_type, str) or not mime_type:
        mime_type = "application/octet-stream"

    filename = f"{asset_id}"
    return FileResponse(
        path=paths.content_path,
        media_type=mime_type,
        headers=_build_inline_headers(filename),
    )
