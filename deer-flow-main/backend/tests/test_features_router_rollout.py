from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.observability.metrics import record_gateway_request, reset_gateway_metrics
from app.gateway.routers import features as features_router
from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig


def _build_app(monkeypatch, tmp_path, cfg: ExtensionsConfig) -> FastAPI:
    config_path = tmp_path / "extensions_config.json"

    monkeypatch.setattr(features_router, "get_extensions_config", lambda: cfg)
    monkeypatch.setattr(features_router, "reload_extensions_config", lambda config_path=None: cfg)
    monkeypatch.setattr(features_router, "_resolve_config_path", lambda: config_path)

    app = FastAPI()
    app.include_router(features_router.router)
    return app


def test_update_feature_supports_rollout_and_user_lists(monkeypatch, tmp_path):
    cfg = ExtensionsConfig(features={"intent_recognition": FeatureFlagConfig(enabled=True)})
    app = _build_app(monkeypatch, tmp_path, cfg)

    with TestClient(app) as client:
        response = client.put(
            "/api/features/intent_recognition",
            json={
                "enabled": True,
                "rollout_percentage": 25,
                "allow_users": ["alice", "alice", " "],
                "deny_users": ["bob"],
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["rollout_percentage"] == 25
    assert payload["allow_users"] == ["alice"]
    assert payload["deny_users"] == ["bob"]


def test_rollback_feature_disables_and_sets_zero_rollout(monkeypatch, tmp_path):
    cfg = ExtensionsConfig(
        features={
            "intent_recognition": FeatureFlagConfig(
                enabled=True,
                rollout_percentage=80,
                allow_users=["alice"],
                deny_users=["bob"],
            )
        }
    )
    app = _build_app(monkeypatch, tmp_path, cfg)

    with TestClient(app) as client:
        response = client.post("/api/features/intent_recognition/rollback")

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is False
    assert payload["rollout_percentage"] == 0
    assert payload["allow_users"] == []
    assert payload["deny_users"] == ["bob"]


def test_evaluate_feature_uses_user_granularity(monkeypatch, tmp_path):
    cfg = ExtensionsConfig(
        features={
            "intent_recognition": FeatureFlagConfig(
                enabled=True,
                rollout_percentage=0,
                allow_users=["alice"],
                deny_users=["bob"],
            )
        }
    )
    app = _build_app(monkeypatch, tmp_path, cfg)

    with TestClient(app) as client:
        allow_response = client.get("/api/features/intent_recognition/evaluate", params={"user_id": "alice"})
        deny_response = client.get("/api/features/intent_recognition/evaluate", params={"user_id": "bob"})

    assert allow_response.status_code == 200
    assert allow_response.json()["enabled"] is True
    assert deny_response.status_code == 200
    assert deny_response.json()["enabled"] is False


def test_metrics_endpoint_returns_snapshot(monkeypatch, tmp_path):
    reset_gateway_metrics()
    record_gateway_request(success=True, retried=False, duration_ms=10)
    record_gateway_request(success=False, retried=True, duration_ms=20)

    cfg = ExtensionsConfig(features={})
    app = _build_app(monkeypatch, tmp_path, cfg)

    with TestClient(app) as client:
        response = client.get("/api/features/metrics/novel-pipeline")

    assert response.status_code == 200
    payload = response.json()["metrics"]
    assert payload["requests_total"] == 2
    assert payload["requests_success_total"] == 1
    assert payload["requests_failure_total"] == 1
    assert payload["requests_retry_total"] == 1
    assert payload["p95_latency_ms"] > 0
