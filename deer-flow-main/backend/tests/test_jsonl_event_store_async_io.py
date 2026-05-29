"""Concurrency-safety tests for JsonlRunEventStore async I/O hardening."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from deerflow.runtime.events.store.jsonl import JsonlRunEventStore


def _make_store(base_dir: Path) -> JsonlRunEventStore:
    return JsonlRunEventStore(base_dir=base_dir)


@pytest.mark.anyio
async def test_get_write_lock_returns_asyncio_lock():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        assert isinstance(store._get_write_lock("t1"), asyncio.Lock)


@pytest.mark.anyio
async def test_get_write_lock_same_thread_reuses_lock():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        assert store._get_write_lock("t1") is store._get_write_lock("t1")


@pytest.mark.anyio
async def test_get_write_lock_different_threads_get_different_locks():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        assert store._get_write_lock("t1") is not store._get_write_lock("t2")


@pytest.mark.anyio
async def test_concurrent_puts_produce_unique_monotonic_seqs():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        results = await asyncio.gather(
            *[
                store.put(
                    thread_id="t1",
                    run_id=f"r{i}",
                    event_type="trace",
                    category="trace",
                    content=f"msg{i}",
                )
                for i in range(10)
            ]
        )
    assert sorted(r["seq"] for r in results) == list(range(1, 11))


@pytest.mark.anyio
async def test_concurrent_puts_different_threads_independent_seqs():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        t1_results, t2_results = await asyncio.gather(
            asyncio.gather(
                *[
                    store.put(thread_id="t1", run_id="r1", event_type="trace", category="trace")
                    for _ in range(5)
                ]
            ),
            asyncio.gather(
                *[
                    store.put(thread_id="t2", run_id="r2", event_type="trace", category="trace")
                    for _ in range(5)
                ]
            ),
        )
    assert sorted(r["seq"] for r in t1_results) == [1, 2, 3, 4, 5]
    assert sorted(r["seq"] for r in t2_results) == [1, 2, 3, 4, 5]


@pytest.mark.anyio
async def test_put_batch_seqs_are_monotonic():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        events = [
            {"thread_id": "t1", "run_id": "r1", "event_type": "trace", "category": "trace", "content": str(i)}
            for i in range(5)
        ]
        results = await store.put_batch(events)
    seqs = [r["seq"] for r in results]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == 5


@pytest.mark.anyio
async def test_ensure_seq_loaded_recovers_from_disk():
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        store1 = _make_store(base)
        for i in range(3):
            await store1.put(thread_id="t1", run_id="r1", event_type="trace", category="trace", content=str(i))

        store2 = _make_store(base)
        record = await store2.put(thread_id="t1", run_id="r1", event_type="trace", category="trace", content="new")
        assert record["seq"] == 4


@pytest.mark.anyio
async def test_put_offloads_write_via_to_thread():
    original = asyncio.to_thread
    calls: list[str] = []

    async def spy(*args, **kwargs):
        calls.append(args[0].__name__ if callable(args[0]) else repr(args[0]))
        return await original(*args, **kwargs)

    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        with patch("asyncio.to_thread", new=spy):
            await store.put(thread_id="t1", run_id="r1", event_type="trace", category="trace", content="x")

    assert "_write_record" in calls


@pytest.mark.anyio
async def test_list_messages_reads_written_records():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        await store.put(thread_id="t1", run_id="r1", event_type="human_message", category="message", content="hello")
        await store.put(thread_id="t1", run_id="r1", event_type="ai_message", category="message", content="world")
        messages = await store.list_messages("t1")
    assert [message["content"] for message in messages] == ["hello", "world"]


@pytest.mark.anyio
async def test_count_messages_accurate_after_concurrent_writes():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        await asyncio.gather(
            *[
                store.put(thread_id="t1", run_id="r1", event_type="human_message", category="message")
                for _ in range(7)
            ]
        )
        count = await store.count_messages("t1")
    assert count == 7


@pytest.mark.anyio
async def test_delete_by_thread_clears_seq_counter_and_lock():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        await store.put(thread_id="t1", run_id="r1", event_type="trace", category="trace")
        await store.delete_by_thread("t1")
        assert "t1" not in store._seq_counters
        assert "t1" not in store._write_locks


@pytest.mark.anyio
async def test_delete_by_run_removes_run_events():
    with tempfile.TemporaryDirectory() as tmp:
        store = _make_store(Path(tmp))
        await store.put(thread_id="t1", run_id="r1", event_type="trace", category="trace")
        await store.put(thread_id="t1", run_id="r2", event_type="trace", category="trace")
        await store.delete_by_run("t1", "r1")
        events = await store.list_events("t1", "r1")
    assert events == []


@pytest.mark.anyio
async def test_db_put_batch_rejects_mixed_thread_ids():
    from deerflow.runtime.events.store.db import DbRunEventStore

    store = DbRunEventStore(session_factory=MagicMock())
    events = [
        {"thread_id": "t1", "run_id": "r1", "event_type": "trace", "category": "trace"},
        {"thread_id": "t2", "run_id": "r2", "event_type": "trace", "category": "trace"},
    ]

    with pytest.raises(ValueError, match="same thread"):
        await store.put_batch(events)
