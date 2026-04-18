"""Encryption utilities for sensitive settings like API keys."""

from __future__ import annotations

import base64
import os
from cryptography.fernet import Fernet, InvalidToken

_FERNET_KEY = os.environ.get("SETTINGS_ENCRYPTION_KEY")

_fernet: Fernet | None = Fernet(_FERNET_KEY.encode()) if _FERNET_KEY else None


def _get_fernet() -> Fernet:
    """Return the Fernet instance, raising if not configured."""
    if _fernet is None:
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
    return _fernet is not None


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
