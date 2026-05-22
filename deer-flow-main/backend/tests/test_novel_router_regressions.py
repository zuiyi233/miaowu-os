from __future__ import annotations

import asyncio

from app.gateway.novel_migrated.api import chapters, foreshadows, memories


def _get_route_query_params(*, route_path: str, method: str, route_module: object) -> list[str]:
    router = getattr(route_module, "router")
    for route in router.routes:
        if getattr(route, "path", None) != route_path:
            continue
        methods = getattr(route, "methods", set()) or set()
        if method not in methods:
            continue
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            break
        return [param.name for param in dependant.query_params]
    raise AssertionError(f"route not found: {method} {route_path}")


def test_foreshadow_routes_do_not_expose_user_id_as_query_param():
    for route in foreshadows.router.routes:
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            continue
        query_param_names = [param.name for param in dependant.query_params]
        assert "user_id" not in query_param_names, f"user_id leaked in route {route.path}"


def test_memory_analyze_route_does_not_expose_ai_service_query_param():
    query_params = _get_route_query_params(
        route_path="/api/memories/projects/{project_id}/analyze-chapter/{chapter_id}",
        method="POST",
        route_module=memories,
    )
    assert "ai_service" not in query_params


def test_list_chapters_keeps_total_when_page_rows_are_empty(monkeypatch):
    class _RowsResult:
        @staticmethod
        def all():
            return []

    class _CountResult:
        @staticmethod
        def scalar():
            return 3

    class _FakeDB:
        def __init__(self) -> None:
            self.calls = 0

        async def execute(self, _query):
            self.calls += 1
            if self.calls == 1:
                return _RowsResult()
            if self.calls == 2:
                return _CountResult()
            raise AssertionError("unexpected extra execute call")

    async def _fake_verify_project_access(*_args, **_kwargs):
        return None

    monkeypatch.setattr(chapters, "verify_project_access", _fake_verify_project_access)

    db = _FakeDB()
    payload = asyncio.run(
        chapters.list_chapters(
            project_id="project-1",
            user_id="user-1",
            db=db,
            offset=500,
            limit=20,
        )
    )

    assert payload["chapters"] == []
    assert payload["total"] == 3
    assert payload["offset"] == 500
    assert payload["limit"] == 20
    assert db.calls == 2
