"""向量记忆服务 - 支持向量检索与降级非向量检索。"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.core.crypto import safe_decrypt
from app.gateway.novel_migrated.core.database import AsyncSessionLocal
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.document_index import DocumentIndex
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.workspace_document_service import workspace_document_service

try:
    import chromadb  # type: ignore
except Exception:  # pragma: no cover - 环境可选依赖
    chromadb = None  # type: ignore

try:
    from sentence_transformers import SentenceTransformer  # type: ignore
except Exception:  # pragma: no cover - 环境可选依赖
    SentenceTransformer = None  # type: ignore

logger = get_logger(__name__)

# 配置常量
_FALLBACK_STORE_MAX_CAPACITY = int(os.getenv("NOVEL_MIGRATED_FALLBACK_MAX_CAPACITY", "10000"))
_HTTP_CLIENT_TIMEOUT = float(os.getenv("NOVEL_MIGRATED_HTTP_TIMEOUT", "30.0"))
_RAG_CONTENT_MAX_CHARS = int(os.getenv("NOVEL_MIGRATED_RAG_CONTENT_MAX_CHARS", "12000"))

_RAG_SUPPORTED_ENTITY_TYPES = {
    "book",
    "chapter",
    "outline",
    "character",
    "relationship",
    "organization",
    "foreshadow",
    "career",
    "memory",
    "analysis",
    "note",
}

_MEMORY_TYPE_BY_ENTITY = {
    "book": "project",
    "chapter": "chapter_content",
    "outline": "outline",
    "character": "character_profile",
    "relationship": "relationship",
    "organization": "organization_profile",
    "foreshadow": "foreshadow",
    "career": "career_system",
    "memory": "memory",
    "analysis": "analysis",
    "note": "note",
}


class MemoryService:
    """记忆管理服务。

    向量模式：
    - `chromadb` + `sentence-transformers` 可用时启用。

    降级模式：
    - 任一依赖不可用时切换为内存存储 + 关键词/覆盖度检索。
    - 保证服务可初始化，不因依赖缺失阻塞启动。

    性能优化（P2）：
    - 复用长生命周期 AsyncClient（避免每次创建）
    - 降级存储使用容量上限策略
    - 降级检索使用索引加速（避免全量 O(n)）
    """

    _instance = None
    _initialized = False
    _http_client: httpx.AsyncClient | None = None  # 复用的 HTTP 客户端

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self._vector_enabled = False
        self._fallback_store: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.client = None
        self.embedding_model = None
        self._local_embedding_failed = False
        self._local_embedding_model_name = os.getenv(
            "NOVEL_MIGRATED_LOCAL_EMBEDDING_MODEL",
            "paraphrase-multilingual-MiniLM-L12-v2",
        )
        self._cloud_embedding_model = os.getenv(
            "NOVEL_MIGRATED_EMBEDDING_MODEL",
            "text-embedding-3-small",
        )
        self._cloud_config_cache_ttl = 120
        self._cloud_config_cache: dict[str, tuple[float, dict[str, str] | None]] = {}
        self._fallback_total_count = 0  # 跟踪总条目数（用于容量控制）

        try:
            self._vector_enabled = self._try_init_vector_stack()
        except Exception as exc:
            self._vector_enabled = False
            logger.warning("⚠️ 向量组件初始化失败，降级为非向量检索: %s", exc)

        # 初始化复用的 HTTP 客户端
        if MemoryService._http_client is None:
            try:
                MemoryService._http_client = httpx.AsyncClient(timeout=_HTTP_CLIENT_TIMEOUT)
                logger.info("✅ HTTP 客户端初始化成功（复用模式）")
            except Exception as e:
                logger.warning("⚠️ HTTP 客户端初始化失败: %s", e)

        if self._vector_enabled:
            logger.info("✅ MemoryService 初始化成功（向量模式）")
        else:
            logger.warning("⚠️ MemoryService 初始化为降级模式（无向量依赖），容量上限: %d", _FALLBACK_STORE_MAX_CAPACITY)

        self._initialized = True

    @classmethod
    async def close_http_client(cls):
        """关闭 HTTP 客户端（应用关闭时调用）"""
        if cls._http_client is not None:
            await cls._http_client.aclose()
            cls._http_client = None

    def _try_init_vector_stack(self) -> bool:
        if chromadb is None:
            logger.warning("⚠️ chromadb 未安装，使用内存语义检索/关键词降级模式")
            return False

        try:
            vector_dir = os.getenv("NOVEL_MIGRATED_VECTOR_DB_DIR")
            if not vector_dir:
                backend_root = os.path.abspath(
                    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
                )
                vector_dir = os.path.join(backend_root, ".deer-flow", "novel-migrated-chroma")
            os.makedirs(vector_dir, exist_ok=True)
            self.client = chromadb.PersistentClient(path=vector_dir)
        except Exception as exc:
            self.client = None
            logger.warning("⚠️ 向量数据库初始化失败，降级为非向量检索: %s", exc)
            return False

        if SentenceTransformer is None:
            logger.warning("⚠️ sentence-transformers 未安装，将优先使用云 Embedding（可回退关键词）")
        else:
            logger.info("✅ 本地 Embedding 可用：%s", self._local_embedding_model_name)
        return True

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
    def _build_document_vector_id(project_id: str, entity_type: str, entity_id: str) -> str:
        digest = hashlib.sha256(f"{project_id}:{entity_type}:{entity_id}".encode()).hexdigest()
        return f"doc-{digest[:40]}"

    @staticmethod
    def _normalize_document_for_rag(content: str, *, max_chars: int = _RAG_CONTENT_MAX_CHARS) -> str:
        normalized = (content or "").replace("\r\n", "\n").strip()
        if len(normalized) <= max_chars:
            return normalized
        return normalized[:max_chars]

    @staticmethod
    def _extract_chapter_number(entity_id: str) -> int:
        raw = (entity_id or "").strip()
        digits = "".join(ch for ch in raw if ch.isdigit())
        if not digits:
            return 0
        try:
            return int(digits)
        except ValueError:
            return 0

    def _build_document_metadata(self, doc: DocumentIndex) -> dict[str, Any]:
        entity_type = (doc.entity_type or "").strip().lower()
        memory_type = _MEMORY_TYPE_BY_ENTITY.get(entity_type, "document")
        chapter_number = self._extract_chapter_number(doc.entity_id) if entity_type == "chapter" else 0
        return {
            "memory_type": memory_type,
            "chapter_id": str(doc.entity_id if entity_type == "chapter" else ""),
            "chapter_number": chapter_number,
            "importance": 0.6 if entity_type == "chapter" else 0.5,
            "importance_score": 0.6 if entity_type == "chapter" else 0.5,
            "title": (doc.title or "").strip()[:200],
            "tags": [],
            "is_foreshadow": 1 if entity_type == "foreshadow" else 0,
            "entity_type": entity_type,
            "entity_id": doc.entity_id,
            "doc_path": doc.doc_path,
        }

    async def _upsert_document_memory_fallback(
        self,
        *,
        user_id: str,
        project_id: str,
        memory_id: str,
        content: str,
        metadata: dict[str, Any],
        embedding: list[float] | None,
    ) -> None:
        key = self._fallback_key(user_id, project_id)
        items = self._fallback_store.setdefault(key, [])
        created_at = datetime.now(tz=UTC).isoformat()

        replaced = False
        for item in items:
            if item.get("id") != memory_id:
                continue
            item["content"] = content
            item["metadata"] = metadata
            item["embedding"] = embedding
            item["created_at"] = created_at
            replaced = True
            break

        if replaced:
            return

        if self._fallback_total_count >= _FALLBACK_STORE_MAX_CAPACITY:
            if items:
                # 本项目内优先淘汰最旧条目
                items.pop(0)
                self._fallback_total_count -= 1
            else:
                oldest_scope = next(iter(self._fallback_store), None)
                if oldest_scope and self._fallback_store.get(oldest_scope):
                    dropped = self._fallback_store.pop(oldest_scope, [])
                    self._fallback_total_count -= len(dropped)

        items.append(
            {
                "id": memory_id,
                "content": content,
                "metadata": metadata,
                "embedding": embedding,
                "created_at": created_at,
            }
        )
        self._fallback_total_count += 1

    async def sync_workspace_documents_incremental(
        self,
        *,
        user_id: str,
        project_id: str,
        db: AsyncSession,
        limit: int | None = None,
        force: bool = False,
    ) -> dict[str, int]:
        """从工作区文档增量同步到向量记忆索引。

        - 数据源：workspace files + document_indexes（不读取正文 DB 字段）
        - 增量：仅处理 `status != indexed` 的文档（或 force=True）
        - 命名空间隔离：collection 已按 user_id/project_id 哈希隔离
        """
        scope_user = (user_id or "").strip() or "local_single_user"
        scope_project = (project_id or "").strip()
        if not scope_project:
            return {"total": 0, "indexed": 0, "skipped": 0, "failed": 0}

        query = (
            select(DocumentIndex)
            .where(
                DocumentIndex.user_id == scope_user,
                DocumentIndex.project_id == scope_project,
                DocumentIndex.entity_type.in_(sorted(_RAG_SUPPORTED_ENTITY_TYPES)),
            )
            .order_by(DocumentIndex.doc_updated_at.desc())
        )
        result = await db.execute(query)
        docs = list(result.scalars().all())
        if limit is not None and limit > 0:
            docs = docs[:limit]

        stats = {"total": len(docs), "indexed": 0, "skipped": 0, "failed": 0}
        collection = self.get_collection(scope_user, scope_project) if self._vector_enabled else None

        for doc in docs:
            if not force and (doc.status or "").lower() == "indexed":
                stats["skipped"] += 1
                continue

            try:
                payload = await workspace_document_service.read_document(
                    user_id=scope_user,
                    project_id=scope_project,
                    entity_type=doc.entity_type,
                    entity_id=doc.entity_id,
                )
                raw_content = str(payload.get("content", ""))
                normalized_content = self._normalize_document_for_rag(raw_content)
                if not normalized_content:
                    doc.status = "indexed"
                    doc.indexed_at = datetime.now(tz=UTC)
                    stats["skipped"] += 1
                    continue

                metadata = self._build_document_metadata(doc)
                memory_id = self._build_document_vector_id(scope_project, doc.entity_type, doc.entity_id)
                vectors = await self._embed_texts(scope_user, [normalized_content])
                embedding = vectors[0] if vectors and vectors[0] else None

                if collection is not None and embedding is not None:
                    try:
                        collection.upsert(
                            ids=[memory_id],
                            embeddings=[embedding],
                            documents=[normalized_content],
                            metadatas=[metadata],
                        )
                    except AttributeError:
                        # 兼容旧版 Chroma API（无 upsert）
                        collection.delete(ids=[memory_id])
                        collection.add(
                            ids=[memory_id],
                            embeddings=[embedding],
                            documents=[normalized_content],
                            metadatas=[metadata],
                        )
                else:
                    await self._upsert_document_memory_fallback(
                        user_id=scope_user,
                        project_id=scope_project,
                        memory_id=memory_id,
                        content=normalized_content,
                        metadata=metadata,
                        embedding=embedding,
                    )

                doc.status = "indexed"
                doc.indexed_at = datetime.now(tz=UTC)
                stats["indexed"] += 1
            except FileNotFoundError:
                doc.status = "missing_file"
                doc.indexed_at = datetime.now(tz=UTC)
                stats["failed"] += 1
            except Exception as exc:
                logger.warning("⚠️ 文档增量索引失败: project=%s doc=%s/%s error=%s", scope_project, doc.entity_type, doc.entity_id, exc)
                doc.status = "error"
                doc.indexed_at = datetime.now(tz=UTC)
                stats["failed"] += 1

        return stats

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

    @staticmethod
    def _normalize_base_url(base_url: str | None) -> str:
        normalized = (base_url or "").strip() or "https://api.openai.com/v1"
        normalized = normalized.rstrip("/")
        if not normalized.endswith("/v1"):
            normalized = f"{normalized}/v1"
        return normalized

    @staticmethod
    def _safe_embedding(embedding: Any) -> list[float] | None:
        if not isinstance(embedding, list) or not embedding:
            return None
        try:
            return [float(v) for v in embedding]
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
        if not vec_a or not vec_b:
            return 0.0

        size = min(len(vec_a), len(vec_b))
        if size == 0:
            return 0.0

        dot = sum(vec_a[idx] * vec_b[idx] for idx in range(size))
        norm_a = math.sqrt(sum(vec_a[idx] * vec_a[idx] for idx in range(size)))
        norm_b = math.sqrt(sum(vec_b[idx] * vec_b[idx] for idx in range(size)))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return max(0.0, min(1.0, dot / (norm_a * norm_b)))

    def _resolve_embedding_model_name(self, settings: Settings) -> str:
        raw_preferences = settings.preferences
        if raw_preferences:
            try:
                parsed_preferences = json.loads(raw_preferences)
            except Exception:
                parsed_preferences = {}
            if isinstance(parsed_preferences, dict):
                for key in ("embedding_model", "embeddings_model", "embeddingModel"):
                    value = parsed_preferences.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()

        llm_model = (settings.llm_model or "").strip()
        if llm_model and "embedding" in llm_model.lower():
            return llm_model

        return self._cloud_embedding_model

    async def _load_cloud_embedding_config(self, user_id: str) -> dict[str, str] | None:
        now = time.time()
        cached = self._cloud_config_cache.get(user_id)
        if cached and now - cached[0] < self._cloud_config_cache_ttl:
            return cached[1]

        config: dict[str, str] | None = None
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Settings).where(Settings.user_id == user_id))
                settings = result.scalar_one_or_none()
            if settings and settings.api_key:
                base_url = self._normalize_base_url(settings.api_base_url)
                config = {
                    "api_key": safe_decrypt(settings.api_key) or "",
                    "base_url": base_url,
                    "model": self._resolve_embedding_model_name(settings),
                }
        except Exception as exc:
            logger.warning("⚠️ 读取云 Embedding 配置失败: %s", exc)

        self._cloud_config_cache[user_id] = (now, config)
        return config

    def _embed_with_local_model(self, texts: list[str]) -> list[list[float]] | None:
        if not texts or SentenceTransformer is None:
            return None
        if self._local_embedding_failed:
            return None

        if self.embedding_model is None:
            try:
                self.embedding_model = SentenceTransformer(self._local_embedding_model_name)
            except Exception as exc:
                self._local_embedding_failed = True
                logger.warning("⚠️ 本地 Embedding 模型加载失败，将切换云 Embedding: %s", exc)
                return None

        try:
            vectors = self.embedding_model.encode(texts)
            if hasattr(vectors, "tolist"):
                vectors = vectors.tolist()
            if isinstance(vectors, list) and vectors and isinstance(vectors[0], (int, float)):
                vectors = [vectors]
            if not isinstance(vectors, list):
                return None
            normalized_vectors: list[list[float]] = []
            for vector in vectors:
                normalized = self._safe_embedding(vector)
                if normalized is None:
                    return None
                normalized_vectors.append(normalized)
            return normalized_vectors
        except Exception as exc:
            logger.warning("⚠️ 本地 Embedding 计算失败，将尝试云 Embedding: %s", exc)
            return None

    async def _embed_with_cloud_provider(self, user_id: str, texts: list[str]) -> list[list[float]] | None:
        if not texts:
            return None

        config = await self._load_cloud_embedding_config(user_id)
        if not config:
            return None

        url = f"{config['base_url']}/embeddings"
        headers = {
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": config["model"],
            "input": texts,
        }

        try:
            # 使用复用的 HTTP 客户端（避免每次创建新实例）
            client = MemoryService._http_client or httpx.AsyncClient(timeout=_HTTP_CLIENT_TIMEOUT)
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code >= 400:
                logger.warning("⚠️ 云 Embedding 请求失败: %s %s", response.status_code, response.text[:200])
                return None
            data = response.json().get("data")
            if not isinstance(data, list):
                return None
            sorted_items = sorted(
                (item for item in data if isinstance(item, dict)),
                key=lambda item: int(item.get("index", 0)),
            )
            vectors: list[list[float]] = []
            for item in sorted_items:
                normalized = self._safe_embedding(item.get("embedding"))
                if normalized is None:
                    return None
                vectors.append(normalized)
            if len(vectors) != len(texts):
                logger.warning("⚠️ 云 Embedding 返回数量不匹配: expected=%s actual=%s", len(texts), len(vectors))
                return None
            return vectors
        except Exception as exc:
            logger.warning("⚠️ 云 Embedding 请求异常: %s", exc)
            return None

    async def _embed_texts(self, user_id: str, texts: list[str]) -> list[list[float]] | None:
        local_vectors = self._embed_with_local_model(texts)
        if local_vectors is not None:
            return local_vectors

        cloud_vectors = await self._embed_with_cloud_provider(user_id, texts)
        if cloud_vectors is not None:
            return cloud_vectors

        return None

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
        semantic_embedding: list[float] | None = None
        embeddings = await self._embed_texts(user_id, [content])
        if embeddings and embeddings[0]:
            semantic_embedding = embeddings[0]

        if self._vector_enabled and semantic_embedding is not None:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    vector_meta = {
                        "memory_type": memory_type,
                        "chapter_id": str(metadata.get("chapter_id", "")),
                        "chapter_number": int(metadata.get("chapter_number", 0) or 0),
                        "importance": float(metadata.get("importance_score", 0.5) or 0.5),
                        "tags": json.dumps(metadata.get("tags", []), ensure_ascii=False),
                        "title": str(metadata.get("title", ""))[:200],
                        "is_foreshadow": int(metadata.get("is_foreshadow", 0) or 0),
                    }
                    collection.add(
                        ids=[memory_id],
                        embeddings=[semantic_embedding],
                        documents=[content],
                        metadatas=[vector_meta],
                    )
                    return True
            except Exception as exc:
                logger.warning("⚠️ 向量写入失败，回退到内存存储: %s", exc)

        key = self._fallback_key(user_id, project_id)

        # 容量控制：如果总条目数超过上限，移除最旧的条目
        if self._fallback_total_count >= _FALLBACK_STORE_MAX_CAPACITY:
            oldest_user_project = next(iter(self._fallback_store), None)
            if oldest_user_project and oldest_user_project != key:
                removed_count = len(self._fallback_store.get(oldest_user_project, []))
                del self._fallback_store[oldest_user_project]
                self._fallback_total_count -= removed_count
                logger.debug("🗑️ 容量淘汰: 移除 %s 条旧记忆（用户项目: %s）", removed_count, oldest_user_project)

        if key not in self._fallback_store:
            self._fallback_store[key] = []

        self._fallback_store[key].append(
            {
                "id": memory_id,
                "content": content,
                "metadata": {
                    **metadata,
                    "memory_type": memory_type,
                    "importance": float(metadata.get("importance_score", 0.5) or 0.5),
                },
                "embedding": semantic_embedding,
                "created_at": datetime.utcnow().isoformat(),
            }
        )
        self._fallback_total_count += 1
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
        similarity_threshold = float(min_similarity)
        query_embedding = None
        query_vectors = await self._embed_texts(user_id, [query])
        if query_vectors and query_vectors[0]:
            query_embedding = query_vectors[0]

        if self._vector_enabled and query_embedding is not None:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
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
                        if similarity < similarity_threshold:
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

        scored: list[tuple[float, dict[str, Any]]] = []
        for mem in candidates:
            memory_embedding = self._safe_embedding(mem.get("embedding"))
            if query_embedding is not None and memory_embedding is not None:
                importance = float(mem.get("metadata", {}).get("importance", 0.5) or 0.5)
                score = self._cosine_similarity(query_embedding, memory_embedding) * 0.85 + importance * 0.15
            else:
                score = self._fallback_score(query, mem.get("content", ""), mem.get("metadata", {}))

            if score >= similarity_threshold:
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
        updated_embedding: list[float] | None = None
        if content is not None:
            vectors = await self._embed_texts(user_id, [content])
            if vectors and vectors[0]:
                updated_embedding = vectors[0]

        if self._vector_enabled:
            try:
                collection = self.get_collection(user_id, project_id)
                if collection is not None:
                    update_data: dict[str, Any] = {"ids": [memory_id]}
                    if content is not None:
                        update_data["documents"] = [content]
                        if updated_embedding is not None:
                            update_data["embeddings"] = [updated_embedding]
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
            if updated_embedding is not None:
                item["embedding"] = updated_embedding
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
