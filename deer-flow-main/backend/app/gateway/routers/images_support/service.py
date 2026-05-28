from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import ipaddress
import json
import logging
import os
import re
import socket
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.media_asset import MediaAsset
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.ai_settings_service import resolve_user_ai_runtime_config
from app.gateway.novel_migrated.services.media_asset_service import media_asset_service
from app.gateway.novel_migrated.services.object_storage_service import (
    ObjectStorageError,
    object_storage_service,
)

logger = logging.getLogger(__name__)

_ALLOWED_SIZES = {
    "auto",
    "1024x1024",
    "1024x1536",
    "1024x1792",
    "1536x1024",
    "1792x1024",
}
_ALLOWED_ASPECT_RATIOS = {
    "1:1",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "16:9",
    "9:16",
}
_ALLOWED_QUALITIES = {"auto", "low", "medium", "high", "standard", "hd"}
_IMAGE_FILE_URL_PREFIX = "/api/v1/images/files"

_http_client: httpx.AsyncClient | None = None
_http_client_lock = asyncio.Lock()


class GeneratedImageResponse(BaseModel):
    image_id: str
    url: str
    filename: str
    content_type: str
    size_bytes: int
    asset_id: str | None = None
    revised_prompt: str | None = None
    source_url: str | None = None


class ImageJobResponse(BaseModel):
    id: str
    status: str
    operation: str
    source: str | None = None
    prompt: str
    model: str | None = None
    request_params: dict[str, Any]
    response_metadata: dict[str, Any] = Field(default_factory=dict)
    images: list[GeneratedImageResponse] = Field(default_factory=list)
    image_urls: list[str] = Field(default_factory=list)
    error: str | dict[str, Any] | None = None
    elapsed_seconds: float | None = None
    created_at: str
    updated_at: str


class ImageJobListResponse(BaseModel):
    items: list[ImageJobResponse]


class ImageGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str
    size: str | None = None
    quality: str | None = None
    n: int = 1
    model: str | None = None
    aspect_ratio: str | None = None
    source: str | None = None

    @field_validator("prompt")
    @classmethod
    def _validate_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("prompt must not be empty")
        return normalized

    @field_validator("size")
    @classmethod
    def _validate_size(cls, value: str | None) -> str | None:
        normalized = _optional_trim(value)
        if normalized is None:
            return None
        if normalized not in _ALLOWED_SIZES:
            raise ValueError(f"size must be one of: {', '.join(sorted(_ALLOWED_SIZES))}")
        return normalized

    @field_validator("quality")
    @classmethod
    def _validate_quality(cls, value: str | None) -> str | None:
        normalized = _optional_trim(value)
        if normalized is None:
            return None
        if normalized not in _ALLOWED_QUALITIES:
            raise ValueError(f"quality must be one of: {', '.join(sorted(_ALLOWED_QUALITIES))}")
        return normalized

    @field_validator("aspect_ratio")
    @classmethod
    def _validate_aspect_ratio(cls, value: str | None) -> str | None:
        normalized = _optional_trim(value)
        if normalized is None:
            return None
        if normalized not in _ALLOWED_ASPECT_RATIOS:
            raise ValueError(
                f"aspect_ratio must be one of: {', '.join(sorted(_ALLOWED_ASPECT_RATIOS))}"
            )
        return normalized

    @field_validator("model", "source")
    @classmethod
    def _normalize_optional_text(cls, value: str | None) -> str | None:
        return _optional_trim(value)

    @field_validator("n")
    @classmethod
    def _validate_n(cls, value: int) -> int:
        if value < 1 or value > 10:
            raise ValueError("n must be between 1 and 10")
        return value

    @model_validator(mode="after")
    def _validate_size_aspect_ratio_contract(self) -> ImageGenerateRequest:
        if self.size and self.aspect_ratio:
            raise ValueError("size and aspect_ratio are mutually exclusive")
        return self


@dataclass(slots=True)
class ImageFilePayload:
    content: bytes
    content_type: str
    filename: str


async def _read_media_asset_image_file(*, asset_id: str, user_id: str, db: AsyncSession | None) -> ImageFilePayload | None:
    if db is None:
        return None
    result = await db.execute(
        select(MediaAsset).where(
            MediaAsset.id == asset_id,
            MediaAsset.user_id == user_id,
            MediaAsset.status == "active",
        )
    )
    asset = result.scalar_one_or_none()
    if asset is None:
        return None
    try:
        stored = await object_storage_service.get_object(object_key=asset.object_key)
    except ObjectStorageError as exc:
        logger.warning("Failed to read generated image media asset %s", asset_id, exc_info=True)
        raise HTTPException(status_code=404, detail="Image file not found") from exc
    return ImageFilePayload(
        content=stored.content,
        content_type=asset.mime_type or stored.content_type or "application/octet-stream",
        filename=asset.filename,
    )


@dataclass(slots=True)
class ImageGenerationError(Exception):
    message: str
    status_code: int = 500
    error_code: str = "image_generation_failed"
    details: dict[str, Any] | None = None

    def as_detail(self) -> dict[str, Any]:
        payload = {
            "error_code": self.error_code,
            "message": self.message,
        }
        if self.details:
            payload.update(self.details)
        return payload


def _optional_trim(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _user_dir_key(user_id: str) -> str:
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()[:24]


def _legacy_user_dir_key(user_id: str) -> str:
    return hashlib.sha1(user_id.encode("utf-8")).hexdigest()[:24]


def _user_dir_keys(user_id: str) -> tuple[str, ...]:
    current = _user_dir_key(user_id)
    legacy = _legacy_user_dir_key(user_id)
    if legacy == current:
        return (current,)
    return (current, legacy)


def _validate_path_segment(value: str, name: str = "id") -> str:
    if not re.fullmatch(r"[0-9a-zA-Z_-]{1,128}", value):
        raise HTTPException(status_code=400, detail=f"Invalid {name}")
    return value


def _images_root() -> Path:
    raw = (os.getenv("MIAOWU_IMAGE_ASSET_DIR") or "").strip()
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parents[5] / ".deer-flow" / "images").resolve()


def _jobs_root() -> Path:
    return _images_root() / "jobs"


def _files_root() -> Path:
    return _images_root() / "files"


def _job_path(user_id: str, job_id: str) -> Path:
    _validate_path_segment(job_id, "job_id")
    return _jobs_root() / _user_dir_key(user_id) / f"{job_id}.json"


def _image_meta_path(user_id: str, image_id: str) -> Path:
    _validate_path_segment(image_id, "image_id")
    return _files_root() / _user_dir_key(user_id) / f"{image_id}.json"


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(path)


def _write_bytes_atomic(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_bytes(content)
    tmp_path.replace(path)


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    try:
        if not path.is_file():
            return None
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception:
        logger.warning("Failed to read image generation JSON: %s", path, exc_info=True)
        return None


async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        return _http_client
    async with _http_client_lock:
        if _http_client is not None and not _http_client.is_closed:
            return _http_client
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            follow_redirects=True,
        )
        return _http_client


async def close_http_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


def _normalize_openai_base_url(base_url: str) -> str:
    cleaned = base_url.strip().rstrip("/")
    if not cleaned:
        return ""
    if cleaned.endswith("/v1") or "/v1/" in cleaned:
        return cleaned
    return f"{cleaned}/v1"


def _first_env_value(*names: str) -> str | None:
    for name in names:
        value = _optional_trim(os.getenv(name))
        if value:
            return value
    return None


def _provider_expects_thinking_field(base_url: str) -> bool:
    configured = _optional_trim(os.getenv("IMAGE_QUALITY_FIELD"))
    if configured:
        return configured.lower() == "thinking"
    return "nowcoding.ai" in base_url.lower()


def _map_quality_for_provider(quality: str) -> str | None:
    normalized = quality.strip().lower()
    if normalized == "auto":
        return None
    return {
        "high": "hd",
        "hd": "hd",
        "medium": "medium",
        "standard": "standard",
        "low": "low",
    }.get(normalized, quality)


def _resolve_env_runtime_config(*, requested_model: str | None) -> tuple[dict[str, Any], str]:
    return (
        {
            "api_provider": "openai",
            "api_key": _first_env_value(
                "MIAOWU_NEWAPI_API_KEY",
                "NEWAPI_PROVIDER_API_KEY",
                "NEWAPI_AI_API_KEY",
                "NEWAPI_API_KEY",
                "OPENAI_API_KEY",
            )
            or "",
            "api_base_url": _normalize_openai_base_url(
                _first_env_value(
                    "MIAOWU_NEWAPI_BASE_URL",
                    "NEWAPI_OPENAI_BASE_URL",
                    "NEWAPI_PROVIDER_BASE_URL",
                    "NEWAPI_AI_BASE_URL",
                    "OPENAI_BASE_URL",
                    "OPENAI_API_BASE",
                )
                or ""
            ),
            "model_name": requested_model
            or _first_env_value(
                "IMAGE_GENERATION_MODEL",
                "OPENAI_IMAGE_MODEL",
                "MIAOWU_IMAGE_MODEL",
                "OPENAI_MODEL",
            )
            or "gpt-image-1",
            "temperature": 0.0,
            "max_tokens": 0,
        },
        "env-fallback",
    )


async def _resolve_runtime_config(
    *,
    user_id: str,
    db: AsyncSession | None,
    requested_model: str | None,
) -> tuple[dict[str, Any], str]:
    if db is not None:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if settings is not None:
            runtime, source = resolve_user_ai_runtime_config(
                settings,
                ai_model=requested_model,
                module_id="images",
            )
            return dict(runtime), source
    return _resolve_env_runtime_config(requested_model=requested_model)


def _ensure_runtime_config(runtime: dict[str, Any], source: str) -> None:
    base_url = _optional_trim(str(runtime.get("api_base_url") or ""))
    api_key = _optional_trim(str(runtime.get("api_key") or ""))
    if not base_url or not api_key:
        raise ImageGenerationError(
            "Image generation provider is not configured",
            status_code=503,
            error_code="missing_config",
            details={"source": source},
        )


def _extract_upstream_error(exc: httpx.HTTPStatusError) -> str:
    response = exc.response
    if response is None:
        return str(exc)
    try:
        data = response.json()
    except Exception:
        text = response.text.strip()
        return text or str(exc)
    if isinstance(data, dict):
        for key in ("message", "detail", "error", "msg"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                for nested_key in ("message", "detail", "msg"):
                    nested = value.get(nested_key)
                    if isinstance(nested, str) and nested.strip():
                        return nested.strip()
    text = response.text.strip()
    return text or str(exc)


def _content_type_and_extension_from_bytes(content: bytes) -> tuple[str, str]:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp", "webp"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", "gif"
    return "application/octet-stream", "bin"


async def _validate_image_url(url: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ImageGenerationError("Only http/https URLs are allowed", status_code=400, error_code="invalid_url")
    hostname = (parsed.hostname or "").lower()
    blocked_hosts = {"169.254.169.254", "metadata.google.internal", "localhost"}
    if hostname in blocked_hosts:
        raise ImageGenerationError("URL points to a restricted host", status_code=400, error_code="restricted_url")
    blocked_prefixes = ("10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "192.168.", "127.", "0.")
    if any(hostname.startswith(p) for p in blocked_prefixes):
        raise ImageGenerationError("URL points to a restricted host", status_code=400, error_code="restricted_url")
    try:
        loop = asyncio.get_event_loop()
        addrs = await loop.getaddrinfo(hostname, None)
        for addr in addrs:
            ip_str = addr[4][0]
            try:
                ip = ipaddress.ip_address(ip_str)
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                    raise ImageGenerationError("Image URL resolves to a restricted network address", status_code=400, error_code="restricted_url")
            except ValueError:
                continue
    except socket.gaierror:
        pass
    return url


async def _download_image_from_url(client: httpx.AsyncClient, url: str) -> tuple[bytes, str]:
    url = await _validate_image_url(url)
    MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/png")
        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > MAX_IMAGE_SIZE_BYTES:
                raise ImageGenerationError("Image exceeds maximum allowed size (50 MB)", status_code=502, error_code="image_too_large")
            chunks.append(chunk)
        content = b"".join(chunks)
    return content, content_type


async def _decode_upstream_image(
    client: httpx.AsyncClient,
    item: dict[str, Any],
) -> tuple[bytes, str, str | None]:
    b64_json = item.get("b64_json")
    if isinstance(b64_json, str) and b64_json.strip():
        try:
            content = base64.b64decode(b64_json, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ImageGenerationError(
                "Upstream returned invalid base64 image data",
                status_code=502,
                error_code="invalid_upstream_image",
            ) from exc
        content_type, _ = _content_type_and_extension_from_bytes(content)
        return content, content_type, None

    image_url = _optional_trim(item.get("url")) if isinstance(item.get("url"), str) else None
    if image_url:
        try:
            content, content_type = await _download_image_from_url(client, image_url)
        except httpx.HTTPStatusError as exc:
            logger.warning("Upstream image download error: %s", _extract_upstream_error(exc))
            raise ImageGenerationError(
                "Image generation provider returned an error",
                status_code=502,
                error_code="upstream_image_download_failed",
                details={"status_code": exc.response.status_code if exc.response is not None else None},
            ) from exc
        except httpx.HTTPError as exc:
            raise ImageGenerationError(
                "Failed to download image from upstream URL",
                status_code=502,
                error_code="upstream_image_download_failed",
            ) from exc
        return content, content_type, image_url

    raise ImageGenerationError(
        "Upstream returned no image payload",
        status_code=502,
        error_code="invalid_upstream_response",
    )


def _build_request_params(req: ImageGenerateRequest) -> dict[str, Any]:
    return req.model_dump(exclude_none=True)


def _build_job_record(*, job_id: str, user_id: str, req: ImageGenerateRequest) -> dict[str, Any]:
    created_at = _utcnow_iso()
    request_params = _build_request_params(req)
    return {
        "schema": "miaowu.images.job.v1",
        "id": job_id,
        "user_id": user_id,
        "status": "processing",
        "operation": "generate",
        "source": req.source or "workspace-images",
        "prompt": req.prompt,
        "model": req.model,
        "request_params": request_params,
        "response_metadata": {},
        "images": [],
        "image_urls": [],
        "error": None,
        "elapsed_seconds": None,
        "created_at": created_at,
        "updated_at": created_at,
    }


def _persist_job(job: dict[str, Any]) -> None:
    user_id = str(job.get("user_id") or "")
    job_id = str(job.get("id") or "")
    if not user_id or not job_id:
        raise ValueError("job payload missing user_id or id")
    _write_json_atomic(_job_path(user_id, job_id), job)


def _load_job(user_id: str, job_id: str) -> dict[str, Any] | None:
    _validate_path_segment(job_id, "job_id")
    for key in _user_dir_keys(user_id):
        payload = _safe_read_json(_jobs_root() / key / f"{job_id}.json")
        if payload is not None and payload.get("user_id") == user_id and payload.get("id") == job_id:
            return payload
    return None


async def _store_image_file(
    *,
    user_id: str,
    job_id: str,
    ordinal: int,
    content: bytes,
    content_type: str,
    source_url: str | None,
    revised_prompt: str | None,
    db: AsyncSession | None,
) -> GeneratedImageResponse:
    detected_content_type, extension = _content_type_and_extension_from_bytes(content)
    normalized_content_type = content_type if content_type and content_type != "application/octet-stream" else detected_content_type
    normalized_extension = extension
    image_id = uuid.uuid4().hex
    filename = f"{job_id}-{ordinal + 1}.{normalized_extension}"
    asset_id: str | None = None
    if db is not None:
        try:
            created = await media_asset_service.create_asset_from_bytes(
                db=db,
                user_id=user_id,
                project_id=None,
                purpose="image_generation_result",
                filename=filename,
                content=content,
                mime_type=normalized_content_type,
                metadata={
                    "source": "workspace-images",
                    "image_id": image_id,
                    "job_id": job_id,
                    "ordinal": ordinal,
                    "source_url": source_url,
                    "revised_prompt": revised_prompt,
                },
                commit=False,
                refresh=False,
                flush=True,
            )
            asset_id = created.asset.id
        except ObjectStorageError:
            logger.warning("Failed to store generated image in media_assets; falling back to local image store", exc_info=True)
    base_path = _files_root() / _user_dir_key(user_id)
    file_path = base_path / f"{image_id}.{normalized_extension}"
    meta_path = _image_meta_path(user_id, image_id)
    _write_bytes_atomic(file_path, content)
    _write_json_atomic(
        meta_path,
        {
            "schema": "miaowu.images.file.v1",
            "image_id": image_id,
            "asset_id": asset_id,
            "job_id": job_id,
            "user_id": user_id,
            "filename": filename,
            "content_type": normalized_content_type,
            "extension": normalized_extension,
            "size_bytes": len(content),
            "created_at": _utcnow_iso(),
            "source_url": source_url,
            "revised_prompt": revised_prompt,
        },
    )
    return GeneratedImageResponse(
        image_id=image_id,
        url=f"{_IMAGE_FILE_URL_PREFIX}/{image_id}",
        filename=filename,
        content_type=normalized_content_type,
        size_bytes=len(content),
        asset_id=asset_id,
        revised_prompt=revised_prompt,
        source_url=source_url,
    )


async def _call_images_generation_api(
    *,
    runtime: dict[str, Any],
    req: ImageGenerateRequest,
) -> tuple[list[GeneratedImageResponse], dict[str, Any]]:
    client = await get_http_client()
    base_url = str(runtime["api_base_url"]).rstrip("/")
    endpoint = f"{base_url}/images/generations"
    payload: dict[str, Any] = {
        "prompt": req.prompt,
        "model": runtime["model_name"],
        "n": req.n,
        "response_format": "b64_json",
    }
    if req.size:
        payload["size"] = req.size
    if req.quality:
        if _provider_expects_thinking_field(base_url):
            thinking = _map_quality_for_provider(req.quality)
            if thinking:
                payload["thinking"] = thinking
        else:
            payload["quality"] = req.quality
    if req.aspect_ratio:
        payload["aspect_ratio"] = req.aspect_ratio

    try:
        response = await client.post(
            endpoint,
            json=payload,
            headers={
                "Authorization": f"Bearer {runtime['api_key']}",
                "Accept": "application/json",
            },
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        logger.warning("Upstream image generation error: %s", _extract_upstream_error(exc))
        raise ImageGenerationError(
            "Image generation provider returned an error",
            status_code=502,
            error_code="upstream_request_failed",
            details={"status_code": exc.response.status_code if exc.response is not None else None},
        ) from exc
    except httpx.HTTPError as exc:
        raise ImageGenerationError(
            "Failed to reach image generation provider",
            status_code=502,
            error_code="upstream_request_failed",
        ) from exc

    try:
        data = response.json()
    except Exception as exc:
        raise ImageGenerationError(
            "Provider returned a non-JSON image response",
            status_code=502,
            error_code="invalid_upstream_response",
        ) from exc

    if not isinstance(data, dict):
        raise ImageGenerationError(
            "Provider returned an unexpected image response payload",
            status_code=502,
            error_code="invalid_upstream_response",
        )

    items = data.get("data")
    if not isinstance(items, list) or not items:
        raise ImageGenerationError(
            "Provider returned no images",
            status_code=502,
            error_code="invalid_upstream_response",
        )

    generated: list[GeneratedImageResponse] = []
    upstream_items: list[dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ImageGenerationError(
                "Provider returned malformed image entries",
                status_code=502,
                error_code="invalid_upstream_response",
            )
        content, content_type, source_url = await _decode_upstream_image(client, item)
        generated.append(
            GeneratedImageResponse(
                image_id="",
                url="",
                filename="",
                content_type=content_type,
                size_bytes=len(content),
                revised_prompt=_optional_trim(item.get("revised_prompt"))
                if isinstance(item.get("revised_prompt"), str)
                else None,
                source_url=source_url,
            )
        )
        upstream_items.append(
            {
                "ordinal": index,
                "content": content,
                "content_type": content_type,
                "source_url": source_url,
                "revised_prompt": generated[-1].revised_prompt,
            }
        )

    return generated, {
        "endpoint": endpoint,
        "provider": runtime.get("api_provider"),
        "upstream_created": data.get("created"),
        "response_count": len(upstream_items),
        "payload": payload,
        "upstream_items": upstream_items,
    }


async def generate_images(
    req: ImageGenerateRequest,
    *,
    user_id: str,
    db: AsyncSession | None = None,
) -> ImageJobResponse:
    job_id = uuid.uuid4().hex
    job = _build_job_record(job_id=job_id, user_id=user_id, req=req)
    _persist_job(job)

    started_at = time.perf_counter()
    try:
        runtime, source = await _resolve_runtime_config(
            user_id=user_id,
            db=db,
            requested_model=req.model,
        )
        _ensure_runtime_config(runtime, source)
        job["model"] = runtime.get("model_name")

        _generated, metadata = await _call_images_generation_api(runtime=runtime, req=req)
        images: list[GeneratedImageResponse] = []
        for item in metadata.pop("upstream_items"):
            image_response = await _store_image_file(
                user_id=user_id,
                job_id=job_id,
                ordinal=int(item["ordinal"]),
                content=item["content"],
                content_type=str(item["content_type"]),
                source_url=item["source_url"],
                revised_prompt=item["revised_prompt"],
                db=db,
            )
            images.append(image_response)

        elapsed = round(time.perf_counter() - started_at, 3)
        job["status"] = "completed"
        job["response_metadata"] = {
            **metadata,
            "config_source": source,
        }
        job["images"] = [image.model_dump() for image in images]
        job["image_urls"] = [image.url for image in images]
        job["elapsed_seconds"] = elapsed
        job["updated_at"] = _utcnow_iso()
        if db is not None and hasattr(db, "commit"):
            await db.commit()
        _persist_job(job)
        return ImageJobResponse.model_validate(job)
    except ImageGenerationError as exc:
        elapsed = round(time.perf_counter() - started_at, 3)
        job["status"] = "failed"
        job["error"] = exc.as_detail()
        job["elapsed_seconds"] = elapsed
        job["updated_at"] = _utcnow_iso()
        _persist_job(job)
        raise
    except Exception as exc:
        logger.exception("Unexpected error during image generation for job %s", job_id)
        job["status"] = "failed"
        job["error"] = {"error_code": "internal_error", "message": "Internal error during image generation"}
        job["elapsed_seconds"] = round(time.perf_counter() - started_at, 3)
        job["updated_at"] = _utcnow_iso()
        try:
            _persist_job(job)
        except Exception:
            logger.exception("Failed to persist failed job %s", job_id)
        raise ImageGenerationError(
            "Internal error during image generation",
            status_code=500,
            error_code="internal_error",
        ) from exc


def list_image_jobs(*, user_id: str, limit: int = 50, offset: int = 0) -> ImageJobListResponse:
    items: list[ImageJobResponse] = []
    seen_ids: set[str] = set()
    for key in _user_dir_keys(user_id):
        jobs_dir = _jobs_root() / key
        if not jobs_dir.is_dir():
            continue
        for path in jobs_dir.glob("*.json"):
            payload = _safe_read_json(path)
            if payload is None or payload.get("user_id") != user_id:
                continue
            job_id = str(payload.get("id") or "")
            if job_id and job_id in seen_ids:
                continue
            try:
                item = ImageJobResponse.model_validate(payload)
                items.append(item)
                seen_ids.add(item.id)
            except Exception:
                logger.warning("Skip invalid image job payload: %s", path, exc_info=True)
    items.sort(key=lambda item: (item.updated_at, item.created_at, item.id), reverse=True)
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    items = items[offset:offset + limit]
    return ImageJobListResponse(items=items)


def get_image_job(job_id: str, *, user_id: str) -> ImageJobResponse:
    payload = _load_job(user_id, job_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Image job not found")
    return ImageJobResponse.model_validate(payload)


_SAFE_EXTENSIONS = {"png", "jpg", "webp", "gif", "bin"}


async def read_image_file(*, image_id: str, user_id: str, db: AsyncSession | None = None) -> ImageFilePayload:
    _validate_path_segment(image_id, "image_id")
    meta: dict[str, Any] | None = None
    user_dir_key: str | None = None
    for key in _user_dir_keys(user_id):
        candidate = _safe_read_json(_files_root() / key / f"{image_id}.json")
        if candidate is not None and candidate.get("user_id") == user_id and candidate.get("image_id") == image_id:
            meta = candidate
            user_dir_key = key
            break
    if meta is None or user_dir_key is None:
        raise HTTPException(status_code=404, detail="Image file not found")

    asset_id = str(meta.get("asset_id") or "").strip()
    if asset_id:
        media_payload = await _read_media_asset_image_file(asset_id=asset_id, user_id=user_id, db=db)
        if media_payload is not None:
            return media_payload

    extension = str(meta.get("extension") or "").strip().lower()
    if extension not in _SAFE_EXTENSIONS:
        extension = "bin"

    file_path = _files_root() / user_dir_key / f"{image_id}.{extension}"
    try:
        content = file_path.read_bytes()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Image file not found") from exc

    filename = str(meta.get("filename") or file_path.name)
    content_type = str(meta.get("content_type") or "application/octet-stream")
    return ImageFilePayload(
        content=content,
        content_type=content_type,
        filename=filename,
    )
