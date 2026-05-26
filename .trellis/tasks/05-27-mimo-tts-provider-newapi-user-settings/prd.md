# MiMo Provider and NewAPI/User Settings Integration

## Goal

Add MiMo as a backend-controlled provider in the existing Miaowu TTS core, using explicit user settings/NewAPI routing or MiMo-specific server configuration, without exposing long-lived keys to the frontend or enabling TTS from generic chat configuration.

## Requirements

- Extend backend and frontend provider types with `mimo`.
- Add MiMo availability and diagnostics to `/api/tts/config`.
- Add a MiMo adapter for voice clone, voice design, and direct synthesis where applicable.
- Add backend endpoints:
  - `POST /api/tts/voices/design`
  - `POST /api/tts/voices/clone`
  - `POST /api/tts/style/optimize`
  - `POST /api/tts/voice-design/optimize`
- Route MiMo upstream calls through server-side credentials resolved from explicit TTS/MiMo routing or MiMo-specific environment variables.
- Preserve existing OpenAI/Volcengine/MOSS-local behavior.
- Keep missing user context as 401.
- Store generated voice/audio outputs as backend assets or return audio through existing TTS response patterns; do not rely on durable base64 data URLs.

## Acceptance Criteria

- [ ] `TtsProvider` supports `mimo` on backend and frontend.
- [ ] `/api/tts/config` includes `providers.mimo` and does not mark MiMo available from generic `OPENAI_BASE_URL`.
- [ ] Explicit user TTS/MiMo routing can make `providers.mimo.available=true`.
- [ ] MiMo voice design and clone payloads are validated and normalized.
- [ ] Timeout, upstream HTTP errors, empty audio, non-audio response, oversized audio, missing config, and invalid payloads return structured errors.
- [ ] Existing tests for OpenAI/Volcengine/MOSS-local still pass.
- [ ] New tests cover auth, config availability, provider resolution, and MiMo adapter error normalization.

## Out of Scope

- Studio canvas UI.
- Novel role voice management UI.
- Production deployment.
- Copying the reference Express API layer.

## Open Questions

- What exact feature module ids should be used for MiMo routing: `tts`, `tts-studio`, `mimo-tts`, or all three?

Recommended answer: support `tts` as the canonical runtime module, add `tts-studio` and `mimo-tts` aliases for explicit user intent, and document the precedence.
