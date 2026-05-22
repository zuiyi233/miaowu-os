"""User identity helpers for novel APIs.

Novel data belongs to the main DeerFlow authenticated user.  This module no
longer falls back to a single local user because that breaks account-level
isolation in the unified SaaS data model.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request


def _normalize_user_id(raw_user_id: Any) -> str | None:
    if raw_user_id is None:
        return None
    normalized = str(raw_user_id).strip()
    return normalized or None


def _extract_user_id_from_auth(request: Request) -> str | None:
    auth = getattr(request.state, "auth", None)
    user = getattr(auth, "user", None)
    user_id = getattr(user, "id", None)
    return _normalize_user_id(user_id)


def _extract_user_id_from_state_user(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    user_id = getattr(user, "id", None)
    return _normalize_user_id(user_id)


def resolve_user_id(user_id: str | None) -> str:
    """Normalize an explicit main-project user id.

    Internal/background callers must pass a concrete user id.  API request
    callers should use ``get_request_user_id`` so the main auth context is
    consulted first.
    """
    normalized = _normalize_user_id(user_id)
    if normalized is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return normalized


def get_request_user_id(request: Request) -> str:
    """Return the authenticated main DeerFlow user id for this request."""
    user_id = (
        _normalize_user_id(getattr(request.state, "user_id", None))
        or _extract_user_id_from_auth(request)
        or _extract_user_id_from_state_user(request)
    )
    return resolve_user_id(user_id)
