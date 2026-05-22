from __future__ import annotations

from types import SimpleNamespace

from app.gateway.routers import novel as novel_router


def test_resolve_llm_uses_requested_model_name(monkeypatch):
    cfg = SimpleNamespace(models=[SimpleNamespace(name="default-model"), SimpleNamespace(name="target-model")])
    captured: dict[str, object] = {}
    fake_llm = object()

    monkeypatch.setattr("deerflow.config.app_config.get_app_config", lambda: cfg)

    def _fake_create_chat_model(*, name=None, **kwargs):
        captured["name"] = name
        captured["kwargs"] = kwargs
        return fake_llm

    monkeypatch.setattr("deerflow.models.factory.create_chat_model", _fake_create_chat_model)

    resolved = novel_router._resolve_llm("target-model")

    assert resolved is fake_llm
    assert captured["name"] == "target-model"


def test_resolve_llm_falls_back_to_first_model_name(monkeypatch):
    cfg = SimpleNamespace(models=[SimpleNamespace(name="fallback-model"), SimpleNamespace(name="other-model")])
    captured: dict[str, object] = {}
    fake_llm = object()

    monkeypatch.setattr("deerflow.config.app_config.get_app_config", lambda: cfg)

    def _fake_create_chat_model(*, name=None, **kwargs):
        captured["name"] = name
        captured["kwargs"] = kwargs
        return fake_llm

    monkeypatch.setattr("deerflow.models.factory.create_chat_model", _fake_create_chat_model)

    resolved = novel_router._resolve_llm("missing-model")

    assert resolved is fake_llm
    assert captured["name"] == "fallback-model"
