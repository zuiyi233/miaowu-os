from __future__ import annotations

from types import SimpleNamespace

from deerflow.tools import builtins as builtins_module
from deerflow.tools import tools as tools_module
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


def test_novel_tools_are_derived_from_builtins_single_source() -> None:
    """L-06 regression: tools.py should derive novel tools from builtins exports."""
    assert tools_module.NOVEL_TOOLS == list(builtins_module.NOVEL_BUILTIN_TOOLS)
    assert tools_module.CORE_TOOLS == list(builtins_module.CORE_BUILTIN_TOOLS)


def test_get_available_tools_excludes_novel_tools_when_disabled(monkeypatch):
    monkeypatch.setattr("deerflow.tools.tools.get_app_config", _make_config)
    monkeypatch.setattr(
        "deerflow.tools.tools.resolve_variable",
        lambda use, _: SimpleNamespace(name="ls"),
    )

    tools = get_available_tools(include_mcp=False, subagent_enabled=False, include_novel=False)
    names = [tool.name for tool in tools]

    assert "create_novel" not in names
    assert "present_files" in names
