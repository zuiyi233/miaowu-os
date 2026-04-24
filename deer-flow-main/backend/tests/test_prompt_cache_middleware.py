"""Unit tests for PromptCacheMiddleware.

Tests the L1 application-level caching layer:
- Cache key generation consistency and uniqueness
- Cache hit/miss scenarios
- TTL expiration mechanism
- LRU eviction strategy
- Error handling and graceful degradation
- Statistics tracking
"""

from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.gateway.middleware.prompt_cache import CacheEntry, PromptCacheMiddleware


class TestComputeCacheKey:
    """Test cache key generation logic."""

    def setup_method(self):
        """Create middleware instance for testing."""
        self.middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

    def test_same_input_produces_same_key(self):
        """Identical requests should produce identical cache keys."""
        data = {
            "messages": [{"role": "user", "content": "Hello"}],
            "provider_config": {
                "model_name": "gpt-4o",
                "temperature": 0.7,
                "max_tokens": 2000,
            },
        }

        key1 = self.middleware._compute_cache_key(data)
        key2 = self.middleware._compute_cache_key(data)

        assert key1 == key2
        assert key1.startswith("prompt_cache:")

    def test_different_input_produces_different_keys(self):
        """Different requests should produce different cache keys."""
        data1 = {
            "messages": [{"role": "user", "content": "Hello"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }
        data2 = {
            "messages": [{"role": "user", "content": "Goodbye"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }

        key1 = self.middleware._compute_cache_key(data1)
        key2 = self.middleware._compute_cache_key(data2)

        assert key1 != key2

    def test_temperature_precision_normalization(self):
        """Temperature should be normalized to 2 decimal places."""
        data1 = {
            "messages": [],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.700, "max_tokens": 2000},
        }
        data2 = {
            "messages": [],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }

        key1 = self.middleware._compute_cache_key(data1)
        key2 = self.middleware._compute_cache_key(data2)

        assert key1 == key2

    def test_key_format(self):
        """Cache key should have correct format prefix."""
        data = {"messages": [], "provider_config": {}}
        key = self.middleware._compute_cache_key(data)

        assert key.startswith("prompt_cache:")
        assert len(key) == len("prompt_cache:") + 64  # SHA256 = 64 hex chars

    def test_context_changes_cache_key(self):
        data1 = {
            "messages": [{"role": "user", "content": "same prompt"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
            "context": {"thread_id": "thread-a", "workspace_id": "ws-1"},
        }
        data2 = {
            "messages": [{"role": "user", "content": "same prompt"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
            "context": {"thread_id": "thread-b", "workspace_id": "ws-1"},
        }

        key1 = self.middleware._compute_cache_key(data1)
        key2 = self.middleware._compute_cache_key(data2)
        assert key1 != key2


class TestCacheHitMiss:
    """Test cache hit and miss scenarios."""

    @pytest.mark.asyncio
    async def test_first_request_is_miss(self):
        """First request should always be a cache miss."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        request_data = {
            "messages": [{"role": "user", "content": "Test"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/ai/chat"
        mock_request.body = AsyncMock(return_value=json.dumps(request_data).encode())

        mock_response = JSONResponse(content={"content": "Response"})
        call_next = AsyncMock(return_value=mock_response)

        await middleware.dispatch(mock_request, call_next)

        assert middleware._stats["misses"] == 1
        assert middleware._stats["hits"] == 0
        call_next.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_second_identical_request_is_hit(self):
        """Second identical request within TTL should be a cache hit."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        request_data = {
            "messages": [{"role": "user", "content": "Test"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }

        request_body = json.dumps(request_data).encode()

        mock_request_1 = MagicMock(spec=Request)
        mock_request_1.method = "POST"
        mock_request_1.url.path = "/api/ai/chat"
        mock_request_1.body = AsyncMock(return_value=request_body)

        mock_response = JSONResponse(content={"content": "Cached Response"})
        call_next = AsyncMock(return_value=mock_response)

        await middleware.dispatch(mock_request_1, call_next)

        mock_request_2 = MagicMock(spec=Request)
        mock_request_2.method = "POST"
        mock_request_2.url.path = "/api/ai/chat"
        mock_request_2.body = AsyncMock(return_value=request_body)

        await middleware.dispatch(mock_request_2, call_next)

        assert middleware._stats["hits"] == 1
        assert middleware._stats["misses"] == 1
        assert call_next.call_count == 1  # Only called once


class TestTTLExpiration:
    """Test TTL-based cache expiration."""

    def test_expired_entry_not_returned(self):
        """Expired cache entries should not be returned."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=1, max_entries=1000)

        entry = CacheEntry(
            response_data={"content": "Old response"},
            created_at=time.monotonic() - 2,  # Created 2 seconds ago (TTL=1s)
        )
        cache_key = "prompt_cache:test123"
        middleware._cache[cache_key] = entry

        result = middleware._get_cached_entry(cache_key)

        assert result is None
        assert cache_key not in middleware._cache

    def test_non_expired_entry_returned(self):
        """Non-expired entries should be returned."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        entry = CacheEntry(
            response_data={"content": "Fresh response"},
            created_at=time.monotonic() - 10,  # Created 10 seconds ago (TTL=300s)
        )
        cache_key = "prompt_cache:test456"
        middleware._cache[cache_key] = entry

        result = middleware._get_cached_entry(cache_key)

        assert result is not None
        assert result.response_data["content"] == "Fresh response"


class TestLRUEviction:
    """Test LRU eviction when cache is full."""

    def test_eviction_when_full(self):
        """Oldest entry should be evicted when cache is full."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=3)

        middleware._store_cache_entry("key1", {"content": "1"})
        time.sleep(0.01)
        middleware._store_cache_entry("key2", {"content": "2"})
        time.sleep(0.01)
        middleware._store_cache_entry("key3", {"content": "3"})

        assert len(middleware._cache) == 3

        middleware._store_cache_entry("key4", {"content": "4"})

        assert len(middleware._cache) == 3
        assert "key1" not in middleware._cache  # Oldest evicted
        assert "key4" in middleware._cache  # New entry added

    def test_recently_accessed_key_is_not_evicted(self):
        """Recently accessed key should be retained when cache is full."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=3)

        middleware._store_cache_entry("key1", {"content": "1"})
        time.sleep(0.01)
        middleware._store_cache_entry("key2", {"content": "2"})
        time.sleep(0.01)
        middleware._store_cache_entry("key3", {"content": "3"})

        # Touch key1 to make it the most recently used entry.
        hit = middleware._get_cached_entry("key1")
        assert hit is not None

        middleware._store_cache_entry("key4", {"content": "4"})

        assert len(middleware._cache) == 3
        assert "key1" in middleware._cache
        assert "key2" not in middleware._cache  # Least recently used key is evicted
        assert "key4" in middleware._cache


class TestErrorHandling:
    """Test graceful error handling and degradation."""

    @pytest.mark.asyncio
    async def test_invalid_json_bypasses_cache(self):
        """Invalid JSON body should bypass cache without error."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/ai/chat"
        mock_request.body = AsyncMock(return_value=b"invalid json")

        mock_response = JSONResponse(content={"error": "parsed"})
        call_next = AsyncMock(return_value=mock_response)

        await middleware.dispatch(mock_request, call_next)

        call_next.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_non_chat_requests_bypassed(self):
        """Non-chat POST requests should bypass caching."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/other"

        call_next = AsyncMock(return_value=JSONResponse(content={}))

        await middleware.dispatch(mock_request, call_next)

        call_next.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_get_requests_bypassed(self):
        """GET requests should always bypass caching."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        mock_request = MagicMock(spec=Request)
        mock_request.method = "GET"
        mock_request.url.path = "/api/ai/chat"

        call_next = AsyncMock(return_value=JSONResponse(content={}))

        await middleware.dispatch(mock_request, call_next)

        call_next.assert_awaited_once()

    def test_non_json_content_type_skips_body_read(self):
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/ai/chat"
        mock_request.headers = {"content-type": "multipart/form-data; boundary=abc"}
        mock_request.body = AsyncMock(return_value=b"unused")

        call_next = AsyncMock(return_value=JSONResponse(content={"ok": True}))

        asyncio.run(middleware.dispatch(mock_request, call_next))

        mock_request.body.assert_not_awaited()
        call_next.assert_awaited_once()


class TestRequestBodyRestore:
    """Test request body restore behavior for downstream handlers."""

    @pytest.mark.asyncio
    async def test_request_body_restored_before_call_next(self):
        """Middleware should replay original request body for downstream receive()."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        request_data = {
            "messages": [{"role": "user", "content": "restore body"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }
        raw_body = json.dumps(request_data).encode("utf-8")

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/ai/chat"
        mock_request.body = AsyncMock(return_value=raw_body)

        async def call_next(request: Request):
            packet = await request._receive()  # type: ignore[attr-defined]
            return JSONResponse(content={"body_len": len(packet.get("body", b""))})

        response = await middleware.dispatch(mock_request, call_next)
        payload = json.loads(response.body.decode("utf-8"))

        assert payload["body_len"] == len(raw_body)

    def test_request_body_restored_concurrent_receive_returns_once(self):
        """Concurrent _receive calls should return original body only once."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)
        raw_body = b'{"messages":[{"role":"user","content":"restore body"}]}'

        mock_request = MagicMock(spec=Request)
        middleware._restore_request_body(mock_request, raw_body)

        async def _read_once() -> dict:
            return await mock_request._receive()  # type: ignore[attr-defined]

        async def _run_reads() -> tuple[dict, dict]:
            first_packet, second_packet = await asyncio.gather(_read_once(), _read_once())
            return first_packet, second_packet

        first, second = asyncio.run(_run_reads())
        bodies = [first.get("body", b""), second.get("body", b"")]

        assert bodies.count(raw_body) == 1
        assert bodies.count(b"") == 1


class TestStatistics:
    """Test cache statistics tracking."""

    def test_initial_stats(self):
        """Initial statistics should show zero hits/misses."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        stats = middleware.get_stats()

        assert stats["hits"] == 0
        assert stats["misses"] == 0
        assert stats["hit_rate"] == 0.0
        assert stats["size"] == 0

    def test_stats_after_operations(self):
        """Statistics should reflect cache operations."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        middleware._store_cache_entry("key1", {"data": "value1"})
        middleware._get_cached_entry("key1")  # Hit

        stats = middleware.get_stats()

        assert stats["hits"] == 1
        assert stats["misses"] == 0  # _get_cached_entry doesn't count misses, only dispatch does
        assert stats["hit_rate"] == 100.0
        assert stats["size"] == 1

    def test_clear_cache_resets_stats(self):
        """Clearing cache should remove all entries but keep stats."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        middleware._store_cache_entry("key1", {"data": "value1"})
        middleware._store_cache_entry("key2", {"data": "value2"})
        middleware.clear_cache()

        assert len(middleware._cache) == 0

    def test_invalidate_specific_entry(self):
        """Invalidating specific entry should only remove that entry."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        middleware._store_cache_entry("key1", {"data": "value1"})
        middleware._store_cache_entry("key2", {"data": "value2"})

        result = middleware.invalidate("key1")

        assert result is True
        assert "key1" not in middleware._cache
        assert "key2" in middleware._cache

    def test_invalidate_nonexistent_entry(self):
        """Invalidating nonexistent entry should return False."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        result = middleware.invalidate("nonexistent")

        assert result is False


class TestStreamingResponseBypass:
    """Test streaming responses bypass cache."""

    @staticmethod
    def _make_streaming_response(payload: bytes) -> StreamingResponse:
        async def _body_iterator():
            yield payload

        return StreamingResponse(_body_iterator(), media_type="text/event-stream")

    @pytest.mark.asyncio
    async def test_streaming_response_bypassed_and_not_cached(self):
        """Streaming response should pass through and should not be cached."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)
        payload = b'data: {"content": "Hello streaming"}\n\ndata: [DONE]\n\n'

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/ai/chat"
        mock_request.body = AsyncMock(return_value=json.dumps(
            {
                "messages": [{"role": "user", "content": "Test streaming"}],
                "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
            }
        ).encode())

        call_next = AsyncMock(return_value=self._make_streaming_response(payload))

        response = await middleware.dispatch(mock_request, call_next)
        streamed = b""
        async for chunk in response.body_iterator:
            streamed += chunk if isinstance(chunk, bytes) else str(chunk).encode()

        assert streamed == payload
        assert middleware._stats["misses"] == 1
        assert middleware._stats["hits"] == 0
        assert len(middleware._cache) == 0
        call_next.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_identical_streaming_requests_do_not_hit_cache(self):
        """Identical streaming requests should still call downstream each time."""
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)
        request_data = {
            "messages": [{"role": "user", "content": "Streaming test"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }
        request_body = json.dumps(request_data).encode()

        mock_request_1 = MagicMock(spec=Request)
        mock_request_1.method = "POST"
        mock_request_1.url.path = "/api/ai/chat"
        mock_request_1.body = AsyncMock(return_value=request_body)

        mock_request_2 = MagicMock(spec=Request)
        mock_request_2.method = "POST"
        mock_request_2.url.path = "/api/ai/chat"
        mock_request_2.body = AsyncMock(return_value=request_body)

        call_next = AsyncMock(
            side_effect=[
                self._make_streaming_response(b'data: {"content": "First"}\n\ndata: [DONE]\n\n'),
                self._make_streaming_response(b'data: {"content": "Second"}\n\ndata: [DONE]\n\n'),
            ]
        )

        await middleware.dispatch(mock_request_1, call_next)
        await middleware.dispatch(mock_request_2, call_next)

        assert middleware._stats["hits"] == 0
        assert middleware._stats["misses"] == 2
        assert len(middleware._cache) == 0
        assert call_next.call_count == 2


class TestEnabledFlag:
    """Test enable/disable functionality."""

    def test_enabled_by_default(self):
        """Middleware should be enabled by default."""
        middleware = PromptCacheMiddleware(app=MagicMock())

        assert middleware.enabled is True

    def test_can_be_disabled_via_env(self, monkeypatch):
        """Middleware can be disabled via environment variable."""
        monkeypatch.setenv("ENABLE_PROMPT_CACHE", "false")
        middleware = PromptCacheMiddleware(app=MagicMock())

        assert middleware.enabled is False


class TestResponseHeaderBypass:
    """Test bypass behavior via response headers."""

    @pytest.mark.asyncio
    async def test_dispatch_bypasses_cache_when_header_requests_bypass(self):
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        request_data = {
            "messages": [{"role": "user", "content": "create novel"}],
            "provider_config": {"model_name": "gpt-4o", "temperature": 0.7, "max_tokens": 2000},
        }

        mock_request = MagicMock(spec=Request)
        mock_request.method = "POST"
        mock_request.url.path = "/api/ai/chat"
        mock_request.body = AsyncMock(return_value=json.dumps(request_data).encode())

        response = JSONResponse(
            content={"content": "handled by action middleware"},
            headers={"X-Prompt-Cache": "bypass", "Cache-Control": "no-store"},
        )
        call_next = AsyncMock(return_value=response)

        returned = await middleware.dispatch(mock_request, call_next)

        assert returned is response
        assert middleware._stats["misses"] == 1
        assert middleware._stats["hits"] == 0
        assert len(middleware._cache) == 0
        call_next.assert_awaited_once()

    def test_should_bypass_response_cache_helper(self):
        middleware = PromptCacheMiddleware(app=MagicMock(), ttl=300, max_entries=1000)

        marked = JSONResponse(content={"ok": True}, headers={"X-Prompt-Cache": "bypass"})
        assert middleware._should_bypass_response_cache(marked) is True

        no_store = JSONResponse(content={"ok": True}, headers={"Cache-Control": "private, no-store"})
        assert middleware._should_bypass_response_cache(no_store) is True

        normal = JSONResponse(content={"ok": True})
        assert middleware._should_bypass_response_cache(normal) is False

        sse = JSONResponse(content={"ok": True}, headers={"content-type": "text/event-stream"})
        assert middleware._should_bypass_response_cache(sse) is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
