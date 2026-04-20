"""Built-in novel tools for DeerFlow agents."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx
from langchain.tools import tool

logger = logging.getLogger(__name__)

_NOVEL_TOOL_BASE_URL_ENV = "DEERFLOW_NOVEL_TOOL_BASE_URL"
_DEFAULT_NOVEL_TOOL_BASE_URL = "http://127.0.0.1:8001"
_NOVEL_TOOL_TIMEOUT_ENV = "DEERFLOW_NOVEL_TOOL_TIMEOUT_SECONDS"
_ACCESS_TOKEN_ENV = "DEERFLOW_AI_PROVIDER_API_TOKEN"


def _get_base_url() -> str:
    raw = (os.getenv(_NOVEL_TOOL_BASE_URL_ENV) or "").strip()
    return raw.rstrip("/") or _DEFAULT_NOVEL_TOOL_BASE_URL


def _get_timeout_seconds() -> float:
    raw = (os.getenv(_NOVEL_TOOL_TIMEOUT_ENV) or "").strip()
    if not raw:
        return 10.0
    try:
        return max(1.0, float(raw))
    except ValueError:
        logger.warning("Invalid %s=%s, fallback to 10s", _NOVEL_TOOL_TIMEOUT_ENV, raw)
        return 10.0


def _build_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = (os.getenv(_ACCESS_TOKEN_ENV) or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    timeout = httpx.Timeout(_get_timeout_seconds())
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=_build_headers())
        response.raise_for_status()
        data = response.json()
        if isinstance(data, dict):
            return data
        return {"raw": data}


@tool("create_novel", parse_docstring=True)
async def create_novel(
    title: str,
    genre: str = "科幻",
    description: str = "",
) -> dict[str, Any]:
    """Create a new novel project for the user.

    The tool first tries the modern `novel_migrated` projects API (`/projects`).
    If unavailable, it falls back to the legacy novel endpoint (`/api/novels`)
    for compatibility with older flows.

    Args:
        title: Novel title. Keep it concise and specific.
        genre: Novel genre, defaults to `科幻`.
        description: Optional brief description for the novel idea.

    Returns:
        A result dictionary with `success`, `source`, and created novel identifiers.
    """
    normalized_title = (title or "").strip()
    if not normalized_title:
        return {
            "success": False,
            "error": "title is required",
            "source": "validation",
        }

    normalized_genre = (genre or "").strip() or "科幻"
    normalized_description = (description or "").strip()
    base_url = _get_base_url()

    modern_payload = {
        "title": normalized_title,
        "genre": normalized_genre,
        "theme": normalized_genre,
        "description": normalized_description,
    }
    modern_url = f"{base_url}/projects"
    modern_error = ""

    try:
        project = await _post_json(modern_url, modern_payload)
        return {
            "success": True,
            "source": "novel_migrated.projects",
            "id": project.get("id"),
            "title": project.get("title", normalized_title),
            "genre": project.get("genre", normalized_genre),
            "raw": project,
        }
    except Exception as modern_exc:
        modern_error = str(modern_exc)
        logger.warning("create_novel modern endpoint failed: %s", modern_error)

    legacy_payload = {
        "title": normalized_title,
        "metadata": {
            "genre": normalized_genre,
            "description": normalized_description,
            "created_by": "deerflow_create_novel_tool",
        },
    }
    legacy_url = f"{base_url}/api/novels"
    try:
        novel = await _post_json(legacy_url, legacy_payload)
        metadata = novel.get("metadata", {}) if isinstance(novel, dict) else {}
        genre_value = normalized_genre
        if isinstance(metadata, dict) and metadata.get("genre"):
            genre_value = str(metadata["genre"])
        return {
            "success": True,
            "source": "legacy.novel_api",
            "id": novel.get("id"),
            "title": novel.get("title", normalized_title),
            "genre": genre_value,
            "raw": novel,
        }
    except Exception as legacy_exc:
        logger.error("create_novel legacy endpoint failed: %s", legacy_exc)
        return {
            "success": False,
            "source": "network",
            "error": (
                "failed to create novel via both endpoints: "
                f"modern={modern_error or 'unknown'}; legacy={legacy_exc}"
            ),
        }
