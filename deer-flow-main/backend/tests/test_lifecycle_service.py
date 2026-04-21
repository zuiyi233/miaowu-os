from __future__ import annotations

from dataclasses import dataclass

from app.gateway.novel_migrated.services.lifecycle_service import NovelLifecycleService
from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig


@dataclass
class _StatusHolder:
    status: str


def test_lifecycle_transition_matrix_and_publish_strategy():
    service = NovelLifecycleService()

    allowed = service.validate_transition(current_status="draft", target_status="analyzing")
    assert allowed["valid"] is True
    assert allowed["reason"] == "allowed"

    blocked = service.validate_transition(current_status="draft", target_status="published")
    assert blocked["valid"] is False
    assert blocked["reason"] == "invalid_transition"

    publish_blocked = service.build_publish_strategy(current_status="revising")
    assert publish_blocked["can_publish"] is False
    assert publish_blocked["required_previous_status"] == "finalized"

    publish_ready = service.build_publish_strategy(current_status="finalized")
    assert publish_ready["can_publish"] is True


def test_lifecycle_transition_feature_disabled_uses_legacy_fallback(monkeypatch):
    service = NovelLifecycleService()
    holder = _StatusHolder(status="completed")

    cfg = ExtensionsConfig(
        features={"novel_lifecycle_v2": FeatureFlagConfig(enabled=False, rollout_percentage=100)}
    )
    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.lifecycle_service.get_extensions_config",
        lambda: cfg,
    )

    decision = service.transition_status(
        status_holder=holder,
        entity_type="chapter",
        entity_id="chapter-1",
        target_status="analyzing",
        user_id="user-disabled",
        idempotency_token="idem-disabled",
        legacy_target_status="completed",
    )

    assert decision.enabled is False
    assert decision.degraded is True
    assert decision.reason == "feature_disabled_legacy_fallback"
    assert holder.status == "completed"


def test_lifecycle_transition_replay_and_multi_stage_token(monkeypatch):
    service = NovelLifecycleService()
    holder = _StatusHolder(status="draft")

    cfg = ExtensionsConfig(
        features={"novel_lifecycle_v2": FeatureFlagConfig(enabled=True, rollout_percentage=100)}
    )
    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.lifecycle_service.get_extensions_config",
        lambda: cfg,
    )

    first = service.transition_status(
        status_holder=holder,
        entity_type="chapter",
        entity_id="chapter-2",
        target_status="analyzing",
        user_id="user-enabled",
        idempotency_token="idem-enabled",
    )
    assert first.applied is True
    assert holder.status == "analyzing"

    replay = service.transition_status(
        status_holder=holder,
        entity_type="chapter",
        entity_id="chapter-2",
        target_status="analyzing",
        user_id="user-enabled",
        idempotency_token="idem-enabled",
    )
    assert replay.replayed is True
    assert replay.reason == "idempotent_replay_noop"

    second_stage = service.transition_status(
        status_holder=holder,
        entity_type="chapter",
        entity_id="chapter-2",
        target_status="revising",
        user_id="user-enabled",
        idempotency_token="idem-enabled",
    )
    assert second_stage.valid is True
    assert second_stage.applied is True
    assert holder.status == "revising"


def test_lifecycle_replay_token_persists_across_service_restarts(monkeypatch, tmp_path):
    persistence_file = tmp_path / "lifecycle_tokens.json"
    holder = _StatusHolder(status="draft")

    cfg = ExtensionsConfig(
        features={"novel_lifecycle_v2": FeatureFlagConfig(enabled=True, rollout_percentage=100)}
    )
    monkeypatch.setattr(
        "app.gateway.novel_migrated.services.lifecycle_service.get_extensions_config",
        lambda: cfg,
    )

    first_service = NovelLifecycleService(persistence_file=persistence_file)
    first_decision = first_service.transition_status(
        status_holder=holder,
        entity_type="chapter",
        entity_id="chapter-persist-1",
        target_status="analyzing",
        user_id="persist-user",
        idempotency_token="persist-token",
    )
    assert first_decision.applied is True
    assert persistence_file.exists()

    reloaded_service = NovelLifecycleService(persistence_file=persistence_file)
    replay = reloaded_service.transition_status(
        status_holder=_StatusHolder(status="analyzing"),
        entity_type="chapter",
        entity_id="chapter-persist-1",
        target_status="analyzing",
        user_id="persist-user",
        idempotency_token="persist-token",
    )
    assert replay.replayed is True
    assert replay.reason == "idempotent_replay_noop"
