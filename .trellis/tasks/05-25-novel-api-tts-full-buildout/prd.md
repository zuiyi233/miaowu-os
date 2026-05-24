# API-only 小说 TTS 全功能建设

## Goal

Build a complete API-only TTS system for Miaowu-OS novel reading and audiobook workflows.

The feature must make the existing TTS code usable in normal local-dev/runtime mode, integrate with the existing NewAPI / AI Provider configuration path, and then grow from basic chapter playback into a production-grade audiobook pipeline with chunking, caching, persisted audio assets, batch generation, and advanced narration controls.

The implementation must not depend on browser `speechSynthesis`, local TTS engines, WSL frontend dependency flows, or non-API-only audio generation.

## Requirements

### Confirmed Current State

- Existing backend TTS router code exists at `deer-flow-main/backend/app/gateway/routers/tts.py`.
- Existing frontend TTS client/hook/player code exists under `deer-flow-main/frontend/src/core/tts/` and `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx`.
- Existing novel reading surfaces already reference TTS controls.
- Existing isolated tests pass for the TTS router and lightweight frontend TTS state/i18n checks.
- Current gateway app registration does not include `app.gateway.routers.tts`, so `/api/tts/*` is not proven available in normal app startup.
- Current TTS config reads environment variables directly, not the existing user AI Provider / NewAPI settings flow.
- Local-dev backend base must remain `http://127.0.0.1:8551`; do not introduce `8001` as a frontend/local-dev default.
- A local offline MOSS-TTS-Nano service is available at `http://localhost:18083`.
- MOSS-TTS-Nano health is ready on CUDA and exposes `GET /health`, `GET /api/warmup-status`, `GET /api/text-normalization-status`, `POST /api/generate`, and `POST /api/generate-stream/*`.
- Real MOSS-TTS-Nano smoke succeeded with a short Chinese text via `POST /api/generate`, returning `audio_base64` wav payload and no error.

### P0 - Make TTS Actually Usable

- Register the TTS router in the main gateway app so normal runtime exposes `/api/tts/config`, `/api/tts/voices`, `/api/tts/synthesize`, and health/smoke endpoints.
- Integrate TTS configuration with the existing AI Provider / NewAPI settings flow, including manual group/key selection where available.
- Keep environment variables as server-side fallback only, not the primary user-facing configuration source.
- Add the local offline MOSS-TTS-Nano service as a first-class server-side provider option named `moss-local`.
- Add NewAPI/OpenAI-compatible capability probing for `/v1/audio/speech`, including provider/model unsupported diagnostics.
- Add real runtime smoke tests against `127.0.0.1:8551` for config and one short synthesis request when credentials are available.
- Preserve authentication and user ownership boundaries: missing/invalid user context must fail with 401 where the surrounding API contract requires it.

### P1 - Production Audiobook Experience

- Update OpenAI-compatible defaults to current API expectations, including `gpt-4o-mini-tts` as the preferred default model when the selected provider supports it.
- Refresh OpenAI-compatible voice metadata to include current voices and make the voice list provider/model aware.
- Add `instructions` / narration style controls for tone, emotion, pace, accent, and narrator direction when supported by the provider.
- Add chapter-level long-text chunking with deterministic chunk boundaries, per-chunk retries, resumable generation, and final audio stitching or playlist playback.
- Cache generated chapter audio by stable synthesis fingerprint: project/chapter/text hash/provider/model/voice/instructions/format/speed.
- Persist generated audio as media assets using the existing object-storage-backed media asset system.
- Add user-visible download and reuse behavior so repeated playback does not resynthesize unchanged chapters.
- Add batch chapter generation with progress, cancellation, retry, and failure reporting.

### P2 - Professional Audiobook Capabilities

- Add SSML or provider-specific markup support where supported, while keeping a plain-text fallback for OpenAI-compatible providers.
- Add pronunciation dictionary / custom term rules for character names, place names, and invented terms.
- Add multi-character narration: narrator voice plus per-character voice assignment, with dialogue segmentation rules.
- Add custom voice / voice library metadata hooks for providers that support them; do not require voice cloning in MVP runtime.
- Add timestamp metadata where providers support it, then use it for subtitle export and read-along highlighting.
- Add optional audio post-processing pipeline for loudness normalization, silence trimming, fade in/out, and chapter intro/outro.
- Add export workflows for single chapter and whole-book audiobook packages.
- Add coverage for backend, frontend, route registration, long-text chunking, media asset caching, provider error handling, and e2e smoke.

## Acceptance Criteria

- [ ] `/api/tts/config`, `/api/tts/voices`, `/api/tts/synthesize`, and TTS health/smoke endpoints are reachable from the normal gateway app on `127.0.0.1:8551`.
- [ ] TTS can synthesize and play a short sample through an OpenAI-compatible/NewAPI provider without exposing API keys to the browser.
- [ ] TTS can synthesize and play a short sample through local `moss-local` at `http://localhost:18083` without browser-to-MOSS direct calls.
- [ ] TTS uses existing user/provider settings when available and clearly reports unsupported or unconfigured providers.
- [ ] A novel chapter longer than the upstream provider's practical request size can be generated through chunking and replayed without repeating provider calls when unchanged.
- [ ] Generated chapter audio is persisted as media assets with user/project ownership, downloadable by authorized users, and reusable by the reader UI.
- [ ] Batch generation reports per-chapter progress and supports retrying failed chunks/chapters.
- [ ] Advanced controls include model, voice, format, speed, and narration instructions; unsupported controls degrade visibly instead of silently doing nothing.
- [ ] P2 professional features have provider capability gates and tests for both supported and unsupported paths.
- [ ] Backend targeted tests, frontend targeted tests, typecheck, and local runtime smoke are documented and pass, or any external-credential gaps are explicitly reported.

## Notes

- This is a complex multi-phase feature. It requires `design.md` and `implement.md` before implementation starts.
- Do not implement all phases in one uncontrolled change. P0 must land and be verified before P1/P2 depend on it.
- External API behavior must be verified against official provider docs and real provider responses where credentials are available.
