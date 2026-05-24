# API-only Novel TTS Buildout Implementation Plan

## Phase 0 - Baseline And Safety

- Confirm current git status and isolate unrelated uncommitted changes before editing.
- Read backend and frontend Trellis specs before implementation.
- Capture current router registration behavior with a failing/confirming test that normal app startup exposes or misses `/api/tts/config`.
- Keep the verified local MOSS-TTS-Nano service as a real provider fixture: `http://localhost:18083`, `/health` ready, `/api/generate` returns wav `audio_base64`.
- Keep this feature separate from `newapi-manual-group-sync`; do not modify that task's files unless required by shared provider config reuse.

Validation:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_router.py -q
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm -s exec vitest run tests/unit/core/tts/useTts.test.ts tests/unit/components/novel/reader/TtsPlayer.test.tsx
```

## Phase 1 - P0 Runtime Usability

- Register `app.gateway.routers.tts` in the gateway app and add an app-level route registration test.
- Refactor backend TTS code into router + service + provider adapter modules while preserving existing endpoint behavior.
- Resolve OpenAI-compatible TTS config from existing AI Provider / NewAPI settings first, with env fallback.
- Add `moss-local` provider config and adapter with server-side base URL defaulting to `http://localhost:18083`.
- Add provider capability probing for `/v1/audio/speech`; expose capability and diagnostic fields in `/api/tts/config`.
- Add MOSS readiness probing through `/health`, `/api/warmup-status`, and `/api/text-normalization-status`.
- Add `POST /api/tts/smoke` for a short synthesis check that returns structured success/failure without storing audio.
- Update frontend API types and UI error handling for `missing_config`, unsupported endpoint/model, auth failure, rate limit, timeout, and provider failure.
- Run local-dev smoke on `127.0.0.1:8551`; use MOSS for real local offline synthesis even when external NewAPI/OpenAI credentials are unavailable.

Validation:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_router.py backend\tests\test_gateway_router_registration.py -q
Invoke-RestMethod http://127.0.0.1:8551/api/tts/config
$form = @{ text = '你好，这是喵呜小说朗读测试。'; provider = 'moss-local'; voice = 'demo-1' }
Invoke-RestMethod http://127.0.0.1:8551/api/tts/smoke -Method Post -Body ($form | ConvertTo-Json) -ContentType 'application/json'
```

## Phase 2 - P1 Models, Voices, Instructions, And Cache

- Change OpenAI-compatible default model to `gpt-4o-mini-tts` when supported, retaining configured overrides.
- Refresh provider/model voice metadata and make `/api/tts/voices` model-aware.
- Add `instructions` to request/response contracts and frontend controls for narration style.
- Map MOSS generation controls to advanced options: seed, text/audio temperature, top-p/top-k, repetition penalty, text normalization, demo prompt voice.
- Add synthesis fingerprinting and cache lookup based on chapter text hash, provider, model, voice, instructions, format, and speed.
- Store generated audio through existing media asset/object storage with `purpose = "tts_audio"`.
- Add download/reuse UI for existing chapter audio.
- Add tests for cache hit, cache miss, changed text invalidation, and storage failure.

Validation:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_router.py backend\tests\test_tts_cache.py backend\tests\test_media_assets_phase_tts.py -q
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm -s exec vitest run tests/unit/core/tts tests/unit/components/novel/reader
pnpm -s tsc --noEmit
```

## Phase 3 - P1 Long Chapter And Batch Generation

- Add stable chapter chunking with deterministic boundaries and per-chunk fingerprints.
- Add generation job model/service for chapter and batch progress, cancellation, retry, and failure reporting.
- Generate chunks with bounded concurrency and retry policy; avoid fire-and-forget tasks without observed exceptions.
- Store chunk assets and a chapter-level manifest asset or metadata record.
- Update reader playback to prefer generated chapter audio and support ordered chunk playback or stitched output.
- Add batch UI for selected chapters or whole project with progress and retry failed items.

Validation:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_chunking.py backend\tests\test_tts_jobs.py -q
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm -s exec vitest run tests/unit/core/tts tests/unit/components/novel/reader
```

## Phase 4 - P2 Professional Audiobook Features

- Add pronunciation dictionary CRUD and apply it to synthesis requests or provider-native fields.
- Add optional SSML/provider markup support with plain-text fallback.
- Add role/character voice assignment and segmentation for narrator/dialogue spans.
- Add timestamp metadata contract and read-along highlighting only for providers or alignment pipelines that can produce timestamps.
- Add optional post-processing pipeline for loudness normalization, silence trimming, fade in/out, and intro/outro.
- Add audiobook export for chapter and whole-book packages.
- Add provider capability gates and tests for unsupported advanced features.

Validation:

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_pronunciation.py backend\tests\test_tts_multivoice.py backend\tests\test_tts_export.py -q
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm -s tsc --noEmit
pnpm -s exec vitest run tests/unit/core/tts tests/unit/components/novel/reader
```

## Final Quality Gate

- Run backend targeted tests plus any impacted auth/provider/media tests.
- Run frontend typecheck and targeted unit tests.
- Run local-dev API smoke on `127.0.0.1:8551`.
- Run a browser smoke for novel reading playback if frontend dev server is available.
- Update docs with configuration, provider compatibility, limitations, and smoke commands.
- Record any provider-credential gap explicitly; do not claim real synthesis success without an actual `audio/*` response.

## Rollback Points

- Router registration can be reverted independently if it breaks app startup.
- Provider config integration must preserve env fallback for emergency rollback.
- Chapter caching must be feature-flaggable or bypassable so short synthesis remains usable.
- Batch generation and P2 features must not block simple short text playback.
