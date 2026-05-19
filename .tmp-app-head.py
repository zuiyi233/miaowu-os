import asyncio
import importlib
import importlib.util
import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from types import ModuleType

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.responses import JSONResponse

from app.gateway.auth_middleware import AuthMiddleware
from app.gateway.config import get_gateway_config
from app.gateway.middleware.request_trace import RequestTraceMiddleware
from app.gateway.novel_migrated.core.logger import setup_logging
from app.gateway.observability.context import install_trace_log_filter

_FILE_LOG_ENABLED_VALUES = {"1", "true", "yes", "on"}

logger = logging.getLogger(__name__)


class _ExceptionShieldMiddleware:
    """Pure-ASGI middleware that catches unhandled exceptions.

    Placed *inside* the CORSMiddleware layer so that error responses
    it produces still receive CORS headers from the outer CORS middleware.
    Without this, exceptions bubbling out of BaseHTTPMiddleware (AuthMiddleware,
    PromptCacheMiddleware, etc.) propagate straight to uvicorn, which returns
    a bare 500 with no CORS headers — causing the browser to block the
    response.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "?")
        try:
            await self.app(scope, receive, send)
        except Exception as exc:
            with open("_shield_debug.log", "a") as f:
                import traceback
                f.write(f"CAUGHT: {type(exc).__name__}: {exc}\n")
                traceback.print_exc(file=f)
                f.write("\n")
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal Server Error"},
            )
            await response(scope, receive, send)


def _is_truthy_env(name: str) -> bool:
    value = (os.getenv(name) or "").strip().lower()
    return value in _FILE_LOG_ENABLED_VALUES


def _configure_gateway_logging() -> None:
    """Configure gateway logging with optional file rotation support.

    Defaults remain console-only to preserve current runtime behavior.
    """
    level = (os.getenv("DEERFLOW_GATEWAY_LOG_LEVEL") or "INFO").strip().upper()
    log_to_file = _is_truthy_env("DEERFLOW_GATEWAY_LOG_TO_FILE")
    log_file_path = (os.getenv("DEERFLOW_GATEWAY_LOG_FILE_PATH") or "").strip() or None

    raw_max_bytes = (os.getenv("DEERFLOW_GATEWAY_LOG_MAX_BYTES") or "").strip()
    raw_backup_count = (os.getenv("DEERFLOW_GATEWAY_LOG_BACKUP_COUNT") or "").strip()
    try:
        max_bytes = int(raw_max_bytes) if raw_max_bytes else 10 * 1024 * 1024
    except ValueError:
        max_bytes = 10 * 1024 * 1024
    try:
        backup_count = int(raw_backup_count) if raw_backup_count else 30
    except ValueError:
        backup_count = 30

    setup_logging(
        level=level,
        log_to_file=log_to_file,
        log_file_path=log_file_path,
        max_bytes=max(1024 * 1024, max_bytes),
        backup_count=max(1, backup_count),
    )


_configure_gateway_logging()

logger = logging.getLogger(__name__)
install_trace_log_filter()

HARNESS_ROUTER_MODULES = (
    "app.gateway.routers.models",
    "app.gateway.routers.mcp",
    "app.gateway.routers.features",
    "app.gateway.routers.memory",
    "app.gateway.routers.skills",
    "app.gateway.routers.artifacts",
    "app.gateway.routers.media_drafts",
    "app.gateway.routers.uploads",
    "app.gateway.routers.threads",
    "app.gateway.routers.agents",
    "app.gateway.routers.suggestions",
    "app.gateway.routers.channels",
    "app.gateway.routers.assistants_compat",
    "app.gateway.routers.thread_runs",
    "app.gateway.routers.runs",
    "app.gateway.routers.auth",
)
CORE_ROUTER_MODULES = (
    "app.gateway.routers.novel",
    "app.gateway.routers.novel_migrated",
    "app.gateway.api.ai_provider",
)
langgraph_runtime = None


def _has_deerflow_package() -> bool:
    return importlib.util.find_spec("deerflow") is not None


def _is_deerflow_import_error(exc: ModuleNotFoundError) -> bool:
    module_name = (exc.name or "").split(".", maxsplit=1)[0]
    return module_name == "deerflow"


def _import_router_module(module_path: str) -> ModuleType:
    return importlib.import_module(module_path)


def _include_router_module(app: FastAPI, module_path: str, *, skip_if_deerflow_missing: bool) -> bool:
    try:
        module = _import_router_module(module_path)
    except ModuleNotFoundError as exc:
        if skip_if_deerflow_missing and _is_deerflow_import_error(exc):
            logger.warning("Skip router %s: deerflow package is unavailable", module_path)
            return False
        raise
    app.include_router(module.router)
    return True


def get_app_config():
    """Compatibility wrapper so tests and callers can patch app-level config loading."""
    from deerflow.config.app_config import get_app_config as _get_app_config

    return _get_app_config()


def get_langgraph_runtime():
    """Resolve LangGraph runtime lazily, while keeping a patchable module attribute."""
    global langgraph_runtime
    if langgraph_runtime is None:
        from app.gateway.deps import langgraph_runtime as _langgraph_runtime

        langgraph_runtime = _langgraph_runtime
    return langgraph_runtime

# Upper bound (seconds) each lifespan shutdown hook is allowed to run.
# Bounds worker exit time so uvicorn's reload supervisor does not keep
# firing signals into a worker that is stuck waiting for shutdown cleanup.
_SHUTDOWN_HOOK_TIMEOUT_SECONDS = 5.0


async def _ensure_admin_user(app: FastAPI) -> None:
    """Startup hook: handle first boot and migrate orphan threads otherwise.

    After admin creation, migrate orphan threads from the LangGraph
    store (metadata.user_id unset) to the admin account. This is the
    "no-auth → with-auth" upgrade path: users who ran DeerFlow without
    authentication have existing LangGraph thread data that needs an
    owner assigned.
        First boot (no admin exists):
            - Does NOT create any user accounts automatically.
            - The operator must visit ``/setup`` to create the first admin.

    Subsequent boots (admin already exists):
      - Runs the one-time "no-auth → with-auth" orphan thread migration for
        existing LangGraph thread metadata that has no owner_id.

    No SQL persistence migration is needed: the four user_id columns
    (threads_meta, runs, run_events, feedback) only come into existence
    alongside the auth module via create_all, so freshly created tables
    never contain NULL-owner rows.
    """
    from sqlalchemy import select

    from app.gateway.deps import get_local_provider
    from deerflow.persistence.engine import get_session_factory
    from deerflow.persistence.user.model import UserRow

    try:
        provider = get_local_provider()
    except RuntimeError:
        # Auth persistence may not be initialized in some test/boot paths.
        # Skip admin migration work rather than failing gateway startup.
        logger.warning("Auth persistence not ready; skipping admin bootstrap check")
        return

    sf = get_session_factory()
    if sf is None:
        return

    admin_count = await provider.count_admin_users()

    if admin_count == 0:
        logger.info("=" * 60)
        logger.info("  First boot detected — no admin account exists.")
        logger.info("  Visit /setup to complete admin account creation.")
        logger.info("=" * 60)
        return

    # Admin already exists — run orphan thread migration for any
    # LangGraph thread metadata that pre-dates the auth module.
    async with sf() as session:
        stmt = select(UserRow).where(UserRow.system_role == "admin").limit(1)
        row = (await session.execute(stmt)).scalar_one_or_none()

    if row is None:
        return  # Should not happen (admin_count > 0 above), but be safe.

    admin_id = str(row.id)

    # LangGraph store orphan migration — non-fatal.
    # This covers the "no-auth → with-auth" upgrade path for users
    # whose existing LangGraph thread metadata has no user_id set.
    store = getattr(app.state, "store", None)
    if store is not None:
        try:
            migrated = await _migrate_orphaned_threads(store, admin_id)
            if migrated:
                logger.info("Migrated %d orphan LangGraph thread(s) to admin", migrated)
        except Exception:
            logger.exception("LangGraph thread migration failed (non-fatal)")


async def _iter_store_items(store, namespace, *, page_size: int = 500):
    """Paginated async iterator over a LangGraph store namespace.

    Replaces the old hardcoded ``limit=1000`` call with a cursor-style
    loop so that environments with more than one page of orphans do
    not silently lose data. Terminates when a page is empty OR when a
    short page arrives (indicating the last page).
    """
    offset = 0
    while True:
        batch = await store.asearch(namespace, limit=page_size, offset=offset)
        if not batch:
            return
        for item in batch:
            yield item
        if len(batch) < page_size:
            return
        offset += page_size


async def _migrate_orphaned_threads(store, admin_user_id: str) -> int:
    """Migrate LangGraph store threads with no user_id to the given admin.

    Uses cursor pagination so all orphans are migrated regardless of
    count. Returns the number of rows migrated.
    """
    migrated = 0
    async for item in _iter_store_items(store, ("threads",)):
        metadata = item.value.get("metadata", {})
        if not metadata.get("user_id"):
            metadata["user_id"] = admin_user_id
            item.value["metadata"] = metadata
            await store.aput(("threads",), item.key, item.value)
            migrated += 1
    return migrated


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""

    config = get_gateway_config()
    logger.info(f"Starting API Gateway on {config.host}:{config.port}")

    if not _has_deerflow_package():
        logger.warning("DeerFlow harness package is unavailable; gateway started in degraded mode")
        yield
        logger.info("Shutting down API Gateway")
        return

    # Load config and check necessary environment variables at startup
    try:
        app.state.config = get_app_config()
        from deerflow.config.app_config import apply_logging_level
        apply_logging_level(app.state.config.log_level)
        logger.info("Configuration loaded successfully")
    except ModuleNotFoundError as exc:
        if _is_deerflow_import_error(exc):
            logger.warning("DeerFlow harness package is unavailable; gateway started in degraded mode")
            yield
            logger.info("Shutting down API Gateway")
            return
        raise
    except Exception as e:
        error_msg = f"Failed to load configuration during gateway startup: {e}"
        logger.exception(error_msg)
        raise RuntimeError(error_msg) from e

    # Validate encryption key availability for novel settings
    try:
        from app.gateway.novel_migrated.core.crypto import is_encryption_enabled, validate_encryption_key

        is_valid, validation_error = validate_encryption_key()
        if validation_error:
            error_msg = (
                "SETTINGS_ENCRYPTION_KEY is configured but invalid. "
                "It must be a 32-byte url-safe base64 key generated by Fernet. "
                f"Original error: {validation_error}"
            )
            logger.error(error_msg)
            raise RuntimeError(error_msg)

        if not is_valid or not is_encryption_enabled():
            logger.warning(
                "SETTINGS_ENCRYPTION_KEY is not set; API keys will be stored in plaintext. "
                "Set it for production use: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )
        else:
            logger.info("Encryption is enabled for sensitive settings")
    except ImportError:
        logger.debug("Novel crypto module unavailable; skipping encryption check")

    runtime_context = get_langgraph_runtime()

    # Initialize LangGraph runtime components (StreamBridge, RunManager, checkpointer, store)
    async with runtime_context(app):
        logger.info("LangGraph runtime initialised")

        # Ensure admin user exists (auto-create on first boot)
        # Must run AFTER langgraph_runtime so app.state.store is available for thread migration
        await _ensure_admin_user(app)

        # Start IM channel service if any channels are configured
        try:
            from app.channels.service import start_channel_service

            channel_service = await start_channel_service(app.state.config)
            logger.info("Channel service started: %s", channel_service.get_status())
        except Exception:
            logger.exception("No IM channels configured or channel service failed to start")

        yield

        # Stop channel service on shutdown (bounded to prevent worker hang)
        try:
            from app.channels.service import stop_channel_service

            await asyncio.wait_for(
                stop_channel_service(),
                timeout=_SHUTDOWN_HOOK_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            logger.warning(
                "Channel service shutdown exceeded %.1fs; proceeding with worker exit.",
                _SHUTDOWN_HOOK_TIMEOUT_SECONDS,
            )
        except Exception:
            logger.exception("Failed to stop channel service")

    logger.info("Shutting down API Gateway")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Configured FastAPI application instance.
    """
    config = get_gateway_config()
    docs_kwargs = {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"} if config.enable_docs else {"docs_url": None, "redoc_url": None, "openapi_url": None}

    app = FastAPI(
        title="DeerFlow API Gateway",
        description="""
## DeerFlow API Gateway

API Gateway for DeerFlow - A LangGraph-based AI agent backend with sandbox execution capabilities.

### Features

- **Models Management**: Query and retrieve available AI models
- **MCP Configuration**: Manage Model Context Protocol (MCP) server configurations
- **Memory Management**: Access and manage global memory data for personalized conversations
- **Skills Management**: Query and manage skills and their enabled status
- **Artifacts**: Access thread artifacts and generated files
- **Health Monitoring**: System health check endpoints

### Architecture

LangGraph requests are handled by nginx reverse proxy.
This gateway provides custom endpoints for models, MCP configuration, skills, and artifacts.
        """,
        version="0.1.0",
        lifespan=lifespan,
        **docs_kwargs,
        openapi_tags=[
            {
                "name": "models",
                "description": "Operations for querying available AI models and their configurations",
            },
            {
                "name": "mcp",
                "description": "Manage Model Context Protocol (MCP) server configurations",
            },
            {
                "name": "memory",
                "description": "Access and manage global memory data for personalized conversations",
            },
            {
                "name": "features",
                "description": "Manage runtime feature flags for gateway capabilities",
            },
            {
                "name": "skills",
                "description": "Manage skills and their configurations",
            },
            {
                "name": "artifacts",
                "description": "Access and download thread artifacts and generated files",
            },
            {
                "name": "uploads",
                "description": "Upload and manage user files for threads",
            },
            {
                "name": "threads",
                "description": "Manage DeerFlow thread-local filesystem data",
            },
            {
                "name": "agents",
                "description": "Create and manage custom agents with per-agent config and prompts",
            },
            {
                "name": "suggestions",
                "description": "Generate follow-up question suggestions for conversations",
            },
            {
                "name": "channels",
                "description": "Manage IM channel integrations (Feishu, Slack, Telegram)",
            },
            {
                "name": "assistants-compat",
                "description": "LangGraph Platform-compatible assistants API (stub)",
            },
            {
                "name": "runs",
                "description": "LangGraph Platform-compatible runs lifecycle (create, stream, cancel)",
            },
            {
                "name": "health",
                "description": "Health check and system status endpoints",
            },
            {
                "name": "novel",
                "description": "Novel workspace endpoints for writing, recommendations and audit",
            },
        ],
    )

    # Exception shield sits inside the CORS layer so that any unhandled
    # exception is converted to a proper JSONResponse *before* the CORS
    # middleware adds Access-Control-Allow-Origin.  Without this shield,
    # exceptions from BaseHTTPMiddleware (Auth, PromptCache, etc.) bypass
    # the CORS send-hook and reach uvicorn directly, producing a bare 500
    # with no CORS headers — the browser then blocks the response.
    app.add_middleware(_ExceptionShieldMiddleware)

    # Auth stays inside the CORS layer so browser preflight requests can be
    # answered with the negotiated CORS headers before auth rejects the call.
    app.add_middleware(AuthMiddleware)

    # Allow direct frontend->gateway calls in local dev (without nginx).
    # In docker/nginx mode this remains compatible because gateway is usually
    # same-origin behind the reverse proxy.
    config = get_gateway_config()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    deerflow_available = _has_deerflow_package()
    registered_harness_router_count = 0

    if deerflow_available:
        for module_path in HARNESS_ROUTER_MODULES:
            if _include_router_module(app, module_path, skip_if_deerflow_missing=True):
                registered_harness_router_count += 1
    else:
        logger.warning(
            "DeerFlow harness package not found; only core routers (%s) will be registered",
            ", ".join(CORE_ROUTER_MODULES),
        )

    for module_path in CORE_ROUTER_MODULES:
        _include_router_module(app, module_path, skip_if_deerflow_missing=False)

    full_mode = deerflow_available and registered_harness_router_count == len(HARNESS_ROUTER_MODULES)
    app.state.gateway_mode = "full" if full_mode else "degraded"
    app.state.deerflow_available = deerflow_available
    app.state.registered_harness_routers = registered_harness_router_count
    app.state.total_harness_routers = len(HARNESS_ROUTER_MODULES)

    # Add prompt cache middleware for AI chat endpoint optimization
    try:
        from app.gateway.middleware.prompt_cache import PromptCacheMiddleware

        enable_cache = os.getenv("ENABLE_PROMPT_CACHE", "true").lower() in ("1", "true", "yes")
        if enable_cache:
            cache_ttl = int(os.getenv("PROMPT_CACHE_TTL", "300"))
            cache_max_entries = int(os.getenv("PROMPT_CACHE_MAX_ENTRIES", "1000"))

            app.add_middleware(
                PromptCacheMiddleware,
                ttl=cache_ttl,
                max_entries=cache_max_entries,
            )
            logger.info(
                "PromptCacheMiddleware enabled: ttl=%ds, max_entries=%d",
                cache_ttl,
                cache_max_entries,
            )
        else:
            logger.info("PromptCacheMiddleware disabled via ENABLE_PROMPT_CACHE")
    except ImportError:
        logger.debug("PromptCacheMiddleware not available, skipping")
    except Exception as exc:
        logger.warning("Failed to initialize PromptCacheMiddleware: %s", exc)

    # Keep request trace middleware outermost so every downstream log record
    # can carry request-scoped observability fields.
    app.add_middleware(RequestTraceMiddleware)

    @app.get("/health", tags=["health"])
    async def health_check() -> dict:
        """Health check endpoint.

        Returns:
            Service health status information.
        """
        return {
            "status": "healthy",
            "service": "deer-flow-gateway",
            "mode": app.state.gateway_mode,
            "deerflow_available": app.state.deerflow_available,
            "registered_harness_routers": app.state.registered_harness_routers,
            "total_harness_routers": app.state.total_harness_routers,
        }

    return app


# Create app instance for uvicorn
app = create_app()
