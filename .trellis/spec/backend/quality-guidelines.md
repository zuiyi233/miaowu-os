# Quality Guidelines

> Backend quality standards for async runtime, cached model clients, memory updates, and detached background work.

---

## Scenario: Async runtime hygiene for model cache, memory updates, and fire-and-forget tasks

### 1. Scope / Trigger

- Trigger: changing `app/gateway/novel_migrated/services/ai_service.py`, `deerflow/agents/memory/queue.py`, or any helper that creates detached async work
- Applies to:
  - model instance caching and transport reuse
  - memory update delivery
  - background cleanup or best-effort fire-and-forget tasks

### 2. Signatures

- `ai_service._detect_model_cache_scope() -> tuple[int, int | None]`
- `ai_service._make_cache_key(...) -> tuple[str, ...]`
- `ai_service._get_cached_model(...) -> Any`
- `ai_service.clear_model_cache() -> None`
- `MemoryUpdateQueue.start_worker() -> bool`
- `MemoryUpdateQueue.add(...) -> None`
- `MemoryUpdateQueue.add_nowait(...) -> None`
- `MemoryUpdateQueue.stop_worker(...) -> None`
- `MemoryUpdateQueue.shutdown_nowait() -> None`
- `MemoryUpdateQueue.flush() -> None`
- `ai_service._run_awaitable_best_effort(awaitable) -> None`
- `MemoryUpdateQueue._log_worker_failure(task) -> None`

### 3. Contracts

#### 3.1 Scope-aware model cache

- **Must** include both `thread_id` and `loop_id` in the cache key for model instances
- **Must** detect scope with `threading.get_ident()` and `asyncio.get_running_loop()`; if there is no running loop, `loop_id` is `None`
- **Must not** reuse a cached async transport or client across thread or event-loop boundaries
- **Must** call `clear_model_cache()` before reinitializing after a configuration change or after loop-closed recovery
- **Verify** by asserting that:
  - same scope + same model credentials returns the same object
  - different scope + same model credentials returns a different object
  - cache stats include `thread_id` and `loop_id`

#### 3.2 Single background worker for memory updates

- **Must** process memory updates through one singleton `MemoryUpdateQueue` and one active worker task per process
- **Must** reuse the current worker if `start_worker()` is called while a worker is already running
- **Must** make `add()` / `add_nowait()` enqueue and signal only; they **must not** call `asyncio.run()` or create ad-hoc event loops in the request path
- **Must** treat `flush()` as an explicit synchronous escape hatch for tests or top-level maintenance code only
- **Must not** call `flush()` from normal request handlers or from code that already runs inside an event loop
- **Must** make `stop_worker()` / `shutdown_nowait()` clear queue state and detach worker references so a stale worker cannot be reused
- **Verify** by asserting that queued work drains via the background worker, `pending_count` returns to `0`, and shutdown is bounded

#### 3.3 Fire-and-forget tasks must consume exceptions

- **Must** attach a done callback immediately after creating any fire-and-forget task
- **Must** consume the task result in that callback with `task.result()` or `future.result()` inside `try / except`
- **Must** log task failures and swallow them in the callback so the event loop does not emit an unhandled task warning
- **Must not** create a task and discard the handle without observing completion
- **Approved patterns**:
  - `loop.create_task(self._worker_main(), name="memory-update-worker")` followed by `add_done_callback(self._log_worker_failure)`
  - `asyncio.ensure_future(_runner())` followed by a callback that reads the future result
- **Verify** by raising from the task and confirming the exception is observed and logged, with no `Task exception was never retrieved` warning

### 4. Validation & Error Matrix

| Case | Must happen | Must not happen | Verification |
| --- | --- | --- | --- |
| Same model / base URL / API key in the same thread and loop | Return the same cached object | Create a second transport or client | Unit test and cache stats |
| Same model / base URL / API key in a different thread or loop | Create a fresh object | Reuse the previous object across scopes | `test_model_cache_isolated_by_thread_and_loop_scope` |
| `add_nowait()` while the memory worker is running | One worker drains the queue and `pending_count` returns to `0` | Repeated `asyncio.run()` in the request path | `test_worker_processes_immediate_updates_in_background` |
| Worker shutdown while the updater hangs | Shutdown remains bounded and queue state is cleared | Indefinite hang or leaked worker references | `test_stop_worker_is_best_effort_when_update_hangs` |
| Fire-and-forget task raises | Callback consumes the exception and logs it | `Task exception was never retrieved` warning | Regression test for the helper |

### 5. Good / Base / Bad Cases

#### Good

- Same-scope cache hits reuse the same object
- Memory updates are queued and drained by one background worker
- Detached tasks register a done callback before the handle is forgotten

#### Base

- `flush()` is used only by explicit sync tooling or tests that know no loop is running
- Background worker failures are visible in logs instead of disappearing silently

#### Bad

- Module-global singleton transport reused across loops
- Per-request `asyncio.run(...)` around memory processing
- `create_task(...)` without a done callback
- Swallowing task exceptions by never reading the future result

### 6. Tests Required

- `backend/tests/test_ai_service_model_cache.py::test_model_cache_isolated_by_thread_and_loop_scope`
- `backend/tests/test_ai_service_model_cache.py::test_clear_model_cache_best_effort_closes_sync_and_async_models`
- `backend/tests/test_memory_queue.py::test_worker_processes_immediate_updates_in_background`
- `backend/tests/test_memory_queue.py::test_stop_worker_is_best_effort_when_update_hangs`
- `backend/tests/test_memory_queue.py::test_process_queue_does_not_reuse_runtime_override_between_contexts`
- When adding a new fire-and-forget helper, add a regression test that raises from the task and asserts the exception is observed and logged

### 7. Wrong vs Correct

#### Wrong

```python
# 1) Reusing a cached model without scope isolation
model = create_chat_model(name=model_name, thinking_enabled=False)

# 2) Driving memory updates with per-call asyncio.run in the request path
def add(...):
    asyncio.run(self._process_queue())

# 3) Orphaned fire-and-forget task
asyncio.create_task(do_cleanup())
```

#### Correct

```python
scope = _detect_model_cache_scope()
model = _get_cached_model(
    model_name,
    base_url=base_url,
    api_key=api_key,
    cache_scope=scope,
)

await queue.start_worker()
queue.add_nowait(thread_id=thread_id, messages=messages)

future = asyncio.ensure_future(_runner())
future.add_done_callback(_consume_result)
```

**Related**: `error-handling.md` defines the recovery path that clears the model cache once when the loop has already closed.
