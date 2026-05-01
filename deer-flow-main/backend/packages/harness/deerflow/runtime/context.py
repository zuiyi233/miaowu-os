"""Run context — a value object that bundles runtime infrastructure dependencies.

:class:`RunContext` is a plain data container built by the gateway's
``get_run_context`` dependency and passed to service-layer functions
so they can access checkpointer, store, event store, thread metadata,
etc. without reaching into ``app.state`` directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from langgraph.types import Checkpointer

from deerflow.config.app_config import AppConfig
from deerflow.runtime.events.store.base import RunEventStore
from deerflow.runtime.runs.store.base import RunStore

if TYPE_CHECKING:
    from deerflow.persistence.thread_meta.base import ThreadMetaStore


@dataclass
class RunContext:
    """Bundled infrastructure dependencies for a run request.

    Attributes are set once during dependency resolution and are
    read-only by convention (the dataclass is frozen=False only to
    keep construction ergonomic for the gateway dep function).
    """

    checkpointer: Checkpointer
    store: Any | None
    event_store: RunEventStore
    run_events_config: Any | None
    thread_store: ThreadMetaStore
    app_config: AppConfig
    run_store: RunStore | None = None
