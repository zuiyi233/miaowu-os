import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from deerflow.agents.memory.queue import ConversationContext, MemoryUpdateQueue
from deerflow.config.memory_config import MemoryConfig


def _memory_config(**overrides: object) -> MemoryConfig:
    config = MemoryConfig()
    for key, value in overrides.items():
        setattr(config, key, value)
    return config


def test_queue_add_preserves_existing_correction_flag_for_same_thread() -> None:
    queue = MemoryUpdateQueue()

    with (
        patch("deerflow.agents.memory.queue.get_memory_config", return_value=_memory_config(enabled=True)),
        patch.object(queue, "_signal_worker"),
    ):
        queue.add(thread_id="thread-1", messages=["first"], correction_detected=True)
        queue.add(thread_id="thread-1", messages=["second"], correction_detected=False)

    assert len(queue._queue) == 1
    assert queue._queue[0].messages == ["second"]
    assert queue._queue[0].correction_detected is True


@pytest.mark.anyio
async def test_process_queue_forwards_correction_flag_to_async_updater() -> None:
    queue = MemoryUpdateQueue()
    queue._queue = [
        ConversationContext(
            thread_id="thread-1",
            messages=["conversation"],
            agent_name="lead_agent",
            correction_detected=True,
        )
    ]
    mock_updater = MagicMock()
    mock_updater.aupdate_memory = AsyncMock(return_value=True)

    with patch("deerflow.agents.memory.updater.MemoryUpdater", return_value=mock_updater):
        await queue._process_queue()

    mock_updater.aupdate_memory.assert_awaited_once_with(
        messages=["conversation"],
        thread_id="thread-1",
        agent_name="lead_agent",
        correction_detected=True,
        reinforcement_detected=False,
        user_id=None,
    )


@pytest.mark.anyio
async def test_process_queue_forwards_reinforcement_flag_to_async_updater() -> None:
    queue = MemoryUpdateQueue()
    queue._queue = [
        ConversationContext(
            thread_id="thread-1",
            messages=["conversation"],
            agent_name="lead_agent",
            reinforcement_detected=True,
        )
    ]
    mock_updater = MagicMock()
    mock_updater.aupdate_memory = AsyncMock(return_value=True)

    with patch("deerflow.agents.memory.updater.MemoryUpdater", return_value=mock_updater):
        await queue._process_queue()

    mock_updater.aupdate_memory.assert_awaited_once_with(
        messages=["conversation"],
        thread_id="thread-1",
        agent_name="lead_agent",
        correction_detected=False,
        reinforcement_detected=True,
        user_id=None,
    )


def test_queue_add_preserves_existing_reinforcement_flag_for_same_thread() -> None:
    queue = MemoryUpdateQueue()

    with (
        patch("deerflow.agents.memory.queue.get_memory_config", return_value=_memory_config(enabled=True)),
        patch.object(queue, "_signal_worker"),
    ):
        queue.add(thread_id="thread-1", messages=["first"], reinforcement_detected=True)
        queue.add(thread_id="thread-1", messages=["second"], reinforcement_detected=False)

    assert len(queue._queue) == 1
    assert queue._queue[0].messages == ["second"]
    assert queue._queue[0].reinforcement_detected is True


@pytest.mark.anyio
async def test_process_queue_does_not_reuse_runtime_override_between_contexts() -> None:
    queue = MemoryUpdateQueue()
    queue._queue = [
        ConversationContext(
            thread_id="thread-override",
            messages=["conversation-1"],
            model_name="override-model",
            runtime_model="LongCat-Flash-Chat",
            runtime_base_url="https://override.example",
            runtime_api_key="override-key",
        ),
        ConversationContext(
            thread_id="thread-default",
            messages=["conversation-2"],
        ),
    ]

    constructor_kwargs: list[dict[str, object]] = []
    updater_instances: list[MagicMock] = []

    def _build_updater(*args: object, **kwargs: object) -> MagicMock:
        updater = MagicMock()
        updater.aupdate_memory = AsyncMock(return_value=True)
        constructor_kwargs.append(dict(kwargs))
        updater_instances.append(updater)
        return updater

    with (
        patch("deerflow.agents.memory.updater.MemoryUpdater", side_effect=_build_updater) as updater_cls,
        patch("deerflow.agents.memory.queue.asyncio.sleep", new=AsyncMock()),
    ):
        await queue._process_queue()

    assert updater_cls.call_count == 2
    assert constructor_kwargs == [
        {
            "model_name": "override-model",
            "runtime_model": "LongCat-Flash-Chat",
            "runtime_base_url": "https://override.example",
            "runtime_api_key": "override-key",
        },
        {
            "model_name": None,
            "runtime_model": None,
            "runtime_base_url": None,
            "runtime_api_key": None,
        },
    ]

    updater_instances[0].aupdate_memory.assert_awaited_once_with(
        messages=["conversation-1"],
        thread_id="thread-override",
        agent_name=None,
        correction_detected=False,
        reinforcement_detected=False,
    )
    updater_instances[1].aupdate_memory.assert_awaited_once_with(
        messages=["conversation-2"],
        thread_id="thread-default",
        agent_name=None,
        correction_detected=False,
        reinforcement_detected=False,
    )


@pytest.mark.anyio
async def test_worker_processes_immediate_updates_in_background() -> None:
    queue = MemoryUpdateQueue()
    started = asyncio.Event()
    updater = MagicMock()

    async def _fake_aupdate_memory(**kwargs: object) -> bool:
        started.set()
        return True

    updater.aupdate_memory = AsyncMock(side_effect=_fake_aupdate_memory)

    with (
        patch("deerflow.agents.memory.queue.get_memory_config", return_value=_memory_config(enabled=True, debounce_seconds=1)),
        patch("deerflow.agents.memory.updater.MemoryUpdater", return_value=updater),
    ):
        await queue.start_worker()
        try:
            queue.add_nowait(thread_id="thread-1", messages=["conversation"], agent_name="lead-agent")
            await asyncio.wait_for(started.wait(), timeout=1)
            assert queue.pending_count == 0
        finally:
            await queue.stop_worker(timeout_seconds=1)

    updater.aupdate_memory.assert_awaited_once_with(
        messages=["conversation"],
        thread_id="thread-1",
        agent_name="lead-agent",
        correction_detected=False,
        reinforcement_detected=False,
    )


@pytest.mark.anyio
async def test_stop_worker_is_best_effort_when_update_hangs() -> None:
    queue = MemoryUpdateQueue()
    started = asyncio.Event()
    release = asyncio.Event()
    updater = MagicMock()

    async def _slow_aupdate_memory(**kwargs: object) -> bool:
        started.set()
        await release.wait()
        return True

    updater.aupdate_memory = AsyncMock(side_effect=_slow_aupdate_memory)

    with (
        patch("deerflow.agents.memory.queue.get_memory_config", return_value=_memory_config(enabled=True, debounce_seconds=1)),
        patch("deerflow.agents.memory.updater.MemoryUpdater", return_value=updater),
    ):
        await queue.start_worker()
        queue.add_nowait(thread_id="thread-1", messages=["conversation"], agent_name="lead-agent")
        await asyncio.wait_for(started.wait(), timeout=1)

        loop = asyncio.get_running_loop()
        start = loop.time()
        await queue.stop_worker(timeout_seconds=0.05)
        elapsed = loop.time() - start

    assert elapsed < 0.5
    assert queue.pending_count == 0
    assert queue.is_processing is False
