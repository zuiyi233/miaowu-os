from cryptography.fernet import Fernet

from app.gateway.novel_migrated.core import crypto


def _set_key(value: str):
    crypto._FERNET_KEY = value
    crypto._fernet = None


def test_validate_encryption_key_missing():
    _set_key("")
    is_valid, error = crypto.validate_encryption_key()
    assert is_valid is False
    assert error is None


def test_validate_encryption_key_invalid():
    _set_key("invalid-key")
    is_valid, error = crypto.validate_encryption_key()
    assert is_valid is False
    assert error is not None


def test_encrypt_and_decrypt_with_valid_key():
    key = Fernet.generate_key().decode()
    _set_key(key)

    assert crypto.is_encryption_enabled() is True
    encrypted = crypto.encrypt_secret("top-secret")
    assert encrypted != "top-secret"
    assert crypto.decrypt_secret(encrypted) == "top-secret"

