# Batch3 Implementation Plan

## Ordered Steps

1. Update task artifacts and switch the task to `in_progress`.
2. Review local `hooks.ts` against upstream commits `d46a577`, `d0fa37e`, and `0287240`.
3. Apply the minimal semantic merge to `frontend/src/core/threads/hooks.ts`.
4. Extend `frontend/tests/unit/core/threads/message-merge.test.ts` for the three repaired behaviors.
5. Run targeted frontend unit tests and TypeScript validation.
6. Update frontend/thread contract guidance and batch3 sync report.
7. Commit batch3 on a dedicated branch.

## Validation Commands

```powershell
pnpm test -- --run tests/unit/core/threads/message-merge.test.ts
pnpm tsc --noEmit
```

## Review Gates

- Do not overwrite local multi-account thread/cache behavior.
- Do not regress upload optimistic UI or token-usage baseline handling.
- Do not let hidden control messages suppress visible thread history.
- Keep the change set confined to `hooks.ts` and directly related tests/docs unless a proven dependency requires more.

## Rollback Points

- Pre-batch3 branch snapshot: `backup-before-batch3-sync-20260530-040103`
- Last known stable implementation branch base: `codex/batch2-upstream-security-contract-sync` at commit `792e9427`
