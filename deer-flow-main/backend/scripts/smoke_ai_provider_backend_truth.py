"""Smoke test AI Provider backend truth with an OpenAI-compatible upstream.

Required env:
  MIAOWU_SMOKE_AI_BASE_URL
  MIAOWU_SMOKE_AI_API_KEY
  MIAOWU_SMOKE_AI_MODEL

Optional env:
  MIAOWU_SMOKE_USER_ID
  MIAOWU_SMOKE_DATABASE_URL
  MIAOWU_SMOKE_SKIP_UPSTREAM_CALL=1

This script verifies:
  - provider settings are persisted server-side
  - API key is not returned in public settings payloads
  - runtime config resolves the current user's provider/key/model/base_url
  - a minimal OpenAI-compatible chat/completions call works when enabled

It intentionally never prints the API key.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import delete, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

database_url = (os.getenv("MIAOWU_SMOKE_DATABASE_URL") or "").strip()
if database_url and not (os.getenv("DATABASE_URL") or "").strip():
    os.environ["DATABASE_URL"] = database_url

from app.gateway.novel_migrated.models.settings import Settings  # noqa: E402
from app.gateway.novel_migrated.services.ai_settings_service import (  # noqa: E402
    get_ai_settings_service,
    resolve_user_ai_runtime_config,
)
from deerflow.config.app_config import get_app_config  # noqa: E402
from deerflow.persistence.engine import get_session_factory, init_engine_from_config  # noqa: E402


def _required_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required env: {name}")
    return value


def _chat_completions_url(base_url: str) -> str:
    cleaned = base_url.rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    return f"{cleaned}/chat/completions"


async def _call_openai_compatible_chat(
    *,
    base_url: str,
    api_key: str,
    model: str,
) -> dict[str, Any]:
    url = _chat_completions_url(base_url)
    started = time.perf_counter()
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "user",
                        "content": "Reply with exactly: miaowu-ai-smoke-ok",
                    }
                ],
                "temperature": 0,
                "max_tokens": 32,
                "stream": False,
            },
        )
    latency_ms = int((time.perf_counter() - started) * 1000)
    if response.status_code != 200:
        body_preview = response.text[:500]
        raise RuntimeError(f"upstream returned {response.status_code}: {body_preview}")
    data = response.json()
    content = ""
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            message = first.get("message")
            if isinstance(message, dict):
                content = str(message.get("content") or "")
    return {
        "latency_ms": latency_ms,
        "model": data.get("model") or model,
        "content_preview": content[:120],
    }


async def main() -> int:
    base_url = _required_env("MIAOWU_SMOKE_AI_BASE_URL")
    api_key = _required_env("MIAOWU_SMOKE_AI_API_KEY")
    model = _required_env("MIAOWU_SMOKE_AI_MODEL")
    user_id = (os.getenv("MIAOWU_SMOKE_USER_ID") or "smoke-ai-provider-user").strip()
    provider_id = "smoke-openai-compatible"
    skip_upstream = (os.getenv("MIAOWU_SMOKE_SKIP_UPSTREAM_CALL") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    if get_session_factory() is None:
        await init_engine_from_config(get_app_config().database)
    session_factory = get_session_factory()
    if session_factory is None:
        raise RuntimeError("Persistence session factory is not initialized")
    service = get_ai_settings_service()

    async with session_factory() as db:
        await db.execute(delete(Settings).where(Settings.user_id == user_id))
        await db.commit()

        response = await service.put_ai_settings(
            user_id,
            {
                "default_provider_id": provider_id,
                "providers": [
                    {
                        "id": provider_id,
                        "name": "Smoke OpenAI-compatible",
                        "provider": "custom",
                        "base_url": base_url,
                        "models": [model],
                        "is_active": True,
                        "temperature": 0,
                        "max_tokens": 128,
                        "api_key": api_key,
                    }
                ],
                "client_settings": {
                    "enable_stream_mode": True,
                    "request_timeout": 60000,
                    "max_retries": 1,
                },
            },
            db,
        )

        provider = response["providers"][0]
        if provider.get("has_api_key") is not True:
            raise AssertionError("public response does not report has_api_key=true")
        serialized = repr(response)
        if api_key in serialized:
            raise AssertionError("public response leaked API key")
        if "api_key" in provider or "api_key_encrypted" in provider:
            raise AssertionError("public provider leaked secret fields")

        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one()
        runtime, source = resolve_user_ai_runtime_config(settings)
        if runtime["api_key"] != api_key:
            raise AssertionError("runtime did not resolve stored API key")
        if runtime["api_base_url"] != base_url:
            raise AssertionError("runtime did not resolve stored base_url")
        if runtime["model_name"] != model:
            raise AssertionError("runtime did not resolve stored model")

        print(
            "backend_truth=ok "
            f"user_id={user_id} provider_id={provider_id} "
            f"model={runtime['model_name']} base_url={runtime['api_base_url']} "
            f"source={source} public_has_api_key={provider.get('has_api_key')}"
        )

    if not skip_upstream:
        upstream = await _call_openai_compatible_chat(
            base_url=base_url,
            api_key=api_key,
            model=model,
        )
        print(
            "upstream_call=ok "
            f"status=200 latency_ms={upstream['latency_ms']} "
            f"model={upstream['model']} content_preview={upstream['content_preview']!r}"
        )
    else:
        print("upstream_call=skipped")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
