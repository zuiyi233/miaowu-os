# P6 Performance Notes (2026-04-18)

## 1. Implemented Optimizations

## 1.1 Stream cancellation chain

- File: `frontend/src/components/novel/ChapterRegenerationModal.tsx`
- Added `AbortController` wiring from UI cancel action to `fetch(..., { signal })`.
- Added unmount cleanup to abort in-flight requests and prevent late state writes.

## 1.2 Chunk update batching

- File: `frontend/src/components/novel/ChapterRegenerationModal.tsx`
- Replaced per-chunk `setWordCount` with `requestAnimationFrame` batched flush.
- Goal: reduce token-level re-render pressure during high-frequency chunk bursts.

## 1.3 SSE parser robustness

- File: `frontend/src/core/novel/utils/stream.ts`
- Updated parser from line-based best-effort parsing to SSE block parsing (`\n\n`).
- Added tail-buffer flush and multi-line `data:` aggregation.
- Goal: reduce parse loss on chunk boundary splits and improve stream stability.

## 1.4 API contract-first routing with fallback

- File: `frontend/src/core/novel/novel-api.ts`
- Main stream calls now target:
  - `/api/novels/{novel_id}/chapters/{chapter_id}/generate-stream`
  - `/api/novels/{novel_id}/chapters/{chapter_id}/continue-stream`
  - `/api/novels/{novel_id}/chapters/batch-generate-stream`
  - `/api/novels/{novel_id}/outlines/generate-stream`
  - `/api/novels/{novel_id}/characters/generate-stream`
- Kept 404 fallback for old routes/wizard routes to reduce migration breakage.

## 2. Deferred Performance Work

- Heartbeat-based reconnect metrics and retry telemetry are not yet implemented.
- Worker-based text post-processing is not yet implemented.
- Browser-level performance profiling (INP/memory timeline) pending Windows runtime verification.
