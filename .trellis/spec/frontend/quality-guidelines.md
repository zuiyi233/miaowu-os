# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

### HyperFrames Render Toolchain

- Trigger: creating or updating HyperFrames compositions under `deer-flow-main/hyperframes/*`.
- Contract: `npm run check` must pass after HTML composition edits. `npm run render` must run with FFmpeg available on the same process `PATH` used by npm/HyperFrames.
- Required pattern:
  - install missing FFmpeg on Windows with winget or an equivalent Windows-native installer
  - if the current shell does not see the new binary, prepend the FFmpeg `bin` directory to `$env:PATH` before `npm run render`
  - verify rendered MP4 metadata with FFprobe or equivalent because HyperFrames console summaries can display misleading total time while the actual stream duration is correct
  - extract representative frames for visual QA when subtitles, transitions, or scene timing changed
- Forbidden pattern: assuming a successful winget install updates the current shell `PATH`, or trusting only the HyperFrames render summary for final duration.
- Verify: run `npm run check`, render the MP4, then inspect duration, dimensions, frame rate, and audio stream metadata.

Example:

```powershell
$env:PATH = "C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.1-full_build\bin;" + $env:PATH
npm run render
```

### Novel i18n Defaults

- Trigger: adding keys to `NovelTranslations` or adding novel UI that reads `t.novel.*`.
- Contract: `Translations["novel"]` must be total at runtime. Missing locale keys must resolve through `withNovelDefaults(...)`, not return `undefined`.
- Required pattern:
  - keep existing explicit locale strings in `en-US.ts` / `zh-CN.ts` as the preferred values
  - wrap the novel object with `withNovelDefaults({...}, "en" | "zh")`
  - add specific labels to `novel-defaults.ts` when a key is user-visible or appears in tests
- Forbidden pattern: weakening `novel` to `Partial<NovelTranslations>` or using `as any` to silence missing translation errors.
- Verify: run `pnpm tsc --noEmit` and targeted component/i18n tests for the touched UI.

Example:

```typescript
novel: withNovelDefaults({
  title: "Novel",
  batchDeleteResult: "Delete completed",
}, "en"),
```

### Workspace image generation contract

- Trigger: adding or changing `/workspace/images`, `src/core/images/*`, or any workspace-side image generation workflow that calls the gateway directly.
- Contract:
  - browser requests must continue through `fetcher.ts` + `getBackendBaseURL()`, so local-dev stays aligned with the existing `127.0.0.1:8551` gateway profile
  - API helpers must normalize backend-relative file URLs into gateway URLs before the page renders them
  - page components must treat `size` and `aspect_ratio` as mutually exclusive UI inputs and avoid sending both together
  - request/response normalization belongs in `src/core/images/api.ts`, not duplicated in page components
- Required pattern:
  - keep the page layer focused on form state, history selection, and display
  - normalize status strings and structured backend errors in the core API layer
  - show history/detail views from the same normalized `ImageJob` shape rather than parsing raw payloads in multiple components
- Forbidden pattern:
  - calling `window.fetch` directly from the page for image generation
  - rendering provider URLs or raw response payloads without gateway URL normalization
  - duplicating error parsing or image URL fallback logic inside multiple components
- Verify:
  - `pnpm typecheck`
  - `pnpm test -- --run tests/unit/core/images/api.test.ts`
  - targeted eslint on `src/core/images`, `src/app/workspace/images/page.tsx`, and the workspace nav entry

Example:

```typescript
const res = await authFetch(imagesApiUrl("/generate"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt,
    aspect_ratio: "16:9",
  }),
});
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
