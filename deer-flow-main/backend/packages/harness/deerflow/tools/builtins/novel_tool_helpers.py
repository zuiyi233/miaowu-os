from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

logger = logging.getLogger(__name__)

_NOVEL_TOOL_BASE_URL_ENV = "DEERFLOW_NOVEL_TOOL_BASE_URL"
_INTERNAL_GATEWAY_BASE_URL_ENV = "DEER_FLOW_INTERNAL_GATEWAY_BASE_URL"
_DEFAULT_NOVEL_TOOL_BASE_URL = "http://127.0.0.1:8551"
_GATEWAY_PORT_ENV = "GATEWAY_PORT"
_NOVEL_TOOL_TIMEOUT_ENV = "DEERFLOW_NOVEL_TOOL_TIMEOUT_SECONDS"
_ACCESS_TOKEN_ENV = "DEERFLOW_AI_PROVIDER_API_TOKEN"
SESSION_CONTEXT_KEYS: tuple[str, ...] = (
    "thread_id",
    "threadId",
    "conversation_id",
    "conversationId",
    "chat_id",
    "chatId",
    "workspace_id",
    "workspaceId",
    "session_id",
    "sessionId",
    "novel_id",
    "novelId",
    "project_id",
    "projectId",
)
USER_CONTEXT_KEYS: tuple[str, ...] = ("user_id", "userId")


def get_base_url() -> str:
    raw = (os.getenv(_NOVEL_TOOL_BASE_URL_ENV) or "").strip()
    if raw:
        return raw.rstrip("/")

    internal_gateway_base_url = (os.getenv(_INTERNAL_GATEWAY_BASE_URL_ENV) or "").strip()
    if internal_gateway_base_url:
        return internal_gateway_base_url.rstrip("/")

    gateway_port = (os.getenv(_GATEWAY_PORT_ENV) or "").strip()
    if gateway_port:
        try:
            port = int(gateway_port)
        except ValueError:
            logger.warning("Invalid %s=%s, fallback to %s", _GATEWAY_PORT_ENV, gateway_port, _DEFAULT_NOVEL_TOOL_BASE_URL)
        else:
            if port > 0:
                return f"http://127.0.0.1:{port}"

    return _DEFAULT_NOVEL_TOOL_BASE_URL


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


def pick_non_empty_str(source: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _build_route_fallback_url(url: str) -> str | None:
    """Build route-prefix fallback URL for M-02 path-prefix compatibility.

    Some deployments expose novel_migrated routes under `/api/...` while others
    register direct root prefixes (e.g. `/projects/...`).
    """
    try:
        parts = urlsplit(url)
    except Exception:
        return None

    path = parts.path or "/"
    if path.startswith("/api/"):
        fallback_path = path[len("/api") :]
    elif path == "/api":
        fallback_path = "/"
    else:
        fallback_path = f"/api{path if path.startswith('/') else '/' + path}"

    if fallback_path == path:
        return None
    return urlunsplit((parts.scheme, parts.netloc, fallback_path, parts.query, parts.fragment))


async def _request_json(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
    allow_route_fallback: bool = True,
) -> dict[str, Any]:
    effective_timeout = get_timeout_seconds() if timeout_seconds is None else max(1.0, float(timeout_seconds))
    timeout = httpx.Timeout(effective_timeout)
    fallback_url = _build_route_fallback_url(url) if allow_route_fallback else None

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.request(
            method,
            url,
            json=payload,
            params=params,
            headers=build_headers(),
        )
        if response.status_code == 404 and fallback_url:
            logger.warning("Novel tool route fallback triggered: %s -> %s", url, fallback_url)
            response = await client.request(
                method,
                fallback_url,
                json=payload,
                params=params,
                headers=build_headers(),
            )
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            return data
        return {"raw": data}


async def post_json(
    url: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
    allow_route_fallback: bool = True,
) -> dict[str, Any]:
    return await _request_json(
        "POST",
        url,
        payload=payload,
        timeout_seconds=timeout_seconds,
        allow_route_fallback=allow_route_fallback,
    )


async def get_json(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    timeout_seconds: float | None = None,
    allow_route_fallback: bool = True,
) -> dict[str, Any]:
    return await _request_json(
        "GET",
        url,
        params=params,
        timeout_seconds=timeout_seconds,
        allow_route_fallback=allow_route_fallback,
    )


async def put_json(
    url: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float | None = None,
    allow_route_fallback: bool = True,
) -> dict[str, Any]:
    return await _request_json(
        "PUT",
        url,
        payload=payload,
        timeout_seconds=timeout_seconds,
        allow_route_fallback=allow_route_fallback,
    )


def _ok(data: dict[str, Any], **extra: Any) -> dict[str, Any]:
    result: dict[str, Any] = {"success": True, **data}
    conflicts: dict[str, Any] = {}
    for key, value in extra.items():
        if key in result and result[key] != value:
            conflicts[key] = value
            continue
        result[key] = value
    if conflicts:
        result.setdefault("_extra_conflicts", {}).update(conflicts)
    return result


def _fail(error: str, **extra: Any) -> dict[str, Any]:
    result: dict[str, Any] = {"success": False, "error": error}
    conflicts: dict[str, Any] = {}
    for key, value in extra.items():
        if key in result and result[key] != value:
            conflicts[key] = value
            continue
        result[key] = value
    if conflicts:
        result.setdefault("_extra_conflicts", {}).update(conflicts)
    return result
