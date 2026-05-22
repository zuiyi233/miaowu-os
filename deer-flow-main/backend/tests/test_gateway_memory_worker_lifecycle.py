from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI


@asynccontextmanager
async def _noop_async_context_manager(resource):
    yield resource


@pytest.mark.anyio
async def test_langgraph_runtime_starts_and_stops_memory_worker(monkeypatch):
    from app.gateway.deps import langgraph_runtime

    fake_queue = MagicMock()
    fake_queue.start_worker = AsyncMock(return_value=True)
    fake_queue.stop_worker = AsyncMock(return_value=None)
    monkeypatch.setattr("deerflow.agents.memory.queue.get_memory_queue", lambda: fake_queue)

    stream_bridge = MagicMock()
    checkpointer = MagicMock()
    store = MagicMock()

    with (
        patch("deerflow.runtime.make_stream_bridge", return_value=_noop_async_context_manager(stream_bridge)),
        patch("deerflow.agents.checkpointer.async_provider.make_checkpointer", return_value=_noop_async_context_manager(checkpointer)),
        patch("deerflow.runtime.make_store", return_value=_noop_async_context_manager(store)),
    ):
        app = FastAPI()
        async with langgraph_runtime(app):
            assert app.state.stream_bridge is stream_bridge
            assert app.state.checkpointer is checkpointer
            assert app.state.store is store
            assert app.state.run_manager is not None

    fake_queue.start_worker.assert_awaited_once()
    fake_queue.stop_worker.assert_awaited_once()
