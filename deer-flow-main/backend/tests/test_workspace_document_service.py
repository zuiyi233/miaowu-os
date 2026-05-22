from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.gateway.novel_migrated.core.database import Base
from app.gateway.novel_migrated.models.document_index import DocumentIndex
from app.gateway.novel_migrated.services.workspace_document_service import (
    WorkspaceDocumentService,
    WorkspaceSecurityError,
)


@pytest.mark.anyio
async def test_initialize_workspace_creates_manifest_and_core_files(tmp_path: Path):
    service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")

    result = await service.initialize_workspace(
        user_id="user-1",
        project_id="project-1",
        title="测试书名",
        description="测试简介",
    )

    workspace_root = Path(result["workspace_root"])
    manifest_path = Path(result["manifest_path"])

    assert workspace_root.exists()
    assert manifest_path.exists()
    assert (workspace_root / "book" / "overview.md").exists()
    assert (workspace_root / "relationships" / "relationships.json").exists()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["project_id"] == "project-1"
    assert manifest["user_id"] == "user-1"
    assert manifest["documents"] == []


@pytest.mark.anyio
async def test_write_and_read_document_uses_file_truth_and_manifest(tmp_path: Path):
    service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")
    await service.initialize_workspace(user_id="user-2", project_id="project-2")

    record = await service.write_document(
        user_id="user-2",
        project_id="project-2",
        entity_type="character",
        entity_id="hero_001",
        content="# 主角\n\n姓名：林墨",
        title="主角档案",
        tags=["角色", "主角"],
    )

    assert record.path == "characters/hero_001.md"
    assert record.title == "主角档案"
    assert record.content_hash

    payload = await service.read_document(
        user_id="user-2",
        project_id="project-2",
        entity_type="character",
        entity_id="hero_001",
    )
    assert payload["content_source"] == "file"
    assert payload["doc_path"] == "characters/hero_001.md"
    assert "林墨" in payload["content"]

    manifest_path = tmp_path / "workspaces" / "user-2" / "project-2" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    docs = manifest["documents"]
    assert len(docs) == 1
    assert docs[0]["entity_type"] == "character"
    assert docs[0]["entity_id"] == "hero_001"


@pytest.mark.anyio
async def test_write_document_rejects_path_traversal_entity_id(tmp_path: Path):
    service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")
    await service.initialize_workspace(user_id="user-3", project_id="project-3")

    with pytest.raises(WorkspaceSecurityError):
        await service.write_document(
            user_id="user-3",
            project_id="project-3",
            entity_type="note",
            entity_id="../escape",
            content="forbidden",
        )


@pytest.mark.anyio
async def test_rescan_reflects_manual_file_edit(tmp_path: Path):
    service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")
    await service.initialize_workspace(user_id="user-4", project_id="project-4")

    record = await service.write_document(
        user_id="user-4",
        project_id="project-4",
        entity_type="outline",
        entity_id="outline_1",
        content="# 原始大纲\n\n第一版",
    )

    workspace = tmp_path / "workspaces" / "user-4" / "project-4"
    outline_path = workspace / record.path
    outline_path.write_text("# 原始大纲\n\n第二版", encoding="utf-8")

    records = await service.rescan_workspace(user_id="user-4", project_id="project-4")
    rescanned = next(item for item in records if item.entity_type == "outline" and item.entity_id == "outline_1")

    assert rescanned.content_hash != record.content_hash


@pytest.mark.anyio
async def test_snapshot_chapter_history_increments_version(tmp_path: Path):
    service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")
    await service.initialize_workspace(user_id="user-history", project_id="project-history")

    v1 = await service.snapshot_chapter_history(
        user_id="user-history",
        project_id="project-history",
        chapter_id="chapter-1",
        content="# 第一版\n\n正文1",
    )
    v2 = await service.snapshot_chapter_history(
        user_id="user-history",
        project_id="project-history",
        chapter_id="chapter-1",
        content="# 第二版\n\n正文2",
    )

    assert v1.endswith("/v1.md")
    assert v2.endswith("/v2.md")


@pytest.mark.anyio
async def test_sync_records_to_db_marks_stale_indexes(tmp_path: Path):
    service = WorkspaceDocumentService(workspace_root=tmp_path / "workspaces")
    await service.initialize_workspace(user_id="user-stale", project_id="project-stale")

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    session_factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as db:
        record_a = await service.write_document(
            user_id="user-stale",
            project_id="project-stale",
            entity_type="note",
            entity_id="note-a",
            content="a",
        )
        record_b = await service.write_document(
            user_id="user-stale",
            project_id="project-stale",
            entity_type="note",
            entity_id="note-b",
            content="b",
        )
        await service.sync_records_to_db(
            db=db,
            user_id="user-stale",
            project_id="project-stale",
            records=[record_a, record_b],
            status="indexed",
        )
        await db.commit()

    async with session_factory() as db:
        stats = await service.sync_records_to_db(
            db=db,
            user_id="user-stale",
            project_id="project-stale",
            records=[record_a],
            status="indexed",
            mark_stale=True,
        )
        await db.commit()
        rows = (await db.execute(select(DocumentIndex))).scalars().all()

    assert stats["synced"] == 1
    assert stats["stale_marked"] == 1
    stale_rows = [row for row in rows if row.entity_id == "note-b"]
    assert stale_rows and stale_rows[0].status == "stale"
