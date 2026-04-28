from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.gateway.novel_migrated.core.database import Base
from app.gateway.novel_migrated.models.document_index import DocumentIndex
from app.gateway.novel_migrated.services import memory_service as memory_service_module
from app.gateway.novel_migrated.services.memory_service import MemoryService
from app.gateway.novel_migrated.services.workspace_document_service import WorkspaceDocumentService


@pytest.mark.anyio
async def test_sync_workspace_documents_incremental_only_reindexes_changed_docs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    MemoryService._instance = None
    MemoryService._initialized = False
    memory_service = MemoryService()
    memory_service._vector_enabled = False
    memory_service._fallback_store.clear()
    memory_service._fallback_total_count = 0

    async def _fake_embed(_user_id: str, texts: list[str]):
        return [[0.3, 0.7] for _ in texts]

    monkeypatch.setattr(memory_service, "_embed_texts", _fake_embed)

    workspace_service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")
    monkeypatch.setattr(memory_service_module, "workspace_document_service", workspace_service)

    user_id = "user-sync"
    project_id = "project-sync"
    await workspace_service.initialize_workspace(user_id=user_id, project_id=project_id)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as db:
        record = await workspace_service.write_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="note",
            entity_id="n1",
            content="# 记忆摘要\n\n第一版内容",
        )
        await workspace_service.sync_record_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            record=record,
        )
        await db.commit()

    async with session_factory() as db:
        stats_first = await memory_service.sync_workspace_documents_incremental(
            user_id=user_id,
            project_id=project_id,
            db=db,
        )
        await db.commit()
        indexed_doc = (await db.execute(select(DocumentIndex))).scalar_one()

    assert stats_first["indexed"] == 1
    assert stats_first["skipped"] == 0
    assert indexed_doc.status == "indexed"

    async with session_factory() as db:
        stats_second = await memory_service.sync_workspace_documents_incremental(
            user_id=user_id,
            project_id=project_id,
            db=db,
        )
        await db.commit()
    assert stats_second["indexed"] == 0
    assert stats_second["skipped"] == 1

    async with session_factory() as db:
        updated_record = await workspace_service.write_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="note",
            entity_id="n1",
            content="# 记忆摘要\n\n第二版内容",
        )
        await workspace_service.sync_record_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            record=updated_record,
        )
        await db.commit()

    async with session_factory() as db:
        stats_third = await memory_service.sync_workspace_documents_incremental(
            user_id=user_id,
            project_id=project_id,
            db=db,
        )
        await db.commit()
        indexed_doc = (await db.execute(select(DocumentIndex))).scalar_one()

    assert stats_third["indexed"] == 1
    assert indexed_doc.status == "indexed"

    fallback_items = memory_service._fallback_store[(user_id, project_id)]
    assert len(fallback_items) == 1
    assert "第二版内容" in fallback_items[0]["content"]

