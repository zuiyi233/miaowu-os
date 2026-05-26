# Implementation Checklist

## Before Work

- [ ] Confirm provider, novel, and studio child tasks are implemented or identify partial scope.
- [ ] Run `git status --short`.
- [ ] Identify current local-dev startup commands.

## Verification

- [ ] Backend targeted tests.
- [ ] Backend route registration tests.
- [ ] Frontend typecheck.
- [ ] Frontend tests if configured.
- [ ] Browser smoke for `/workspace/tts-studio`.
- [ ] Novel chapter TTS smoke.
- [ ] Config diagnostics smoke for unavailable and available MiMo states.

## Documentation

- [ ] Add/update MiMo TTS setup docs.
- [ ] Add NewAPI routing instructions.
- [ ] Add diagnostics/troubleshooting.
- [ ] Add non-migrated reference-project items.
- [ ] Add deployment-readiness checklist.

## Final Parent Closure

- [ ] Re-run parent-level verification.
- [ ] Record validation gaps.
- [ ] Update specs if reusable contracts were learned.
- [ ] Commit only after user-approved implementation scope is complete.
