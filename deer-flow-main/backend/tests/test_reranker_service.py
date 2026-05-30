from __future__ import annotations

import json

import pytest

from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.reranker_service import RerankConfig, RerankerService

pytestmark = pytest.mark.usefixtures("novel_main_sqlite_engine")


async def _seed_settings(
    user_id: str,
    *,
    api_key: str = "sk-test-rerank",
    api_base_url: str = "https://example.com/v1",
    preferences: dict | None = None,
) -> None:
    await init_db_schema()
    async with AsyncSessionLocal() as session:
        session.add(
            Settings(
                user_id=user_id,
                api_key=api_key,
                api_base_url=api_base_url,
                llm_model="gpt-4o-mini",
                preferences=json.dumps(preferences or {}),
            )
        )
        await session.commit()


@pytest.mark.asyncio
async def test_reranker_service_prefers_user_settings(monkeypatch) -> None:
    await _seed_settings(
        "rerank-user-1",
        preferences={
            "rerank_model": "bge-reranker-v2-m3",
            "rerank_enabled": "true",
        },
    )
    service = RerankerService.get_instance()
    service._config_cache.clear()

    config = await service._resolve_config("rerank-user-1")

    assert config == RerankConfig(
        api_key="sk-test-rerank",
        base_url="https://example.com/v1",
        model="bge-reranker-v2-m3",
    )


@pytest.mark.asyncio
async def test_reranker_service_respects_user_disable(monkeypatch) -> None:
    await _seed_settings(
        "rerank-user-2",
        preferences={
            "rerank_model": "bge-reranker-v2-m3",
            "rerank_enabled": "false",
        },
    )
    service = RerankerService.get_instance()
    service._config_cache.clear()

    config = await service._resolve_config("rerank-user-2")

    assert config is None


def test_rerank_sync_returns_empty_without_config() -> None:
    service = RerankerService.get_instance()
    results = service.rerank_sync("query", ["a", "b"], config=None)
    assert results == []
