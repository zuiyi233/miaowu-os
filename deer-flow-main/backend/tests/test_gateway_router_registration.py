from __future__ import annotations

from fastapi.testclient import TestClient


def test_gateway_registers_tts_router_in_degraded_mode(monkeypatch) -> None:
    import app.gateway.app as gateway_app
    import app.gateway.config as gateway_config
    from app.gateway.internal_auth import create_internal_auth_headers

    original_config = gateway_config._gateway_config
    gateway_config._gateway_config = None
    monkeypatch.setattr(gateway_app, "_has_deerflow_package", lambda: False)

    try:
        app = gateway_app.create_app()
        assert any(route.path == "/api/tts/config" for route in app.routes)

        with TestClient(app) as client:
            response = client.get(
                "/api/tts/config",
                headers=create_internal_auth_headers(),
            )

        assert response.status_code == 200
        assert "moss-local" in response.json()["providers"]
    finally:
        gateway_config._gateway_config = original_config


def test_gateway_registers_images_router_in_degraded_mode(monkeypatch) -> None:
    import app.gateway.app as gateway_app
    import app.gateway.config as gateway_config
    from app.gateway.internal_auth import create_internal_auth_headers

    original_config = gateway_config._gateway_config
    gateway_config._gateway_config = None
    monkeypatch.setattr(gateway_app, "_has_deerflow_package", lambda: False)

    try:
        app = gateway_app.create_app()
        assert any(route.path == "/api/v1/images/jobs" for route in app.routes)

        with TestClient(app) as client:
            response = client.get(
                "/api/v1/images/jobs",
                headers=create_internal_auth_headers(),
            )

        assert response.status_code == 200
        assert response.json() == {"items": []}
    finally:
        gateway_config._gateway_config = original_config
