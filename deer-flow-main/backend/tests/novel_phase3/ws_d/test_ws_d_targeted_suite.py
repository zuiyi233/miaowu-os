from __future__ import annotations

from pathlib import Path


def test_ws_d_required_suite_files_exist() -> None:
    backend_root = Path(__file__).resolve().parents[3]
    expected = [
        backend_root / "tests/contracts/novel_phase3/ws_d/test_finalize_gate_contract.py",
        backend_root / "tests/e2e/novel_phase3/ws_d/test_lifecycle_e2e_flow.py",
        backend_root / "tests/load/novel_phase3/ws_d/test_idempotency_replay_flow.py",
    ]
    missing = [str(path) for path in expected if not path.exists()]
    assert not missing, f"missing ws-d suite files: {missing}"
