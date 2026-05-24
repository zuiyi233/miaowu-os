# Research: TTS impact map for P2 continuation

- Query: Read task jsonl entries, `prd.md`, `design.md`, `implement.md`, Trellis specs, and current TTS code to map backend/frontend impact for resumable local fallback manifests, sturdier multi-worker behavior, and feasible P2 audiobook capabilities.
- Scope: internal
- Date: 2026-05-25

## Findings

### Task and Spec Context

- `.trellis/tasks/05-25-novel-api-tts-full-buildout/prd.md` defines the target as API-only TTS for novel reading/audiobook workflows, with browser provider calls and browser `speechSynthesis` explicitly out of scope.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/prd.md` requires P0 normal gateway exposure, NewAPI/user provider settings integration, `moss-local`, provider probing, auth ownership boundaries, P1 chunking/cache/media assets/batch jobs, and P2 SSML/pronunciation/role voices/voice library/timestamps/postprocess/export.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/design.md` sets the intended flow: frontend reader UI -> gateway `/api/tts/*` -> service/provider adapter -> audio bytes -> media asset storage/cache -> playback/download.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/design.md` says generated TTS should use existing `MediaAsset`/object storage with `purpose = "tts_audio"`, project/user ownership metadata, and stable synthesis fingerprints.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.md` phases the work as: P0 runtime usability, P1 model/voice/instructions/cache, P1 long chapter/batch generation, then P2 professional audiobook features.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.jsonl` points implement agents at `tts.py`, `tts_support`, gateway registration, frontend `src/core/tts`, reader components, media asset model/API/service, and MOSS runtime.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/check.jsonl` points checks at backend error handling, async/background-worker hygiene, cross-layer 8551 wiring, existing TTS tests, and MOSS/gateway runtime smoke endpoints.
- `.trellis/spec/backend/quality-guidelines.md` requires detached async work to consume exceptions and avoid unobserved fire-and-forget tasks; this is directly relevant if TTS jobs become true background/multi-worker workers.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` records the local-dev contract: Miaowu direct frontend/backend calls must use `127.0.0.1:8551`, while container-internal `8001` references are a separate profile.

### Backend Files and Current Contract

- `deer-flow-main/backend/app/gateway/app.py:120-125` includes `app.gateway.routers.tts` in `CORE_ROUTER_MODULES`; P0 route registration appears present in current code.
- `deer-flow-main/backend/app/gateway/routers/tts.py:42` declares `APIRouter(prefix="/api/tts", tags=["tts"])`.
- `deer-flow-main/backend/app/gateway/routers/tts.py:56-58` exposes `GET /api/tts/voices` with optional `provider` and `model`.
- `deer-flow-main/backend/app/gateway/routers/tts.py:65-86` exposes `POST /api/tts/synthesize`, requires `get_user_id`, calls `synthesize_tts`, and returns raw audio bytes with `X-Audio-Size` and `X-TTS-Provider`.
- `deer-flow-main/backend/app/gateway/routers/tts.py:89-94` exposes `GET /api/tts/config`, requires user context, and resolves config through `build_config_response`.
- `deer-flow-main/backend/app/gateway/routers/tts.py:97-108` exposes MOSS readiness and smoke endpoints.
- `deer-flow-main/backend/app/gateway/routers/tts.py:111-117` exposes `POST /api/tts/probe` for OpenAI-compatible `/audio/speech` probing.
- `deer-flow-main/backend/app/gateway/routers/tts.py:120-155` exposes chapter generation, chapter audio manifest, and chapter audio download.
- `deer-flow-main/backend/app/gateway/routers/tts.py:158-183` exposes in-memory job get/cancel/retry routes.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:35` defines providers as `openai`, `volcengine`, and `moss-local`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:47-51` sets OpenAI default model to `gpt-4o-mini-tts`, MOSS default base URL to `http://localhost:18083`, MOSS default voice to `demo-1`, and max audio response size to 20 MiB.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:53-67` normalizes backend TTS errors including `missing_config`, `unsupported_provider`, `unsupported_model`, `unsupported_endpoint`, `auth_failed`, `rate_limited`, `provider_timeout`, `provider_failed`, `storage_unavailable`, `quota_exceeded`, and `generation_cancelled`; it also has `unsupported_feature`, which frontend type coverage currently does not include.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:101-119` defines `TtsRequest` for short synthesis; it already includes text/provider/voice/model/format/speed/instructions, MOSS generation controls, `advanced_options`, and `ai_provider_id`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:135-143` defines `TtsAdvancedOptions` with P2-shaped fields: pronunciation dictionary, role voices, SSML, timestamps, postprocess, and export.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:146-160` defines `TtsChapterGenerateRequest`, including `max_chunk_chars`, `advanced_options`, and `professional_options`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:289-310` stores `ChapterJobState`, `_chapter_jobs`, `_chapter_manifests`, `_audio_cache`, and `_local_audio_assets` as process-local memory only.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:342-349` uses one module-global `httpx.AsyncClient`; if workers/loops multiply, this should be checked against existing async-cache guidance.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:356-360` defines local TTS fallback root from `MIAOWU_TTS_ASSET_DIR` or `.deer-flow/tts-assets`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:388-414` builds a deterministic synthesis fingerprint from project/chapter/text hash/provider/model/voice/instructions hash/format/speed/extra.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:420-444` chunks long text deterministically by sentence punctuation and hard length splits.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:447-480` creates per-chunk fingerprints with chunk index and chunk count in `extra`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:483-516` resolves OpenAI-compatible config from user AI runtime settings first, then falls back to env `OPENAI_BASE_URL` / `OPENAI_API_BASE` and `OPENAI_API_KEY`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:550-665` returns provider availability/defaults/capabilities; P2 advanced features are all currently false for OpenAI and MOSS.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:668-725` calls OpenAI-compatible `/audio/speech` with model, voice, response format, speed, and instructions.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:796-818` checks MOSS `/health`, `/api/warmup-status`, and `/api/text-normalization-status`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:821-907` calls MOSS `/api/generate` as multipart form, maps demo id/seed/temperature/top-p/top-k/repetition/normalization, decodes `audio_base64`, and preserves metadata such as sample rate, normalized text, text chunks, duration, and generation time.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:910-938` currently rejects any non-empty P2 advanced feature for providers by returning `unsupported_feature`; for `moss-local`, invalid `TtsAdvancedOptions` shape is treated as MOSS-specific options and bypassed at this layer.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1056-1072` checks existing object-storage `MediaAsset` rows using `metadata_json.contains(fingerprint)` and `metadata_json.contains(chapter_id)`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1075-1095` checks local fallback cache only in `_local_audio_assets`, which is process-local and cannot survive restart.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1098-1167` creates TTS chunk assets. It first tries object-storage-backed `MediaAsset`; on `ObjectStorageError`, it writes bytes under the local fallback root and records metadata only in `_local_audio_assets`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1169-1343` generates chapter TTS synchronously inside the request, loops chunks one-by-one, commits each chunk, supports cache hits and `force`, and stores the final manifest only in `_chapter_manifests`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1346-1350` reads chapter audio manifests only from `_chapter_manifests`; object-storage and local files are not enough after process restart unless this index is rebuilt or persisted.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1353-1377` gets/cancels/retries jobs only from `_chapter_jobs`; job state is not durable and retry creates a new generation through the original request.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1380-1414` downloads by joining all chunk bytes in memory and returning one response. It does not perform container-level audio concatenation; joining MP3/WAV bytes is only a pragmatic initial download path and may be invalid for some formats.
- `deer-flow-main/backend/app/gateway/novel_migrated/models/media_asset.py:13-31` stores media asset metadata with user/project/purpose/filename/mime/size/content hash/storage backend/object key/status/metadata JSON.
- `deer-flow-main/backend/app/gateway/novel_migrated/services/media_asset_service.py:21-31` includes `tts_audio` as an active purpose.
- `deer-flow-main/backend/app/gateway/novel_migrated/services/media_asset_service.py:57-133` creates object-storage media assets from bytes, reserves storage quota when supported, stores content hash, and rolls back uploaded objects on DB failure.

### Frontend Files and Current Contract

- `deer-flow-main/frontend/src/core/tts/api.ts:4` defines frontend providers as `openai`, `volcengine`, and `moss-local`.
- `deer-flow-main/frontend/src/core/tts/api.ts:6-23` defines stable frontend TTS error codes, but it omits backend `unsupported_feature`.
- `deer-flow-main/frontend/src/core/tts/api.ts:25-41` defines provider capabilities with P2 booleans for SSML, pronunciation dictionary, role voices, timestamps, postprocess, and export.
- `deer-flow-main/frontend/src/core/tts/api.ts:92-129` defines MOSS local advanced options plus P2 option shapes for role voice, pronunciation rule, postprocess, and export.
- `deer-flow-main/frontend/src/core/tts/api.ts:131-159` sends short synthesis options and chapter request options, including `professional_options`.
- `deer-flow-main/frontend/src/core/tts/api.ts:181-201` defines a chapter audio manifest shape with segment/timestamp/export URL fields that are mostly future-facing today.
- `deer-flow-main/frontend/src/core/tts/api.ts:234-242` builds all TTS URLs from `getBackendBaseURL()`, preserving the 8551 local-dev path when config returns it.
- `deer-flow-main/frontend/src/core/tts/api.ts:300-390` implements config, voices, short synthesis, chapter audio lookup, and chapter generation calls through `/api/tts/*`.
- `deer-flow-main/frontend/src/core/tts/api.ts:393-408` implements get/cancel/retry job calls, but `cancelTtsJob` and `retryTtsJob` return `res.json()` directly even though backend wraps action responses as `{ ok, job }`; hook code currently expects a `TtsJob`.
- `deer-flow-main/frontend/src/core/tts/api.ts:411-418` normalizes relative chapter download URLs to the gateway base.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:132-143` tracks selected provider/model/voice/format/speed/instructions/advanced options/professional options.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:156-196` loads config and provider/model-aware voices and populates defaults.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:227-264` maps chapter audio and builds chapter options, including professional options.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:316-362` polls jobs every 1500 ms for queued/running jobs.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:364-412` calls chapter generation and applies returned audio/job state.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:414-447` uses cancel/retry job helpers; because those helpers currently return action envelopes, this is a likely shape mismatch.
- `deer-flow-main/frontend/src/core/tts/hooks.ts:449-543` handles immediate short synthesis via returned Blob and local `Audio`.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:25-39` embeds TTS into reader surfaces and stops playback when text changes.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:58-72` loads chapter audio when the settings panel opens and relevant TTS selections change.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:101-122` generates/re-generates/downloads chapter audio.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:140-180` maps stable backend/frontend error codes to localized UI text.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:207-210` treats a capability as supported only when the top-level capability value is `true`.
- `deer-flow-main/frontend/src/components/novel/reader/TtsPlayer.tsx:426-477` renders instructions and P2 toggles, but current backend config returns advanced features under `advanced_features`, not top-level booleans. This means P2 toggles likely remain disabled even if the backend capability object contains nested advanced feature truth values.
- `deer-flow-main/frontend/src/core/i18n/locales/novel-defaults.ts:7-59` and `:76-128` include Chinese and English TTS labels for P2 controls.

### Existing Tests

- `deer-flow-main/backend/tests/test_tts_router.py:35-62` tests env/provider availability, MOSS defaults, OpenAI default model, and MOSS health endpoint list.
- `deer-flow-main/backend/tests/test_tts_router.py:82-103` tests voice filtering and MOSS demo voice exposure.
- `deer-flow-main/backend/tests/test_tts_router.py:120-138` tests stable provider error response for missing OpenAI config.
- `deer-flow-main/backend/tests/test_tts_router.py:140-168` tests OpenAI synthesis default model, instructions payload, `/audio/speech` URL, and Authorization header.
- `deer-flow-main/backend/tests/test_tts_router.py:171-190` tests non-audio OpenAI-compatible success response as provider failure.
- `deer-flow-main/backend/tests/test_tts_router.py:193-225` tests MOSS audio base64 decoding and metadata preservation.
- `deer-flow-main/backend/tests/test_tts_router.py:228-295` tests MOSS advanced option mapping and validation.
- `deer-flow-main/backend/tests/test_tts_router.py:298-317` tests MOSS health checks.
- `deer-flow-main/backend/tests/test_tts_router.py:319-382` tests deterministic synthesis and chunk fingerprints.
- `deer-flow-main/backend/tests/test_tts_router.py:385-483` tests local-file fallback cache/reuse/force behavior, but only within one process because `_local_audio_assets` and `_chapter_manifests` are memory-only.
- `deer-flow-main/backend/tests/test_tts_router.py:485-537` tests OpenAI capability probe classification.
- `deer-flow-main/backend/tests/test_tts_router.py:539-584` tests download storage failure maps to `storage_unavailable`.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:17-62` tests short synthesis goes through the Miaowu 8551 gateway and carries MOSS advanced options.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:64-109` tests structured backend error code preservation.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:111-124` tests provider/model voice query parameters.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:126-179` tests chapter generation payload includes P2 professional options.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:181-238` tests chapter audio lookup and job endpoint URLs.
- `deer-flow-main/frontend/tests/unit/core/tts/api.test.ts:240-252` tests relative download URL normalization to `http://127.0.0.1:8551`.
- `deer-flow-main/frontend/tests/unit/components/novel/reader/TtsPlayer.test.tsx:68-90` only checks i18n labels and stable labels, not interactive P2 controls.

### Current Gaps Against User's Continuation Target

- Local fallback files are written to disk, but their index is in `_local_audio_assets`; after restart, the files remain but the lookup and download path cannot discover them.
- Chapter manifests are stored only in `_chapter_manifests`; after restart, `GET /api/tts/chapters/{chapter_id}/audio` returns missing even if local fallback files or object-storage media assets exist.
- Job state is stored only in `_chapter_jobs`; queued/running/completed/failed state cannot survive restart, and multi-worker processes cannot see each other's jobs.
- Chapter generation is synchronous in the request handler. There is no true queue, no detached worker, no bounded concurrency across jobs, and no persisted worker lease/claiming.
- `_job_lock` is a process-local `asyncio.Lock`, so it does not coordinate multiple workers/processes.
- `_http_client` is module-global and not loop/thread scoped; this deserves attention if generation moves into background workers or multiple event loops.
- Object-storage cache lookup uses JSON text `contains()` rather than a structured index. It can work as a simple path, but it is not robust for scale or exact matching.
- `download_chapter_tts_audio` concatenates raw chunk bytes, which is not equivalent to producing a valid stitched WAV/MP3 container for all formats.
- Backend P2 models/options exist as schema fields, but `validate_advanced_feature_gates` rejects all non-empty P2 features today. P2 implementation should change capability gates feature by feature rather than broad-enabling everything.
- Frontend P2 controls are toggles only; they do not yet provide real editors for dictionaries, role-to-voice mapping, SSML, timestamps, postprocess settings, or export configuration.
- Frontend capability read path checks top-level `capabilities[key] === true`, while backend currently nests advanced feature booleans under `advanced_features`; this will need alignment before any P2 feature appears enabled.
- Frontend `cancelTtsJob`/`retryTtsJob` likely return backend action envelopes while hooks expect bare `TtsJob`; this should be fixed before more job UI is layered on top.

## Suggested Feasible P2 Subset

1. Persist local fallback manifest/index and rebuild on startup/request.
   - Store a `manifest.json` per user/chapter/fingerprint under the local TTS asset root, containing chapter id, user id, project id, provider/model/voice/format/speed/instructions hash, chunk list, content type, sizes, paths, and generated timestamp.
   - Add a read path that loads local manifest files when `_chapter_manifests` is missing.
   - Add a validation path that ignores missing/corrupt files and reports stale/missing rather than crashing.
   - This directly satisfies the user's restart-recovery target and is lower risk than introducing a database migration first.

2. Add a small durable job/manifest abstraction before multi-worker scaling.
   - First define a service boundary around `ChapterJobState`, manifest load/save, and chunk asset load/save.
   - Keep the current synchronous execution path initially, but remove direct router/service dependence on raw globals for lookup.
   - This creates the minimum seam needed for later DB-backed queue, worker leases, and multi-process coordination.

3. Make multi-worker behavior "safe and honest" before making it fully distributed.
   - Persist job/manifest status to local manifest or DB so another worker can at least read completed/failed artifacts.
   - Use deterministic job/fingerprint identity to make duplicate generation idempotent.
   - Treat cancellation as best-effort unless cancellation state is persisted.
   - Defer true distributed queue/leases if no existing task table is approved for TTS.

4. Implement pronunciation dictionary as provider-independent preprocessor.
   - Start with request-level rules in `professional_options.pronunciation_dictionary`.
   - Apply safe, deterministic term replacements before chunking/fingerprinting or include dictionary in fingerprint extra if applied after text hash.
   - Add capability gate for this one feature and expose it consistently to frontend.
   - This is more feasible than provider-native dictionary integrations and immediately helps Chinese novel names/terms.

5. Implement simple role voice segmentation for narrator/dialogue as playlist chunks, not stitched multivoice audio.
   - Segment text into narrator/dialogue spans with conservative Chinese quote parsing.
   - Map role/narrator to voice ids when `professional_options.role_voices` is provided.
   - Generate per-span/per-chunk assets and return an ordered manifest.
   - Do not promise character attribution accuracy beyond explicit quote/name rules in the first pass.

6. Implement timestamp metadata as manifest-level approximate timeline first.
   - Use provider returned `duration` when available, or omit exact durations if unknown.
   - Store segment/chunk order and optional duration metadata; expose `timestamps_url` only when a real timestamp artifact exists.
   - Avoid read-along highlighting claims until either provider timestamps or an alignment pipeline exists.

7. Implement export as manifest package download before whole-book production export.
   - Start with chapter package: audio chunks/final download plus `manifest.json` and optional dictionary/timeline JSON.
   - Whole-book export can reuse the same manifest format later.
   - Avoid binary audio stitching unless a real audio processing dependency and tests are added.

8. Defer full SSML and postprocessing until after manifest/job durability.
   - SSML support needs provider-specific rules and sanitization.
   - Loudness normalization/silence trim/fades need an audio toolchain such as ffmpeg/pydub and real media-container tests.
   - These can be represented in manifest capabilities as unsupported or planned until the storage/job foundation is stable.

## Tests To Add

### Backend

- Add restart-recovery tests for local fallback:
  - Generate with object storage failing into local files.
  - Clear `_local_audio_assets` and `_chapter_manifests`.
  - Confirm `get_chapter_audio_manifest` and `download_chapter_tts_audio` can rebuild/read from persisted local manifest/index.
- Add corrupt/stale local manifest tests:
  - Missing chunk file returns missing/stale state or 404.
  - Invalid manifest JSON is ignored/logged without breaking unrelated chapter reads.
  - Manifest user/chapter mismatch is rejected.
- Add exact fingerprint tests:
  - Dictionary/role voice/SSML/postprocess/export options that alter output must be included in fingerprint material.
  - Changing pronunciation dictionary invalidates cache.
  - Changing role voice mapping invalidates cache.
- Add backend P2 gate tests:
  - Supported pronunciation dictionary applies replacements and succeeds.
  - Unsupported SSML/postprocess/export still returns `unsupported_feature`.
  - `unsupported_feature` maps to a stable frontend-visible code.
- Add segmentation tests:
  - Plain narrator-only text produces one voice stream.
  - Chinese dialogue punctuation splits stable spans.
  - Unknown role falls back to narrator/default voice.
- Add job durability/multi-worker tests:
  - A second service instance/process simulation can read completed manifest.
  - Duplicate generation with same fingerprint reuses artifacts.
  - Cancel/retry action response shape is stable.
- Add download/export tests:
  - Multi-chunk download behavior is documented and tested for current concat behavior.
  - Chapter package export includes manifest and all referenced chunks.
- Add HTTP client lifecycle tests if background workers are introduced:
  - Client use does not reuse a closed event loop transport.
  - Fire-and-forget worker task exceptions are consumed and logged.

### Frontend

- Add `unsupported_feature` to `TtsErrorCode` and test localized rendering.
- Add tests that capability gates read the same shape backend returns. Either flatten backend booleans or update frontend to read `advanced_features`.
- Add tests for `cancelTtsJob` and `retryTtsJob` response normalization from `{ ok, job }` to `TtsJob`, or change hook contract explicitly.
- Add `useTts` tests for:
  - generating a chapter with professional options;
  - receiving unsupported feature error;
  - applying generated chapter audio manifest after job completion;
  - handling action envelope from cancel/retry.
- Add `TtsPlayer` interaction tests for:
  - P2 toggles disabled when unsupported;
  - supported pronunciation/role/timestamp capability enabling controls;
  - download button uses normalized gateway URL;
  - progress display from job polling.
- Add API contract tests for:
  - `professional_options` fields added to fingerprint-relevant calls;
  - chapter audio manifest with segments/timestamps/export URLs;
  - local-dev URL remains `http://127.0.0.1:8551`.

### Runtime / Smoke

- Keep targeted backend command from task plan:
  - `backend\.venv\Scripts\python.exe -m pytest backend\tests\test_tts_router.py -q`
- Keep frontend targeted tests:
  - `pnpm -s exec vitest run tests/unit/core/tts tests/unit/components/novel/reader`
  - `pnpm -s tsc --noEmit`
- Add local MOSS smoke after changes:
  - `GET http://127.0.0.1:8551/api/tts/config`
  - `POST http://127.0.0.1:8551/api/tts/smoke` with `provider=moss-local`
  - Generate a chapter, restart backend, then read/download generated audio from manifest fallback.

## Caveats / Not Found

- No code was changed in this research pass.
- The active task script returned no active task pointer in this session; the user supplied `.trellis/tasks/05-25-novel-api-tts-full-buildout`, so this research was written there.
- I did not run tests or start local services; this is a read-only code-impact map.
- I did not verify the live MOSS service at `localhost:18083` in this pass; task artifacts say it was previously available and smoke-tested.
- I did not browse external provider docs in this pass because the request was to read local task/code impact and produce a code map. Before implementing provider-specific SSML/timestamps/voice-library support, re-check official provider docs.
- I did not inspect upstream `D:\deer-flow-main` or `D:\miaowu-os\参考项目\MuMuAINovel-main` because this was a read-only impact map for current TTS code; implementation work involving novel behavior should compare those references per project instruction.
- The current P2 frontend controls are mostly capability-gated placeholders; backend rejects P2 advanced features today except MOSS-specific advanced generation controls.
