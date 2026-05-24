# API-only Novel TTS Buildout Design

## Architecture

The system should be implemented as a backend-mediated TTS pipeline:

Frontend reader UI -> gateway `/api/tts/*` -> TTS service layer -> provider adapter -> audio bytes -> media asset storage/cache -> reader playback/download.

The browser must never call provider APIs directly and must never receive raw provider API keys. Browser playback uses returned Blob URLs or persisted media asset download URLs.

## Backend Boundaries

### Router

Register `app.gateway.routers.tts` in the normal gateway app. The router owns HTTP validation, user context, status codes, and response shape only.

Required API surface:

- `GET /api/tts/config`: resolved availability, defaults, supported controls, and provider capability summaries.
- `GET /api/tts/voices?provider=&model=`: provider/model-aware voices.
- `POST /api/tts/synthesize`: short text synthesis returning audio bytes for immediate playback.
- `POST /api/tts/smoke`: credential-protected short synthesis check for runtime validation.
- `POST /api/tts/chapters/{chapter_id}/generate`: chapter-level queued or resumable generation.
- `GET /api/tts/chapters/{chapter_id}/audio`: latest active generated chapter audio metadata.
- `GET /api/tts/jobs/{job_id}`: batch/chapter generation progress.
- `POST /api/tts/jobs/{job_id}/cancel`: best-effort cancellation.
- `POST /api/tts/jobs/{job_id}/retry`: retry failed chunks/chapters.

### Service Layer

Create a TTS service layer that hides provider details from routers and frontend contracts.

Core responsibilities:

- Resolve provider config from existing AI Provider / NewAPI settings first.
- Fall back to `OPENAI_BASE_URL` / `OPENAI_API_BASE` / `OPENAI_API_KEY` and `VOLCENGINE_TTS_*` only when no user/provider setting is available.
- Probe provider capability for `/v1/audio/speech` and record unsupported-model/provider diagnostics.
- Validate text, model, voice, format, speed, and instructions centrally.
- Build deterministic synthesis fingerprints.
- Split long chapter text into chunks and persist chunk/job state.
- Store final or chunk audio in media assets with purpose such as `tts_audio`.
- Avoid re-synthesizing unchanged audio when a matching active media asset exists.

### Provider Adapters

Implement adapters behind a common interface:

- OpenAI-compatible/NewAPI adapter: `/v1/audio/speech`, default `gpt-4o-mini-tts`, voices including current OpenAI-compatible voice metadata, optional `instructions`, format support, and clear unsupported endpoint handling.
- Volcengine adapter: existing API path, voice metadata, speed support, and provider-specific payloads.
- MOSS local adapter: server-side bridge to `http://localhost:18083`, using `/health` and `/api/warmup-status` for readiness, `/api/generate` for buffered wav synthesis, and `/api/generate-stream/*` for realtime/streaming phases.
- Future adapters: ElevenLabs/Azure can be added later without changing frontend contracts.

Adapters must return audio bytes, content type, provider request metadata, and normalized errors.

MOSS-specific mapping:

- Provider id: `moss-local`.
- Base URL default: `http://localhost:18083`, configurable by server env such as `MOSS_TTS_BASE_URL`.
- Voice ids: expose built-in demo prompt voices such as `demo-1` first; later support uploaded prompt audio as custom voice assets.
- Request shape: send multipart form to `/api/generate` with `text`, `demo_id`, text normalization flags, generation parameters, and optional seed.
- Response shape: decode `audio_base64` to wav bytes and preserve returned metadata such as `sample_rate`, `normalized_text`, `text_chunks`, and warmup status.
- Streaming: use `/api/generate-stream/start`, `/audio`, `/status`, `/result`, and `/close` only after buffered synthesis is stable.

## Storage And Caching

Use the existing `MediaAsset` and object storage path for generated audio. Store generated assets with:

- `purpose = "tts_audio"`
- `project_id` when chapter belongs to a project
- `metadata_json` containing chapter id, text hash, provider, model, voice, instructions hash, format, speed, chunk info, duration if known, and synthesis fingerprint
- `content_hash` for byte-level integrity

Cache lookup should use the synthesis fingerprint before calling providers. A changed chapter text, voice, model, instructions, format, or speed must create a new fingerprint.

Large chapters should be split into stable chunks so retries only repeat failed chunks. Final playback can initially use ordered chunk playlist playback; later phases may add server-side stitched exports.

## Frontend Boundaries

The frontend should keep TTS state in `src/core/tts` and keep reader UI components thin.

Reader UX:

- Show configured provider/model/voice state.
- Play short synthesis immediately for selected text or current chapter.
- For chapters, prefer cached/generated media asset when available.
- Show generation progress for long chapters and batches.
- Support pause/resume/stop/seek/download.
- Show provider unsupported, missing config, rate limit, auth failure, and generation failed states with actionable copy.

Settings UX:

- Reuse existing AI Provider/NewAPI settings where possible.
- Add TTS-specific model/voice/style defaults without duplicating API key storage.
- Expose smoke-test result for selected provider/model.

## Advanced Features

P2 features should be capability gated:

- SSML/markup only when provider supports it; otherwise convert to plain text.
- Pronunciation dictionary applied before synthesis or through provider-native fields when available.
- Multi-character narration uses a segmentation pass that maps narrator/dialogue spans to configured voices.
- Timestamp/read-along requires provider timestamp support or a later alignment pipeline.
- Audio post-processing should be an optional backend step after raw audio generation.

## Error Handling

Errors must be normalized by category:

- `missing_config`
- `unsupported_provider`
- `unsupported_model`
- `unsupported_endpoint`
- `auth_failed`
- `rate_limited`
- `provider_timeout`
- `provider_failed`
- `storage_unavailable`
- `quota_exceeded`
- `generation_cancelled`

Frontend should receive stable error codes and localized messages. Backend logs can include provider status/body snippets but must not log secrets.

## Compatibility

- Keep local-dev backend base at `127.0.0.1:8551`.
- Keep MOSS-TTS-Nano as a server-side local provider; the Miaowu frontend must call the Miaowu gateway, not `localhost:18083` directly.
- Do not introduce frontend WSL dependency workflows.
- Preserve existing TTS imports where possible; evolve contracts rather than replacing the reader UI wholesale.
- Existing short synthesis endpoint should remain available while chapter generation is added.
