"""Workspace document service for novel file-truth architecture."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.document_index import DocumentIndex

logger = get_logger(__name__)

WORKSPACE_ROOT_ENV = "NOVEL_WORKSPACE_ROOT"
MANIFEST_FILE_NAME = "manifest.json"
MANIFEST_SCHEMA_VERSION = "1.0"

_BACKEND_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_WORKSPACE_ROOT = _BACKEND_ROOT / ".deer-flow" / "novel-workspaces"
_FORBIDDEN_SEGMENT_RE = re.compile(r"[\\/]|(\.\.)|[\x00]")


@dataclass(frozen=True)
class ManifestRecord:
    entity_type: str
    entity_id: str
    path: str
    title: str
    content_hash: str
    mtime: str
    size: int
    tags: list[str]
    schema_version: str = MANIFEST_SCHEMA_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "path": self.path,
            "title": self.title,
            "content_hash": self.content_hash,
            "mtime": self.mtime,
            "size": self.size,
            "tags": self.tags,
            "schema_version": self.schema_version,
        }


class WorkspaceSecurityError(ValueError):
    """Raised when requested workspace path breaks security constraints."""


class WorkspaceDocumentService:
    """File-truth workspace document manager."""

    _DIR_LAYOUT = (
        "book",
        "chapters",
        "outlines",
        "characters",
        "relationships",
        "organizations",
        "foreshadows",
        "careers",
        "memories",
        "analysis",
        "notes",
        "history/chapters",
    )

    _ENTITY_EXTENSIONS: dict[str, str] = {
        "book": ".md",
        "chapter": ".md",
        "outline": ".md",
        "character": ".md",
        "relationship": ".json",
        "organization": ".md",
        "foreshadow": ".md",
        "career": ".md",
        "memory": ".md",
        "analysis": ".json",
        "note": ".md",
    }

    _ENTITY_ALIASES: dict[str, str] = {
        "book": "book",
        "books": "book",
        "chapter": "chapter",
        "chapters": "chapter",
        "outline": "outline",
        "outlines": "outline",
        "character": "character",
        "characters": "character",
        "relationship": "relationship",
        "relationships": "relationship",
        "organization": "organization",
        "organizations": "organization",
        "foreshadow": "foreshadow",
        "foreshadows": "foreshadow",
        "career": "career",
        "careers": "career",
        "memory": "memory",
        "memories": "memory",
        "analysis": "analysis",
        "analyses": "analysis",
        "note": "note",
        "notes": "note",
    }

    def __init__(self, workspace_root: Path | None = None) -> None:
        self._workspace_root = workspace_root or self._resolve_workspace_root()
        self._manifest_locks: dict[str, asyncio.Lock] = {}
        self._manifest_locks_guard = asyncio.Lock()

    async def _get_manifest_lock(self, workspace: Path) -> asyncio.Lock:
        key = str(workspace.resolve())
        existing = self._manifest_locks.get(key)
        if existing is not None:
            return existing
        async with self._manifest_locks_guard:
            lock = self._manifest_locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._manifest_locks[key] = lock
            return lock

    @staticmethod
    def _resolve_workspace_root() -> Path:
        raw = (os.getenv(WORKSPACE_ROOT_ENV) or "").strip()
        root = Path(raw) if raw else _DEFAULT_WORKSPACE_ROOT
        root.mkdir(parents=True, exist_ok=True)
        return root

    @staticmethod
    def _validate_segment(value: str, field_name: str) -> str:
        normalized = (value or "").strip()
        if not normalized:
            raise WorkspaceSecurityError(f"{field_name} 不能为空")
        if _FORBIDDEN_SEGMENT_RE.search(normalized):
            raise WorkspaceSecurityError(f"{field_name} 包含非法路径片段")
        if Path(normalized).is_absolute():
            raise WorkspaceSecurityError(f"{field_name} 不允许绝对路径")
        return normalized

    @staticmethod
    def _slug_for_filename(value: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
        cleaned = cleaned.strip("._")
        return cleaned or "entity"

    @staticmethod
    def _compute_hash(content: str) -> str:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    def workspace_dir(self, user_id: str, project_id: str) -> Path:
        safe_user = self._validate_segment(user_id, "user_id")
        safe_project = self._validate_segment(project_id, "project_id")
        workspace = (self._workspace_root / safe_user / safe_project).resolve()
        workspace.mkdir(parents=True, exist_ok=True)
        self._assert_within_workspace_root(workspace)
        return workspace

    def _assert_within_workspace_root(self, path: Path) -> None:
        root = self._workspace_root.resolve()
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            raise WorkspaceSecurityError(f"目标路径越界: {resolved}")

    @staticmethod
    def _coerce_entity_type(entity_type: str) -> str:
        key = (entity_type or "").strip().lower()
        mapped = WorkspaceDocumentService._ENTITY_ALIASES.get(key)
        if not mapped:
            raise ValueError(f"不支持的 entity_type: {entity_type}")
        return mapped

    def _resolve_entity_relative_path(self, entity_type: str, entity_id: str) -> Path:
        canonical_type = self._coerce_entity_type(entity_type)
        safe_id = self._validate_segment(entity_id, "entity_id")
        file_id = self._slug_for_filename(safe_id)

        if canonical_type == "book":
            return Path("book/overview.md")
        if canonical_type == "chapter":
            chapter_name = f"chapter_{int(file_id):04d}" if file_id.isdigit() else f"chapter_{file_id}"
            return Path("chapters") / f"{chapter_name}.md"
        if canonical_type == "outline":
            return Path("outlines") / f"{file_id}.md"
        if canonical_type == "character":
            return Path("characters") / f"{file_id}.md"
        if canonical_type == "relationship":
            return Path("relationships/relationships.json")
        if canonical_type == "organization":
            return Path("organizations") / f"{file_id}.md"
        if canonical_type == "foreshadow":
            return Path("foreshadows") / f"{file_id}.md"
        if canonical_type == "career":
            return Path("careers") / f"{file_id}.md"
        if canonical_type == "memory":
            return Path("memories") / f"{file_id}.md"
        if canonical_type == "analysis":
            return Path("analysis") / f"{file_id}.analysis.json"
        if canonical_type == "note":
            return Path("notes") / f"{file_id}.md"
        raise ValueError(f"未实现的 entity_type: {entity_type}")

    def _ensure_workspace_layout(self, workspace: Path) -> None:
        for rel_dir in self._DIR_LAYOUT:
            (workspace / rel_dir).mkdir(parents=True, exist_ok=True)

    def _manifest_path(self, workspace: Path) -> Path:
        return workspace / MANIFEST_FILE_NAME

    async def initialize_workspace(
        self,
        *,
        user_id: str,
        project_id: str,
        title: str = "",
        description: str = "",
        theme: str = "",
        genre: str = "",
    ) -> dict[str, Any]:
        workspace = self.workspace_dir(user_id, project_id)
        self._ensure_workspace_layout(workspace)

        overview_path = workspace / "book" / "overview.md"
        if not overview_path.exists():
            overview = "\n".join(
                [
                    f"# {title or '未命名作品'}",
                    "",
                    "## 主题",
                    theme or "待补充",
                    "",
                    "## 简介",
                    description or "待补充",
                    "",
                    "## 世界观摘要",
                    genre or "待补充",
                    "",
                ]
            )
            await asyncio.to_thread(overview_path.write_text, overview, "utf-8")

        rel_path = workspace / "relationships" / "relationships.json"
        if not rel_path.exists():
            await asyncio.to_thread(rel_path.write_text, "[]\n", "utf-8")

        manifest_path = self._manifest_path(workspace)
        if not manifest_path.exists():
            payload = self._empty_manifest(user_id=user_id, project_id=project_id)
            await asyncio.to_thread(
                manifest_path.write_text,
                json.dumps(payload, ensure_ascii=False, indent=2),
                "utf-8",
            )

        return {
            "workspace_root": str(workspace),
            "manifest_path": str(manifest_path),
            "content_source": "file",
        }

    @staticmethod
    def _empty_manifest(*, user_id: str, project_id: str) -> dict[str, Any]:
        now = datetime.now(tz=UTC).isoformat()
        return {
            "schema_version": MANIFEST_SCHEMA_VERSION,
            "user_id": user_id,
            "project_id": project_id,
            "updated_at": now,
            "documents": [],
        }

    async def _load_manifest(self, workspace: Path, *, user_id: str, project_id: str) -> dict[str, Any]:
        manifest_path = self._manifest_path(workspace)
        if not manifest_path.exists():
            return self._empty_manifest(user_id=user_id, project_id=project_id)
        raw = await asyncio.to_thread(manifest_path.read_text, "utf-8")
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            logger.warning("manifest.json corrupted for user=%s project=%s, resetting to empty", user_id, project_id)
            data = {}
        if not isinstance(data, dict):
            raise ValueError("manifest.json 格式错误：根节点必须为对象")
        data.setdefault("schema_version", MANIFEST_SCHEMA_VERSION)
        data.setdefault("user_id", user_id)
        data.setdefault("project_id", project_id)
        data.setdefault("documents", [])
        return data

    async def _save_manifest(self, workspace: Path, manifest: dict[str, Any]) -> None:
        manifest["updated_at"] = datetime.now(tz=UTC).isoformat()
        path = self._manifest_path(workspace)
        await asyncio.to_thread(
            path.write_text,
            json.dumps(manifest, ensure_ascii=False, indent=2),
            "utf-8",
        )

    def _serialize_content(self, *, entity_type: str, content: Any) -> str:
        canonical_type = self._coerce_entity_type(entity_type)
        ext = self._ENTITY_EXTENSIONS.get(canonical_type, ".md")
        if ext == ".json":
            if isinstance(content, str):
                try:
                    parsed = json.loads(content)
                except json.JSONDecodeError:
                    parsed = {"content": content}
            else:
                parsed = content
            return json.dumps(parsed, ensure_ascii=False, indent=2) + "\n"

        if isinstance(content, str):
            return content
        return json.dumps(content, ensure_ascii=False, indent=2)

    @staticmethod
    def _guess_title(entity_type: str, entity_id: str, content_text: str, provided_title: str | None = None) -> str:
        if provided_title and provided_title.strip():
            return provided_title.strip()
        if content_text:
            first_non_empty = next((line.strip() for line in content_text.splitlines() if line.strip()), "")
            if first_non_empty.startswith("#"):
                return first_non_empty.lstrip("# ").strip()[:200]
            if first_non_empty:
                return first_non_empty[:200]
        return f"{entity_type}:{entity_id}"

    async def write_document(
        self,
        *,
        user_id: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
        content: Any,
        title: str | None = None,
        tags: list[str] | None = None,
    ) -> ManifestRecord:
        workspace = self.workspace_dir(user_id, project_id)
        self._ensure_workspace_layout(workspace)

        relative_path = self._resolve_entity_relative_path(entity_type, entity_id)
        absolute_path = (workspace / relative_path).resolve()
        self._assert_within_workspace_root(absolute_path)
        absolute_path.parent.mkdir(parents=True, exist_ok=True)

        content_text = self._serialize_content(entity_type=entity_type, content=content)
        await asyncio.to_thread(absolute_path.write_text, content_text, "utf-8")
        stat = await asyncio.to_thread(absolute_path.stat)
        content_hash = self._compute_hash(content_text)
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat()
        record = ManifestRecord(
            entity_type=self._coerce_entity_type(entity_type),
            entity_id=self._validate_segment(entity_id, "entity_id"),
            path=relative_path.as_posix(),
            title=self._guess_title(entity_type, entity_id, content_text, provided_title=title),
            content_hash=content_hash,
            mtime=mtime,
            size=int(stat.st_size),
            tags=[str(tag) for tag in (tags or []) if str(tag).strip()],
        )

        manifest_lock = await self._get_manifest_lock(workspace)
        async with manifest_lock:
            manifest = await self._load_manifest(workspace, user_id=user_id, project_id=project_id)
            docs = manifest.get("documents", [])
            manifest["documents"] = self._upsert_record(docs, record)
            await self._save_manifest(workspace, manifest)
        return record

    async def snapshot_chapter_history(
        self,
        *,
        user_id: str,
        project_id: str,
        chapter_id: str,
        content: str,
    ) -> str:
        """Write chapter history snapshot as history/chapters/{chapter_id}/v{n}.md."""
        workspace = self.workspace_dir(user_id, project_id)
        safe_chapter_id = self._validate_segment(chapter_id, "chapter_id")
        history_dir = (workspace / "history" / "chapters" / self._slug_for_filename(safe_chapter_id)).resolve()
        self._assert_within_workspace_root(history_dir)
        history_dir.mkdir(parents=True, exist_ok=True)

        max_version = 0
        for file in history_dir.glob("v*.md"):
            if not file.is_file():
                continue
            raw = file.stem.lower()
            if not raw.startswith("v"):
                continue
            try:
                max_version = max(max_version, int(raw[1:]))
            except ValueError:
                continue

        next_version = max_version + 1
        snapshot_path = (history_dir / f"v{next_version}.md").resolve()
        self._assert_within_workspace_root(snapshot_path)
        await asyncio.to_thread(snapshot_path.write_text, content, "utf-8")
        return snapshot_path.relative_to(workspace).as_posix()

    @staticmethod
    def _upsert_record(existing_records: list[Any], new_record: ManifestRecord) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        replaced = False
        for item in existing_records:
            if not isinstance(item, dict):
                continue
            same_entity = (
                item.get("entity_type") == new_record.entity_type
                and item.get("entity_id") == new_record.entity_id
            )
            if same_entity:
                normalized.append(new_record.to_dict())
                replaced = True
            else:
                normalized.append(item)
        if not replaced:
            normalized.append(new_record.to_dict())
        return normalized

    async def read_document(
        self,
        *,
        user_id: str,
        project_id: str,
        entity_type: str,
        entity_id: str,
    ) -> dict[str, Any]:
        workspace = self.workspace_dir(user_id, project_id)
        relative_path = self._resolve_entity_relative_path(entity_type, entity_id)
        absolute_path = (workspace / relative_path).resolve()
        self._assert_within_workspace_root(absolute_path)

        if not absolute_path.exists():
            raise FileNotFoundError(f"文档不存在: {relative_path.as_posix()}")

        content = await asyncio.to_thread(absolute_path.read_text, "utf-8")
        stat = await asyncio.to_thread(absolute_path.stat)
        content_hash = self._compute_hash(content)
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat()

        return {
            "entity_type": self._coerce_entity_type(entity_type),
            "entity_id": self._validate_segment(entity_id, "entity_id"),
            "doc_path": relative_path.as_posix(),
            "content_source": "file",
            "content_hash": content_hash,
            "doc_updated_at": mtime,
            "size": int(stat.st_size),
            "content": content,
        }

    async def rescan_workspace(
        self,
        *,
        user_id: str,
        project_id: str,
    ) -> list[ManifestRecord]:
        workspace = self.workspace_dir(user_id, project_id)
        self._ensure_workspace_layout(workspace)

        records: list[ManifestRecord] = []
        for abs_path in workspace.rglob("*"):
            if not abs_path.is_file():
                continue
            if abs_path.name == MANIFEST_FILE_NAME:
                continue
            relative = abs_path.relative_to(workspace).as_posix()
            inferred = self._infer_entity_from_path(relative)
            if not inferred:
                continue
            entity_type, entity_id = inferred
            content = await asyncio.to_thread(abs_path.read_text, "utf-8")
            stat = await asyncio.to_thread(abs_path.stat)
            mtime = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat()
            record = ManifestRecord(
                entity_type=entity_type,
                entity_id=entity_id,
                path=relative,
                title=self._guess_title(entity_type, entity_id, content),
                content_hash=self._compute_hash(content),
                mtime=mtime,
                size=int(stat.st_size),
                tags=[],
            )
            records.append(record)

        manifest = self._empty_manifest(user_id=user_id, project_id=project_id)
        manifest["documents"] = [item.to_dict() for item in records]
        await self._save_manifest(workspace, manifest)
        return records

    @staticmethod
    def _infer_entity_from_path(relative_path: str) -> tuple[str, str] | None:
        if relative_path == "book/overview.md":
            return ("book", "overview")
        if relative_path == "relationships/relationships.json":
            return ("relationship", "relationships")
        if relative_path.startswith("chapters/chapter_") and relative_path.endswith(".md"):
            raw = relative_path[len("chapters/chapter_") : -3]
            return ("chapter", raw)
        if relative_path.startswith("outlines/") and relative_path.endswith(".md"):
            return ("outline", Path(relative_path).stem)
        if relative_path.startswith("characters/") and relative_path.endswith(".md"):
            return ("character", Path(relative_path).stem)
        if relative_path.startswith("organizations/") and relative_path.endswith(".md"):
            return ("organization", Path(relative_path).stem)
        if relative_path.startswith("foreshadows/") and relative_path.endswith(".md"):
            return ("foreshadow", Path(relative_path).stem)
        if relative_path.startswith("careers/") and relative_path.endswith(".md"):
            return ("career", Path(relative_path).stem)
        if relative_path.startswith("memories/") and relative_path.endswith(".md"):
            return ("memory", Path(relative_path).stem)
        if relative_path.startswith("analysis/") and relative_path.endswith(".analysis.json"):
            return ("analysis", relative_path[len("analysis/") : -len(".analysis.json")])
        if relative_path.startswith("notes/") and relative_path.endswith(".md"):
            return ("note", Path(relative_path).stem)
        return None

    async def sync_record_to_db(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        record: ManifestRecord,
        status: str = "pending",
    ) -> DocumentIndex:
        stmt = select(DocumentIndex).where(
            DocumentIndex.project_id == project_id,
            DocumentIndex.user_id == user_id,
            DocumentIndex.entity_type == record.entity_type,
            DocumentIndex.entity_id == record.entity_id,
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        doc_updated_at = datetime.fromisoformat(record.mtime.replace("Z", "+00:00"))
        tags_json = json.dumps(record.tags, ensure_ascii=False)

        if existing:
            has_doc_changed = (
                existing.content_hash != record.content_hash
                or existing.doc_path != record.path
                or existing.doc_updated_at != doc_updated_at
            )
            existing.doc_path = record.path
            existing.title = record.title
            existing.content_hash = record.content_hash
            existing.doc_updated_at = doc_updated_at
            existing.size = record.size
            existing.tags_json = tags_json
            existing.schema_version = record.schema_version
            if has_doc_changed:
                existing.status = status
                existing.indexed_at = datetime.now(tz=UTC)
            return existing

        entry = DocumentIndex(
            project_id=project_id,
            user_id=user_id,
            entity_type=record.entity_type,
            entity_id=record.entity_id,
            doc_path=record.path,
            title=record.title,
            content_hash=record.content_hash,
            doc_updated_at=doc_updated_at,
            indexed_at=datetime.now(tz=UTC),
            status=status,
            size=record.size,
            tags_json=tags_json,
            schema_version=record.schema_version,
        )
        db.add(entry)
        return entry

    async def sync_records_to_db(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        records: list[ManifestRecord],
        status: str = "pending",
        mark_stale: bool = True,
    ) -> dict[str, int]:
        synced = 0
        stale_marked = 0
        seen_keys: set[tuple[str, str]] = set()
        for record in records:
            await self.sync_record_to_db(
                db=db,
                user_id=user_id,
                project_id=project_id,
                record=record,
                status=status,
            )
            synced += 1
            seen_keys.add((record.entity_type, record.entity_id))

        if mark_stale:
            stmt = select(DocumentIndex).where(
                DocumentIndex.user_id == user_id,
                DocumentIndex.project_id == project_id,
            )
            result = await db.execute(stmt)
            for row in result.scalars().all():
                key = (row.entity_type, row.entity_id)
                if key in seen_keys:
                    continue
                if row.status != "stale":
                    row.status = "stale"
                    row.indexed_at = datetime.now(tz=UTC)
                    stale_marked += 1

        return {"synced": synced, "stale_marked": stale_marked}

    async def list_index_records(
        self,
        *,
        db: AsyncSession,
        user_id: str,
        project_id: str,
        entity_type: str,
        include_stale: bool = False,
    ) -> list[DocumentIndex]:
        canonical_type = self._coerce_entity_type(entity_type)
        filters: list[Any] = [
            DocumentIndex.user_id == user_id,
            DocumentIndex.project_id == project_id,
            DocumentIndex.entity_type == canonical_type,
        ]
        if not include_stale:
            filters.append(DocumentIndex.status != "stale")
        stmt = (
            select(DocumentIndex)
            .where(and_(*filters))
            .order_by(DocumentIndex.doc_updated_at.desc())
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())


workspace_document_service = WorkspaceDocumentService()
