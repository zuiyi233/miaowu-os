"""In-process observability metrics for novel pipeline gateway traffic."""

from __future__ import annotations

import math
import threading
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any

_MAX_LATENCY_SAMPLES = 4096


def _safe_rate(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator, 6)


def _p95(latencies: list[float]) -> float:
    if not latencies:
        return 0.0
    sorted_values = sorted(latencies)
    index = max(0, math.ceil(len(sorted_values) * 0.95) - 1)
    return round(sorted_values[index], 3)


@dataclass
class _GatewayMetricsState:
    total_requests: int = 0
    success_requests: int = 0
    failure_requests: int = 0
    retried_requests: int = 0
    duplicate_write_intercepted: int = 0
    latencies_ms: deque[float] = field(default_factory=lambda: deque(maxlen=_MAX_LATENCY_SAMPLES))
    duplicate_by_action: Counter[str] = field(default_factory=Counter)


_METRICS_LOCK = threading.Lock()
_METRICS_STATE = _GatewayMetricsState()


def record_gateway_request(*, success: bool, retried: bool, duration_ms: float) -> None:
    """Record one /api/ai/chat request observation."""
    with _METRICS_LOCK:
        _METRICS_STATE.total_requests += 1
        if success:
            _METRICS_STATE.success_requests += 1
        else:
            _METRICS_STATE.failure_requests += 1
        if retried:
            _METRICS_STATE.retried_requests += 1
        if duration_ms >= 0:
            _METRICS_STATE.latencies_ms.append(float(duration_ms))


def record_duplicate_write_intercept(*, action: str | None = None) -> None:
    """Record one duplicate-write interception event."""
    normalized_action = (action or "unknown").strip() or "unknown"
    with _METRICS_LOCK:
        _METRICS_STATE.duplicate_write_intercepted += 1
        _METRICS_STATE.duplicate_by_action[normalized_action] += 1


def get_gateway_metrics_snapshot() -> dict[str, Any]:
    """Return aggregated metrics snapshot for observability endpoints."""
    with _METRICS_LOCK:
        total = _METRICS_STATE.total_requests
        success = _METRICS_STATE.success_requests
        failure = _METRICS_STATE.failure_requests
        retries = _METRICS_STATE.retried_requests
        duplicate = _METRICS_STATE.duplicate_write_intercepted
        latencies = list(_METRICS_STATE.latencies_ms)
        duplicate_by_action = dict(_METRICS_STATE.duplicate_by_action)

    return {
        "requests_total": total,
        "requests_success_total": success,
        "requests_failure_total": failure,
        "requests_retry_total": retries,
        "duplicate_write_intercept_total": duplicate,
        "success_rate": _safe_rate(success, total),
        "failure_rate": _safe_rate(failure, total),
        "retry_rate": _safe_rate(retries, total),
        "duplicate_write_intercept_rate": _safe_rate(duplicate, total),
        "p95_latency_ms": _p95(latencies),
        "latency_samples": len(latencies),
        "duplicate_write_intercept_by_action": duplicate_by_action,
    }


def reset_gateway_metrics() -> None:
    """Reset metrics state. Intended for unit tests."""
    with _METRICS_LOCK:
        _METRICS_STATE.total_requests = 0
        _METRICS_STATE.success_requests = 0
        _METRICS_STATE.failure_requests = 0
        _METRICS_STATE.retried_requests = 0
        _METRICS_STATE.duplicate_write_intercepted = 0
        _METRICS_STATE.latencies_ms.clear()
        _METRICS_STATE.duplicate_by_action.clear()
