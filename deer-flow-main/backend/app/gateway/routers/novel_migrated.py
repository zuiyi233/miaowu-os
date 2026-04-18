"""Gateway router aggregator for Novel Migrated Wave 1+2 APIs."""

from __future__ import annotations

import importlib
import logging
from types import ModuleType

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["novel_migrated"])

_OPTIONAL_ROUTER_MODULES = (
    "app.gateway.novel_migrated.api.careers",
    "app.gateway.novel_migrated.api.foreshadows",
    "app.gateway.novel_migrated.api.memories",
    "app.gateway.novel_migrated.api.inspiration",
    "app.gateway.novel_migrated.api.wizard_stream",
    "app.gateway.novel_migrated.api.novel_stream",
    "app.gateway.novel_migrated.api.project_covers",
    "app.gateway.novel_migrated.api.book_import",
    "app.gateway.novel_migrated.api.user_settings",
)


def _import_router_module(module_path: str) -> ModuleType:
    return importlib.import_module(module_path)


def _include_optional_router(module_path: str) -> bool:
    try:
        module = _import_router_module(module_path)
    except ModuleNotFoundError as exc:
        missing_name = exc.name or "<unknown>"
        logger.warning("Skip optional router %s: missing module dependency %s", module_path, missing_name)
        return False

    module_router = getattr(module, "router", None)
    if module_router is None:
        logger.warning("Skip optional router %s: router attribute is missing", module_path)
        return False

    router.include_router(module_router)
    return True


for _module_path in _OPTIONAL_ROUTER_MODULES:
    _include_optional_router(_module_path)
