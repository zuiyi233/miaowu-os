"""ORM model registration entry point.

Importing this module ensures all ORM models are registered with
``Base.metadata`` so Alembic autogenerate detects every table.

The actual ORM classes have moved to entity-specific subpackages:
- ``deerflow.persistence.thread_meta``
- ``deerflow.persistence.run``
- ``deerflow.persistence.feedback``
- ``deerflow.persistence.user``

``RunEventRow`` remains in ``deerflow.persistence.models.run_event`` because
its storage implementation lives in ``deerflow.runtime.events.store.db`` and
there is no matching entity directory.
"""

from deerflow.persistence.feedback.model import FeedbackRow
from deerflow.persistence.models.run_event import RunEventRow
from deerflow.persistence.run.model import RunRow
from deerflow.persistence.storage_quota.model import (
    AdminAuditLogRow,
    StorageRecalculateTaskRow,
    SystemSettingRow,
    UserQuotaOverrideRow,
    UserStorageObjectRow,
    UserStorageUsageRow,
)
from deerflow.persistence.thread_meta.model import ThreadMetaRow
from deerflow.persistence.user.model import NewAPIAccountSnapshotRow, UserRow

__all__ = [
    "AdminAuditLogRow",
    "FeedbackRow",
    "NewAPIAccountSnapshotRow",
    "RunEventRow",
    "RunRow",
    "StorageRecalculateTaskRow",
    "SystemSettingRow",
    "ThreadMetaRow",
    "UserQuotaOverrideRow",
    "UserRow",
    "UserStorageObjectRow",
    "UserStorageUsageRow",
]
