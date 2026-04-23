from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select, update

from app.gateway.novel_migrated.core.database import async_session_factory

logger = logging.getLogger(__name__)

_OPTIMISTIC_RETRY_MAX = 3


async def optimistic_update(
    model_class: type,
    entity_id: str,
    updates: dict[str, Any],
    id_column: str = "id",
    retry_max: int = _OPTIMISTIC_RETRY_MAX,
) -> dict[str, Any]:
    """Perform an optimistic-lock update on a model instance.

    Reads the current version, then issues an UPDATE with
    `WHERE version = old_version`. If no row is affected (concurrent
    modification), retries up to `retry_max` times with fresh reads.

    Args:
        model_class: SQLAlchemy model class (must have `version` column).
        entity_id: Primary key value of the row to update.
        updates: Dict of column-name -> new-value to set.
        id_column: Name of the primary key column (default "id").
        retry_max: Maximum number of retry attempts on version conflict.

    Returns:
        Dict with "success", "attempts", and "final_version" keys.

    Raises:
        ValueError: If the entity is not found after all retries.
    """
    id_col = getattr(model_class, id_column, None)
    version_col = getattr(model_class, "version", None)
    if id_col is None or version_col is None:
        raise ValueError(f"Model {model_class.__name__} missing id or version column")

    async with async_session_factory() as session:
        for attempt in range(1, retry_max + 1):
            stmt = select(model_class).where(id_col == entity_id)
            result = await session.execute(stmt)
            instance = result.scalar_one_or_none()

            if instance is None:
                raise ValueError(f"{model_class.__name__} with {id_column}={entity_id} not found")

            current_version = instance.version
            update_stmt = (
                update(model_class)
                .where(id_col == entity_id, version_col == current_version)
                .values(**updates, version=current_version + 1)
            )
            row_result = await session.execute(update_stmt)
            await session.commit()

            if row_result.rowcount > 0:
                return {
                    "success": True,
                    "attempts": attempt,
                    "final_version": current_version + 1,
                }

            logger.warning(
                "Optimistic lock conflict on %s id=%s, retry %d/%d",
                model_class.__name__,
                entity_id,
                attempt,
                retry_max,
            )
            await session.rollback()

        raise ValueError(
            f"Optimistic lock conflict on {model_class.__name__} id={entity_id} "
            f"after {retry_max} retries"
        )
