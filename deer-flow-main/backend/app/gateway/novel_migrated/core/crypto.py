"""Encryption utilities for sensitive settings like API keys."""

from __future__ import annotations

import base64
import os
from cryptography.fernet import Fernet, InvalidToken

_FERNET_KEY = (os.environ.get("SETTINGS_ENCRYPTION_KEY") or "").strip()
_fernet: Fernet | None = None


def validate_encryption_key() -> tuple[bool, str | None]:
    """Validate SETTINGS_ENCRYPTION_KEY format.

    Returns:
        tuple[bool, str | None]:
            - bool: whether key is valid and encryption can be enabled
            - str | None: error message when invalid
    """
    if not _FERNET_KEY:
        return False, None

    try:
        Fernet(_FERNET_KEY.encode())
        return True, None
    except Exception as exc:  # pragma: no cover - defensive branch
        return False, str(exc)


def _get_fernet() -> Fernet:
    """Return the Fernet instance, raising if not configured."""
    global _fernet
    if _fernet is not None:
        return _fernet

    if _fernet is None:
        if not _FERNET_KEY:
            raise RuntimeError(
                "SETTINGS_ENCRYPTION_KEY environment variable is not set. "
                "Generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )

        try:
            _fernet = Fernet(_FERNET_KEY.encode())
        except Exception as exc:
            raise RuntimeError(
                "SETTINGS_ENCRYPTION_KEY is invalid. "
                "It must be a 32-byte url-safe base64 key. "
                f"Original error: {exc}"
            ) from exc

    if _fernet is None:  # pragma: no cover - defensive branch
        raise RuntimeError(
            "SETTINGS_ENCRYPTION_KEY environment variable is not set. "
            "Generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return _fernet


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext string and return a URL-safe base64 ciphertext."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a ciphertext string back to plaintext."""
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        raise ValueError("Failed to decrypt: invalid or tampered ciphertext")


def is_encryption_enabled() -> bool:
    """Check whether encryption is configured."""
    is_valid, _ = validate_encryption_key()
    return is_valid


def safe_decrypt(value: str | None) -> str | None:
    """Decrypt a value if encryption is enabled and value looks encrypted, else return as-is."""
    if value is None:
        return None
    if not is_encryption_enabled():
        return value
    try:
        return decrypt_secret(value)
    except (ValueError, Exception):
        return value
