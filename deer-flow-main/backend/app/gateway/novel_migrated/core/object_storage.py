"""S3-compatible object storage configuration for novel assets.

The local server runtime truth is SeaweedFS exposed through an S3-compatible
VIP.  The code intentionally keeps the provider generic because deployments may
swap to another S3-compatible service without changing business code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_S3_COMPATIBLE_ENDPOINT = "http://172.22.22.170:18334"
DEFAULT_BUCKET = "miaowu-novel-assets"


@dataclass(frozen=True)
class ObjectStorageConfig:
    provider: str
    endpoint: str
    bucket: str
    region: str
    access_key: str
    secret_key: str
    private_bucket: bool

    @property
    def is_configured(self) -> bool:
        return bool(self.endpoint and self.bucket)


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _env_first(*names: str, default: str = "") -> str:
    for name in names:
        value = _env(name)
        if value:
            return value
    return default.strip()


def get_object_storage_config() -> ObjectStorageConfig:
    """Read S3-compatible object storage settings from the environment."""
    provider = _env_first("MIAOWU_OBJECT_STORAGE_PROVIDER", "STORAGE_BACKEND", default="s3")
    endpoint = _env_first("MIAOWU_OBJECT_STORAGE_ENDPOINT", "S3_ENDPOINT", default=DEFAULT_S3_COMPATIBLE_ENDPOINT)
    bucket = _env_first("MIAOWU_OBJECT_STORAGE_BUCKET", "S3_BUCKET_NAME", "S3_BUCKET", default=DEFAULT_BUCKET)
    region = _env_first("MIAOWU_OBJECT_STORAGE_REGION", "S3_REGION", "AWS_REGION", default="us-east-1")
    access_key = _env_first("MIAOWU_OBJECT_STORAGE_ACCESS_KEY", "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
    secret_key = _env_first("MIAOWU_OBJECT_STORAGE_SECRET_KEY", "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    private_raw = _env("MIAOWU_OBJECT_STORAGE_PRIVATE", "true").lower()

    return ObjectStorageConfig(
        provider=provider,
        endpoint=endpoint,
        bucket=bucket,
        region=region,
        access_key=access_key,
        secret_key=secret_key,
        private_bucket=private_raw not in {"0", "false", "no", "off"},
    )


def build_private_object_key(*, user_id: str, asset_id: str, filename: str) -> str:
    """Build a non-guessable-ish scoped object key for backend-mediated access."""
    safe_user = user_id.strip().replace("/", "_")
    safe_asset = asset_id.strip().replace("/", "_")
    safe_name = filename.strip().replace("\\", "/").split("/")[-1] or "asset.bin"
    return f"users/{safe_user}/novel-assets/{safe_asset}/{safe_name}"
