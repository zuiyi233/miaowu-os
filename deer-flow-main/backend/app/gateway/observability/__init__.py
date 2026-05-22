"""Gateway observability helpers (trace context + lightweight metrics)."""

from app.gateway.observability.context import (
    copy_trace_context,
    extract_trace_fields_from_context,
    extract_trace_fields_from_headers,
    install_trace_log_filter,
    reset_trace_context,
    set_trace_context,
    update_trace_context,
)
from app.gateway.observability.metrics import (
    get_gateway_metrics_snapshot,
    record_authorization_toggle,
    record_auto_execute,
    record_clarification,
    record_confirmation_fallback,
    record_duplicate_write_intercept,
    record_gateway_request,
    reset_gateway_metrics,
)

__all__ = [
    "copy_trace_context",
    "extract_trace_fields_from_context",
    "extract_trace_fields_from_headers",
    "get_gateway_metrics_snapshot",
    "install_trace_log_filter",
    "record_authorization_toggle",
    "record_auto_execute",
    "record_clarification",
    "record_confirmation_fallback",
    "record_duplicate_write_intercept",
    "record_gateway_request",
    "reset_gateway_metrics",
    "reset_trace_context",
    "set_trace_context",
    "update_trace_context",
]
