# Error Handling

> Runtime error recovery rules for backend model calls.

---

## Scenario: `RuntimeError: Event loop is closed` during model calls

### 1. Scope / Trigger

- Trigger: `LLMErrorHandlingMiddleware._classify_error()` receives a `RuntimeError` whose normalized message contains `Event loop is closed`
- Applies to both `wrap_model_call()` and `awrap_model_call()`
- The failure usually means a cached async transport or client was created in a different loop/thread scope and is no longer reusable

### 2. Signatures

- `LLMErrorHandlingMiddleware._classify_error(exc: BaseException) -> tuple[bool, str]`
- `LLMErrorHandlingMiddleware._recover_loop_closed_once() -> None`
- `LLMErrorHandlingMiddleware.wrap_model_call(...) -> ModelCallResult`
- `LLMErrorHandlingMiddleware.awrap_model_call(...) -> ModelCallResult`
- `app.gateway.novel_migrated.services.ai_service.clear_model_cache() -> None`

### 3. Contracts

- **Must** classify `Event loop is closed` as `retriable=True` and `reason="loop_closed"`
- **Must** call `clear_model_cache()` exactly once per middleware instance before the next retry attempt
- **Must** keep the normal retry budget intact; loop-closed recovery is not an extra retry slot
- **Must not** clear the cache again for repeated `Event loop is closed` errors in the same middleware instance
- **Must not** classify unrelated `RuntimeError` messages as loop-closed recovery candidates
- **Must** return the standard temporary-unavailable assistant message after retries are exhausted; do not expose Python internals to the user

### 4. Validation & Error Matrix

| Input | Classification | Recovery action | Retry behavior | Verification |
| --- | --- | --- | --- | --- |
| `RuntimeError("Event loop is closed")` | `retriable=True`, `reason="loop_closed"` | Clear cache once | Retry through the normal retry loop | `clear_model_cache()` called once, attempts increment |
| Same error again in the same middleware instance | `retriable=True`, `reason="loop_closed"` | No second clear | Continue retry loop | Clear call count remains `1` |
| Unrelated `RuntimeError("...")` | Non-loop-closed path | No cache clear | Default handling | `clear_model_cache()` is not called |
| Retry budget exhausted after loop-closed recovery | Retriable path exhausted | No extra recovery | Return graceful fallback message | User sees the temporary-unavailable message, not a traceback |

### 5. Good / Base / Bad Cases

#### Good

- The first loop-closed failure clears the cache once and then retries
- Recovery happens before the next retry attempt, not after the call has fully failed
- The middleware instance remains idempotent: one recovery flag, one cache clear

#### Base

- The middleware retries transient provider failures according to `retry_max_attempts`
- The user-facing fallback for exhausted transient failures remains a concise temporary-unavailable message

#### Bad

- Clearing the cache on every retry
- Treating loop-closed as auth / quota / model-unavailable
- Returning the raw `RuntimeError` text to the user
- Adding a second, separate loop-closed retry path outside `LLMErrorHandlingMiddleware`

### 6. Tests Required

- `backend/tests/test_llm_error_handling_middleware.py::test_classify_error_event_loop_closed_is_retriable_loop_closed`
- `backend/tests/test_llm_error_handling_middleware.py::test_sync_event_loop_closed_clears_cache_once_and_retries`
- `backend/tests/test_llm_error_handling_middleware.py::test_async_event_loop_closed_clears_cache_once_and_retries`

Assertion points:

- `clear_model_cache()` is called exactly once
- the handler is attempted until success or retry exhaustion
- the returned `AIMessage` content is the graceful temporary-unavailable message when retries fail

### 7. Wrong vs Correct

#### Wrong

```python
except RuntimeError as exc:
    if "Event loop is closed" in str(exc):
        clear_model_cache()
        return handler(request)
```

#### Correct

```python
retriable, reason = self._classify_error(exc)
if retriable and reason == "loop_closed":
    self._recover_loop_closed_once()
if retriable and attempt < self.retry_max_attempts:
    # Continue through the normal retry loop.
    ...
```

**Related**: `quality-guidelines.md` defines the cache-scope rule that prevents reuse of stale async transports in the first place.
