from __future__ import annotations

from types import SimpleNamespace

from deerflow.tools.tools import get_available_tools


def _make_config():
    return SimpleNamespace(
        tools=[
            SimpleNamespace(name="ls", group="file:read", use="tests:ls_tool"),
        ],
        models=[],
        sandbox=SimpleNamespace(
            use="deerflow.sandbox.local:LocalSandboxProvider",
            allow_host_bash=False,
        ),
        tool_search=SimpleNamespace(enabled=False),
        skill_evolution=SimpleNamespace(enabled=False),
        get_model_config=lambda name: None,
    )


def test_get_available_tools_includes_create_novel_builtin(monkeypatch):
    monkeypatch.setattr("deerflow.tools.tools.get_app_config", _make_config)
    monkeypatch.setattr(
        "deerflow.tools.tools.resolve_variable",
        lambda use, _: SimpleNamespace(name="ls"),
    )

    tools = get_available_tools(include_mcp=False, subagent_enabled=False)
    names = [tool.name for tool in tools]

    assert "create_novel" in names
