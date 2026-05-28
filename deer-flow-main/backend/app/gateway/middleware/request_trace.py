"""Gateway HTTP middleware to initialize per-request trace context."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.gateway.observability.context import (
    build_request_id,
    extract_trace_fields_from_headers,
    reset_trace_context,
    set_trace_context,
)

logger = logging.getLogger(__name__)


class RequestTraceMiddleware(BaseHTTPMiddleware):
    """Bind a stable request trace context for logs and metrics."""

    async def dispatch(self, request: Request, call_next):
        request_id = build_request_id(request.headers.get("x-request-id"))
        header_trace = extract_trace_fields_from_headers(request.headers)
        token = set_trace_context(request_id=request_id, **header_trace)
        started_at = time.perf_counter()
        request.state.request_id = request_id

        def _duration_ms() -> float:
            return (time.perf_counter() - started_at) * 1000

        async def _iter_with_trace_context(iterator: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
            try:
                async for chunk in iterator:
                    yield chunk
            finally:
                reset_trace_context(token)

        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "Gateway request failed method=%s path=%s duration_ms=%.2f request_id=%s",
                request.method,
                request.url.path,
                _duration_ms(),
                request_id,
            )
            reset_trace_context(token)
            raise

        response.headers.setdefault("X-Request-ID", request_id)
        logger.info(
            "Gateway request completed method=%s path=%s status_code=%s duration_ms=%.2f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            _duration_ms(),
            request_id,
        )
        if hasattr(response, "body_iterator"):
            response.body_iterator = _iter_with_trace_context(response.body_iterator)
        else:
            reset_trace_context(token)
        return response
