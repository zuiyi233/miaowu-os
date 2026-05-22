from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict
from urllib.parse import urljoin, urlparse

import httpx

from deerflow.config import get_app_config
from deerflow.config.paths import Paths, get_paths

logger = logging.getLogger(__name__)


DraftMediaKind = Literal["image", "audio"]
DraftMediaRetention = Literal["24h", "7d", "never"]


class DraftMediaItem(TypedDict):
    id: str
    kind: DraftMediaKind
    created_at: str
    expires_at: str | None
    prompt: NotRequired[str]
    text: NotRequired[str]
    model: NotRequired[str]
    voice: NotRequired[str]
    format: NotRequired[str]
    mime_type: str
    content_url: str


def _utc_now_iso() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def _parse_iso_to_ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.timestamp()
    except ValueError:
        return None


def _retention_to_ttl_seconds(retention: DraftMediaRetention | str | None) -> int | None:
    normalized = (retention or "").strip().lower()
    if normalized in ("never", "none", "0", "false"):
        return None
    if normalized in ("24h", "24", "1d", "1day", "day"):
        return 24 * 60 * 60
    if normalized in ("7d", "7", "7day", "week"):
        return 7 * 24 * 60 * 60
    return 7 * 24 * 60 * 60


def _guess_image_mime_and_ext(data: bytes) -> tuple[str, str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    return "application/octet-stream", "bin"


def _mime_to_ext(mime_type: str, *, fallback: str) -> str:
    mt = (mime_type or "").lower().strip()
    if mt == "image/png":
        return "png"
    if mt == "image/jpeg":
        return "jpg"
    if mt == "image/webp":
        return "webp"
    if mt in ("audio/mpeg", "audio/mp3"):
        return "mp3"
    if mt in ("audio/wav", "audio/x-wav"):
        return "wav"
    if mt in ("audio/flac",):
        return "flac"
    if mt in ("audio/aac",):
        return "aac"
    if mt in ("audio/ogg", "audio/opus"):
        return "opus"
    return fallback


def _tts_format_to_mime_and_ext(fmt: str | None) -> tuple[str, str]:
    normalized = (fmt or "").strip().lower()
    if normalized in ("wav",):
        return "audio/wav", "wav"
    if normalized in ("flac",):
        return "audio/flac", "flac"
    if normalized in ("aac",):
        return "audio/aac", "aac"
    if normalized in ("opus", "ogg"):
        return "audio/opus", "opus"
    if normalized in ("pcm",):
        return "audio/pcm", "pcm"
    # Default to mp3 to match most OpenAI-compatible relays.
    return "audio/mpeg", "mp3"


def _safe_filename(name: str) -> str:
    # Do not allow directory traversal; keep it simple (uuid + extension).
    return name.replace("/", "_").replace("\\", "_").strip()


@dataclass(frozen=True)
class DraftPaths:
    content_path: Path
    meta_path: Path


class DraftMediaStore:
    """Thread-scoped draft media storage + OpenAI-compatible generation helpers."""

    def __init__(self, paths: Paths | None = None) -> None:
        self._paths = paths or get_paths()

    def _draft_dir(self, thread_id: str) -> Path:
        return self._paths.thread_dir(thread_id) / "draft-media"

    def _asset_dir(self) -> Path:
        return self._paths.base_dir / "media-assets"

    def _draft_paths(self, thread_id: str, draft_id: str, ext: str) -> DraftPaths:
        safe_id = _safe_filename(draft_id)
        safe_ext = _safe_filename(ext.lstrip(".")) or "bin"
        d = self._draft_dir(thread_id)
        return DraftPaths(
            content_path=d / f"{safe_id}.{safe_ext}",
            meta_path=d / f"{safe_id}.json",
        )

    def _asset_paths(self, asset_id: str, ext: str) -> DraftPaths:
        safe_id = _safe_filename(asset_id)
        safe_ext = _safe_filename(ext.lstrip(".")) or "bin"
        d = self._asset_dir()
        return DraftPaths(
            content_path=d / f"{safe_id}.{safe_ext}",
            meta_path=d / f"{safe_id}.json",
        )

    def _ensure_thread_dir(self, thread_id: str) -> None:
        self._paths.ensure_thread_dirs(thread_id)
        draft_dir = self._draft_dir(thread_id)
        draft_dir.mkdir(parents=True, exist_ok=True)
        draft_dir.chmod(0o777)

    def _ensure_asset_dir(self) -> None:
        asset_dir = self._asset_dir()
        asset_dir.mkdir(parents=True, exist_ok=True)
        asset_dir.chmod(0o777)

    def _build_content_url(self, thread_id: str, draft_id: str) -> str:
        return f"/api/threads/{thread_id}/media/drafts/{draft_id}/content"

    def _build_asset_url(self, asset_id: str) -> str:
        return f"/api/media/assets/{asset_id}/content"

    def load_metadata(self, *, thread_id: str, draft_id: str) -> DraftMediaItem | None:
        meta_path = self._draft_dir(thread_id) / f"{_safe_filename(draft_id)}.json"
        if not meta_path.exists():
            return None
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            logger.exception("Failed to read draft metadata: %s", meta_path)
            return None
        if not isinstance(data, dict):
            return None
        return data  # type: ignore[return-value]

    def delete_draft(self, *, thread_id: str, draft_id: str) -> bool:
        meta_path = self._draft_dir(thread_id) / f"{_safe_filename(draft_id)}.json"
        existed = meta_path.exists()
        content_path: Path | None = None
        try:
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    if isinstance(meta, dict) and isinstance(meta.get("content_path"), str):
                        content_path = Path(meta["content_path"])
                except Exception:
                    pass
        finally:
            # best-effort delete metadata first
            try:
                meta_path.unlink(missing_ok=True)
            except Exception:
                logger.debug("Failed to delete draft metadata %s", meta_path, exc_info=True)

        if content_path is not None:
            try:
                content_path.unlink(missing_ok=True)
            except Exception:
                logger.debug("Failed to delete draft content %s", content_path, exc_info=True)
        else:
            # Fallback: delete any matching content file with unknown extension.
            for candidate in self._draft_dir(thread_id).glob(f"{_safe_filename(draft_id)}.*"):
                if candidate.suffix == ".json":
                    continue
                try:
                    candidate.unlink(missing_ok=True)
                except Exception:
                    logger.debug("Failed to delete draft content %s", candidate, exc_info=True)

        return existed

    def cleanup_expired(self, *, thread_id: str) -> list[str]:
        """Remove expired drafts on disk. Returns removed draft IDs."""
        draft_dir = self._draft_dir(thread_id)
        if not draft_dir.exists():
            return []

        now = time.time()
        removed: list[str] = []
        for meta_path in draft_dir.glob("*.json"):
            try:
                data = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                logger.debug("Skip unreadable draft metadata: %s", meta_path)
                continue
            if not isinstance(data, dict):
                continue

            draft_id = str(data.get("id") or meta_path.stem)
            expires_at = data.get("expires_at")
            expires_ts = _parse_iso_to_ts(expires_at if isinstance(expires_at, str) else None)
            if expires_ts is None:
                continue
            if expires_ts > now:
                continue

            self.delete_draft(thread_id=thread_id, draft_id=draft_id)
            removed.append(draft_id)
        return removed

    def create_draft(
        self,
        *,
        thread_id: str,
        kind: DraftMediaKind,
        mime_type: str,
        content: bytes,
        ttl_seconds: int | None,
        prompt: str | None = None,
        text: str | None = None,
        model: str | None = None,
        voice: str | None = None,
        fmt: str | None = None,
    ) -> DraftMediaItem:
        self._ensure_thread_dir(thread_id)

        draft_id = uuid.uuid4().hex
        ext = _mime_to_ext(mime_type, fallback="bin")
        paths = self._draft_paths(thread_id, draft_id, ext)

        created_at = _utc_now_iso()
        expires_at: str | None = None
        if ttl_seconds is not None:
            expires_at = datetime.fromtimestamp(time.time() + ttl_seconds, tz=UTC).isoformat().replace("+00:00", "Z")

        paths.content_path.write_bytes(content)
        paths.meta_path.write_text(
            json.dumps(
                {
                    "id": draft_id,
                    "kind": kind,
                    "created_at": created_at,
                    "expires_at": expires_at,
                    "prompt": prompt or None,
                    "text": text or None,
                    "model": model or None,
                    "voice": voice or None,
                    "format": fmt or None,
                    "mime_type": mime_type,
                    "content_url": self._build_content_url(thread_id, draft_id),
                    # For deletion/tracing only; not used by the client.
                    "content_path": str(paths.content_path),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        return {
            "id": draft_id,
            "kind": kind,
            "created_at": created_at,
            "expires_at": expires_at,
            "mime_type": mime_type,
            "content_url": self._build_content_url(thread_id, draft_id),
            **({"prompt": prompt} if prompt else {}),
            **({"text": text} if text else {}),
            **({"model": model} if model else {}),
            **({"voice": voice} if voice else {}),
            **({"format": fmt} if fmt else {}),
        }

    async def generate_openai_image_draft(
        self,
        *,
        thread_id: str,
        base_url: str,
        api_key: str | None,
        prompt: str,
        model: str | None,
        retention: DraftMediaRetention | str | None,
    ) -> DraftMediaItem:
        ttl_seconds = _retention_to_ttl_seconds(retention)

        url = f"{base_url.rstrip('/')}/images/generations"
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload: dict[str, Any] = {
            "prompt": prompt,
            "n": 1,
            "response_format": "b64_json",
        }
        if model:
            payload["model"] = model

        timeout = httpx.Timeout(120.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        if not isinstance(data, dict) or not isinstance(data.get("data"), list) or not data["data"]:
            raise ValueError("Unexpected images response shape")

        first = data["data"][0]
        if not isinstance(first, dict):
            raise ValueError("Unexpected images response item shape")

        content_bytes: bytes | None = None
        mime_type = "image/png"
        revised_prompt = first.get("revised_prompt") if isinstance(first.get("revised_prompt"), str) else None

        if isinstance(first.get("b64_json"), str) and first["b64_json"].strip():
            raw = base64.b64decode(first["b64_json"])
            mime_type, _ = _guess_image_mime_and_ext(raw)
            content_bytes = raw
        elif isinstance(first.get("url"), str) and first["url"].strip():
            image_url = first["url"].strip()
            if image_url.startswith("data:"):
                header, _, payload = image_url.partition(",")
                is_base64 = ";base64" in header
                content_bytes = base64.b64decode(payload) if is_base64 else payload.encode("utf-8")
                media_part = header[5:].split(";", 1)[0].strip()
                if media_part:
                    mime_type = media_part
            else:
                parsed = urlparse(image_url)
                if not parsed.scheme:
                    image_url = urljoin(f"{base_url.rstrip('/')}/", image_url.lstrip("/"))

                timeout = httpx.Timeout(120.0)
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                    img_resp = await client.get(image_url)
                    img_resp.raise_for_status()
                    content_bytes = img_resp.content
                    mime_type = (img_resp.headers.get("content-type") or "").split(";", 1)[0].strip() or mime_type
        else:
            raise ValueError("Images response missing b64_json/url")

        if content_bytes is None:
            raise ValueError("Images response missing content bytes")

        return self.create_draft(
            thread_id=thread_id,
            kind="image",
            mime_type=mime_type,
            content=content_bytes,
            ttl_seconds=ttl_seconds,
            prompt=revised_prompt or prompt,
            model=model,
        )

    async def generate_openai_tts_draft(
        self,
        *,
        thread_id: str,
        base_url: str,
        api_key: str | None,
        text: str,
        model: str | None,
        voice: str | None,
        fmt: str | None,
        retention: DraftMediaRetention | str | None,
    ) -> DraftMediaItem:
        ttl_seconds = _retention_to_ttl_seconds(retention)
        mime_type, ext = _tts_format_to_mime_and_ext(fmt)

        url = f"{base_url.rstrip('/')}/audio/speech"
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        payload: dict[str, Any] = {
            "input": text,
        }
        if model:
            payload["model"] = model
        if voice:
            payload["voice"] = voice
        if fmt:
            payload["response_format"] = fmt

        timeout = httpx.Timeout(120.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            audio_bytes = response.content
            upstream_ct = (response.headers.get("content-type") or "").split(";", 1)[0].strip()
            if upstream_ct:
                mime_type = upstream_ct
                ext = _mime_to_ext(mime_type, fallback=ext)

        return self.create_draft(
            thread_id=thread_id,
            kind="audio",
            mime_type=mime_type,
            content=audio_bytes,
            ttl_seconds=ttl_seconds,
            text=text,
            model=model,
            voice=voice,
            fmt=fmt,
        )

    def attach_draft_to_asset(
        self,
        *,
        thread_id: str,
        draft_id: str,
        target_type: Literal["project", "character", "scene"],
        target_id: str,
    ) -> dict[str, Any]:
        """Move draft content into the global asset store and return asset info."""
        meta = self.load_metadata(thread_id=thread_id, draft_id=draft_id)
        if meta is None:
            raise FileNotFoundError("draft not found")

        expires_ts = _parse_iso_to_ts(meta.get("expires_at"))
        if expires_ts is not None and expires_ts <= time.time():
            # Expired: delete and treat as gone.
            self.delete_draft(thread_id=thread_id, draft_id=draft_id)
            raise TimeoutError("draft expired")

        content_path_str = meta.get("content_path")
        if not isinstance(content_path_str, str) or not content_path_str:
            raise ValueError("draft content_path missing")
        content_path = Path(content_path_str)
        if not content_path.exists():
            self.delete_draft(thread_id=thread_id, draft_id=draft_id)
            raise FileNotFoundError("draft content missing")

        mime_type = str(meta.get("mime_type") or "application/octet-stream")
        ext = _mime_to_ext(mime_type, fallback=content_path.suffix.lstrip(".") or "bin")

        self._ensure_asset_dir()
        asset_id = uuid.uuid4().hex
        asset_paths = self._asset_paths(asset_id, ext)

        # Move the content file; delete draft metadata.
        content_path.replace(asset_paths.content_path)
        try:
            (self._draft_dir(thread_id) / f"{_safe_filename(draft_id)}.json").unlink(missing_ok=True)
        except Exception:
            logger.debug("Failed to delete draft metadata after attach: %s", draft_id, exc_info=True)

        asset_meta = {
            "id": asset_id,
            "source_draft_id": draft_id,
            "kind": meta.get("kind"),
            "mime_type": mime_type,
            "created_at": _utc_now_iso(),
            "target": {"type": target_type, "id": target_id},
            "content_path": str(asset_paths.content_path),
            "content_url": self._build_asset_url(asset_id),
        }
        asset_paths.meta_path.write_text(json.dumps(asset_meta, ensure_ascii=False), encoding="utf-8")

        return {
            "asset_id": asset_id,
            "mime_type": mime_type,
            "kind": meta.get("kind"),
            "content_url": self._build_asset_url(asset_id),
            "target_type": target_type,
            "target_id": target_id,
        }

    def load_asset_paths(self, *, asset_id: str) -> DraftPaths | None:
        meta_path = self._asset_dir() / f"{_safe_filename(asset_id)}.json"
        if not meta_path.exists():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            logger.debug("Failed to read asset metadata: %s", meta_path, exc_info=True)
            return None
        if not isinstance(meta, dict) or not isinstance(meta.get("content_path"), str):
            return None
        content_path = Path(meta["content_path"])
        if not content_path.exists():
            return None
        return DraftPaths(content_path=content_path, meta_path=meta_path)

    @staticmethod
    def resolve_openai_client_for_model(model_name: str | None) -> tuple[str, str | None]:
        """Resolve (base_url, api_key) from config for the given chat model."""
        cfg = get_app_config()
        if model_name:
            model_cfg = cfg.get_model_config(model_name)
            if model_cfg is None:
                raise ValueError(f"OpenAI-compatible model {model_name!r} is not configured")
        else:
            if not cfg.models:
                raise ValueError("No models configured")
            model_cfg = cfg.models[0]

        base_url = (getattr(model_cfg, "base_url", None) or getattr(model_cfg, "openai_api_base", None) or "").strip()
        if not base_url:
            raise ValueError("OpenAI-compatible base_url is not configured for the selected model")
        api_key = (getattr(model_cfg, "api_key", None) or os.getenv("OPENAI_API_KEY") or "").strip() or None
        return base_url, api_key


draft_media_store = DraftMediaStore()
