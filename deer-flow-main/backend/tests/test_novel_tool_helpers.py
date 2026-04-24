from __future__ import annotations

import asyncio

import httpx

from deerflow.tools.builtins import novel_tool_helpers


class _FakeResponse:
    def __init__(self, *, status_code: int, payload: dict, method: str, url: str) -> None:
        self.status_code = status_code
        self._payload = payload
        self._request = httpx.Request(method, url)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=self._request,
                response=httpx.Response(self.status_code, request=self._request),
            )

    def json(self):
        return self._payload


class _FakeAsyncClient:
    calls: list[tuple[str, str]] = []

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def request(self, method: str, url: str, **kwargs):
        _FakeAsyncClient.calls.append((method, url))
        if len(_FakeAsyncClient.calls) == 1:
            return _FakeResponse(status_code=404, payload={"detail": "missing"}, method=method, url=url)
        return _FakeResponse(status_code=200, payload={"ok": True, "url": url}, method=method, url=url)


def test_post_json_route_prefix_fallback_on_404(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(novel_tool_helpers.httpx, "AsyncClient", _FakeAsyncClient)

    result = asyncio.run(
        novel_tool_helpers.post_json(
            "http://127.0.0.1:8551/projects/world-build",
            {"project_id": "p-1"},
        )
    )

    assert result["ok"] is True
    assert [url for _, url in _FakeAsyncClient.calls] == [
        "http://127.0.0.1:8551/projects/world-build",
        "http://127.0.0.1:8551/api/projects/world-build",
    ]


def test_ok_preserves_core_fields_when_extra_conflicts():
    result = novel_tool_helpers._ok(
        {"success": True, "value": 1},
        success=False,
        value=2,
        source="novel",
    )

    assert result["success"] is True
    assert result["value"] == 1
    assert result["source"] == "novel"
    assert result["_extra_conflicts"] == {"success": False, "value": 2}


def test_fail_preserves_core_fields_when_extra_conflicts():
    result = novel_tool_helpers._fail(
        "boom",
        success=True,
        code="E100",
    )

    assert result["success"] is False
    assert result["error"] == "boom"
    assert result["code"] == "E100"
    assert result["_extra_conflicts"] == {"success": True}


def test_pick_non_empty_str_and_context_key_constants():
    source = {"userId": " user-1 ", "threadId": " thread-9 "}
    user = novel_tool_helpers.pick_non_empty_str(source, *novel_tool_helpers.USER_CONTEXT_KEYS)
    thread = novel_tool_helpers.pick_non_empty_str(source, *novel_tool_helpers.SESSION_CONTEXT_KEYS)

    assert user == "user-1"
    assert thread == "thread-9"


def test_get_base_url_uses_default_base_url_when_env_overrides_are_missing(monkeypatch):
    monkeypatch.delenv("DEERFLOW_NOVEL_TOOL_BASE_URL", raising=False)
    monkeypatch.delenv("DEER_FLOW_INTERNAL_GATEWAY_BASE_URL", raising=False)
    monkeypatch.delenv("GATEWAY_PORT", raising=False)

    assert novel_tool_helpers.get_base_url() == "http://127.0.0.1:8551"


def test_get_base_url_uses_gateway_port_when_explicit_base_url_missing(monkeypatch):
    monkeypatch.delenv("DEERFLOW_NOVEL_TOOL_BASE_URL", raising=False)
    monkeypatch.delenv("DEER_FLOW_INTERNAL_GATEWAY_BASE_URL", raising=False)
    monkeypatch.setenv("GATEWAY_PORT", "9123")

    assert novel_tool_helpers.get_base_url() == "http://127.0.0.1:9123"


def test_get_base_url_prefers_explicit_base_url_over_gateway_port(monkeypatch):
    monkeypatch.setenv("DEERFLOW_NOVEL_TOOL_BASE_URL", "http://127.0.0.1:9555/")
    monkeypatch.setenv("DEER_FLOW_INTERNAL_GATEWAY_BASE_URL", "http://127.0.0.1:8551")
    monkeypatch.setenv("GATEWAY_PORT", "8551")

    assert novel_tool_helpers.get_base_url() == "http://127.0.0.1:9555"
