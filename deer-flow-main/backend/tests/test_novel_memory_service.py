from __future__ import annotations

import logging

import pytest

from app.gateway.novel_migrated.services import memory_service as memory_service_module
from app.gateway.novel_migrated.services.memory_service import MemoryService


@pytest.fixture
def isolated_memory_service() -> MemoryService:
    MemoryService._instance = None
    MemoryService._initialized = False
    service = MemoryService()
    service._vector_enabled = False
    service._fallback_store.clear()
    return service


@pytest.mark.anyio
async def test_add_memory_persists_semantic_embedding_in_fallback(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_embed_texts(user_id: str, texts: list[str]):
        _ = (user_id, texts)
        return [[0.2, 0.8]]

    monkeypatch.setattr(isolated_memory_service, '_embed_texts', fake_embed_texts)

    saved = await isolated_memory_service.add_memory(
        user_id='u1',
        project_id='p1',
        memory_id='m1',
        content='测试内容',
        memory_type='plot_point',
        metadata={'importance_score': 0.7},
    )

    assert saved is True
    items = isolated_memory_service._fallback_store[('u1', 'p1')]
    assert len(items) == 1
    assert items[0]['embedding'] == [0.2, 0.8]


@pytest.mark.anyio
async def test_search_memories_filters_by_min_similarity(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_embed_texts(user_id: str, texts: list[str]):
        _ = (user_id, texts)
        return [[1.0, 0.0]]

    monkeypatch.setattr(isolated_memory_service, '_embed_texts', fake_embed_texts)

    isolated_memory_service._fallback_store[('u1', 'p1')] = [
        {
            'id': 'keep',
            'content': '主角在废墟觉醒',
            'metadata': {'memory_type': 'plot_point', 'importance': 0.9},
            'embedding': [1.0, 0.0],
            'created_at': '2026-01-01T00:00:00',
        },
        {
            'id': 'drop',
            'content': '配角在酒馆闲聊',
            'metadata': {'memory_type': 'plot_point', 'importance': 0.2},
            'embedding': [0.0, 1.0],
            'created_at': '2026-01-01T00:00:01',
        },
    ]

    results = await isolated_memory_service.search_memories(
        user_id='u1',
        project_id='p1',
        query='觉醒',
        memory_types=['plot_point'],
        limit=10,
        min_similarity=0.4,
    )

    assert [item['id'] for item in results] == ['keep']
    assert results[0]['similarity'] >= 0.4


def test_fallback_store_evicts_oldest_and_logs(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(memory_service_module, "_FALLBACK_STORE_MAX_CAPACITY", 1)

    with caplog.at_level(logging.INFO):
        isolated_memory_service._store_memory_fallback_entry(
            user_id='u1',
            project_id='p1',
            memory_id='old',
            content='旧内容',
            memory_type='plot_point',
            metadata={'importance_score': 0.9},
            embedding=[0.1, 0.9],
        )
        isolated_memory_service._store_memory_fallback_entry(
            user_id='u1',
            project_id='p1',
            memory_id='new',
            content='新内容',
            memory_type='plot_point',
            metadata={'importance_score': 0.8},
            embedding=[0.2, 0.8],
        )

    items = isolated_memory_service._fallback_store[('u1', 'p1')]
    assert isolated_memory_service._fallback_total_count == 1
    assert len(items) == 1
    assert items[0]['id'] == 'new'
    assert any('容量淘汰' in record.message for record in caplog.records)
