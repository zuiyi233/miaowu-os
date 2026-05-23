from __future__ import annotations

import json

import pytest

from app.gateway.novel_migrated.core import database
from app.gateway.novel_migrated.services import ai_metrics as ai_metrics_module
from app.gateway.novel_migrated.services import dual_write_service
from app.gateway.novel_migrated.services.ai_metrics import AIMetricsService


def test_database_exports_async_session_factory_alias() -> None:
    """C-01 regression: async_session_factory alias must stay available."""
    assert database.async_session_factory is database.AsyncSessionLocal


@pytest.mark.anyio
async def test_database_schema_requires_main_persistence_engine() -> None:
    """Novel schema bootstrap must not recreate the retired private SQLite path."""
    assert not hasattr(database, "_ensure_wal_and_pragma")
    assert not hasattr(database, "_WAL_INITIALIZED")
    assert not hasattr(database, "DATABASE_URL")

    with pytest.raises(RuntimeError, match="Main persistence engine is not initialized"):
        await database.init_db_schema()


@pytest.mark.anyio
async def test_ai_metrics_get_user_stats_is_async_awaitable(monkeypatch: pytest.MonkeyPatch) -> None:
    """C-03 regression: get_user_stats should be async-only and directly awaitable."""
    service = AIMetricsService()

    async def _fake_load_from_db(user_id: str, days: int) -> list[dict]:
        assert user_id == "user-1"
        assert days == 1
        return []

    monkeypatch.setattr(service, "_load_from_db", _fake_load_from_db)

    result = await service.get_user_stats("user-1", days=1)
    assert result["total_calls"] == 0
    assert result["period_days"] == 1


@pytest.mark.anyio
async def test_ai_metrics_flush_retry_is_bounded(monkeypatch: pytest.MonkeyPatch) -> None:
    """M-27 regression: failed flush retries should be capped instead of infinite."""
    service = AIMetricsService()

    class _FailingSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

    monkeypatch.setattr(ai_metrics_module, "AsyncSessionLocal", lambda: _FailingSession())

    ai_metrics_module._pending_writes.clear()
    ai_metrics_module._pending_writes.append(
        {
            "timestamp": "2026-01-01T00:00:00",
            "provider": "openai",
            "model": "gpt-4o",
            "prompt_tokens": 1,
            "completion_tokens": 1,
            "total_tokens": 2,
            "operation_type": "generation",
            "success": True,
            "user_id": "u-1",
            "_flush_retry_count": 0,
        }
    )

    # max retry = 3 -> after 4 failed flushes the record should be dropped.
    for _ in range(ai_metrics_module._max_flush_retries + 1):
        await service._flush_to_db_async()

    assert ai_metrics_module._pending_writes == []


@pytest.mark.anyio
async def test_dual_write_retry_success_does_not_increment_retry_count(monkeypatch: pytest.MonkeyPatch) -> None:
    """H-01 regression: retry_count should only increase in exception branch."""

    class _Entry:
        def __init__(self) -> None:
            self.id = "dw-1"
            self.modern_project_id = "proj-1"
            self.legacy_payload = json.dumps({"title": "T"}, ensure_ascii=False)
            self.status = "pending"
            self.retry_count = 2
            self.max_retries = 5
            self.next_retry_at = None
            self.last_error = None

    class _Result:
        def __init__(self, entries: list[_Entry]) -> None:
            self._entries = entries

        def scalars(self) -> _Result:
            return self

        def all(self) -> list[_Entry]:
            return self._entries

    class _Session:
        def __init__(self, entries: list[_Entry]) -> None:
            self._entries = entries
            self.commit_calls = 0

        async def __aenter__(self) -> _Session:
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

        async def execute(self, stmt) -> _Result:  # pragma: no cover - stmt shape is irrelevant in this unit test
            del stmt
            return _Result(self._entries)

        async def commit(self) -> None:
            self.commit_calls += 1

    class _Response:
        def raise_for_status(self) -> None:
            return None

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

        async def post(self, *args, **kwargs) -> _Response:
            return _Response()

    entry = _Entry()
    session = _Session([entry])

    monkeypatch.setattr(dual_write_service, "async_session_factory", lambda: session)
    monkeypatch.setattr("httpx.AsyncClient", _Client)
    monkeypatch.setattr("deerflow.tools.builtins.novel_tool_helpers.get_base_url", lambda: "http://127.0.0.1:8001")
    monkeypatch.setattr("deerflow.tools.builtins.novel_tool_helpers.get_timeout_seconds", lambda: 1.0)
    monkeypatch.setattr("deerflow.tools.builtins.novel_tool_helpers.build_headers", lambda: {"Content-Type": "application/json"})

    success = await dual_write_service.retry_pending_dual_writes()

    assert success == 1
    assert entry.status == "success"
    assert entry.retry_count == 2
    assert session.commit_calls == 1
