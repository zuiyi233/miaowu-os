"""HTTP header helpers for novel APIs."""

from __future__ import annotations

from urllib.parse import quote


def safe_download_content_disposition(filename: str) -> str:
    """Build a safe attachment Content-Disposition header value."""
    normalized = (filename or "download.bin").strip().replace("\\", "/").split("/")[-1]
    normalized = normalized.replace("\r", "_").replace("\n", "_").replace('"', "_")
    normalized = normalized or "download.bin"
    ascii_fallback = "".join(ch if 32 <= ord(ch) < 127 else "_" for ch in normalized)
    ascii_fallback = ascii_fallback.replace(";", "_") or "download.bin"
    encoded = quote(normalized, safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"
