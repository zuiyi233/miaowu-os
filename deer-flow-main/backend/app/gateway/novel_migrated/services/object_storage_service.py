"""Backend-mediated S3-compatible object storage for novel media assets."""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit

import httpx

from app.gateway.novel_migrated.core.object_storage import ObjectStorageConfig, get_object_storage_config

EMPTY_SHA256_HEX = hashlib.sha256(b"").hexdigest()


class ObjectStorageError(RuntimeError):
    """Base object storage failure."""


class ObjectStorageConfigurationError(ObjectStorageError):
    """Object storage is not configured for authenticated S3-compatible access."""


class ObjectNotFoundError(ObjectStorageError):
    """The requested object does not exist."""


@dataclass(frozen=True)
class StoredObject:
    content: bytes
    content_type: str | None
    size_bytes: int
    etag: str | None = None


def _quote_object_key(object_key: str) -> str:
    return quote(object_key.strip().lstrip("/"), safe="/")


def _object_url(config: ObjectStorageConfig, object_key: str) -> str:
    endpoint = config.endpoint.rstrip("/")
    bucket = quote(config.bucket.strip().strip("/"), safe="")
    return f"{endpoint}/{bucket}/{_quote_object_key(object_key)}"


def _signing_key(secret_key: str, date_stamp: str, region: str) -> bytes:
    date_key = hmac.new(f"AWS4{secret_key}".encode(), date_stamp.encode("utf-8"), hashlib.sha256).digest()
    region_key = hmac.new(date_key, region.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def _authorization_header(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    payload_hash: str,
    config: ObjectStorageConfig,
    now: datetime,
) -> str:
    date_stamp = now.strftime("%Y%m%d")
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    credential_scope = f"{date_stamp}/{config.region}/s3/aws4_request"
    split_url = urlsplit(url)
    canonical_uri = split_url.path or "/"
    canonical_query = split_url.query

    signing_headers = {key.lower(): " ".join(value.strip().split()) for key, value in headers.items()}
    signed_headers = ";".join(sorted(signing_headers))
    canonical_headers = "".join(f"{key}:{signing_headers[key]}\n" for key in sorted(signing_headers))
    canonical_request = "\n".join(
        [
            method.upper(),
            canonical_uri,
            canonical_query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(
        _signing_key(config.secret_key, date_stamp, config.region),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return (
        "AWS4-HMAC-SHA256 "
        f"Credential={config.access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )


class ObjectStorageService:
    """Small S3-compatible client for SeaweedFS path-style access."""

    def __init__(self, *, timeout_seconds: float = 60.0) -> None:
        self._timeout_seconds = timeout_seconds

    def _require_config(self) -> ObjectStorageConfig:
        config = get_object_storage_config()
        if not config.endpoint or not config.bucket:
            raise ObjectStorageConfigurationError("Object storage endpoint or bucket is not configured")
        if not config.access_key or not config.secret_key:
            raise ObjectStorageConfigurationError("Object storage credentials are not configured")
        return config

    async def _request(
        self,
        *,
        method: str,
        object_key: str,
        data: bytes = b"",
        content_type: str | None = None,
    ) -> httpx.Response:
        config = self._require_config()
        url = _object_url(config, object_key)
        split_url = urlsplit(url)
        payload_hash = hashlib.sha256(data).hexdigest() if data else EMPTY_SHA256_HEX
        now = datetime.now(UTC)
        headers = {
            "host": split_url.netloc,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": now.strftime("%Y%m%dT%H%M%SZ"),
        }
        if content_type:
            headers["content-type"] = content_type
        headers["authorization"] = _authorization_header(
            method=method,
            url=url,
            headers=headers,
            payload_hash=payload_hash,
            config=config,
            now=now,
        )

        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            return await client.request(method.upper(), url, headers=headers, content=data)

    async def put_object(self, *, object_key: str, data: bytes, content_type: str | None = None) -> dict[str, str | int | None]:
        response = await self._request(method="PUT", object_key=object_key, data=data, content_type=content_type)
        if response.status_code < 200 or response.status_code >= 300:
            raise ObjectStorageError(f"Object upload failed with status {response.status_code}")
        return {
            "etag": response.headers.get("etag"),
            "size_bytes": len(data),
        }

    async def get_object(self, *, object_key: str) -> StoredObject:
        response = await self._request(method="GET", object_key=object_key)
        if response.status_code == 404:
            raise ObjectNotFoundError("Object not found")
        if response.status_code < 200 or response.status_code >= 300:
            raise ObjectStorageError(f"Object download failed with status {response.status_code}")
        return StoredObject(
            content=response.content,
            content_type=response.headers.get("content-type"),
            size_bytes=len(response.content),
            etag=response.headers.get("etag"),
        )

    async def delete_object(self, *, object_key: str) -> None:
        response = await self._request(method="DELETE", object_key=object_key)
        if response.status_code in {404, 204, 200}:
            return
        if response.status_code < 200 or response.status_code >= 300:
            raise ObjectStorageError(f"Object delete failed with status {response.status_code}")


object_storage_service = ObjectStorageService()
