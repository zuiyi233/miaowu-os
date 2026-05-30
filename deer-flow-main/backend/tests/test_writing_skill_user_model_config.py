from __future__ import annotations

import asyncio
import json

import pytest

from app.gateway.novel_migrated.core.database import AsyncSessionLocal, init_db_schema
from app.gateway.novel_migrated.models.settings import Settings
from deerflow.skills.writing_skill_index import WritingSkillUserConfig, load_writing_skill_user_config
from deerflow.tools.builtins.writing_skill_tools import list_writing_skill_candidates

pytestmark = pytest.mark.usefixtures("novel_main_sqlite_engine")


async def _seed_settings(user_id: str) -> None:
    await init_db_schema()
    async with AsyncSessionLocal() as session:
        session.add(
            Settings(
                user_id=user_id,
                api_key="sk-test-writing-skill",
                api_base_url="https://example.com/v1",
                llm_model="gpt-4o-mini",
                preferences=json.dumps(
                    {
                        "writing_skill_embedding_model": "bge-m3",
                        "writing_skill_rerank_model": "bge-reranker-v2-m3",
                    }
                ),
            )
        )
        await session.commit()


async def _seed_settings_without_writing_skill_overrides(user_id: str) -> None:
    await init_db_schema()
    async with AsyncSessionLocal() as session:
        session.add(
            Settings(
                user_id=user_id,
                api_key="sk-test-writing-skill",
                api_base_url="https://example.com/v1",
                llm_model="gpt-4o-mini",
                preferences=json.dumps(
                    {
                        "embedding_model": "user-private-memory-embedding",
                        "rerank_model": "user-private-memory-rerank",
                    }
                ),
            )
        )
        await session.commit()


@pytest.mark.asyncio
async def test_writing_skill_index_reads_user_embedding_and_rerank_models(novel_main_sqlite_engine, monkeypatch):
    await _seed_settings("writer-1")
    user_config = await load_writing_skill_user_config("writer-1")
    vector_config = user_config.embedding
    rerank_config = user_config.rerank

    assert vector_config is not None
    assert vector_config.base_url == "https://example.com/v1"
    assert vector_config.model == "bge-m3"
    assert vector_config.api_key == "sk-test-writing-skill"

    assert rerank_config is not None
    assert rerank_config.base_url == "https://example.com/v1"
    assert rerank_config.model == "bge-reranker-v2-m3"
    assert rerank_config.api_key == "sk-test-writing-skill"


@pytest.mark.asyncio
async def test_writing_skill_index_does_not_inherit_private_memory_models_without_explicit_overrides(
    novel_main_sqlite_engine,
):
    await _seed_settings_without_writing_skill_overrides("writer-2")
    user_config = await load_writing_skill_user_config("writer-2")

    assert user_config.embedding is None
    assert user_config.rerank is None


def test_list_writing_skill_candidates_passes_user_id_to_index(monkeypatch):
    captured: dict[str, object] = {}

    class _DummyIndex:
        def warm_user_vector_index(self, user_config: WritingSkillUserConfig | None) -> None:
            captured["warm_user_config"] = user_config

        def search_candidates(self, **kwargs):
            captured["search_kwargs"] = kwargs
            return []

    monkeypatch.setattr("deerflow.tools.builtins.writing_skill_tools._get_index", lambda: _DummyIndex())
    monkeypatch.setattr(
        "deerflow.tools.builtins.writing_skill_tools.load_writing_skill_user_config",
        lambda user_id: asyncio.sleep(0, result=WritingSkillUserConfig()),
    )

    result = asyncio.run(
        list_writing_skill_candidates.coroutine(
            "设计反派",
            context="需要有层次",
            config={"configurable": {"user_id": "writer-1"}},
        )
    )

    assert result["success"] is True
    assert "warm_user_config" not in captured
    assert isinstance(captured["search_kwargs"]["user_config"], WritingSkillUserConfig)


def test_writing_skill_vector_collection_name_is_shared_per_embedding_model():
    from deerflow.skills.writing_skill_index import _UserModelConfig, _VectorSearchBackend

    backend = _VectorSearchBackend(data_dir=__import__("pathlib").Path("N:/miaowu-os-merge-upstream-main/deer-flow-main/backend/data"))
    default_name = backend._collection_name(None)
    bge_name = backend._collection_name(
        _UserModelConfig(
            api_key="sk-test",
            base_url="https://example.com/v1",
            model="bge-m3",
        )
    )
    bge_name_2 = backend._collection_name(
        _UserModelConfig(
            api_key="sk-another-user",
            base_url="https://another.example.com/v1",
            model="bge-m3",
        )
    )

    assert default_name.startswith("writing_skills_index__")
    assert bge_name == bge_name_2
    assert bge_name.endswith("bge_m3")
