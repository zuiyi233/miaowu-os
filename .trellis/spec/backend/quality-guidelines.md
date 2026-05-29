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

---

## Scenario: Run persistence must be atomic, progress-aware, and restart-recoverable

### 1. Scope / Trigger

- Trigger: changing run lifecycle persistence, run token/progress aggregation, or gateway startup recovery for persisted runs
- Applies to:
  - `deerflow/runtime/journal.py`
  - `deerflow/runtime/runs/manager.py`
  - `deerflow/runtime/runs/store/base.py`
  - `deerflow/runtime/runs/store/memory.py`
  - `deerflow/persistence/run/sql.py`
  - `app/gateway/deps.py`
  - `app/gateway/routers/thread_runs.py`

### 2. Signatures

- `RunJournal(..., progress_reporter: Callable[[dict], Awaitable[None]] | None = None, progress_flush_interval: float = 5.0)`
- `RunJournal.record_external_llm_usage_records(records: list[dict[str, int | str]]) -> None`
- `RunJournal.get_completion_data() -> dict`
- `RunManager.create(...) -> RunRecord`
- `RunManager.create_or_reject(...) -> RunRecord`
- `RunManager.update_run_progress(run_id: str, **kwargs) -> None`
- `RunManager.update_run_completion(run_id: str, **kwargs) -> None`
- `RunManager.reconcile_orphaned_inflight_runs(*, error: str, before: str | None = None) -> list[RunRecord]`
- `RunStore.update_status(...) -> bool | None`
- `RunStore.update_run_completion(...) -> bool | None`
- `RunStore.update_run_progress(...) -> None`
- `RunStore.list_inflight(*, before: str | None = None) -> list[dict[str, Any]]`
- `RunStore.aggregate_tokens_by_thread(thread_id: str, *, include_active: bool = False) -> dict[str, Any]`
- `RunRepository.put(...) -> None`

### 3. Contracts

#### 3.1 New runs must not become visible before durable persistence

- **Must** keep `RunManager.create()` and `RunManager.create_or_reject()` atomic with respect to visibility
- **Must** insert the in-memory `RunRecord` under lock, persist it, and roll back `_runs` if the initial store write fails or is cancelled
- **Must not** return or expose a newly created run to concurrent readers until the initial persistence step succeeds
- **Must** persist the new run before interrupting older inflight runs in `create_or_reject(..., multitask_strategy="interrupt"|"rollback")`

#### 3.2 Progress snapshots must reflect active run state without double counting

- **Must** keep token/message counters in `RunJournal` deduplicated by source identity so repeated callback delivery does not inflate totals
- **Must** bucket token totals by caller class: `lead_agent`, `subagent`, `middleware`
- **Must** throttle progress writes via `progress_flush_interval` and use `progress_reporter` for best-effort active-run snapshots
- **Must** update `last_ai_message` only from lead-agent user-facing assistant output; subagent and middleware model calls must not overwrite it
- **Must** expose running totals through `RunResponse` and `GET /api/threads/{thread_id}/token-usage?include_active=true`

#### 3.3 Completion/status persistence must survive missing-row and transient-SQLite cases

- **Must** treat short SQLite lock/busy failures as retryable for run status/finalization writes
- **Must** make `RunRepository.put()` idempotent so a retried write does not turn a previously committed row into a primary-key failure
- **Must** let `update_status()` / `update_run_completion()` return `False` when the store can prove no row was updated
- **Must** recreate a missing row from the latest in-memory snapshot before retrying completion/status persistence

#### 3.4 Restart recovery must fail orphaned active runs closed

- **Must** treat persisted `pending` / `running` rows found at SQLite-backed gateway startup as orphan candidates when no live in-memory run owns them
- **Must** mark recovered orphaned runs as `error` with an explicit operator-readable message
- **Must** mark thread status to `error` only when the latest run in that thread was one of the recovered orphaned runs
- **Must not** recover or rewrite a run that is still live in `_runs`

### 4. Validation & Error Matrix

| Case | Must happen | Must not happen | Verification |
| --- | --- | --- | --- |
| Initial store write fails during `create()` | Exception propagates and `_runs` rollback removes the new run | Half-created run remains listable | `test_create_rolls_back_in_memory_record_on_store_failure` |
| Initial store write is cancelled during `create()` | Cancellation propagates and `_runs` rollback removes the new run | Cancelled create leaves visible run | `test_create_rolls_back_in_memory_record_on_store_cancellation` |
| `create_or_reject(..., interrupt)` new-run persist fails | Old run stays running; no interrupt side effect | Existing inflight run is cancelled before new run is durable | `test_create_or_reject_does_not_interrupt_old_run_when_new_run_store_write_fails` |
| Active run emits repeated progress callbacks | Counters stay deduplicated and progress snapshots stay throttled | Double-counted token totals or unbounded progress writes | `test_throttled_progress_flush_emits_trailing_snapshot` |
| Completion update hits missing row | Row is recreated from in-memory snapshot, then completion fields are retried | Final token/status data is silently dropped | `RunManager.update_run_completion()` regression coverage |
| SQLite-backed startup finds orphaned inflight row | Row becomes `error`; latest affected thread becomes `error` | UI shows indefinitely running zombie run | startup recovery tests around `reconcile_orphaned_inflight_runs` |

### 5. Good / Base / Bad Cases

#### Good

- A concurrent `list_by_thread()` blocks until a newly created run is durably persisted
- Active run totals in `RunResponse` and `token-usage?include_active=true` match the current `RunJournal` snapshot
- A restarted SQLite gateway converts stale active rows into explicit failure state instead of hanging forever

#### Base

- Memory-only stores may return `False` / `True` directly for row-updated semantics without implementing SQL rowcount internals
- Progress writes are best-effort and may be skipped on shutdown after the final durable completion write succeeds

#### Bad

- Persisting status/finalization with fire-and-forget writes that can silently fail
- Interrupting the old run before the replacement run has a durable store row
- Using active progress snapshots to overwrite durable final status after completion
- Treating stale persisted `running` rows after restart as harmless UI noise

### 6. Tests Required

- `backend/tests/test_run_journal.py`
  - progress reporter snapshot
  - throttled trailing snapshot
  - flush behavior for delayed progress task
- `backend/tests/test_thread_token_usage.py`
  - `include_active=true` passes through to store aggregation
- `backend/tests/test_run_manager.py`
  - create rollback on store failure/cancellation
  - create visibility blocked until persist completes
  - create-or-reject does not interrupt old run when new-run persist fails
- `backend/tests/test_run_repository.py`
  - idempotent `put()`
  - `update_status()` / `update_run_completion()` return `False` for missing row
  - `list_inflight()` cutoff behavior
- Assertion points:
  - no half-visible run after failed initial persistence
  - no duplicate token accumulation from repeated callbacks
  - active-token API can include running runs without rewriting final totals
  - orphan recovery only touches truly orphaned latest runs

### 7. Wrong vs Correct

#### Wrong

```python
record = RunRecord(...)
self._runs[record.run_id] = record
await self._store.put(record.run_id, ...)
interrupt_existing_runs()
```

#### Correct

```python
self._runs[record.run_id] = record
try:
    await self._persist_new_run_to_store(record)
except Exception:
    self._runs.pop(record.run_id, None)
    raise

interrupt_existing_runs_after_new_run_is_durable()
```

**Related**: `error-handling.md` covers loop-closed retry recovery; this section covers durable run-row lifecycle and active progress reporting semantics.

---

## Scenario: Gateway image generation module contract

### 1. Scope / Trigger

- Trigger: adding or changing `/api/v1/images/*` gateway routes, the image provider bridge, or the controlled `.deer-flow/images` persistence layout.
- Applies to:
  - `app/gateway/app.py`
  - `app/gateway/routers/images.py`
  - `app/gateway/routers/images_support/service.py`
  - backend tests that cover image router registration and contract behavior

### 2. Signatures

- `POST /api/v1/images/generate`
- `GET /api/v1/images/jobs`
- `GET /api/v1/images/jobs/{job_id}`
- `GET /api/v1/images/files/{image_id}`
- `generate_images(req: ImageGenerateRequest, *, user_id: str, db: AsyncSession | None = None) -> ImageJobResponse`
- `list_image_jobs(*, user_id: str) -> ImageJobListResponse`
- `get_image_job(job_id: str, *, user_id: str) -> ImageJobResponse`
- `read_image_file(*, image_id: str, user_id: str) -> ImageFilePayload`

### 3. Contracts

- Authentication:
  - **Must** reuse `app.gateway.novel_migrated.api.common.get_user_id`
  - **Must** fail closed with `401` when the main-project user context is missing
  - **Must not** add `local_single_user`, passphrase, or anonymous fallbacks
- Provider/runtime resolution:
  - **Must** prefer `resolve_user_ai_runtime_config(settings, ai_model=..., module_id="images")`
  - **May** fall back to env only when DB/settings are unavailable
  - **Must** keep local-dev routing aligned with the existing gateway profile; do not introduce a separate image service port
- Request validation:
  - `prompt`: required, trimmed non-empty
  - `n`: integer `1..10`
  - `size` and `aspect_ratio`: mutually exclusive
  - `size`, `aspect_ratio`, `quality`: explicit allowlists
- Provider payload:
  - **Must** call OpenAI-compatible `/images/generations`
  - **Must** request `response_format="b64_json"` by default
  - **Must** preserve request-vs-response metadata for debugging
  - **Must** support provider adapters that map `quality` into `thinking` when the upstream contract requires it
- Persistence:
  - **Must** store generated files and JSON metadata under backend-controlled `.deer-flow/images`
  - **Must** isolate job/file records by authenticated user
  - **Must not** introduce a new SQL table, SQLite sidecar, or standalone generated/uploads/jobs service layout

### 4. Validation & Error Matrix

| Case | Must happen | Must not happen | Verification |
| --- | --- | --- | --- |
| Missing user context | `401 Authentication required` | Silent fallback to local user | Router tests for generate/jobs/detail/file |
| Missing runtime config | `503` with stable `missing_config` error body and failed job record | Upstream call attempt | `test_generate_images_returns_503_when_config_missing` |
| Invalid `prompt` / `n` / `size` / `aspect_ratio` / `size+aspect_ratio` | `422` from request validation | Provider call or partial job write | `test_generate_images_validates_request_payload` |
| Upstream returns `b64_json` | Decode, persist image, return controlled file URL | Return raw base64 to frontend | success contract test |
| Upstream returns `url` | Best-effort download, persist image, return controlled file URL | Leak upstream temporary URL as the only artifact | env fallback / URL test |
| Degraded gateway mode | Images router still registers under `CORE_ROUTER_MODULES` | Router only available in full DeerFlow mode | degraded router registration test |

### 5. Good / Base / Bad Cases

- Good:
  - The frontend only sees controlled gateway file URLs like `/api/v1/images/files/{image_id}`
  - Job history survives process restarts through the JSON metadata files
  - Provider-specific quality/thinking adaptation stays inside the backend bridge
- Base:
  - The module ships only user-facing generate/history/file access for MVP
  - Image files are stored locally when object/media-asset integration is not yet required
- Bad:
  - Adding `/admin/*`, quota bookkeeping, passphrase owners, or SQLite sidecars
  - Returning provider URLs directly without controlled persistence
  - Re-introducing `8001`, `30116`, or a second image server in local-dev assumptions

### 6. Tests Required

- `backend/tests/test_image_generation_router.py`
  - success path with `b64_json`
  - env fallback path with provider `url`
  - missing config -> failed job with readable error
  - invalid request payload matrix
  - strict `401` for generate/jobs/detail/file without authenticated user
- `backend/tests/test_images_router_registration.py`
  - degraded gateway still registers `/api/v1/images/jobs`
  - internal-auth read succeeds in degraded mode
- Assertion points:
  - controlled file URL shape
  - request payload fields sent upstream
  - config source metadata
  - user isolation on job/file lookup

### 7. Wrong vs Correct

#### Wrong

```python
# 1) Public fallback identity
user_id = request.query_params.get("user_id") or "local-user"

# 2) Hand provider URLs back to the page
return {"image_urls": [item["url"] for item in data["data"]]}
```

#### Correct

```python
user_id = Depends(get_user_id)
runtime, source = resolve_user_ai_runtime_config(
    settings,
    ai_model=requested_model,
    module_id="images",
)
image = _store_image_file(...)
return ImageJobResponse.model_validate({
    "images": [image.model_dump()],
    "image_urls": [image.url],
})
```

---

## Scenario: Local sandbox virtual path command execution

### 1. Scope / Trigger

- Trigger: changing `deerflow/sandbox/local/local_sandbox.py` path mapping, command execution, or Windows shell handling.
- Applies to the public `Sandbox` API methods used after `LocalSandboxProvider.acquire(thread_id)`.

### 2. Signatures

- `LocalSandbox._resolve_paths_in_command(command: str) -> str`
- `LocalSandbox.execute_command(command: str) -> str`
- `LocalSandboxProvider.acquire(thread_id: str | None = None) -> str`

### 3. Contracts

- `/mnt/user-data`, `/mnt/user-data/uploads`, `/mnt/user-data/workspace`, and `/mnt/user-data/outputs` must resolve inside the acquired thread's user-data directory.
- Command execution must preserve the same virtual path behavior as `read_file`, `write_file`, `list_dir`, `glob`, `grep`, and `update_file`.
- On Windows, resolved local paths passed to PowerShell, cmd, or Git Bash/MSYS must be shell-safe. Do not emit raw backslash paths into MSYS commands because `C:\Users\...` can become `C:Users...`.
- Output should reverse-resolve local paths back to the documented virtual prefixes when possible.

### 4. Validation & Error Matrix

| Case | Must happen | Must not happen | Verification |
| --- | --- | --- | --- |
| `ls /mnt/user-data/uploads` after writing an upload | Lists the file | Loses slashes in `C:\...` paths | `test_execute_command_with_virtual_path` |
| `ls /mnt/user-data` after touching all subdirs | Lists `workspace`, `uploads`, and `outputs` | Requires caller-side `tools.py` path shims | `test_execute_command_lists_aggregate_user_data_root` |
| Two different thread ids use the same virtual path | Resolve to isolated host dirs | Leak files between threads | `test_per_thread_user_data_mapping_isolated` |

### 5. Good / Base / Bad Cases

- Good: virtual paths are translated once at the sandbox boundary and quoted for the selected host shell.
- Base: already quoted user paths remain quoted and are not double-quoted.
- Bad: returning raw Windows backslash paths for Git Bash/MSYS command strings.

### 6. Tests Required

- `backend/tests/test_local_sandbox_virtual_path_contract.py`
- Include command execution cases, not only file API cases, whenever path mapping changes.

### 7. Wrong vs Correct

#### Wrong

```python
return command.replace("/mnt/user-data", r"C:\Users\...\user-data")
```

#### Correct

```python
resolved = self._resolve_path(matched_path)
return quote_for_windows_shell(resolved)
```
