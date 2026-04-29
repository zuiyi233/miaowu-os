# Technical design — memory worker refactor + lifecycle protection

## Memory queue design
- Keep `ConversationContext` as the unit of work.
- Convert `MemoryUpdateQueue` into a singleton owner of a single async worker task.
- Use an `asyncio.Queue` to wake/drive the worker, and batch queued conversations after the configured debounce interval.
- Merge same-thread updates before processing so the latest payload wins.
- Run `MemoryUpdater.aupdate_memory(...)` directly inside the worker instead of bridging through `update_memory()`.
- Preserve the small inter-update delay with `asyncio.sleep`, not blocking `time.sleep`.
- Expose best-effort startup/shutdown helpers for app lifespan management.

## App lifecycle integration
- Start the memory worker during gateway lifespan initialization.
- Stop it during shutdown with a bounded wait and cancellation fallback.
- Keep the queue singleton accessible to existing callers.

## Background task protection
- Wrap `asyncio.create_task(...)` calls in a helper that applies a done callback.
- The done callback should ignore cancellation, pull exceptions with `task.exception()`, and log unexpected failures.
- Name background tasks where this makes diagnostics easier.

## Test strategy
- Replace timer-centric queue tests with async worker tests.
- Cover:
  - merge behavior for same-thread updates
  - async worker processing and debouncing
  - immediate flush / no-wait behavior
  - worker shutdown draining / best-effort stop
  - background task done-callback exception handling
- Keep tests isolated from live LLM/network calls by mocking `MemoryUpdater` and related async work.
