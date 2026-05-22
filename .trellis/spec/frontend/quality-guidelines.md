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

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
