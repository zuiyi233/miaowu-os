# Technical Design

## Backend Provider Adapter

Implement MiMo under the existing `tts_support` boundary:

- update `TtsProvider`
- add request models for MiMo advanced options and voice endpoints
- add a MiMo config resolver
- add call helpers for voice clone, voice design, and text optimization
- reuse existing HTTP client, error normalization, size checks, and content-type checks

The adapter should understand the reference MiMo response shape:

- text: `choices[0].message.content`
- audio base64: `choices[0].message.audio.data`

## Config Resolution

Resolution order:

1. explicit `ai_provider_id` when it points to a configured provider and is allowed for TTS/MiMo
2. feature routing module ids: `tts`, `tts-studio`, `mimo-tts`
3. MiMo-specific environment variables

Do not use:

- generic active provider
- generic OpenAI env
- frontend-provided key

## Public API

Add focused models rather than accepting arbitrary dicts for new endpoints:

- design: voice description, text/sample text, instruction, model, format, optional provider id
- clone: reference audio asset id or temporary data URL, text, instruction/style, model, format, optional provider id
- style optimize: style text and optional provider id
- voice-design optimize: voice description and optional provider id

Return a normalized response with:

- `asset_id`
- `url`
- `download_url`
- `content_type`
- `provider`
- `model`
- `metadata`
- optional diagnostics

## Tests

Use `deer-flow-main/backend/tests/test_tts_router.py` as the primary contract test location unless studio persistence creates a separate suite.

Required cases:

- unauthenticated request returns 401 in real app dependency mode
- regular OpenAI chat config does not enable MiMo
- explicit MiMo/TTS route enables MiMo
- successful voice design parses audio
- successful voice clone validates reference input
- upstream timeout maps to `provider_timeout`
- upstream HTTP status maps to structured error
- empty audio maps to `provider_failed`
- oversized audio maps to structured error

## Compatibility Notes

The existing `build_config_response` default provider order should remain stable unless MiMo is explicitly available and product policy chooses it. Prefer not making MiMo the automatic default in the first provider child; let UI select it explicitly.
