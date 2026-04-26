"""Internal direct-call bridge for novel tools.

Provides process-internal invocation of Gateway API functions,
bypassing HTTP overhead. Falls back to HTTP when internal modules
are unavailable (e.g., deerflow package runs standalone).
"""
from __future__ import annotations

import importlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

_INTERNAL_AVAILABLE: bool | None = None


def is_internal_available() -> bool:
    global _INTERNAL_AVAILABLE
    if _INTERNAL_AVAILABLE is None:
        _INTERNAL_AVAILABLE = _check_internal_modules()
    return _INTERNAL_AVAILABLE


def _check_internal_modules() -> bool:
    try:
        mod = importlib.import_module("app.gateway.novel_migrated.core.database")
        return hasattr(mod, "AsyncSessionLocal")
    except Exception:
        return False


def load_attr(module_path: str, attr_name: str) -> Any | None:
    try:
        module = importlib.import_module(module_path)
    except Exception as exc:
        logger.debug("novel internal import skipped: %s (%s)", module_path, exc)
        return None
    return getattr(module, attr_name, None)


async def get_internal_db():
    init_db_schema = load_attr("app.gateway.novel_migrated.core.database", "init_db_schema")
    AsyncSessionLocal = load_attr("app.gateway.novel_migrated.core.database", "AsyncSessionLocal")
    if AsyncSessionLocal is None:
        raise RuntimeError("internal db session unavailable")
    if callable(init_db_schema):
        await init_db_schema()
    return AsyncSessionLocal


async def get_internal_ai_service(
    user_id: str | None = None,
    module_id: str | None = None,
) -> Any:
    AsyncSessionLocal = await get_internal_db()
    effective_user_id = resolve_user_id(user_id)

    Settings = load_attr("app.gateway.novel_migrated.models.settings", "Settings")
    resolve_config = load_attr("app.gateway.novel_migrated.api.settings", "_resolve_user_ai_runtime_config")
    create_fn = load_attr("app.gateway.novel_migrated.services.ai_service", "create_user_ai_service")

    if Settings is None or not callable(resolve_config) or not callable(create_fn):
        raise RuntimeError("internal ai service construction unavailable")

    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Settings).where(Settings.user_id == effective_user_id))
        settings = result.scalar_one_or_none()

        if settings is None:
            settings = Settings(user_id=effective_user_id)
            db.add(settings)
            await db.commit()
            await db.refresh(settings)

        runtime, _source = resolve_config(
            settings,
            module_id=module_id,
        )

        ai_service = create_fn(
            api_provider=runtime["api_provider"],
            api_key=runtime["api_key"],
            api_base_url=runtime["api_base_url"],
            model_name=runtime["model_name"],
            temperature=runtime["temperature"],
            max_tokens=runtime["max_tokens"],
            system_prompt=getattr(settings, "system_prompt", None),
            user_id=effective_user_id,
            db_session=db,
            enable_mcp=True,
        )

    return ai_service


def resolve_user_id(raw_user_id: str | None) -> str:
    resolver = load_attr(
        "app.gateway.novel_migrated.core.user_context",
        "resolve_user_id",
    )
    if callable(resolver):
        try:
            result = resolver(raw_user_id)
            if isinstance(result, str) and result.strip():
                return result.strip()
        except Exception:
            pass
    normalized = (raw_user_id or "").strip()
    return normalized or "local_single_user"


def to_dict(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump") and callable(result.model_dump):
        return result.model_dump()
    if hasattr(result, "__dict__"):
        return {k: v for k, v in result.__dict__.items() if not k.startswith("_")}
    return {"raw": result}
