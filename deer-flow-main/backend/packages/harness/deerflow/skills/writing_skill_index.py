"""Runtime index cache for the writing-skill unified layer.

Loads the pre-built ``writing_skill_index.json`` once (lazy, on first
access) and keeps it in process memory.  All look-ups are dict-based and
avoid any disk scanning of individual skill files.

Enhanced features (v2):
- Vector search via ChromaDB + cloud/local embedding (reuses MemoryService pattern)
- Per-thread invoke frequency control (reuses TimedOrderedCache)
- Incremental index refresh via version_hash + mtime dual invalidation
- Quality-score-aware ranking (reuses PlotAnalysis four-dimension model)
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.gateway.novel_migrated.core.crypto import safe_decrypt
from app.gateway.novel_migrated.core.database import AsyncSessionLocal
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.reranker_service import RerankConfig, RerankerService

logger = logging.getLogger(__name__)

_FALLBACK_DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "data"
_INDEX_FILENAME = "writing_skill_index.json"
_SKILLS_SUBDIR = "writing-skills"

_VECTOR_COLLECTION_NAME = "writing_skills_index"
_VECTOR_MIN_SIMILARITY = 0.30
_MAX_INVOKE_PER_TURN = 3
_INVOKE_TTL_SECONDS = 600.0


def _resolve_data_dir() -> Path:
    env_dir = os.environ.get("WRITING_SKILL_DATA_DIR")
    if env_dir:
        p = Path(env_dir)
        if p.is_dir():
            return p
        logger.warning("WRITING_SKILL_DATA_DIR=%s is not a valid directory, using fallback", env_dir)
    return _FALLBACK_DATA_DIR


def _normalize_openai_base_url(base_url: str | None) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    return normalized or "https://api.openai.com/v1"


def _load_settings_preferences(settings: Settings) -> dict[str, Any]:
    raw_preferences = settings.preferences
    if not raw_preferences:
        return {}
    try:
        parsed = json.loads(raw_preferences)
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read_preference_string(preferences: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = preferences.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


async def load_writing_skill_user_config(user_id: str | None) -> WritingSkillUserConfig:
    if not user_id:
        return WritingSkillUserConfig()

    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Settings).where(Settings.user_id == user_id))
            settings = result.scalar_one_or_none()
    except Exception as exc:
        logger.warning("Writing skill user config load failed for %s: %s", user_id, exc)
        return WritingSkillUserConfig()

    if not settings or not settings.api_key:
        return WritingSkillUserConfig()

    api_key = safe_decrypt(settings.api_key) or settings.api_key or ""
    if not api_key:
        return WritingSkillUserConfig()

    preferences = _load_settings_preferences(settings)
    base_url = _normalize_openai_base_url(settings.api_base_url)

    # Writing-skill retrieval defaults to the server-side shared public index
    # configuration. User preferences here are treated as explicit advanced
    # overrides only, and must not inherit the user's private memory settings.
    embedding_model = _read_preference_string(
        preferences,
        ("writing_skill_embedding_model", "writingSkillEmbeddingModel"),
    )
    rerank_model = _read_preference_string(
        preferences,
        ("writing_skill_rerank_model", "writingSkillRerankModel"),
    )

    return WritingSkillUserConfig(
        embedding=_UserModelConfig(
            api_key=api_key,
            base_url=base_url,
            model=embedding_model,
        ) if embedding_model else None,
        rerank=_UserModelConfig(
            api_key=api_key,
            base_url=base_url,
            model=rerank_model,
        ) if rerank_model else None,
    )


@dataclass(frozen=True, slots=True)
class WritingSkillEntry:
    slug: str
    name: str
    description: str
    category: str
    tags: tuple[str, ...]
    keywords: tuple[str, ...]
    routing_hints: str
    source: str
    version_hash: str
    content_path: str
    quality_score: float = 0.0


@dataclass
class _SearchHit:
    entry: WritingSkillEntry
    keyword_score: float = 0.0
    vector_score: float = 0.0
    quality_bonus: float = 0.0

    @property
    def combined_score(self) -> float:
        return self.keyword_score * 0.55 + self.vector_score * 0.30 + self.quality_bonus * 0.15


@dataclass(frozen=True, slots=True)
class _UserModelConfig:
    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True, slots=True)
class WritingSkillUserConfig:
    embedding: _UserModelConfig | None = None
    rerank: _UserModelConfig | None = None


class _InvokeRateLimiter:
    """Per-thread invoke frequency control, reusing TimedOrderedCache pattern."""

    def __init__(self, max_per_turn: int = _MAX_INVOKE_PER_TURN, ttl: float = _INVOKE_TTL_SECONDS) -> None:
        self._max = max_per_turn
        self._ttl = ttl
        self._counts: dict[str, tuple[int, float]] = {}

    def check_and_increment(self, thread_id: str) -> bool:
        now = time.monotonic()
        count, ts = self._counts.get(thread_id, (0, 0.0))
        if now - ts > self._ttl:
            count = 0
        if count >= self._max:
            return False
        self._counts[thread_id] = (count + 1, now)
        self._evict()
        return True

    def remaining(self, thread_id: str) -> int:
        now = time.monotonic()
        count, ts = self._counts.get(thread_id, (0, 0.0))
        if now - ts > self._ttl:
            return self._max
        return max(0, self._max - count)

    def _evict(self) -> None:
        if len(self._counts) < 1000:
            return
        now = time.monotonic()
        expired = [k for k, (_, ts) in self._counts.items() if now - ts > self._ttl]
        for k in expired:
            del self._counts[k]


class _VectorSearchBackend:
    """ChromaDB + cloud/local embedding for semantic skill search.

    Follows the same three-tier pattern as MemoryService:
    1. Cloud embedding (OpenAI-compatible) -> ChromaDB query
    2. Local sentence-transformers fallback
    3. Keyword-only degradation
    """

    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._client: Any = None
        self._collections: dict[str, Any] = {}
        self._embedding_model: Any = None
        self._initialized = False
        self._init_attempted = False
        self._local_model_failed = False
        self._allow_local = os.getenv("WRITING_SKILL_ALLOW_LOCAL_EMBEDDING", "0") == "1"
        self._local_model_name = os.getenv(
            "WRITING_SKILL_LOCAL_EMBEDDING_MODEL",
            "paraphrase-multilingual-MiniLM-L12-v2",
        )
        self._cloud_config: dict[str, str] | None = None
        self._embedding_cache: dict[str, list[float]] = {}

    @staticmethod
    def _collection_suffix(cloud_config: _UserModelConfig | None) -> str:
        if cloud_config and cloud_config.model:
            raw = cloud_config.model.strip().lower()
        else:
            raw = os.getenv("WRITING_SKILL_EMBEDDING_MODEL", "text-embedding-3-small").strip().lower()
        safe = re.sub(r"[^a-z0-9]+", "_", raw).strip("_")
        return safe or "default"

    def _collection_name(self, cloud_config: _UserModelConfig | None) -> str:
        return f"{_VECTOR_COLLECTION_NAME}__{self._collection_suffix(cloud_config)}"

    def _try_init(self) -> bool:
        if self._init_attempted:
            return self._initialized
        self._init_attempted = True

        try:
            import chromadb
        except ImportError:
            logger.info("chromadb not installed, vector search unavailable for writing skills")
            return False

        try:
            vector_dir = os.getenv("WRITING_SKILL_VECTOR_DB_DIR")
            if not vector_dir:
                vector_dir = str(self._data_dir / "writing-skill-chroma")
            os.makedirs(vector_dir, exist_ok=True)
            self._client = chromadb.PersistentClient(path=vector_dir)
        except Exception as exc:
            logger.warning("Writing skill ChromaDB init failed: %s", exc)
            return False

        if self._allow_local:
            try:
                from sentence_transformers import SentenceTransformer
                self._embedding_model = SentenceTransformer(self._local_model_name)
                logger.info("Writing skill local embedding model loaded: %s", self._local_model_name)
            except Exception as exc:
                self._local_model_failed = True
                logger.warning("Writing skill local embedding model load failed: %s", exc)

        self._initialized = True
        return True

    def _get_or_create_collection(self, cloud_config: _UserModelConfig | None) -> Any | None:
        if not self._try_init() or self._client is None:
            return None
        name = self._collection_name(cloud_config)
        cached = self._collections.get(name)
        if cached is not None:
            return cached
        try:
            collection = self._client.get_or_create_collection(
                name=name,
                metadata={"hnsw:space": "cosine"},
            )
        except Exception as exc:
            logger.warning("Writing skill ChromaDB collection init failed: %s", exc)
            return None
        self._collections[name] = collection
        return collection

    def _load_cloud_config(self) -> _UserModelConfig | None:
        if self._cloud_config is not None:
            return _UserModelConfig(
                api_key=self._cloud_config["api_key"],
                base_url=self._cloud_config["base_url"],
                model=self._cloud_config["model"],
            )

        api_key = os.getenv("WRITING_SKILL_EMBEDDING_API_KEY", "")
        base_url = os.getenv("WRITING_SKILL_EMBEDDING_BASE_URL", "")
        model = os.getenv("WRITING_SKILL_EMBEDDING_MODEL", "text-embedding-3-small")

        if not api_key or not base_url:
            return None

        self._cloud_config = {"api_key": api_key, "base_url": base_url.rstrip("/"), "model": model}
        return _UserModelConfig(
            api_key=self._cloud_config["api_key"],
            base_url=self._cloud_config["base_url"],
            model=self._cloud_config["model"],
        )

    def _embed_sync(self, texts: list[str], cloud_config: _UserModelConfig | None = None) -> list[list[float]] | None:
        if not texts:
            return None

        uncached = [t for t in texts if t not in self._embedding_cache]
        if uncached:
            vectors = self._compute_embeddings(uncached, cloud_config=cloud_config)
            if vectors is None:
                if not self._embedding_cache:
                    return None
            else:
                for text, vec in zip(uncached, vectors):
                    self._embedding_cache[text] = vec
                if len(self._embedding_cache) > 5000:
                    keys = list(self._embedding_cache.keys())
                    for k in keys[:len(keys) - 4000]:
                        del self._embedding_cache[k]

        return [self._embedding_cache[t] for t in texts if t in self._embedding_cache] or None

    def _compute_embeddings(self, texts: list[str], cloud_config: _UserModelConfig | None = None) -> list[list[float]] | None:
        cloud_vectors = self._embed_cloud(texts, cloud_config=cloud_config)
        if cloud_vectors is not None:
            return cloud_vectors

        if self._allow_local and not self._local_model_failed and self._embedding_model is not None:
            try:
                vectors = self._embedding_model.encode(texts)
                if hasattr(vectors, "tolist"):
                    vectors = vectors.tolist()
                return [self._normalize(v) for v in vectors if v]
            except Exception as exc:
                logger.warning("Writing skill local embedding failed: %s", exc)

        return None

    def _embed_cloud(self, texts: list[str], cloud_config: _UserModelConfig | None = None) -> list[list[float]] | None:
        config = cloud_config or self._load_cloud_config()
        if not config:
            return None

        try:
            import httpx
        except ImportError:
            return None

        url = f"{config.base_url}/embeddings"
        headers = {"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"}
        payload = {"model": config.model, "input": texts}

        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, headers=headers, json=payload)
            if resp.status_code >= 400:
                return None
            data = resp.json().get("data")
            if not isinstance(data, list):
                return None
            sorted_items = sorted(
                (item for item in data if isinstance(item, dict)),
                key=lambda item: int(item.get("index", 0)),
            )
            vectors = []
            for item in sorted_items:
                v = self._normalize(item.get("embedding"))
                if v:
                    vectors.append(v)
            return vectors if len(vectors) == len(texts) else None
        except Exception as exc:
            logger.warning("Writing skill cloud embedding failed: %s", exc)
            return None

    @staticmethod
    def _normalize(vec: Any) -> list[float] | None:
        if vec is None:
            return None
        if hasattr(vec, "tolist"):
            vec = vec.tolist()
        if not isinstance(vec, list) or not vec:
            return None
        norm = math.sqrt(sum(x * x for x in vec))
        if norm < 1e-9:
            return None
        return [x / norm for x in vec]

    def ensure_indexed(self, entries: dict[str, WritingSkillEntry], cloud_config: _UserModelConfig | None = None) -> None:
        collection = self._get_or_create_collection(cloud_config)
        if collection is None:
            return

        try:
            existing_ids = set(collection.get(include=[])["ids"])
        except Exception:
            existing_ids = set()

        new_slugs = [s for s in entries if s not in existing_ids]
        if not new_slugs:
            return

        batch_size = 50
        for i in range(0, len(new_slugs), batch_size):
            batch_slugs = new_slugs[i:i + batch_size]
            texts = []
            metas = []
            for slug in batch_slugs:
                e = entries[slug]
                texts.append(f"{e.name} {e.description} {' '.join(e.tags)} {e.routing_hints}")
                metas.append({"slug": e.slug, "category": e.category})

            embeddings = self._embed_sync(texts, cloud_config=cloud_config)
            if embeddings and len(embeddings) == len(batch_slugs):
                try:
                    collection.add(
                        ids=batch_slugs,
                        embeddings=embeddings,
                        documents=texts,
                        metadatas=metas,
                    )
                except Exception as exc:
                    logger.warning("Writing skill vector index batch add failed: %s", exc)

    def search(self, query: str, max_results: int = 8, category: str | None = None, cloud_config: _UserModelConfig | None = None) -> list[tuple[str, float]]:
        collection = self._get_or_create_collection(cloud_config)
        if collection is None:
            return []

        query_embedding = self._embed_sync([query], cloud_config=cloud_config)
        if not query_embedding or not query_embedding[0]:
            return []

        where_clause = None
        if category:
            where_clause = {"category": category}

        try:
            results = collection.query(
                query_embeddings=[query_embedding[0]],
                n_results=max_results * 2,
                where=where_clause,
            )
        except Exception as exc:
            logger.warning("Writing skill vector search failed: %s", exc)
            return []

        ids = (results.get("ids") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]

        output: list[tuple[str, float]] = []
        for idx, slug in enumerate(ids):
            distance = float(distances[idx]) if idx < len(distances) else 1.0
            similarity = max(0.0, 1.0 - distance)
            if similarity >= _VECTOR_MIN_SIMILARITY:
                output.append((slug, similarity))

        return output[:max_results]


class WritingSkillIndex:
    _instance: WritingSkillIndex | None = None

    def __init__(self, data_dir: Path | None = None) -> None:
        self._data_dir = data_dir or _resolve_data_dir()
        self._raw: dict[str, Any] | None = None
        self._by_slug: dict[str, WritingSkillEntry] = {}
        self._by_category: dict[str, list[WritingSkillEntry]] = {}
        self._content_hash: str = ""
        self._loaded_at: float = 0.0
        self._index_mtime: float = 0.0
        self._vector_backend: _VectorSearchBackend | None = None
        self._reranker_service = RerankerService.get_instance()
        self._invoke_limiter = _InvokeRateLimiter()

    @classmethod
    def get_instance(cls) -> WritingSkillIndex:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        cls._instance = None

    def _index_path(self) -> Path:
        return self._data_dir / _INDEX_FILENAME

    def _skills_dir(self) -> Path:
        return self._data_dir / _SKILLS_SUBDIR

    @property
    def is_loaded(self) -> bool:
        return self._raw is not None

    @property
    def total_skills(self) -> int:
        self.ensure_loaded()
        return len(self._by_slug)

    def ensure_loaded(self) -> None:
        if self._raw is not None:
            self._check_mtime_refresh()
            return
        self._load_index()

    def _check_mtime_refresh(self) -> None:
        path = self._index_path()
        try:
            current_mtime = path.stat().st_mtime
        except OSError:
            return
        if self._index_mtime > 0 and current_mtime > self._index_mtime:
            logger.info("Writing skill index file changed (mtime), triggering incremental refresh")
            self._incremental_refresh()

    def _incremental_refresh(self) -> None:
        path = self._index_path()
        try:
            with open(path, encoding="utf-8") as f:
                new_raw = json.load(f)
        except Exception:
            logger.warning("Failed to reload writing_skill_index.json for incremental refresh")
            return

        new_hash = new_raw.get("content_hash", "")
        if new_hash == self._content_hash:
            try:
                self._index_mtime = path.stat().st_mtime
            except OSError:
                pass
            return

        old_hashes = {slug: entry.version_hash for slug, entry in self._by_slug.items()}
        new_skills = new_raw.get("skills", [])

        added, updated, removed = 0, 0, 0
        new_slugs = set()

        self._by_slug = {}
        self._by_category = {}

        for raw_entry in new_skills:
            try:
                entry = self._build_entry(raw_entry)
            except (KeyError, TypeError):
                continue

            slug = entry.slug
            new_slugs.add(slug)
            self._by_slug[slug] = entry
            self._by_category.setdefault(entry.category, []).append(entry)

            if slug not in old_hashes:
                added += 1
            elif old_hashes[slug] != entry.version_hash:
                updated += 1

        for old_slug in old_hashes:
            if old_slug not in new_slugs:
                removed += 1

        self._raw = new_raw
        self._content_hash = new_hash
        try:
            self._index_mtime = path.stat().st_mtime
        except OSError:
            pass

        if added or updated or removed:
            logger.info(
                "Writing skill index incremental refresh: +%d updated=%d -%d",
                added, updated, removed,
            )
            self._ensure_vector_indexed()

    def _build_entry(self, raw_entry: dict[str, Any]) -> WritingSkillEntry:
        return WritingSkillEntry(
            slug=raw_entry["slug"],
            name=raw_entry["name"],
            description=raw_entry["description"],
            category=raw_entry.get("category", "综合"),
            tags=tuple(raw_entry.get("tags", [])),
            keywords=tuple(raw_entry.get("keywords", [])),
            routing_hints=raw_entry.get("routing_hints", ""),
            source=raw_entry.get("source", "writing_skill_builtin"),
            version_hash=raw_entry.get("version_hash", ""),
            content_path=raw_entry.get("content_path", ""),
            quality_score=float(raw_entry.get("quality_score", 0.0)),
        )

    def _load_index(self) -> None:
        path = self._index_path()
        if not path.exists():
            logger.warning("writing_skill_index.json not found at %s, writing skills unavailable", path)
            self._raw = {"skills": [], "categories": {}, "content_hash": ""}
            self._by_slug = {}
            self._by_category = {}
            self._loaded_at = time.monotonic()
            return

        try:
            with open(path, encoding="utf-8") as f:
                self._raw = json.load(f)
            self._index_mtime = path.stat().st_mtime
        except Exception:
            logger.exception("Failed to load writing_skill_index.json")
            self._raw = {"skills": [], "categories": {}, "content_hash": ""}
            self._by_slug = {}
            self._by_category = {}
            self._loaded_at = time.monotonic()
            return

        self._content_hash = self._raw.get("content_hash", "")
        self._by_slug = {}
        self._by_category = {}

        for raw_entry in self._raw.get("skills", []):
            try:
                entry = self._build_entry(raw_entry)
            except (KeyError, TypeError):
                logger.warning("Skipping malformed skill entry: %s", raw_entry.get("slug", "?"))
                continue

            self._by_slug[entry.slug] = entry
            self._by_category.setdefault(entry.category, []).append(entry)

        self._loaded_at = time.monotonic()
        logger.info(
            "Writing skill index loaded: %d skills, %d categories, hash=%s",
            len(self._by_slug),
            len(self._by_category),
            self._content_hash[:16],
        )

        self._ensure_vector_indexed()

    def _ensure_vector_indexed(self) -> None:
        if self._vector_backend is None:
            self._vector_backend = _VectorSearchBackend(self._data_dir)
        self._vector_backend.ensure_indexed(self._by_slug)

    def reload(self) -> dict[str, Any]:
        self._raw = None
        self._by_slug = {}
        self._by_category = {}
        self._load_index()
        return self.get_stats()

    def get_stats(self) -> dict[str, Any]:
        self.ensure_loaded()
        stats = {
            "total_skills": len(self._by_slug),
            "categories": {cat: len(entries) for cat, entries in self._by_category.items()},
            "content_hash": self._content_hash,
            "vector_available": self._vector_backend is not None and self._vector_backend._initialized,
        }
        return stats

    def get_entry(self, slug: str) -> WritingSkillEntry | None:
        self.ensure_loaded()
        return self._by_slug.get(slug)

    def list_categories(self) -> list[str]:
        self.ensure_loaded()
        return sorted(self._by_category.keys())

    def list_slugs(self, limit: int = 20) -> list[str]:
        self.ensure_loaded()
        return list(self._by_slug.keys())[:limit]

    def check_invoke_limit(self, thread_id: str) -> tuple[bool, int]:
        allowed = self._invoke_limiter.check_and_increment(thread_id)
        remaining = self._invoke_limiter.remaining(thread_id)
        return allowed, remaining

    def search_candidates(
        self,
        intent: str,
        context: str | None = None,
        category: str | None = None,
        max_candidates: int = 8,
        user_config: WritingSkillUserConfig | None = None,
    ) -> list[WritingSkillEntry]:
        self.ensure_loaded()

        pool = list(self._by_slug.values())
        if category:
            pool = [e for e in pool if e.category == category]

        if not pool:
            return []

        query_text = (intent + " " + (context or "")).lower()
        query_tokens = _expand_with_synonyms(set(_tokenize(query_text)))

        hits: dict[str, _SearchHit] = {}

        for entry in pool:
            searchable = " ".join([
                entry.name, entry.description, entry.routing_hints,
                " ".join(entry.tags), " ".join(entry.keywords),
            ]).lower()
            entry_tokens = set(_tokenize(searchable))
            overlap = len(query_tokens & entry_tokens)
            if overlap > 0:
                hit = hits.setdefault(entry.slug, _SearchHit(entry=entry))
                max_possible = max(len(query_tokens), 1)
                hit.keyword_score = min(1.0, overlap / max_possible)

        if self._vector_backend is not None and self._vector_backend._initialized:
            vector_results = self._vector_backend.search(
                query_text,
                max_results=max_candidates * 2,
                category=category,
                cloud_config=user_config.embedding if user_config else None,
            )
            for slug, similarity in vector_results:
                entry = self._by_slug.get(slug)
                if entry is None:
                    continue
                hit = hits.setdefault(entry.slug, _SearchHit(entry=entry))
                hit.vector_score = similarity

        for hit in hits.values():
            hit.quality_bonus = hit.entry.quality_score / 10.0 if hit.entry.quality_score > 0 else 0.5

        ranked = sorted(hits.values(), key=lambda h: h.combined_score, reverse=True)
        top_entries = [hit.entry for hit in ranked[:max_candidates]]
        rerank_config = None
        if user_config and user_config.rerank:
            rerank_config = RerankConfig(
                api_key=user_config.rerank.api_key,
                base_url=user_config.rerank.base_url,
                model=user_config.rerank.model,
            )
        documents = [
            f"{entry.name}\n{entry.description}\n{entry.routing_hints}\n{' '.join(entry.tags)}"
            for entry in top_entries
        ]
        rerank_results = self._reranker_service.rerank_sync(
            query_text,
            documents,
            top_n=max_candidates,
            config=rerank_config,
        )
        if rerank_results:
            reranked_entries: list[WritingSkillEntry] = []
            for result in rerank_results:
                if 0 <= result.index < len(top_entries):
                    reranked_entries.append(top_entries[result.index])
            if reranked_entries:
                top_entries = reranked_entries

        return top_entries

    def warm_user_vector_index(self, user_config: WritingSkillUserConfig | None) -> None:
        self.ensure_loaded()
        if self._vector_backend is None:
            self._vector_backend = _VectorSearchBackend(self._data_dir)
        self._vector_backend.ensure_indexed(self._by_slug, cloud_config=user_config.embedding if user_config else None)

    def read_skill_content(self, slug: str) -> str | None:
        entry = self.get_entry(slug)
        if entry is None:
            return None

        content_path = (self._data_dir / entry.content_path).resolve()
        data_dir_resolved = self._data_dir.resolve()
        try:
            content_path.relative_to(data_dir_resolved)
        except ValueError:
            logger.warning("Path traversal blocked for skill '%s': %s", slug, entry.content_path)
            return None

        if not content_path.exists():
            logger.warning("Skill content file not found: %s", content_path)
            return None

        try:
            return content_path.read_text(encoding="utf-8")
        except Exception:
            logger.exception("Failed to read skill content for %s", slug)
            return None


_SYNONYM_MAP: dict[str, list[str]] = {
    "反派": ["敌人", "对手", "boss", "恶人"],
    "主角": ["男主", "女主", "主人公", "protagonist"],
    "人设": ["角色设定", "人物设定", "性格"],
    "大纲": ["提纲", "框架", "结构"],
    "节奏": ["节奏感", "紧凑", "拖沓"],
    "钩子": ["悬念", "吸引", "抓人"],
    "爽点": ["爽感", "满足感", "高潮"],
    "打脸": ["逆袭", "反转", "翻盘"],
    "伏笔": ["铺垫", "暗线", "埋线"],
    "推拉": ["暧昧", "拉扯", "暧昧感"],
    "开篇": ["开头", "开局", "第一章"],
    "对话": ["台词", "对白", "交谈"],
    "文风": ["风格", "笔触", "语言"],
    "世界观": ["设定", "背景", "体系"],
    "升级": ["成长", "突破", "进阶"],
}


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for chunk in text.split():
        chunk = chunk.strip()
        if not chunk:
            continue
        tokens.append(chunk)
    cn_chunks = re.findall(r"[\u4e00-\u9fff]{2,}", text)
    for chunk in cn_chunks:
        for i in range(len(chunk) - 1):
            tokens.append(chunk[i:i + 2])
    return tokens


def _expand_with_synonyms(tokens: set[str]) -> set[str]:
    expanded = set(tokens)
    for token in list(tokens):
        synonyms = _SYNONYM_MAP.get(token)
        if synonyms:
            expanded.update(synonyms)
    return expanded
