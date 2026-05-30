# Hook Guidelines

> How hooks are used in this project.

---

## Overview

This project expects data-fetching hooks to normalize backend failures into explicit, typed states before they reach the page layer.

---

## Data Fetching

### Quality Report Queries

`useQualityReportQuery` must own the shared `queryKey` and `queryFn` for quality report fetching.

Pages and layouts must not define duplicate `useQuery` logic for the same quality report data.

### Agents Management API

Agents-related hooks must detect the management-API disabled case explicitly and surface it as `AgentsApiDisabledError` rather than a generic network failure.

When a disabled response is identified, the hook layer must stop retrying immediately. Only non-disabled network failures may continue with limited retry behavior.

---

## Common Mistakes

- Treating `403 disabled` as a transient fetch error and letting retry logic continue.
- Returning only a loading state for disabled management APIs instead of a terminal disabled state.

## Thread Message Merge Contract

### 1. Scope / Trigger

- Trigger: changing `deer-flow-main/frontend/src/core/threads/hooks.ts`, thread message merge helpers, or the sidebar thread search cache behavior.
- This contract protects the Miaowu-OS local customizations that ride on top of upstream DeerFlow thread UX fixes.

### 2. Signatures

```typescript
mergeMessages(
  historyMessages: Message[],
  threadMessages: Message[],
  optimisticMessages: Message[],
): Message[]

getVisibleOptimisticMessages(
  optimisticMessages: Message[],
  previousHumanMessageCount: number,
  currentHumanMessageCount: number,
): Message[]

getSummarizationMiddlewareMessages(data: unknown): Message[] | undefined

upsertThreadInSearchCache(queryClient: QueryClient, thread: AgentThread): void
```

### 3. Contracts

- `mergeMessages(...)`
  - overlap trimming is based on **visible** live thread messages only
  - hidden/control messages must not evict visible history when ids collide
  - live visible messages still replace overlapping history entries with the same identity
- `getVisibleOptimisticMessages(...)`
  - optimistic human input stays visible until the server-side human message count increases
  - when that count increases, the whole optimistic pair disappears, including upload-status AI placeholders tied to the same send
  - non-human optimistic status messages may remain visible if there is no optimistic human message in the batch
- `getSummarizationMiddlewareMessages(...)`
  - must accept both `SummarizationMiddleware.before_model` and `DeerFlowSummarizationMiddleware.before_model`
  - unrelated suffix-sharing keys must be ignored
- summarization history carry-over inside `useThreadStream(...)`
  - when summarization updates arrive, the cutoff is the first retained **visible** identity after `remove` records are excluded
  - summary placeholder messages tracked in `summarizedRef` must not be re-added to history
- `upsertThreadInSearchCache(...)`
  - new threads are inserted immediately into `["threads", "search"]`
  - for an existing cache entry, preserve local `metadata` and `values` fields by merging the new optimistic stub into the cached row rather than replacing the cached row outright
  - this preservation rule is required because local multi-account / agent-scoped views can already carry extra metadata before the first full refresh lands

### 4. Validation & Error Matrix

| Condition | Expected behavior |
|----------|-------------------|
| Hidden live message reuses a visible history id | Keep the visible history message in merged UI output |
| Visible live message reuses a hidden history id | Show the visible live message |
| Optimistic human exists and human count increases | Hide the optimistic send batch |
| Optimistic batch has only non-human status messages | Keep the optimistic status visible |
| Summarization update uses DeerFlow custom key | Parse it exactly like the base key |
| Existing thread cache row already contains local metadata | Preserve cached metadata/values on optimistic upsert |

### 5. Good / Base / Bad Cases

- Good:
  - a hidden control reminder arrives with the same id as a visible history message and the user still sees the visible message
  - a new thread appears in the sidebar immediately after `onCreated`, with `agent_name` already attached
- Base:
  - a standard live human/AI pair replaces duplicated history with the same ids
  - an optimistic human input disappears only after the real human message arrives from the server
- Bad:
  - hidden control messages shrink history because overlap detection counted hidden ids
  - optimistic upload placeholders remain after the server-side human message is already rendered
  - a new thread only appears after a later invalidate/refetch round-trip
  - a cache upsert drops local account/agent metadata fields from the existing row

### 6. Tests Required

- `pnpm test -- --run tests/unit/core/threads/message-merge.test.ts`
  - assert hidden-vs-visible dedupe behavior
  - assert both summarization update keys are recognized
  - assert optimistic human dedupe behavior, including upload placeholder pairs
  - assert thread cache upsert insert behavior and existing-row merge behavior
- `pnpm tsc --noEmit`
  - assert helper exports and `QueryClient` / `AgentThread` typing stay valid

### 7. Wrong vs Correct

#### Wrong

```typescript
const threadMessageIds = new Set(
  threadMessages.map(messageIdentity).filter(isNonEmptyString),
);
```

Why it is wrong:
- hidden control messages now participate in overlap trimming and can hide visible history by accident

#### Correct

```typescript
const threadMessageIds = new Set(
  threadMessages
    .filter((message) => !isHiddenFromUIMessage(message))
    .map(messageIdentity)
    .filter(isNonEmptyString),
);
```

Why it is correct:
- only visible live messages are allowed to suppress visible history in the merged UI path
