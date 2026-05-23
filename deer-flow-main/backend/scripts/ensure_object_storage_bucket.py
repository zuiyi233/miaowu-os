"""Ensure the configured S3-compatible bucket exists.

This is intended for deployment smoke setup. It uses the same
MIAOWU_OBJECT_STORAGE_* configuration and SigV4 helper as the runtime client.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from urllib.parse import quote, urlsplit

import httpx

from app.gateway.novel_migrated.core.object_storage import get_object_storage_config
from app.gateway.novel_migrated.services.object_storage_service import EMPTY_SHA256_HEX, _authorization_header


async def main() -> None:
    config = get_object_storage_config()
    if not config.access_key or not config.secret_key:
        raise SystemExit("Object storage credentials are not configured")

    endpoint = config.endpoint.rstrip("/")
    bucket = quote(config.bucket.strip().strip("/"), safe="")
    url = f"{endpoint}/{bucket}"
    split_url = urlsplit(url)
    now = datetime.now(UTC)
    headers = {
        "host": split_url.netloc,
        "x-amz-content-sha256": EMPTY_SHA256_HEX,
        "x-amz-date": now.strftime("%Y%m%dT%H%M%SZ"),
    }
    headers["authorization"] = _authorization_header(
        method="PUT",
        url=url,
        headers=headers,
        payload_hash=EMPTY_SHA256_HEX,
        config=config,
        now=now,
    )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.put(url, headers=headers, content=b"")

    if response.status_code in {200, 201, 204, 409}:
        print(f"OK bucket ready: {config.bucket} status={response.status_code}")
        return

    raise SystemExit(f"Bucket create/check failed: status={response.status_code} body={response.text[:500]}")


if __name__ == "__main__":
    asyncio.run(main())
