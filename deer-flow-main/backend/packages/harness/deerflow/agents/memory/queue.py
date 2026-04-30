"""Memory update queue with a single background async worker."""

import asyncio
import logging
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from deerflow.config.memory_config import get_memory_config

logger = logging.getLogger(__name__)

_DEFAULT_WORKER_SHUTDOWN_TIMEOUT_SECONDS = 5.0


@dataclass
class ConversationContext:
    """Context for a conversation to be processed for memory update."""

    thread_id: str
    messages: list[Any]
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    agent_name: str | None = None
    correction_detected: bool = False
    reinforcement_detected: bool = False
    model_name: str | None = None
    runtime_model: str | None = None
    runtime_base_url: str | None = None
    runtime_api_key: str | None = None


class MemoryUpdateQueue:
    """Queue for memory updates processed by a single async worker.

    Conversation contexts are merged per thread and processed by one
    event-loop worker that debounces regular adds while still supporting
    explicit immediate flush requests.
    """

    def __init__(self):
        """Initialize the memory update queue."""
        self._queue: list[ConversationContext] = []
        self._lock = threading.Lock()
        self._worker_task: asyncio.Task[None] | None = None
        self._worker_loop: asyncio.AbstractEventLoop | None = None
        self._wake_event: asyncio.Event | None = None
        self._processing = False
        self._stop_requested = False
        self._immediate_requested = False

    def _reset_runtime_state_locked(self, *, clear_queue: bool) -> None:
        if clear_queue:
            self._queue.clear()
        self._processing = False
        self._stop_requested = False
        self._immediate_requested = False

    def _detach_worker_locked(self) -> None:
        self._worker_task = None
        self._worker_loop = None
        self._wake_event = None

    def _signal_worker(self, *, immediate: bool = False) -> None:
        """Wake the background worker if it is currently running."""
        with self._lock:
            if immediate:
                self._immediate_requested = True
            wake_event = self._wake_event
            loop = self._worker_loop
            active = self._worker_task is not None and not self._worker_task.done()

        if not active or wake_event is None or loop is None:
            return

        try:
            loop.call_soon_threadsafe(wake_event.set)
        except RuntimeError:
            logger.debug("Unable to signal memory worker; event loop may be closing", exc_info=True)

    def add(
        self,
        thread_id: str,
        messages: list[Any],
        agent_name: str | None = None,
        correction_detected: bool = False,
        reinforcement_detected: bool = False,
        model_name: str | None = None,
        runtime_model: str | None = None,
        runtime_base_url: str | None = None,
        runtime_api_key: str | None = None,
    ) -> None:
        """Add a conversation to the update queue."""
        config = get_memory_config()
        if not config.enabled:
            return

        with self._lock:
            self._enqueue_locked(
                thread_id=thread_id,
                messages=messages,
                agent_name=agent_name,
                correction_detected=correction_detected,
                reinforcement_detected=reinforcement_detected,
                model_name=model_name,
                runtime_model=runtime_model,
                runtime_base_url=runtime_base_url,
                runtime_api_key=runtime_api_key,
            )
            queue_size = len(self._queue)

        self._signal_worker()
        logger.info("Memory update queued for thread %s, queue size: %d", thread_id, queue_size)

    def add_nowait(
        self,
        thread_id: str,
        messages: list[Any],
        agent_name: str | None = None,
        correction_detected: bool = False,
        reinforcement_detected: bool = False,
        model_name: str | None = None,
        runtime_model: str | None = None,
        runtime_base_url: str | None = None,
        runtime_api_key: str | None = None,
    ) -> None:
        """Add a conversation and request immediate background processing."""
        config = get_memory_config()
        if not config.enabled:
            return

        with self._lock:
            self._enqueue_locked(
                thread_id=thread_id,
                messages=messages,
                agent_name=agent_name,
                correction_detected=correction_detected,
                reinforcement_detected=reinforcement_detected,
                model_name=model_name,
                runtime_model=runtime_model,
                runtime_base_url=runtime_base_url,
                runtime_api_key=runtime_api_key,
            )
            queue_size = len(self._queue)

        self._signal_worker(immediate=True)
        logger.info(
            "Memory update queued for immediate processing on thread %s, queue size: %d",
            thread_id,
            queue_size,
        )

    def _enqueue_locked(
        self,
        *,
        thread_id: str,
        messages: list[Any],
        agent_name: str | None,
        correction_detected: bool,
        reinforcement_detected: bool,
        model_name: str | None = None,
        runtime_model: str | None = None,
        runtime_base_url: str | None = None,
        runtime_api_key: str | None = None,
    ) -> None:
        existing_context = next(
            (context for context in self._queue if context.thread_id == thread_id),
            None,
        )
        merged_correction_detected = correction_detected or (existing_context.correction_detected if existing_context is not None else False)
        merged_reinforcement_detected = reinforcement_detected or (existing_context.reinforcement_detected if existing_context is not None else False)
        effective_model_name = model_name or (existing_context.model_name if existing_context is not None else None)
        effective_runtime_model = runtime_model or (existing_context.runtime_model if existing_context is not None else None)
        effective_base_url = runtime_base_url or (existing_context.runtime_base_url if existing_context is not None else None)
        effective_api_key = runtime_api_key or (existing_context.runtime_api_key if existing_context is not None else None)
        merged_messages = list(messages)
        context = ConversationContext(
            thread_id=thread_id,
            messages=merged_messages,
            agent_name=agent_name,
            correction_detected=merged_correction_detected,
            reinforcement_detected=merged_reinforcement_detected,
            model_name=effective_model_name,
            runtime_model=effective_runtime_model,
            runtime_base_url=effective_base_url,
            runtime_api_key=effective_api_key,
        )

        self._queue = [c for c in self._queue if c.thread_id != thread_id]
        self._queue.append(context)

    def _snapshot_worker_state_locked(self) -> tuple[bool, bool, bool]:
        """Return queue/work flags while consuming one-shot wake requests."""
        has_pending = bool(self._queue)
        stop_requested = self._stop_requested
        immediate_requested = self._immediate_requested
        if not has_pending or stop_requested or immediate_requested:
            self._immediate_requested = False
        return has_pending, stop_requested, immediate_requested

    async def start_worker(self) -> bool:
        """Start the single async worker if memory updates are enabled.

        Returns ``True`` when the worker is running after this call. If the
        worker was already running, the existing task is reused.
        """
        config = get_memory_config()
        if not config.enabled:
            return False

        created_new_worker = False
        with self._lock:
            if self._worker_task is None or self._worker_task.done():
                loop = asyncio.get_running_loop()
                self._worker_loop = loop
                self._wake_event = asyncio.Event()
                self._stop_requested = False
                self._processing = False
                self._worker_task = loop.create_task(self._worker_main(), name="memory-update-worker")
                self._worker_task.add_done_callback(self._log_worker_failure)
                created_new_worker = True

        self._signal_worker()
        if created_new_worker:
            logger.info("Memory update worker started")
        return True

    async def stop_worker(self, timeout_seconds: float | None = None) -> None:
        """Stop the worker with a bounded best-effort wait.

        The worker is given one chance to finish the current batch. If it does
        not stop within ``timeout_seconds`` (or the built-in default), the task
        is cancelled and the queue state is cleared so shutdown can continue.
        """
        timeout = _DEFAULT_WORKER_SHUTDOWN_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds

        with self._lock:
            task = self._worker_task
            if task is None or task.done():
                self._detach_worker_locked()
                self._reset_runtime_state_locked(clear_queue=True)
                return
            self._stop_requested = True

        self._signal_worker(immediate=True)

        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except TimeoutError:
            logger.warning(
                "Memory update worker shutdown exceeded %.1fs; cancelling task",
                timeout,
            )
            self.shutdown_nowait()
            try:
                await asyncio.gather(task, return_exceptions=True)
            except Exception:
                logger.debug("Failed to join cancelled memory worker", exc_info=True)
        except asyncio.CancelledError:
            logger.debug("Memory update worker shutdown was cancelled", exc_info=True)
        except Exception:
            logger.exception("Memory update worker shutdown failed")
        finally:
            with self._lock:
                if self._worker_task is task:
                    self._detach_worker_locked()
                self._reset_runtime_state_locked(clear_queue=True)

    def shutdown_nowait(self) -> None:
        """Cancel the worker without waiting.

        Intended for test cleanup or emergency teardown paths where best-effort
        shutdown is sufficient and waiting would be undesirable.
        """
        with self._lock:
            task = self._worker_task
            loop = self._worker_loop
            wake_event = self._wake_event
            self._stop_requested = True
            self._immediate_requested = True
            self._queue.clear()
            self._processing = False

        if wake_event is not None:
            try:
                if loop is not None and not loop.is_closed():
                    loop.call_soon_threadsafe(wake_event.set)
                else:
                    wake_event.set()
            except RuntimeError:
                logger.debug("Unable to wake memory worker during shutdown", exc_info=True)

        if task is not None and not task.done():
            try:
                if loop is not None and not loop.is_closed():
                    loop.call_soon_threadsafe(task.cancel)
                else:
                    task.cancel()
            except RuntimeError:
                logger.debug("Unable to cancel memory worker during shutdown", exc_info=True)

    async def _worker_main(self) -> None:
        logger.info("Memory update worker running")
        try:
            while True:
                should_process = await self._await_batch_ready()
                if not should_process:
                    break
                await self._process_queue()
        except asyncio.CancelledError:
            logger.debug("Memory update worker cancelled")
            raise
        except Exception:
            logger.exception("Memory update worker crashed")
            raise
        finally:
            current_task = asyncio.current_task()
            with self._lock:
                if self._worker_task is current_task:
                    self._detach_worker_locked()
                self._processing = False
                self._stop_requested = False
                self._immediate_requested = False
            logger.info("Memory update worker stopped")

    async def _await_batch_ready(self) -> bool:
        """Wait until the current batch should be processed.

        Returns ``True`` when the queue should be drained, or ``False`` when the
        worker should exit.
        """
        while True:
            wake_event = self._wake_event
            if wake_event is None:
                return False

            await wake_event.wait()
            wake_event.clear()

            with self._lock:
                has_pending, stop_requested, immediate_requested = self._snapshot_worker_state_locked()

            if not has_pending:
                if stop_requested:
                    return False
                continue

            if stop_requested or immediate_requested:
                return True

            debounce_seconds = max(0, get_memory_config().debounce_seconds)
            if debounce_seconds <= 0:
                return True

            while True:
                try:
                    await asyncio.wait_for(wake_event.wait(), timeout=debounce_seconds)
                except TimeoutError:
                    return True

                wake_event.clear()
                with self._lock:
                    has_pending, stop_requested, immediate_requested = self._snapshot_worker_state_locked()

                if not has_pending:
                    if stop_requested:
                        return False
                    continue

                if stop_requested or immediate_requested:
                    return True

    def _log_worker_failure(self, task: asyncio.Task[Any]) -> None:
        if task.cancelled():
            return
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return
        except Exception:
            logger.debug("Failed to inspect memory worker completion state", exc_info=True)
            return
        if exc is not None:
            logger.error("Memory update worker failed: %s", exc)

    async def _process_queue(self) -> None:
        """Process all queued conversation contexts."""
        # Import here to avoid circular dependency
        from deerflow.agents.memory.updater import MemoryUpdater

        with self._lock:
            if self._processing:
                return
            if not self._queue:
                return

            self._processing = True
            contexts_to_process = self._queue.copy()
            self._queue.clear()

        logger.info("Processing %d queued memory updates", len(contexts_to_process))

        try:
            for index, context in enumerate(contexts_to_process):
                try:
                    logger.info("Updating memory for thread %s", context.thread_id)
                    updater = MemoryUpdater(
                        model_name=context.model_name,
                        runtime_model=context.runtime_model,
                        runtime_base_url=context.runtime_base_url,
                        runtime_api_key=context.runtime_api_key,
                    )

                    success = await updater.aupdate_memory(
                        messages=context.messages,
                        thread_id=context.thread_id,
                        agent_name=context.agent_name,
                        correction_detected=context.correction_detected,
                        reinforcement_detected=context.reinforcement_detected,
                    )
                    if success:
                        logger.info("Memory updated successfully for thread %s", context.thread_id)
                    else:
                        logger.warning("Memory update skipped/failed for thread %s", context.thread_id)
                except Exception:
                    logger.exception("Error updating memory for thread %s", context.thread_id)

                if index < len(contexts_to_process) - 1 and not self._stop_requested:
                    await asyncio.sleep(0.5)
        finally:
            with self._lock:
                self._processing = False

    def flush(self) -> None:
        """Force immediate processing of the queue.

        This is useful for testing or graceful shutdown when no worker is
        currently running.
        """
        asyncio.run(self._process_queue())

    def flush_nowait(self) -> None:
        """Request immediate processing from the background worker."""
        self._signal_worker(immediate=True)

    def clear(self) -> None:
        """Clear the queue without processing.

        This is useful for testing.
        """
        with self._lock:
            self._queue.clear()
            self._reset_runtime_state_locked(clear_queue=False)

    @property
    def pending_count(self) -> int:
        """Get the number of pending updates."""
        with self._lock:
            return len(self._queue)

    @property
    def is_processing(self) -> bool:
        """Check if the queue is currently being processed."""
        with self._lock:
            return self._processing


# Global singleton instance
_memory_queue: MemoryUpdateQueue | None = None
_queue_lock = threading.Lock()


def get_memory_queue() -> MemoryUpdateQueue:
    """Get the global memory update queue singleton.

    Returns:
        The memory update queue instance.
    """
    global _memory_queue
    with _queue_lock:
        if _memory_queue is None:
            _memory_queue = MemoryUpdateQueue()
        return _memory_queue


def reset_memory_queue() -> None:
    """Reset the global memory queue.

    This is useful for testing.
    """
    global _memory_queue
    with _queue_lock:
        queue = _memory_queue
        _memory_queue = None
    if queue is not None:
        queue.shutdown_nowait()
