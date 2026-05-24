# Implementation Plan

1. Inspect current HyperFrames project and confirmed product feature copy from repository docs/components.
2. Rewrite `script.txt` into a focused 90-120 second product narration.
3. Rebuild the `index.html` scene timeline so each narration segment has matching visuals, dynamic title, and subtitle text.
4. Generate or refresh narration audio using local MOSS-TTS-Nano if available.
5. Normalize audio loudness through FFmpeg.
6. Run HyperFrames validation/render.
7. Extract representative frames and check for nonblank visuals, readable subtitles, and obvious alignment issues.
8. Report final output path, verification performed, and any remaining limitations.

## Validation Commands

- `npm run check`
- `npm run render`
- `ffprobe` or equivalent metadata check on final audio/video
- frame extraction from rendered video for visual QA

## Rollback Points

- `script.txt`
- `index.html`
- `caption-overrides.json`
- generated files under `assets/` and `renders/`

## Notes

- Do not use WSL for frontend dependency management.
- Do not clean unrelated uncommitted changes in the repository.
