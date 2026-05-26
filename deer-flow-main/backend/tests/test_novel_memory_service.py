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
    service._vector_init_attempted = False
    service._fallback_store.clear()
    return service


def test_memory_service_startup_does_not_initialize_vector_stack(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    MemoryService._instance = None
    MemoryService._initialized = False

    def fail_init(self: MemoryService) -> bool:
        raise AssertionError("vector stack must be lazy")

    monkeypatch.setattr(MemoryService, "_try_init_vector_stack", fail_init)

    with caplog.at_level(logging.WARNING):
        service = MemoryService()

    assert service._vector_enabled is False
    assert service._vector_init_attempted is False
    assert not any("MemoryService 初始化为降级模式" in record.message for record in caplog.records)
    assert not any("chromadb 未安装" in record.message for record in caplog.records)


def test_get_collection_initializes_vector_stack_lazily(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0

    class FakeClient:
        def get_or_create_collection(self, *, name: str, metadata: dict[str, str]):
            return {"name": name, "metadata": metadata}

    def fake_init() -> bool:
        nonlocal calls
        calls += 1
        isolated_memory_service.client = FakeClient()
        return True

    monkeypatch.setattr(isolated_memory_service, "_try_init_vector_stack", fake_init)

    collection = isolated_memory_service.get_collection("u1", "p1")

    assert calls == 1
    assert isolated_memory_service._vector_init_attempted is True
    assert collection is not None


def test_get_collection_names_are_isolated_by_user_and_project(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    names: list[str] = []

    class FakeClient:
        def get_or_create_collection(self, *, name: str, metadata: dict[str, str]):
            names.append(name)
            return {"name": name, "metadata": metadata}

    def fake_init() -> bool:
        isolated_memory_service.client = FakeClient()
        return True

    monkeypatch.setattr(isolated_memory_service, "_try_init_vector_stack", fake_init)

    isolated_memory_service.get_collection("user-a", "project-1")
    isolated_memory_service.get_collection("user-b", "project-1")
    isolated_memory_service.get_collection("user-a", "project-2")

    assert len(names) == 3
    assert len(set(names)) == 3
    assert all(name.startswith("u_") and "_p_" in name for name in names)


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


@pytest.mark.anyio
async def test_embed_texts_prefers_user_cloud_config_over_local_fallback(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cloud_called = False
    local_called = False

    async def fake_cloud(user_id: str, texts: list[str]):
        nonlocal cloud_called
        assert user_id == "u1"
        assert texts == ["query"]
        cloud_called = True
        return [[0.4, 0.6]]

    def fake_local(texts: list[str]):
        nonlocal local_called
        local_called = True
        return [[0.9, 0.1]]

    isolated_memory_service._allow_local_embedding_fallback = True
    monkeypatch.setattr(isolated_memory_service, "_embed_with_cloud_provider", fake_cloud)
    monkeypatch.setattr(isolated_memory_service, "_embed_with_local_model", fake_local)

    vectors = await isolated_memory_service._embed_texts("u1", ["query"])

    assert vectors == [[0.4, 0.6]]
    assert cloud_called is True
    assert local_called is False


@pytest.mark.anyio
async def test_embed_texts_does_not_use_local_model_unless_enabled(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local_called = False

    async def fake_cloud(_user_id: str, _texts: list[str]):
        return None

    def fake_local(_texts: list[str]):
        nonlocal local_called
        local_called = True
        return [[0.9, 0.1]]

    isolated_memory_service._allow_local_embedding_fallback = False
    monkeypatch.setattr(isolated_memory_service, "_embed_with_cloud_provider", fake_cloud)
    monkeypatch.setattr(isolated_memory_service, "_embed_with_local_model", fake_local)

    vectors = await isolated_memory_service._embed_texts("u1", ["query"])

    assert vectors is None
    assert local_called is False


@pytest.mark.anyio
async def test_vector_quota_filters_items_per_user(
    isolated_memory_service: MemoryService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_quota(user_id: str) -> int:
        assert user_id == "u1"
        return 90

    monkeypatch.setattr(isolated_memory_service, "_get_vector_memory_quota_bytes", fake_quota)
    monkeypatch.setattr(isolated_memory_service, "_estimate_user_collection_bytes", lambda user_id: 60)
    monkeypatch.setattr(isolated_memory_service, "_estimate_user_fallback_vector_bytes", lambda user_id: 0)
    monkeypatch.setattr(
        isolated_memory_service,
        "_estimate_vector_item_bytes",
        lambda *, content, metadata, embedding: 20,
    )

    allowed = await isolated_memory_service._filter_vector_items_by_user_quota(
        user_id="u1",
        collection=object(),
        items=[
            {"memory_id": "m1", "content": "a", "metadata": {}, "embedding": [0.1]},
            {"memory_id": "m2", "content": "b", "metadata": {}, "embedding": [0.2]},
        ],
    )

    assert [item["memory_id"] for item in allowed] == ["m1"]
