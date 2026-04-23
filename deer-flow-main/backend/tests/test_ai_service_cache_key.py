from __future__ import annotations

import hashlib

from app.gateway.novel_migrated.services.ai_service import _make_cache_key


def test_make_cache_key_hashes_api_key() -> None:
    api_key = "sk-test-plaintext"
    base_url = "https://api.example.com/v1"
    key = _make_cache_key("gpt-4o-mini", base_url=base_url, api_key=api_key)

    assert isinstance(key, tuple)
    assert len(key) == 3
    assert key[0] == "gpt-4o-mini"
    assert key[1] == base_url

    # Ensure the plaintext secret never appears in the cache key.
    assert api_key not in "|".join(key)

    expected_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
    assert key[2] == expected_hash


def test_make_cache_key_is_stable_and_unique_per_api_key() -> None:
    base_url = "https://api.example.com/v1"

    key1 = _make_cache_key("gpt-4o-mini", base_url=base_url, api_key="sk-a")
    key2 = _make_cache_key("gpt-4o-mini", base_url=base_url, api_key="sk-b")
    key3 = _make_cache_key("gpt-4o-mini", base_url=base_url, api_key="sk-a")

    assert key1 != key2
    assert key1 == key3


def test_make_cache_key_without_overrides_is_minimal() -> None:
    assert _make_cache_key("gpt-4o-mini") == ("gpt-4o-mini",)

