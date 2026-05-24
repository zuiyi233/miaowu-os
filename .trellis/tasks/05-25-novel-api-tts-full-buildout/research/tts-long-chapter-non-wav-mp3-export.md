# Research: TTS long chapter non-WAV/MP3 export

- Query: TTS long chapter non-WAV/MP3 export implementation options; existing ffmpeg/pydub/moviepy/ffmpeg-python/audio mux/transcode capability; Windows ffmpeg availability; minimal backend TTS download/storage integration.
- Scope: internal
- Date: 2026-05-25

## Findings

### Task context

- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.jsonl` points this task at the PRD, design, implementation plan, backend TTS router, frontend TTS code, media asset model/API/service, and local MOSS provider context.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/prd.md` requires long chapter chunking, final audio stitching or playlist playback, cached persisted media assets, user-visible download/reuse, and audiobook export workflows.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/design.md` says final playback can initially use ordered chunk playlist playback and later phases may add server-side stitched exports.
- `.trellis/tasks/05-25-novel-api-tts-full-buildout/implement.md` places stable chunking, generated chapter audio, ordered chunk playback or stitched output, and export workflows in later P1/P2 phases.
- `.trellis/spec/guides/cross-layer-thinking-guide.md:34-61` requires explicit layer-boundary contracts. Relevant boundary here is provider bytes -> chunk storage -> manifest -> download endpoint -> browser/player/export.
- `.trellis/spec/backend/quality-guidelines.md:57-72` requires observing exceptions for detached/background work. If transcoding is moved into queued/background generation later, the job must consume task exceptions.
- `.trellis/spec/backend/error-handling.md` requires normalized, user-facing errors rather than leaking Python/runtime internals. Existing TTS code already uses `TtsProviderError` codes.

### Files found

- `deer-flow-main/backend/app/gateway/routers/tts.py` - FastAPI TTS router; exposes chapter generate/audio/plan/download/job endpoints.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py` - Main TTS service, provider calls, cache, chunk manifest, media asset storage fallback, and download concatenation.
- `deer-flow-main/backend/tests/test_tts_router.py` - Current regression tests for TTS providers, chapter generation, download behavior, local fallback assets, and multi-chunk non-WAV rejection.
- `deer-flow-main/backend/app/gateway/novel_migrated/services/media_asset_service.py` - Object-storage-backed media asset creation; `tts_audio` is an allowed purpose.
- `deer-flow-main/backend/app/gateway/novel_migrated/api/media_assets.py` - Generic media asset upload/download API with user ownership checks and object storage error mapping.
- `deer-flow-main/backend/pyproject.toml` - Direct Python dependencies for backend; no direct audio mux/transcode library is declared.
- `deer-flow-main/backend/uv.lock` - Lockfile includes `pydub==0.25.1`, but only via `markitdown` optional extras/lock state, not as a direct backend dependency.
- `.trellis/spec/frontend/quality-guidelines.md` - Notes an installed Windows FFmpeg path used by frontend video workflows.

### Current backend TTS download/storage path

- `deer-flow-main/backend/app/gateway/routers/tts.py:168-182` implements `GET /api/tts/chapters/{chapter_id}/download`. It delegates to `download_chapter_tts_audio(...)` and returns a single attachment response.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1628-1697` stores generated chunk audio through `media_asset_service.create_asset_from_bytes(...)` with `purpose="tts_audio"`, `filename=tts_<chapter>_<chunk>.<ext>`, and metadata including `chapter_id`, `fingerprint`, provider/model/voice, chunk index/count, and result metadata.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1672-1697` falls back to local files under `MIAOWU_TTS_ASSET_DIR` when object storage is unavailable. This means download support must handle both `media_asset` and `local_file` chunk sources.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1864-1900` builds and persists a manifest with `format`, `chunk_count`, `download_url`, `export_urls.chapter`, `chunks`, `segments`, and a chapter-level fingerprint.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:1946-1983` is the minimal backend entry point for non-WAV/MP3 export. It loads the manifest, sorts chunks, reads each chunk from local fallback or object storage, then calls `_ensure_downloadable_chunk_format(...)` and `_concat_audio_chunks(...)`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:876-899` currently only rewraps multi-chunk `audio/wav` with Python `wave`; for non-WAV or single chunk it returns `b"".join(chunks)`.
- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py:902-910` explicitly rejects multiple chunks unless `media_type == "audio/wav"`.
- `deer-flow-main/backend/tests/test_tts_router.py:602-633` locks in the current rejection behavior: multi-chunk `audio/mpeg` raises `unsupported_feature` with `media_type` and `chunk_count`.

### Existing dependency/tool capability

- `deer-flow-main/backend/pyproject.toml:7-26` declares backend runtime deps. It includes FastAPI/httpx/multipart/storage/db deps, but no `ffmpeg`, `ffmpeg-python`, `python-ffmpeg`, `pydub`, `moviepy`, `soundfile`, or `librosa` direct dependency.
- `deer-flow-main/backend/uv.lock:2195-2228` shows `markitdown` has optional `all` dependencies including `pydub`, but this does not mean backend runtime intentionally depends on `pydub` for audio export.
- `deer-flow-main/backend/uv.lock:3292-3299` includes `pydub==0.25.1`.
- Runtime probe with `deer-flow-main/backend/.venv/Scripts/python.exe` found:
  - `pydub`: importable
  - `moviepy`: not importable
  - `ffmpeg` Python package / `ffmpeg-python`: not importable
  - `soundfile`: not importable
- Script search under `deer-flow-main/scripts`, `deer-flow-main/backend/scripts`, `deer-flow-main/docker`, and `.github` found no existing audio mux/transcode script or backend FFmpeg wrapper.
- `where.exe ffmpeg` returned no `ffmpeg` in current PATH.
- The known Windows-native FFmpeg binary exists at `C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin\ffmpeg.exe`; invoking it reported `ffmpeg version 8.1.1-full_build-www.gyan.dev`.
- `.trellis/spec/frontend/quality-guidelines.md:38-49` already documents the same FFmpeg install/PATH caveat for frontend video render workflows: install on Windows, prepend the `bin` path if the current shell cannot see the binary, then verify media metadata.

### Code patterns

- Existing TTS service uses lightweight in-process state for jobs/manifests/local fallback assets and stores durable chunks as media assets when object storage is configured.
- Existing chunk concat is synchronous and memory-buffered: `download_chapter_tts_audio` loads all chunks into a list of bytes before returning a single `Response`.
- Current WAV stitching is safe for compatible PCM WAV chunks because it reads frames and writes one valid WAV container, but if WAV params differ it falls back to raw byte concatenation (`service.py:876-899`). That fallback may produce an invalid WAV stream for multi-chunk WAV with mismatched params.
- Current non-WAV protection prevents invalid MP3/MPEG byte concatenation from being served as a single file (`service.py:902-910` plus test at `test_tts_router.py:602-633`).
- Existing media asset generic download path does not solve chapter export because chapter export is manifest-based and may combine several assets.

### Recommendation

Recommended minimal implementation path for non-WAV/MP3 chapter download:

1. Keep current playlist/manifest playback behavior for generated chapter audio.
2. Add an optional backend mux/transcode helper used only by `download_chapter_tts_audio(...)` when `chunk_count > 1` and the media type is not directly stitchable.
3. Prefer FFmpeg CLI over adding `moviepy` or `ffmpeg-python`:
   - FFmpeg CLI is already available on this Windows machine, although not on PATH.
   - It handles MP3 concat/muxing, WAV normalization, and future M4A/AAC/Opus export better than pure Python.
   - It avoids relying on `pydub` as an accidental/transitive lockfile dependency.
4. Resolve FFmpeg path in a small helper:
   - first `MIAOWU_FFMPEG_PATH` env var
   - then `shutil.which("ffmpeg")`
   - optionally the documented Windows winget path as a local-dev convenience
   - if unavailable, return current `unsupported_feature` style error with a clear `missing_dependency`/`unsupported_feature` detail.
5. For MP3 chunks, use FFmpeg concat demuxer through temp files:
   - write chunk bytes to a temp dir with safe sequential names
   - write `concat.txt`
   - run `ffmpeg -hide_banner -loglevel error -f concat -safe 0 -i concat.txt -c copy output.mp3`
   - if stream-copy concat fails, retry with re-encode: `-codec:a libmp3lame -b:a 128k` or project-selected bitrate
   - return `audio/mpeg`, filename `tts_<chapter_id>.mp3`.
6. For output format flexibility, introduce a request/query contract later rather than overloading existing download silently:
   - current `GET /api/tts/chapters/{chapter_id}/download` can export in the manifest format
   - later `?format=mp3|wav|source` or a separate export job can control transcode target
   - default should preserve current format and only use FFmpeg to make a valid single container.
7. Keep the current pure-stdlib WAV path as the fast path, but consider changing mismatched WAV params from raw byte concatenation to FFmpeg transcode or an explicit error. Raw byte concatenation is not a valid stitched WAV export.

Why not use `pydub` as the first choice:

- `pydub` is importable in the current venv and present in `uv.lock`, but not declared in `pyproject.toml` runtime dependencies. Treating it as a production dependency would be brittle unless the project adds it intentionally.
- `pydub` still shells out to FFmpeg/avlib for MP3 and many formats, so it does not remove the system FFmpeg requirement.
- A direct FFmpeg subprocess wrapper has fewer hidden defaults and is easier to test by monkeypatching path/process calls.

Minimal code surface if an implement agent picks this up:

- `deer-flow-main/backend/app/gateway/routers/tts_support/service.py`
  - replace `_ensure_downloadable_chunk_format(...)` with a helper that either allows direct WAV, routes non-WAV through FFmpeg, or raises a normalized dependency/capability error.
  - extend `_concat_audio_chunks(...)` or add `_export_audio_chunks(...)` to return a valid single container.
  - keep all source chunk reads and ownership checks inside `download_chapter_tts_audio(...)`.
- `deer-flow-main/backend/tests/test_tts_router.py`
  - replace/adjust `test_download_chapter_tts_audio_rejects_multi_chunk_non_wav`
  - add tests for FFmpeg path missing, MP3 concat success, FFmpeg copy failure fallback to re-encode, and object-storage/local-file mixed chunks.

## Caveats / Not Found

- `python ./.trellis/scripts/task.py current --source` returned no active task in this session. The user-provided task path `.trellis/tasks/05-25-novel-api-tts-full-buildout` was used as the write target.
- No business code was modified.
- I did not run backend tests because this was a read-only research task.
- I did not test actual MP3 concatenation through FFmpeg; I only verified local FFmpeg binary availability and current code/test behavior.
- FFmpeg is not in the current shell PATH. Any implementation must not assume `ffmpeg` resolves unless it explicitly supports env/path discovery.
- `pydub` is available in the current venv, but appears lockfile-only/transitive/optional rather than a deliberate backend runtime dependency.
- No `moviepy`, `ffmpeg-python`, `python-ffmpeg`, `soundfile`, or project audio mux/transcode script was found.
- Current service is memory-buffered for chapter download. Very long whole-book exports should probably be a queued export job with persisted output media asset rather than a synchronous response.
