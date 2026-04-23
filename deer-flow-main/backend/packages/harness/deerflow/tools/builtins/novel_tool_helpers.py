from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_NOVEL_TOOL_BASE_URL_ENV = "DEERFLOW_NOVEL_TOOL_BASE_URL"
_DEFAULT_NOVEL_TOOL_BASE_URL = "http://127.0.0.1:8001"
_NOVEL_TOOL_TIMEOUT_ENV = "DEERFLOW_NOVEL_TOOL_TIMEOUT_SECONDS"
_ACCESS_TOKEN_ENV = "DEERFLOW_AI_PROVIDER_API_TOKEN"


def get_base_url() -> str:
    raw = (os.getenv(_NOVEL_TOOL_BASE_URL_ENV) or "").strip()
    return raw.rstrip("/") or _DEFAULT_NOVEL_TOOL_BASE_URL


def get_timeout_seconds() -> float:
    raw = (os.getenv(_NOVEL_TOOL_TIMEOUT_ENV) or "").strip()
    if not raw:
        return 30.0
    try:
        return max(1.0, float(raw))
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to 30s", _NOVEL_TOOL_TIMEOUT_ENV, raw)
        return 30.0


def build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = (os.getenv(_ACCESS_TOKEN_ENV) or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    timeout = httpx.Timeout(get_timeout_seconds())
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=build_headers())
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            return data
        return {"raw": data}


async def get_json(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    timeout = httpx.Timeout(get_timeout_seconds())
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url, params=params, headers=build_headers())
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            return data
        return {"raw": data}


async def put_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    timeout = httpx.Timeout(get_timeout_seconds())
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.put(url, json=payload, headers=build_headers())
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            return data
        return {"raw": data}


def _ok(data: dict[str, Any], **extra: Any) -> dict[str, Any]:
    result = {"success": True, **data, **extra}
    return result


def _fail(error: str, **extra: Any) -> dict[str, Any]:
    return {"success": False, "error": error, **extra}
