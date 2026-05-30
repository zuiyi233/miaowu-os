from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select

from app.gateway.cache_policy import TimedOrderedCache
from app.gateway.novel_migrated.core.crypto import safe_decrypt
from app.gateway.novel_migrated.core.database import AsyncSessionLocal
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.settings import Settings

logger = get_logger(__name__)

_CONFIG_CACHE_TTL_SECONDS = float(os.getenv("RERANK_CONFIG_CACHE_TTL_SECONDS", "120"))
_CONFIG_CACHE_MAX_SIZE = int(os.getenv("RERANK_CONFIG_CACHE_MAX_SIZE", "256"))
_HTTP_TIMEOUT_SECONDS = float(os.getenv("RERANK_TIMEOUT_SECONDS", "10"))
_MAX_DOCUMENTS = int(os.getenv("RERANK_MAX_DOCUMENTS", "50"))
_GLOBAL_ENABLED = os.getenv("RERANK_ENABLED", "1").strip().lower() not in {"0", "false", "no", "off"}


def _normalize_base_url(base_url: str | None) -> str:
    return (base_url or "").strip().rstrip("/")


def _load_preferences_blob(settings: Settings) -> dict[str, Any]:
    raw = settings.preferences or "{}"
    if isinstance(raw, str):
        try:
            parsed = __import__("json").loads(raw)
        except Exception:
            parsed = {}
    else:
        parsed = raw
    return parsed if isinstance(parsed, dict) else {}


def _read_preference_string(preferences: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = preferences.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _read_preference_bool(preferences: dict[str, Any], keys: tuple[str, ...], default: bool) -> bool:
    for key in keys:
        value = preferences.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on"}:
                return True
            if normalized in {"0", "false", "no", "off"}:
                return False
    return default


@dataclass(frozen=True, slots=True)
class RerankConfig:
    api_key: str
    base_url: str
    model: str


@dataclass(frozen=True, slots=True)
class RerankResult:
    index: int
    relevance_score: float


class RerankerService:
    _instance: RerankerService | None = None
    _http_client: httpx.AsyncClient | None = None
    _http_client_lock = threading.Lock()

    def __init__(self) -> None:
        self._config_cache = TimedOrderedCache[str, RerankConfig | None](
            name="reranker config",
            ttl_seconds=_CONFIG_CACHE_TTL_SECONDS,
            max_size=_CONFIG_CACHE_MAX_SIZE,
            logger=logger,
        )
        if RerankerService._http_client is None:
            with RerankerService._http_client_lock:
                if RerankerService._http_client is None:
                    RerankerService._http_client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS)

    @classmethod
    def get_instance(cls) -> RerankerService:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    async def close_http_client(cls) -> None:
        if cls._http_client is not None:
            await cls._http_client.aclose()
            cls._http_client = None

    async def _resolve_config(self, user_id: str | None = None) -> RerankConfig | None:
        if not _GLOBAL_ENABLED:
            return None

        cache_key = user_id or "__global__"
        cached_entry = self._config_cache.get_entry(cache_key)
        if cached_entry is not None:
            return cached_entry.value

        resolved = await self._load_user_config(user_id) if user_id else None
        if resolved is None:
            resolved = self._load_env_config()

        self._config_cache.set(cache_key, resolved)
        return resolved

    async def _load_user_config(self, user_id: str | None) -> RerankConfig | None:
        if not user_id:
            return None

        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(select(Settings).where(Settings.user_id == user_id))
                settings = result.scalar_one_or_none()
        except Exception as exc:
            logger.warning("读取用户 Rerank 配置失败 user_id=%s: %s", user_id, exc)
            return None

        if not settings or not settings.api_key:
            return None

        preferences = _load_preferences_blob(settings)
        enabled = _read_preference_bool(preferences, ("rerank_enabled", "writing_skill_rerank_enabled"), True)
        if not enabled:
            return None

        api_key = safe_decrypt(settings.api_key) or settings.api_key or ""
        base_url = _normalize_base_url(settings.api_base_url)
        model = _read_preference_string(
            preferences,
            (
                "rerank_model",
                "reranker_model",
                "rerankModel",
            ),
        )

        if not model:
            model = os.getenv("RERANK_MODEL", "").strip()

        if not api_key or not base_url or not model:
            return None

        return RerankConfig(api_key=api_key, base_url=base_url, model=model)

    def _load_env_config(self) -> RerankConfig | None:
        api_key = os.getenv("RERANK_API_KEY", "").strip()
        base_url = os.getenv("RERANK_BASE_URL", "").strip()
        model = os.getenv("RERANK_MODEL", "").strip()
        if not api_key or not base_url or not model:
            return None
        return RerankConfig(api_key=api_key, base_url=base_url.rstrip("/"), model=model)

    @staticmethod
    def _build_payload(query: str, documents: list[str], config: RerankConfig, top_n: int | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": config.model,
            "query": query,
            "documents": documents[:_MAX_DOCUMENTS],
        }
        if top_n is not None:
            payload["top_n"] = min(max(1, int(top_n)), len(payload["documents"]))
        return payload

    @staticmethod
    def _parse_results(data: Any) -> list[RerankResult]:
        if not isinstance(data, dict):
            return []
        raw_results = data.get("results")
        if not isinstance(raw_results, list):
            return []
        output: list[RerankResult] = []
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            try:
                output.append(
                    RerankResult(
                        index=int(item.get("index")),
                        relevance_score=float(item.get("relevance_score", 0.0)),
                    )
                )
            except (TypeError, ValueError):
                continue
        return output

    async def async_rerank(
        self,
        query: str,
        documents: list[str],
        *,
        user_id: str | None = None,
        top_n: int | None = None,
        config: RerankConfig | None = None,
    ) -> list[RerankResult]:
        if not documents or len(documents) < 2:
            return []

        resolved = config or await self._resolve_config(user_id)
        if resolved is None or RerankerService._http_client is None:
            return []

        payload = self._build_payload(query, documents, resolved, top_n)
        headers = {
            "Authorization": f"Bearer {resolved.api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = await RerankerService._http_client.post(
                f"{resolved.base_url}/rerank",
                headers=headers,
                json=payload,
            )
            if response.status_code >= 400:
                logger.warning("Rerank request failed: status=%s body=%s", response.status_code, response.text[:300])
                return []
            return self._parse_results(response.json())
        except Exception as exc:
            logger.warning("Rerank request failed: %s", exc)
            return []

    def rerank_sync(
        self,
        query: str,
        documents: list[str],
        *,
        top_n: int | None = None,
        config: RerankConfig | None = None,
    ) -> list[RerankResult]:
        if not documents or len(documents) < 2:
            return []

        resolved = config or self._load_env_config()
        if resolved is None:
            return []

        payload = self._build_payload(query, documents, resolved, top_n)
        headers = {
            "Authorization": f"Bearer {resolved.api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=_HTTP_TIMEOUT_SECONDS) as client:
                response = client.post(
                    f"{resolved.base_url}/rerank",
                    headers=headers,
                    json=payload,
                )
            if response.status_code >= 400:
                logger.warning("Sync rerank request failed: status=%s body=%s", response.status_code, response.text[:300])
                return []
            return self._parse_results(response.json())
        except Exception as exc:
            logger.warning("Sync rerank request failed: %s", exc)
            return []
