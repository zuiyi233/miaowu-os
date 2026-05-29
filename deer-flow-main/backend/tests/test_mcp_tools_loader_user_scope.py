from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.gateway.novel_migrated.services.mcp_tools_loader import MCPToolsLoader


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDBSession:
    def __init__(self, preferences_json: str):
        self._preferences_json = preferences_json

    async def execute(self, _stmt):
        return _ScalarResult(SimpleNamespace(preferences=self._preferences_json))


def test_get_user_langchain_tools_passes_user_filtered_enabled_server_names(monkeypatch) -> None:
    loader = MCPToolsLoader()
    loader.invalidate_cache()

    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.mcp_tools_loader.ExtensionsConfig.from_file",
        classmethod(
            lambda cls: cls.model_validate(
                {
                    "mcpServers": {
                        "server-a": {"enabled": True, "type": "stdio", "command": "echo"},
                        "server-b": {"enabled": True, "type": "stdio", "command": "echo"},
                    }
                }
            )
        ),
    )

    captured: dict[str, object] = {}

    async def _fake_load_langchain_tools(*, enabled_server_names=None):
        captured["enabled_server_names"] = enabled_server_names
        return []

    monkeypatch.setattr(loader, "_load_langchain_tools", _fake_load_langchain_tools)

    db_session = _FakeDBSession(
        '{"user_tool_settings":{"version":1,"enabled_mcp_servers":{"server-a":false,"server-b":true}}}'
    )

    asyncio.run(
        loader.get_user_langchain_tools(
            user_id="user-a",
            db_session=db_session,
            use_cache=False,
            force_refresh=True,
        )
    )

    assert captured["enabled_server_names"] == {"server-b"}

