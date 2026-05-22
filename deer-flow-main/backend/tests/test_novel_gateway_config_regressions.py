from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import APIRouter

from app.gateway.novel_migrated.services import ai_metrics as ai_metrics_module
from app.gateway.novel_migrated.services.ai_metrics import AIMetricsService


def _build_metric_record(retry_count: int = 0) -> dict[str, object]:
    return {
        "timestamp": "2026-01-01T00:00:00",
        "provider": "openai",
        "model": "gpt-4o",
        "prompt_tokens": 1,
        "completion_tokens": 2,
        "total_tokens": 3,
        "operation_type": "generation",
        "success": True,
        "user_id": "u-1",
        "_flush_retry_count": retry_count,
    }


def test_oauth_service_alias_is_lazy_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """M-24: oauth_service export should not instantiate provider at module load time."""
    from app.gateway.novel_migrated.services import oauth_service as oauth_module

    oauth_module._oauth_service = None
    called = {"count": 0}

    def _fake_init(self) -> None:
        called["count"] += 1

    monkeypatch.setattr(oauth_module.LinuxDOOAuthService, "__init__", _fake_init)

    # Accessing compatibility alias itself should stay lazy.
    assert called["count"] == 0
    _ = oauth_module.oauth_service
    assert called["count"] == 0

    # First method call triggers real service creation.
    _ = oauth_module.oauth_service.generate_state()
    assert called["count"] == 1


def test_router_admin_module_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """M-25: admin router should be opt-in via explicit switch."""
    from app.gateway.routers import novel_migrated as router_module

    monkeypatch.delenv(router_module._ADMIN_ROUTE_SWITCH_ENV, raising=False)
    import_calls = {"count": 0}

    def _fake_import(module_path: str):
        import_calls["count"] += 1
        return SimpleNamespace(router=APIRouter(prefix="/admin", tags=["admin"]))

    monkeypatch.setattr(router_module, "_import_router_module", _fake_import)
    monkeypatch.setattr(router_module, "router", APIRouter(tags=["novel_migrated"]))

    assert router_module._include_optional_router(router_module._ADMIN_ROUTER_MODULE) is False
    assert import_calls["count"] == 0


def test_router_admin_module_can_be_enabled_explicitly(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.gateway.routers import novel_migrated as router_module

    monkeypatch.setenv(router_module._ADMIN_ROUTE_SWITCH_ENV, "true")
    import_calls = {"count": 0}

    def _fake_import(module_path: str):
        import_calls["count"] += 1
        return SimpleNamespace(router=APIRouter(prefix="/admin", tags=["admin"]))

    monkeypatch.setattr(router_module, "_import_router_module", _fake_import)
    monkeypatch.setattr(router_module, "router", APIRouter(tags=["novel_migrated"]))

    assert router_module._include_optional_router(router_module._ADMIN_ROUTER_MODULE) is True
    assert import_calls["count"] == 1


@pytest.mark.anyio
async def test_ai_metrics_flush_uses_to_thread_for_lock_sections(monkeypatch: pytest.MonkeyPatch) -> None:
    """M-26: async flush path should avoid directly blocking on thread lock."""
    service = AIMetricsService()
    ai_metrics_module._pending_writes.clear()
    ai_metrics_module._pending_writes.append(_build_metric_record())

    class _SuccessSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

        def add(self, _metric) -> None:
            return None

        async def commit(self) -> None:
            return None

    to_thread_funcs: list[str] = []

    async def _fake_to_thread(func, *args, **kwargs):
        to_thread_funcs.append(getattr(func, "__name__", "<anonymous>"))
        return func(*args, **kwargs)

    monkeypatch.setattr(ai_metrics_module, "AsyncSessionLocal", lambda: _SuccessSession())
    monkeypatch.setattr(ai_metrics_module.asyncio, "to_thread", _fake_to_thread)

    await service._flush_to_db_async()

    assert "_drain_pending_batch" in to_thread_funcs


@pytest.mark.anyio
async def test_ai_metrics_flush_failure_requeue_via_to_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    service = AIMetricsService()
    ai_metrics_module._pending_writes.clear()
    ai_metrics_module._pending_writes.append(_build_metric_record(retry_count=0))

    class _FailingSession:
        async def __aenter__(self):
            raise RuntimeError("db down")

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

    to_thread_funcs: list[str] = []

    async def _fake_to_thread(func, *args, **kwargs):
        to_thread_funcs.append(getattr(func, "__name__", "<anonymous>"))
        return func(*args, **kwargs)

    monkeypatch.setattr(ai_metrics_module, "AsyncSessionLocal", lambda: _FailingSession())
    monkeypatch.setattr(ai_metrics_module.asyncio, "to_thread", _fake_to_thread)

    await service._flush_to_db_async()

    assert "_drain_pending_batch" in to_thread_funcs
    assert "_requeue_failed_batch" in to_thread_funcs
    assert len(ai_metrics_module._pending_writes) == 1
    assert int(ai_metrics_module._pending_writes[0]["_flush_retry_count"]) == 1


def test_sync_ai_bundle_helper_filters_non_ai_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """M-28: extracted helper should keep only AI legacy fields when syncing bundle."""
    from app.gateway.novel_migrated.api import settings as settings_api

    captured: dict[str, object] = {}

    class _FakeAISettingsService:
        def sync_preferences_from_settings_payload(self, settings, payload) -> None:
            captured["settings"] = settings
            captured["payload"] = payload

    monkeypatch.setattr(settings_api, "get_ai_settings_service", lambda: _FakeAISettingsService())

    settings = SimpleNamespace()
    settings_api._sync_ai_bundle_if_needed(
        settings,
        {"cover_enabled": True, "api_provider": "openai", "max_tokens": 256},
    )

    assert captured["settings"] is settings
    assert captured["payload"] == {"api_provider": "openai", "max_tokens": 256}


def test_sync_ai_bundle_helper_skips_when_no_ai_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.gateway.novel_migrated.api import settings as settings_api

    called = {"count": 0}

    class _FakeAISettingsService:
        def sync_preferences_from_settings_payload(self, settings, payload) -> None:
            del settings, payload
            called["count"] += 1

    monkeypatch.setattr(settings_api, "get_ai_settings_service", lambda: _FakeAISettingsService())

    settings_api._sync_ai_bundle_if_needed(SimpleNamespace(), {"cover_enabled": True, "preferences": "{}"})
    assert called["count"] == 0
