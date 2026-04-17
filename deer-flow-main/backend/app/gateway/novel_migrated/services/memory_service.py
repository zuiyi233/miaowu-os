"""向量记忆服务 - 支持向量检索与降级非向量检索。"""

from __future__ import annotations

import hashlib
import json
import os
from collections import defaultdict
from datetime import datetime
from typing import Any

from app.gateway.novel_migrated.core.logger import get_logger

try:
    import chromadb  # type: ignore
except Exception:  # pragma: no cover - 环境可选依赖
    chromadb = None  # type: ignore

try:
    from sentence_transformers import SentenceTransformer  # type: ignore
except Exception:  # pragma: no cover - 环境可选依赖
    SentenceTransformer = None  # type: ignore

logger = get_logger(__name__)


class MemoryService:
    """记忆管理服务。

    向量模式：
    - `chromadb` + `sentence-transformers` 可用时启用。

    降级模式：
    - 任一依赖不可用时切换为内存存储 + 关键词/覆盖度检索。
    - 保证服务可初始化，不因依赖缺失阻塞启动。
    """

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._vector_enabled = False
        self._fallback_store: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        self.client = None
        self.embedding_model = None

        try:
            self._vector_enabled = self._try_init_vector_stack()
        except Exception as exc:
            self._vector_enabled = False
            logger.warning("⚠️ 向量组件初始化失败，降级为非向量检索: %s", exc)

        if self._vector_enabled:
            logger.info("✅ MemoryService 初始化成功（向量模式）")
        else:
            logger.warning("⚠️ MemoryService 初始化为降级模式（无向量依赖）")

        self._initialized = True

    def _try_init_vector_stack(self) -> bool:
        if chromadb is None or SentenceTransformer is None:
            logger.warning("⚠️ chromadb 或 sentence-transformers 未安装，启用降级检索")
            return False

        # 跳过本地 embedding 模型加载，使用在线模型替代
        logger.info("⚡ 跳过本地 embedding 模型加载，使用在线模型服务")
        logger.warning("⚠️ 记忆服务使用降级模式（关键词检索）")
        return False

    def get_collection(self, user_id: str, project_id: str):
        if not self._vector_enabled or not self.client:
            return None

        user_hash = hashlib.md5(user_id.encode("utf-8")).hexdigest()[:12]
        project_hash = hashlib.md5(project_id.encode("utf-8")).hexdigest()[:12]
        collection_name = f"u_{user_hash}_p_{project_hash}"

        return self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    @staticmethod
    def _fallback_key(user_id: str, project_id: str) -> tuple[str, str]:
        return (user_id or "anonymous", project_id)

    @staticmethod
    def _normalize_text(text: str) -> str:
        return (text or "").strip().lower()

    @staticmethod
    def _tokenize(text: str) -> set[str]:
        normalized = MemoryService._normalize_text(text)
        tokens = [t for t in normalized.replace("\n", " ").split(" ") if t]
        return set(tokens)

    @staticmethod
    def _fallback_score(query: str, content: str, metadata: dict[str, Any]) -> float:
        q_tokens = MemoryService._tokenize(query)
        c_tokens = MemoryService._tokenize(content)
        overlap = len(q_tokens & c_tokens)
        coverage = overlap / max(len(q_tokens), 1)
        importance = float(metadata.get("importance_score", metadata.get("importance", 0.5)) or 0.5)
        return coverage * 0.8 + importance * 0.2

    async def add_memory(
        self,
        user_id: str,
        project_id: str,
        memory_id: str,
        content: str,
        memory_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        metadata = metadata or {}

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None and self.embedding_model is not None:
                    embedding = self.embedding_model.encode(content).tolist()
                    vector_meta = {
                        "memory_type": memory_type,
                        "chapter_id": str(metadata.get("chapter_id", "")),
                        "chapter_number": int(metadata.get("chapter_number", 0) or 0),
                        "importance": float(metadata.get("importance_score", 0.5) or 0.5),
                        "tags": json.dumps(metadata.get("tags", []), ensure_ascii=False),
                        "title": str(metadata.get("title", ""))[:200],
                        "is_foreshadow": int(metadata.get("is_foreshadow", 0) or 0),
                    }
                    collection.add(ids=[memory_id], embeddings=[embedding], documents=[content], metadatas=[vector_meta])
                    return True
            except Exception as exc:
                logger.warning("⚠️ 向量写入失败，回退到内存存储: %s", exc)

        key = self._fallback_key(user_id, project_id)
        self._fallback_store[key].append(
            {
                "id": memory_id,
                "content": content,
                "metadata": {
                    **metadata,
                    "memory_type": memory_type,
                    "importance": float(metadata.get("importance_score", 0.5) or 0.5),
                },
                "created_at": datetime.utcnow().isoformat(),
            }
        )
        return True

    async def batch_add_memories(self, user_id: str, project_id: str, memories: list[dict[str, Any]]) -> int:
        saved = 0
        for mem in memories:
            ok = await self.add_memory(
                user_id=user_id,
                project_id=project_id,
                memory_id=mem["memory_id"],
                content=mem["content"],
                memory_type=mem["memory_type"],
                metadata=mem.get("metadata", {}),
            )
            if ok:
                saved += 1
        return saved

    async def search_memories(
        self,
        user_id: str,
        project_id: str,
        query: str,
        memory_types: list[str] | None = None,
        limit: int = 20,
        min_similarity: float = 0.35,
    ) -> list[dict[str, Any]]:
        memory_types = memory_types or []

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None and self.embedding_model is not None:
                    query_embedding = self.embedding_model.encode(query).tolist()
                    where_clause = None
                    if memory_types:
                        where_clause = {"memory_type": {"$in": memory_types}}

                    results = collection.query(
                        query_embeddings=[query_embedding],
                        n_results=limit,
                        where=where_clause,
                    )

                    docs = (results.get("documents") or [[]])[0]
                    metas = (results.get("metadatas") or [[]])[0]
                    ids = (results.get("ids") or [[]])[0]
                    distances = (results.get("distances") or [[]])[0]

                    output: list[dict[str, Any]] = []
                    for idx, doc in enumerate(docs):
                        distance = float(distances[idx]) if idx < len(distances) else 1.0
                        similarity = max(0.0, 1.0 - distance)
                        if similarity < min_similarity:
                            continue
                        output.append(
                            {
                                "id": ids[idx] if idx < len(ids) else "",
                                "content": doc,
                                "metadata": metas[idx] if idx < len(metas) else {},
                                "similarity": similarity,
                            }
                        )
                    return output
            except Exception as exc:
                logger.warning("⚠️ 向量检索失败，回退到非向量检索: %s", exc)

        key = self._fallback_key(user_id, project_id)
        candidates = self._fallback_store.get(key, [])
        if memory_types:
            candidates = [m for m in candidates if m.get("metadata", {}).get("memory_type") in memory_types]

        scored = []
        for mem in candidates:
            score = self._fallback_score(query, mem.get("content", ""), mem.get("metadata", {}))
            if score >= min_similarity:
                scored.append((score, mem))

        scored.sort(key=lambda item: item[0], reverse=True)
        output = []
        for score, mem in scored[:limit]:
            output.append(
                {
                    "id": mem.get("id", ""),
                    "content": mem.get("content", ""),
                    "metadata": mem.get("metadata", {}),
                    "similarity": score,
                }
            )
        return output

    async def get_recent_memories(
        self,
        user_id: str,
        project_id: str,
        limit: int = 20,
        memory_types: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        memory_types = memory_types or []

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    where_clause = {"memory_type": {"$in": memory_types}} if memory_types else None
                    results = collection.get(where=where_clause)
                    docs = results.get("documents") or []
                    metas = results.get("metadatas") or []
                    ids = results.get("ids") or []

                    merged = [
                        {
                            "id": ids[idx] if idx < len(ids) else "",
                            "content": docs[idx],
                            "metadata": metas[idx] if idx < len(metas) else {},
                        }
                        for idx in range(len(docs))
                    ]
                    merged.sort(
                        key=lambda item: (
                            float(item["metadata"].get("importance", 0.0)),
                            int(item["metadata"].get("chapter_number", 0) or 0),
                        ),
                        reverse=True,
                    )
                    return merged[:limit]
            except Exception as exc:
                logger.warning("⚠️ 读取最近记忆失败，回退到降级模式: %s", exc)

        key = self._fallback_key(user_id, project_id)
        items = list(self._fallback_store.get(key, []))
        if memory_types:
            items = [m for m in items if m.get("metadata", {}).get("memory_type") in memory_types]

        items.sort(
            key=lambda m: (
                float(m.get("metadata", {}).get("importance", 0.0)),
                m.get("created_at", ""),
            ),
            reverse=True,
        )
        return items[:limit]

    async def find_unresolved_foreshadows(
        self,
        user_id: str,
        project_id: str,
        current_chapter: int | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        memories = await self.get_recent_memories(
            user_id=user_id,
            project_id=project_id,
            limit=200,
            memory_types=["foreshadow"],
        )

        unresolved: list[dict[str, Any]] = []
        for mem in memories:
            metadata = mem.get("metadata", {})
            is_foreshadow = int(metadata.get("is_foreshadow", 0) or 0)
            chapter_number = int(metadata.get("chapter_number", 0) or 0)

            if is_foreshadow != 1:
                continue
            if current_chapter is not None and chapter_number > current_chapter:
                continue
            unresolved.append(mem)

        unresolved.sort(key=lambda m: float(m.get("metadata", {}).get("importance", 0.0)), reverse=True)
        return unresolved[:limit]

    async def build_context_for_generation(
        self,
        user_id: str,
        project_id: str,
        current_chapter: int,
        query: str,
        max_memories: int = 20,
    ) -> str:
        related = await self.search_memories(
            user_id=user_id,
            project_id=project_id,
            query=query,
            limit=max_memories // 2,
            min_similarity=0.25,
        )
        foreshadows = await self.find_unresolved_foreshadows(
            user_id=user_id,
            project_id=project_id,
            current_chapter=current_chapter,
            limit=max_memories // 2,
        )

        sections = []
        if related:
            sections.append(self._format_memories(related, "语义相关记忆"))
        if foreshadows:
            sections.append(self._format_memories(foreshadows, "未回收伏笔"))
        return "\n\n".join(sections)

    def _format_memories(self, memories: list[dict[str, Any]], section_title: str = "记忆") -> str:
        lines = [f"【{section_title}】"]
        for idx, mem in enumerate(memories, 1):
            metadata = mem.get("metadata", {})
            title = metadata.get("title") or ""
            chapter_num = metadata.get("chapter_number", "?")
            content = mem.get("content", "")
            if title:
                lines.append(f"{idx}. 第{chapter_num}章《{title}》: {content}")
            else:
                lines.append(f"{idx}. 第{chapter_num}章: {content}")
        return "\n".join(lines)

    async def delete_foreshadow_memories(self, user_id: str, project_id: str, foreshadow_keywords: list[str]) -> int:
        if not foreshadow_keywords:
            return 0

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    results = collection.get(where={"memory_type": "foreshadow"})
                    ids = results.get("ids") or []
                    docs = results.get("documents") or []
                    metas = results.get("metadatas") or []

                    to_delete = []
                    keywords = [k.strip().lower() for k in foreshadow_keywords if k and k.strip()]
                    for idx, doc in enumerate(docs):
                        meta = metas[idx] if idx < len(metas) else {}
                        title = str(meta.get("title", "")).lower()
                        content = str(doc or "").lower()
                        if any(k in title or k in content for k in keywords):
                            to_delete.append(ids[idx])

                    if to_delete:
                        collection.delete(ids=to_delete)
                    return len(to_delete)
            except Exception as exc:
                logger.warning("⚠️ 删除向量伏笔记忆失败，回退到降级存储删除: %s", exc)

        key = self._fallback_key(user_id, project_id)
        before = len(self._fallback_store.get(key, []))
        keywords = [k.strip().lower() for k in foreshadow_keywords if k and k.strip()]

        kept = []
        for mem in self._fallback_store.get(key, []):
            metadata = mem.get("metadata", {})
            if metadata.get("memory_type") != "foreshadow":
                kept.append(mem)
                continue
            title = str(metadata.get("title", "")).lower()
            content = str(mem.get("content", "")).lower()
            if any(k in title or k in content for k in keywords):
                continue
            kept.append(mem)

        self._fallback_store[key] = kept
        return before - len(kept)

    async def delete_chapter_memories(self, user_id: str, project_id: str, chapter_id: str) -> int:
        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    results = collection.get(where={"chapter_id": str(chapter_id)})
                    ids = results.get("ids") or []
                    if ids:
                        collection.delete(ids=ids)
                    return len(ids)
            except Exception as exc:
                logger.warning("⚠️ 删除章节向量记忆失败，回退到降级存储删除: %s", exc)

        key = self._fallback_key(user_id, project_id)
        before = len(self._fallback_store.get(key, []))
        self._fallback_store[key] = [
            m for m in self._fallback_store.get(key, []) if str(m.get("metadata", {}).get("chapter_id", "")) != str(chapter_id)
        ]
        return before - len(self._fallback_store[key])

    async def delete_project_memories(self, user_id: str, project_id: str) -> bool:
        if self._vector_enabled and self.client is not None:
            try:
                user_hash = hashlib.md5(user_id.encode("utf-8")).hexdigest()[:12]
                project_hash = hashlib.md5(project_id.encode("utf-8")).hexdigest()[:12]
                collection_name = f"u_{user_hash}_p_{project_hash}"
                self.client.delete_collection(name=collection_name)
                return True
            except Exception as exc:
                if "does not exist" not in str(exc).lower():
                    logger.warning("⚠️ 删除向量 collection 失败: %s", exc)

        key = self._fallback_key(user_id, project_id)
        self._fallback_store.pop(key, None)
        return True

    async def update_memory(
        self,
        user_id: str,
        project_id: str,
        memory_id: str,
        content: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> bool:
        metadata = metadata or {}

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    update_data: dict[str, Any] = {"ids": [memory_id]}
                    if content is not None:
                        update_data["documents"] = [content]
                        if self.embedding_model is not None:
                            update_data["embeddings"] = [self.embedding_model.encode(content).tolist()]
                    if metadata:
                        update_data["metadatas"] = [
                            {
                                "memory_type": metadata.get("memory_type", "unknown"),
                                "chapter_id": str(metadata.get("chapter_id", "")),
                                "chapter_number": int(metadata.get("chapter_number", 0) or 0),
                                "importance": float(metadata.get("importance_score", 0.5) or 0.5),
                                "tags": json.dumps(metadata.get("tags", []), ensure_ascii=False),
                                "title": str(metadata.get("title", ""))[:200],
                                "is_foreshadow": int(metadata.get("is_foreshadow", 0) or 0),
                            }
                        ]
                    collection.update(**update_data)
                    return True
            except Exception as exc:
                logger.warning("⚠️ 更新向量记忆失败，回退到降级存储更新: %s", exc)

        key = self._fallback_key(user_id, project_id)
        for item in self._fallback_store.get(key, []):
            if item.get("id") != memory_id:
                continue
            if content is not None:
                item["content"] = content
            if metadata:
                item["metadata"].update(metadata)
            return True
        return False

    async def get_memory_stats(self, user_id: str, project_id: str) -> dict[str, Any]:
        memories: list[dict[str, Any]] = []

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    all_memories = collection.get()
                    docs = all_memories.get("documents") or []
                    metas = all_memories.get("metadatas") or []
                    ids = all_memories.get("ids") or []
                    memories = [
                        {
                            "id": ids[idx] if idx < len(ids) else "",
                            "content": docs[idx],
                            "metadata": metas[idx] if idx < len(metas) else {},
                        }
                        for idx in range(len(docs))
                    ]
            except Exception as exc:
                logger.warning("⚠️ 读取向量统计失败，回退到降级统计: %s", exc)

        if not memories:
            key = self._fallback_key(user_id, project_id)
            memories = list(self._fallback_store.get(key, []))

        type_counts: dict[str, int] = {}
        chapter_counts: dict[str, int] = {}
        foreshadow_resolved = 0

        for mem in memories:
            meta = mem.get("metadata", {})
            mem_type = str(meta.get("memory_type", "unknown"))
            chapter_num = str(meta.get("chapter_number", 0))
            is_foreshadow = int(meta.get("is_foreshadow", 0) or 0)

            type_counts[mem_type] = type_counts.get(mem_type, 0) + 1
            chapter_counts[chapter_num] = chapter_counts.get(chapter_num, 0) + 1
            if is_foreshadow == 2:
                foreshadow_resolved += 1

        return {
            "total_memories": len(memories),
            "type_counts": type_counts,
            "chapter_counts": chapter_counts,
            "foreshadow_total": type_counts.get("foreshadow", 0),
            "foreshadow_resolved": foreshadow_resolved,
        }


memory_service = MemoryService()
