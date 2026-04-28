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

from app.gateway.config import get_gateway_config
from app.gateway.middleware.request_trace import RequestTraceMiddleware
from app.gateway.novel_migrated.core.logger import setup_logging
from app.gateway.observability.context import install_trace_log_filter

_FILE_LOG_ENABLED_VALUES = {"1", "true", "yes", "on"}


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
        get_app_config()
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

        # Start IM channel service if any channels are configured
        try:
            from app.channels.service import start_channel_service

            channel_service = await start_channel_service()
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
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
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
