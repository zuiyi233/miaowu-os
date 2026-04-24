from __future__ import annotations

from datetime import timedelta

from deerflow.tools.builtins import novel_idempotency


def test_lazy_initialization_runs_only_on_first_check(monkeypatch):
    novel_idempotency._memory_store.clear()
    novel_idempotency._pending_persists.clear()
    novel_idempotency._store_initialized = False

    calls = {"load": 0, "cleanup": 0}
    monkeypatch.setattr(
        novel_idempotency,
        "_load_from_disk",
        lambda: calls.__setitem__("load", calls["load"] + 1),
    )
    monkeypatch.setattr(
        novel_idempotency,
        "_cleanup_expired_disk_files",
        lambda: calls.__setitem__("cleanup", calls["cleanup"] + 1),
    )
    monkeypatch.setattr(novel_idempotency, "_flush_pending_persists", lambda: None)

    assert calls == {"load": 0, "cleanup": 0}

    first = novel_idempotency.check_idempotency("tool-a", "k-1")
    second = novel_idempotency.check_idempotency("tool-a", "k-2")

    assert first["is_duplicate"] is False
    assert second["is_duplicate"] is False
    assert calls == {"load": 1, "cleanup": 1}


def test_ttl_prune_semantics_preserved(monkeypatch):
    novel_idempotency._memory_store.clear()
    novel_idempotency._pending_persists.clear()
    novel_idempotency._store_initialized = True
    monkeypatch.setattr(novel_idempotency, "_flush_pending_persists", lambda: None)

    expired_key = novel_idempotency._make_key("tool-a", "expired")
    novel_idempotency._memory_store[expired_key] = novel_idempotency._now() - timedelta(seconds=novel_idempotency._TTL_SECONDS + 30)

    result = novel_idempotency.check_idempotency("tool-a", "fresh")
    assert result["is_duplicate"] is False
    assert expired_key not in novel_idempotency._memory_store
