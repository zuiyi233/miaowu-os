"""Consistency gate submodules.

This package splits the previous monolithic `consistency_gate_service.py` into
smaller, testable units:
- ConsistencyChecker: cross-chapter consistency detection
- GateReporter: finalize gate checks & fusion logic
- FinalizationExecutor: finalize workflow execution
"""

from .base import GateBase, GateLevel
from .checker import ConsistencyChecker
from .finalizer import FinalizationExecutor
from .reporter import GateReporter

__all__ = [
    "GateBase",
    "GateLevel",
    "ConsistencyChecker",
    "GateReporter",
    "FinalizationExecutor",
]

