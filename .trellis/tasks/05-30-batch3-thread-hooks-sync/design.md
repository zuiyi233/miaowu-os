# Batch3 Design

## Scope

This batch performs a selective semantic merge of three upstream `hooks.ts` fixes onto the local Miaowu-OS frontend thread runtime:

- `d46a577`: preserve messages after summarization
- `d0fa37e`: avoid duplicate optimistic user message
- `0287240`: show new thread in sidebar immediately on creation

Out of scope:

- MCP session pooling
- any backend-only changes
- frontend auth/provider/static-demo work
- unrelated workspace or novel UI refactors

## Merge Strategy

### 1. Summarization-safe message merge

Keep the local message history / token-usage / custom-event flow.

Add only the upstream semantics that matter:

- hidden UI-control messages must not evict visible history when identities collide
- overlap trimming must consider visible live thread messages, not hidden control messages
- summarization update parsing should support both `SummarizationMiddleware.before_model` and `DeerFlowSummarizationMiddleware.before_model`
- when summarization moves history into the archive, the cutoff should be based on the first retained visible identity instead of a fixed index assumption

### 2. Optimistic user-message dedupe

Keep local upload optimistic behavior, but isolate the display decision into an explicit helper so:

- optimistic human input disappears once the server-side human message has actually arrived
- optimistic non-human status messages do not accidentally outlive the matching human optimistic state
- merge logic sees only the visible optimistic messages

### 3. Immediate new-thread sidebar visibility

Keep local thread search cache structure and agent metadata handling.

Add the upstream intent:

- when `onCreated` fires, insert or update the new thread immediately in the thread search cache
- preserve local metadata/values merging semantics instead of blindly replacing cache entries

## Validation Design

Add or extend unit tests around:

- visible-vs-hidden dedupe during merge
- summarization key detection
- optimistic visibility transitions
- thread cache upsert behavior for new threads

Run targeted unit tests and TypeScript validation from the project's Windows frontend environment.

## Rollback Shape

- Branch-level rollback point: `backup-before-batch3-sync-20260530-040103`
- If batch3 regresses thread UX, revert only the batch3 commit and keep batch2 (`792e9427`) as the stable baseline
