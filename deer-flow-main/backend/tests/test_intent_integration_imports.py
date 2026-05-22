from __future__ import annotations

import importlib


def test_intent_related_modules_import_clean_checkout():
    """Guard against missing tracked files in a clean checkout."""
    domain_protocol = importlib.import_module("app.gateway.middleware.domain_protocol")
    intent_session = importlib.import_module("app.gateway.novel_migrated.models.intent_session")
    features_router = importlib.import_module("app.gateway.routers.features")

    assert hasattr(domain_protocol, "extract_context_fields")
    assert hasattr(intent_session, "IntentSessionState")
    assert hasattr(intent_session, "IntentIdempotencyKey")
    assert hasattr(features_router, "router")
