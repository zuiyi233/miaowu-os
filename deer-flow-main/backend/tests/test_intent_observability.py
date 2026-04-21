from __future__ import annotations

import asyncio
from datetime import datetime

from app.gateway.middleware.intent_recognition_middleware import IntentRecognitionMiddleware, _NovelCreationSession
from app.gateway.observability.metrics import get_gateway_metrics_snapshot, reset_gateway_metrics
from deerflow.config import extensions_config as extensions_config_module
from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig


def test_finalize_creation_duplicate_records_intercept_metric(monkeypatch):
    middleware = IntentRecognitionMiddleware()
    session = _NovelCreationSession(
        session_key="session-1",
        user_id="user-1",
        started_at=datetime.now(),
        updated_at=datetime.now(),
        mode="create",
        fields={"title": "T", "genre": "科幻", "theme": "", "audience": "", "target_words": 1000},
        idempotency_key="idem-1",
    )

    async def _consume_idempotency_key(*args, **kwargs):
        return False

    async def _remove_session(*args, **kwargs):
        return None

    monkeypatch.setattr(middleware, "_consume_idempotency_key", _consume_idempotency_key)
    monkeypatch.setattr(middleware, "_remove_session", _remove_session)

    reset_gateway_metrics()
    result = asyncio.run(middleware._finalize_creation(session=session, db_session=None))

    assert result.handled is True
    assert result.session["status"] == "duplicate"
    snapshot = get_gateway_metrics_snapshot()
    assert snapshot["duplicate_write_intercept_total"] == 1
    assert snapshot["duplicate_write_intercept_by_action"]["create_novel"] == 1


def test_feature_flag_evaluation_is_user_scoped(monkeypatch):
    cfg = ExtensionsConfig(
        features={
            "intent_recognition": FeatureFlagConfig(
                enabled=True,
                rollout_percentage=0,
                allow_users=["allowed-user"],
            )
        }
    )
    monkeypatch.setattr(extensions_config_module, "get_extensions_config", lambda: cfg)

    middleware = IntentRecognitionMiddleware()

    assert middleware._is_feature_enabled(user_id="allowed-user") is True
    assert middleware._is_feature_enabled(user_id="blocked-user") is False
