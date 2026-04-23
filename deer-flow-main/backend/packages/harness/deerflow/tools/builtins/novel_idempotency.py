from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_IDEMPOTENCY_DIR = Path(os.environ.get(
    "DEERFLOW_NOVEL_IDEMPOTENCY_DIR",
    str(Path.cwd() / "novel_state" / "idempotency"),
))
_TTL_SECONDS = 3600 * 6
_store_lock = threading.Lock()
_memory_store: dict[str, datetime] = {}


def _make_key(tool_name: str, idempotency_key: str) -> str:
    raw = f"{tool_name}:{idempotency_key}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _prune() -> None:
    cutoff = _now().timestamp() - _TTL_SECONDS
    expired = [k for k, v in _memory_store.items() if v.timestamp() < cutoff]
    for k in expired:
        _memory_store.pop(k, None)


def check_idempotency(
    tool_name: str,
    idempotency_key: str | None,
) -> dict[str, Any]:
    """Check if a tool call with the given idempotency key has already been processed.

    Returns:
        Dict with:
        - "is_duplicate": True if this key was already seen
        - "key_hash": The hashed key for logging
        - "first_seen": ISO timestamp of first occurrence (if duplicate)
    """
    if not idempotency_key or not idempotency_key.strip():
        return {"is_duplicate": False, "key_hash": None, "first_seen": None}

    key_hash = _make_key(tool_name, idempotency_key.strip())
    now = _now()

    with _store_lock:
        _prune()
        existing = _memory_store.get(key_hash)
        if existing is not None:
            return {
                "is_duplicate": True,
                "key_hash": key_hash,
                "first_seen": existing.isoformat(),
            }
        _memory_store[key_hash] = now
        _persist_to_disk(key_hash, now)

    return {"is_duplicate": False, "key_hash": key_hash, "first_seen": None}


def _persist_to_disk(key_hash: str, ts: datetime) -> None:
    try:
        _DEFAULT_IDEMPOTENCY_DIR.mkdir(parents=True, exist_ok=True)
        record_file = _DEFAULT_IDEMPOTENCY_DIR / f"{key_hash}.json"
        record_file.write_text(
            json.dumps({"key_hash": key_hash, "recorded_at": ts.isoformat()}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as exc:
        logger.debug("idempotency disk persist skipped: %s", exc)


def _load_from_disk() -> None:
    if not _DEFAULT_IDEMPOTENCY_DIR.exists():
        return
    try:
        for f in _DEFAULT_IDEMPOTENCY_DIR.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                ts_str = data.get("recorded_at", "")
                if ts_str:
                    ts = datetime.fromisoformat(ts_str)
                    if (datetime.now(tz=UTC) - ts).total_seconds() < _TTL_SECONDS:
                        key_hash = data["key_hash"]
                        _memory_store[key_hash] = ts
            except Exception:
                pass
    except Exception as exc:
        logger.debug("idempotency disk load skipped: %s", exc)


_load_from_disk()
