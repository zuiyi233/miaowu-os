from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.gateway.novel_migrated.services.lifecycle_service import lifecycle_service
from deerflow.config.extensions_config import ExtensionsConfig, FeatureFlagConfig


@pytest.mark.anyio
async def test_lifecycle_transition_replay_is_idempotent_under_parallel_calls() -> None:
    token = f"ws-d-load-{uuid.uuid4()}"
    holder = SimpleNamespace(status="draft")
    lifecycle_cfg = ExtensionsConfig(
        features={"novel_lifecycle_v2": FeatureFlagConfig(enabled=True, rollout_percentage=100)}
    )

    def _run_once() -> tuple[bool, bool]:
        decision = lifecycle_service.transition_status(
            status_holder=holder,
            entity_type="project",
            entity_id="ws-d-load-project",
            target_status="analyzing",
            user_id="ws-d-load-user",
            idempotency_token=token,
        )
        return decision.applied, decision.replayed

    with patch(
        "app.gateway.novel_migrated.services.lifecycle_service.get_extensions_config",
        return_value=lifecycle_cfg,
    ):
        results = await asyncio.gather(*[asyncio.to_thread(_run_once) for _ in range(12)])

    applied_count = sum(1 for applied, _replayed in results if applied)
    replayed_count = sum(1 for _applied, replayed in results if replayed)

    assert applied_count == 1
    assert replayed_count >= 1
    assert holder.status == "analyzing"
