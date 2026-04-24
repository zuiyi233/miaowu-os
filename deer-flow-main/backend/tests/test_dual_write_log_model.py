from __future__ import annotations

from app.gateway.novel_migrated.models.dual_write_log import DualWriteLog


def test_dual_write_log_repr_contains_core_fields() -> None:
    log = DualWriteLog(
        id="log-1",
        modern_project_id="project-1",
        legacy_payload='{"ok":true}',
        status="failed",
        retry_count=2,
        max_retries=5,
    )

    text = repr(log)
    assert "DualWriteLog(" in text
    assert "id='log-1'" in text
    assert "modern_project_id='project-1'" in text
    assert "status='failed'" in text
    assert "retry_count=2" in text
