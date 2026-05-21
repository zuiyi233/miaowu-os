"""Novel backend implementation that satisfies harness NovelBackendProtocol.

提供进程内直调能力的实现，由 app 启动时通过
register_novel_backend(NovelBackendImpl()) 注入到 harness。
"""
from __future__ import annotations

import importlib
import logging
from typing import Any

from deerflow.tools.builtins.novel_internal import register_novel_backend

logger = logging.getLogger(__name__)


class NovelBackendImpl:
    """App 层实现，向 harness 注入 db / ai_service / user_id / load_attr 能力。"""

    async def get_db_session_factory(self) -> Any:
        from app.gateway.novel_migrated.core.database import (
            AsyncSessionLocal,
            init_db_schema,
        )
        await init_db_schema()
        return AsyncSessionLocal

    async def get_ai_service(
        self,
        user_id: str | None,
        module_id: str | None,
    ) -> Any:
        from sqlalchemy import select

        from app.gateway.novel_migrated.api.settings import _resolve_user_ai_runtime_config
        from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
        from app.gateway.novel_migrated.core.user_context import resolve_user_id as resolve_uid
        from app.gateway.novel_migrated.models.settings import Settings
        from app.gateway.novel_migrated.services.ai_service import create_user_ai_service

        await init_db_schema()
        effective_user_id = resolve_uid(user_id)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Settings).where(Settings.user_id == effective_user_id))
            settings = result.scalar_one_or_none()
            if settings is None:
                settings = Settings(user_id=effective_user_id)
                db.add(settings)
                await db.commit()
                await db.refresh(settings)

            runtime, _source = _resolve_user_ai_runtime_config(settings, module_id=module_id)

            ai_service = create_user_ai_service(
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

    def resolve_user_id(self, raw_user_id: str | None) -> str:
        from app.gateway.novel_migrated.core.user_context import resolve_user_id as resolve_uid

        return resolve_uid(raw_user_id)

    def load_attr(self, module_path: str, attr_name: str) -> Any | None:
        # 仅允许 app.gateway.novel_migrated.* 范围内的模块
        if not module_path.startswith("app.gateway.novel_migrated"):
            logger.debug("load_attr rejected: %s out of allowed prefix", module_path)
            return None
        try:
            module = importlib.import_module(module_path)
        except Exception as exc:
            logger.debug("load_attr import failed: %s (%s)", module_path, exc)
            return None
        return getattr(module, attr_name, None)


def install_novel_backend() -> None:
    """启动时调用一次。"""
    register_novel_backend(NovelBackendImpl())
