from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from _router_auth_helpers import make_authed_test_app
from fastapi.testclient import TestClient

from app.gateway.app import _include_langgraph_alias_routers
from app.gateway.routers import assistants_compat, thread_runs, threads


class _DummyCheckpointer:
    async def alist(self, _config, **_kwargs):
        if False:
            yield None


class _DummyThreadStore:
    async def search(self, *, metadata=None, status=None, limit=100, offset=0, user_id=None):
        return []

    async def check_access(self, thread_id, user_id, *, require_existing=False):
        return True


def _make_alias_app():
    app = make_authed_test_app()
    app.state.checkpointer = _DummyCheckpointer()
    app.state.thread_store = _DummyThreadStore()

    run_store = MagicMock()
    run_store.aggregate_tokens_by_thread = AsyncMock(
        return_value={
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "total_runs": 0,
            "by_model": {},
            "by_caller": {},
        },
    )
    app.state.run_store = run_store

    app.include_router(threads.router)
    app.include_router(thread_runs.router)
    app.include_router(assistants_compat.router)
    _include_langgraph_alias_routers(app)
    return app


def test_langgraph_threads_search_alias_matches_threads_search_contract():
    app = _make_alias_app()

    with TestClient(app) as client:
        canonical = client.post("/api/threads/search", json={})
        alias = client.post("/api/langgraph/threads/search", json={})

    assert canonical.status_code == 200
    assert alias.status_code == 200
    assert alias.json() == canonical.json() == []


def test_langgraph_assistants_search_alias_matches_assistants_search_contract():
    app = _make_alias_app()

    with TestClient(app) as client:
        canonical = client.post("/api/assistants/search", json={})
        alias = client.post("/api/langgraph/assistants/search", json={})

    assert canonical.status_code == 200
    assert alias.status_code == 200
    assert alias.json()[0]["assistant_id"] == canonical.json()[0]["assistant_id"]
    assert alias.json()[0]["graph_id"] == canonical.json()[0]["graph_id"]
    assert alias.json()[0]["assistant_id"] == "lead_agent"


def test_langgraph_thread_run_alias_matches_thread_run_contract():
    app = _make_alias_app()

    with TestClient(app) as client:
        canonical = client.get("/api/threads/thread-1/token-usage")
        alias = client.get("/api/langgraph/threads/thread-1/token-usage")

    assert canonical.status_code == 200
    assert alias.status_code == 200
    assert alias.json() == canonical.json()
