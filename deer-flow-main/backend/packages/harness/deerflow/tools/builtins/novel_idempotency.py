from __future__ import annotations

import hashlib
import json
import logging
import os
import queue
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_IDEMPOTENCY_DIR_ENV = "DEERFLOW_NOVEL_IDEMPOTENCY_DIR"
_TTL_SECONDS = 3600 * 6
_MAX_DISK_FILES = 10000
_store_lock = threading.Lock()
_memory_store: dict[str, datetime] = {}
_pending_persists: list[tuple[str, datetime]] = []
_persist_queue: queue.Queue[tuple[str, datetime]] = queue.Queue(maxsize=50000)
_persist_worker_started = False
_store_initialized = False
_DISK_CLEANUP_INTERVAL_SECONDS = 600
_last_disk_cleanup_at = 0.0


def _make_key(tool_name: str, idempotency_key: str) -> str:
    raw = f"{tool_name}:{idempotency_key}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _now() -> datetime:
    return datetime.now(tz=UTC)


def _get_idempotency_dir() -> Path:
    return Path(
        os.environ.get(
            _IDEMPOTENCY_DIR_ENV,
            str(Path.cwd() / "novel_state" / "idempotency"),
        )
    )


def _ensure_store_initialized() -> None:
    global _store_initialized, _last_disk_cleanup_at
    if _store_initialized:
        return
    with _store_lock:
        if _store_initialized:
            return
        _load_from_disk()
        _cleanup_expired_disk_files()
        _last_disk_cleanup_at = time.time()
        _store_initialized = True


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

    _ensure_store_initialized()
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
        _pending_persists.append((key_hash, now))

    _flush_pending_persists()
    return {"is_duplicate": False, "key_hash": key_hash, "first_seen": None}


def _ensure_persist_worker() -> None:
    global _persist_worker_started
    if _persist_worker_started:
        return
    thread = threading.Thread(
        target=_persist_worker,
        name="novel-idempotency-persist",
        daemon=True,
    )
    thread.start()
    _persist_worker_started = True


def _persist_worker() -> None:
    global _last_disk_cleanup_at

    while True:
        try:
            key_hash, ts = _persist_queue.get()
            _persist_to_disk(key_hash, ts)

            # Best-effort periodic cleanup to avoid disk bloat (H-03).
            now = time.time()
            if now - _last_disk_cleanup_at >= _DISK_CLEANUP_INTERVAL_SECONDS:
                _cleanup_expired_disk_files()
                _last_disk_cleanup_at = now
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("idempotency persist worker skipped: %s", exc)


def _flush_pending_persists() -> None:
    """Persist queued entries to disk outside the store lock."""
    with _store_lock:
        batch = list(_pending_persists)
        _pending_persists.clear()

    if not batch:
        return
    _ensure_persist_worker()
    dropped = 0
    for item in batch:
        try:
            _persist_queue.put_nowait(item)
        except queue.Full:
            dropped += 1
    if dropped:
        logger.warning("Idempotency persist queue is full, dropped %d entries", dropped)


def _persist_to_disk(key_hash: str, ts: datetime) -> None:
    try:
        idempotency_dir = _get_idempotency_dir()
        idempotency_dir.mkdir(parents=True, exist_ok=True)
        record_file = idempotency_dir / f"{key_hash}.json"
        record_file.write_text(
            json.dumps({"key_hash": key_hash, "recorded_at": ts.isoformat()}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception as exc:
        logger.debug("idempotency disk persist skipped: %s", exc)


def _cleanup_expired_disk_files() -> None:
    """Remove expired JSON files from disk."""
    idempotency_dir = _get_idempotency_dir()
    if not idempotency_dir.exists():
        return
    cutoff = _now().timestamp() - _TTL_SECONDS
    removed = 0
    try:
        for f in idempotency_dir.glob("*.json"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink(missing_ok=True)
                    removed += 1
            except Exception:
                pass
    except Exception as exc:
        logger.debug("idempotency disk cleanup skipped: %s", exc)
    if removed:
        logger.debug("Cleaned up %d expired idempotency files", removed)


def _load_from_disk() -> None:
    idempotency_dir = _get_idempotency_dir()
    if not idempotency_dir.exists():
        return
    try:
        files = list(idempotency_dir.glob("*.json"))
        if len(files) > _MAX_DISK_FILES:
            logger.warning(
                "Too many idempotency files (%d > %d), skipping load",
                len(files),
                _MAX_DISK_FILES,
            )
            return
        for f in files:
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
