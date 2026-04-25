# DeerFlow Backend

DeerFlow is a LangGraph-based AI super agent with sandbox execution, persistent memory, and extensible tool integration. The backend enables AI agents to execute code, browse the web, manage files, delegate tasks to subagents, and retain context across conversations - all in isolated, per-thread environments.

---

## Architecture

```
                        ┌──────────────────────────────────────┐
                        │          Nginx (Port 2026)           │
                        │      Unified reverse proxy           │
                        └───────┬──────────────────┬───────────┘
                                │                  │
              /api/langgraph/*  │                  │  /api/* (other)
                                ▼                  ▼
               ┌────────────────────┐  ┌────────────────────────┐
               │ LangGraph Server   │  │   Gateway API (8001)   │
               │    (Port 2024)     │  │   FastAPI REST         │
               │                    │  │                        │
               │ ┌────────────────┐ │  │ Models, MCP, Skills,   │
               │ │  Lead Agent    │ │  │ Memory, Uploads,       │
               │ │  ┌──────────┐  │ │  │ Artifacts              │
               │ │  │Middleware│  │ │  └────────────────────────┘
               │ │  │  Chain   │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │  Tools   │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │Subagents │  │ │
               │ │  └──────────┘  │ │
               │ └────────────────┘ │
               └────────────────────┘
```

**Request Routing** (via Nginx):
- `/api/langgraph/*` → LangGraph Server - agent interactions, threads, streaming
- `/api/*` (other) → Gateway API - models, MCP, skills, memory, artifacts, uploads, thread-local cleanup
- `/` (non-API) → Frontend - Next.js web interface

> **Miaowu local-dev note**: in this fork (`D:\miaowu-os\deer-flow-main`) local development pins gateway to `http://127.0.0.1:8551` (frontend `4560`). Keep fallback/default proxy targets aligned with `8551`.

---

## Core Components

### Lead Agent

The single LangGraph agent (`lead_agent`) is the runtime entry point, created via `make_lead_agent(config)`. It combines:

- **Dynamic model selection** with thinking and vision support
- **Middleware chain** for cross-cutting concerns (9 middlewares)
- **Tool system** with sandbox, MCP, community, and built-in tools
- **Subagent delegation** for parallel task execution
- **System prompt** with skills injection, memory context, and working directory guidance

### Middleware Chain

Middlewares execute in strict order, each handling a specific concern:

| # | Middleware | Purpose |
|---|-----------|---------|
| 1 | **ThreadDataMiddleware** | Creates per-thread isolated directories (workspace, uploads, outputs) |
| 2 | **UploadsMiddleware** | Injects newly uploaded files into conversation context |
| 3 | **SandboxMiddleware** | Acquires sandbox environment for code execution |
| 4 | **SummarizationMiddleware** | Reduces context when approaching token limits (optional) |
| 5 | **TodoListMiddleware** | Tracks multi-step tasks in plan mode (optional) |
| 6 | **TitleMiddleware** | Auto-generates conversation titles after first exchange |
| 7 | **MemoryMiddleware** | Queues conversations for async memory extraction |
| 8 | **ViewImageMiddleware** | Injects image data for vision-capable models (conditional) |
| 9 | **ClarificationMiddleware** | Intercepts clarification requests and interrupts execution (must be last) |

### Sandbox System

Per-thread isolated execution with virtual path translation:

- **Abstract interface**: `execute_command`, `read_file`, `write_file`, `list_dir`
- **Providers**: `LocalSandboxProvider` (filesystem) and `AioSandboxProvider` (Docker, in community/)
- **Virtual paths**: `/mnt/user-data/{workspace,uploads,outputs}` → thread-specific physical directories
- **Skills path**: `/mnt/skills` → `deer-flow/skills/` directory
- **Skills loading**: Recursively discovers nested `SKILL.md` files under `skills/{public,custom}` and preserves nested container paths
- **File-write safety**: `str_replace` serializes read-modify-write per `(sandbox.id, path)` so isolated sandboxes keep concurrency even when virtual paths match
- **Tools**: `bash`, `ls`, `read_file`, `write_file`, `str_replace` (`bash` is disabled by default when using `LocalSandboxProvider`; use `AioSandboxProvider` for isolated shell access)

### Subagent System

Async task delegation with concurrent execution:

- **Built-in agents**: `general-purpose` (full toolset) and `bash` (command specialist, exposed only when shell access is available)
- **Concurrency**: Max 3 subagents per turn, 15-minute timeout
- **Execution**: Background thread pools with status tracking and SSE events
- **Flow**: Agent calls `task()` tool → executor runs subagent in background → polls for completion → returns result

### Memory System

LLM-powered persistent context retention across conversations:

- **Automatic extraction**: Analyzes conversations for user context, facts, and preferences
- **Structured storage**: User context (work, personal, top-of-mind), history, and confidence-scored facts
- **Debounced updates**: Batches updates to minimize LLM calls (configurable wait time)
- **System prompt injection**: Top facts + context injected into agent prompts
- **Storage**: JSON file with mtime-based cache invalidation

### Tool Ecosystem

| Category | Tools |
|----------|-------|
| **Sandbox** | `bash`, `ls`, `read_file`, `write_file`, `str_replace` |
| **Built-in** | `present_files`, `ask_clarification`, `create_novel`, `view_image`, `task` (subagent) |
| **Community** | Tavily (web search), Jina AI (web fetch), Firecrawl (scraping), DuckDuckGo (image search) |
| **MCP** | Any Model Context Protocol server (stdio, SSE, HTTP transports) |
| **Skills** | Domain-specific workflows injected via system prompt |

#### `create_novel` performance path (Miaowu fork)

`create_novel` is optimized for lower latency and clearer runtime progress in streaming chats:

- **P2 direct path first**: tries internal `novel_migrated` service calls before any HTTP loopback.
- **P1 fast return + async dual-write**: when modern project creation succeeds, legacy sync can run in background (stream mode) to avoid blocking user-visible completion.
- **P0 stage observability**: emits `custom` stream events (`type=create_novel_progress`) for key phases (session gate, validation, modern create, legacy sync, fallback).
- **HTTP remains as fallback**: used only when internal modules are unavailable or raise runtime errors.

Optional tuning env vars:

- `DEERFLOW_CREATE_NOVEL_PRIMARY_TIMEOUT_SECONDS` (default `12`)
- `DEERFLOW_CREATE_NOVEL_LEGACY_TIMEOUT_SECONDS` (default `4`)
- `DEERFLOW_CREATE_NOVEL_ENABLE_ROUTE_FALLBACK` (default `true`)
- `DEERFLOW_CREATE_NOVEL_DUAL_WRITE_ASYNC` (default `false`)
- `DEERFLOW_CREATE_NOVEL_MAX_ATTEMPTS` (default `2`)
- `DEERFLOW_CREATE_NOVEL_RETRY_BACKOFF_MS` (default `600`)

### Gateway API

FastAPI application providing REST endpoints for frontend integration:

| Route | Purpose |
|-------|---------|
| `GET /api/models` | List available LLM models |
| `GET/PUT /api/mcp/config` | Manage MCP server configurations |
| `GET/PUT /api/skills` | List and manage skills |
| `POST /api/skills/install` | Install skill from `.skill` archive |
| `GET /api/memory` | Retrieve memory data |
| `POST /api/memory/reload` | Force memory reload |
| `GET /api/memory/config` | Memory configuration |
| `GET /api/memory/status` | Combined config + data |
| `POST /api/threads/{id}/uploads` | Upload files (auto-converts PDF/PPT/Excel/Word to Markdown, rejects directory paths) |
| `GET /api/threads/{id}/uploads/list` | List uploaded files |
| `DELETE /api/threads/{id}` | Delete DeerFlow-managed local thread data after LangGraph thread deletion; unexpected failures are logged server-side and return a generic 500 detail |
| `GET /api/threads/{id}/artifacts/{path}` | Serve generated artifacts |
| `GET /api/features` | List gateway feature flags |
| `PUT /api/features/{feature_name}` | Update feature flag (enabled + rollout strategy) |
| `POST /api/features/{feature_name}/rollback` | Fast rollback (disable + rollout=0) |
| `GET /api/features/{feature_name}/evaluate?user_id=...` | Evaluate user-scoped canary decision |
| `GET /api/features/metrics/novel-pipeline` | Get in-process novel pipeline observability metrics |
| `POST /api/ai/chat` | Global AI chat endpoint (uses server-side user settings; ignores client-provided plaintext api_key) |
| `POST /api/ai/test-connection` | AI connectivity check (uses server-side user settings; ignores client-provided plaintext api_key) |
| `GET /api/ai/providers` | List provider metadata for frontend selector |

`/api/ai/*` endpoints are now protected by gateway-side access control:
- If `DEERFLOW_AI_PROVIDER_API_TOKEN` is configured, callers must provide `Authorization: Bearer <token>`.
- If token is not configured, only loopback requests are allowed by default.
- Request rate is limited by `DEERFLOW_AI_PROVIDER_RATE_LIMIT_PER_MINUTE` (default `30`).
- `POST /api/ai/chat` includes session-based intent middleware for novel workflows and currently supports two conversation tracks:
  - Novel creation session: guided field collection (title/genre/theme/audience/target_words), then persistence only after explicit confirmation.
  - Novel lifecycle management session: project/chapter/outline/character/relationship/organization/item mapping operations inside the same conversational flow.
- Intent middleware internals are now split into explicit components (`app.gateway.middleware.intent_components`): `IntentDetector`, `SessionPersistence`, `SessionManager`, `ManageActionRouter` (middleware keeps compatibility wrappers for existing call sites/tests).
- `ManageActionRouter` now owns manage-flow action building/merging/dispatch and missing-slot rules, reducing `intent_recognition_middleware.py` single-file responsibility.
- Intent session state and idempotency keys are persisted in shared `novel_migrated` database tables (`intent_session_states`, `intent_idempotency_keys`) by default for cross-worker consistency.
- Set `DEERFLOW_INTENT_SESSION_BACKEND=file` to force legacy JSON-file storage (`DEERFLOW_INTENT_SESSION_STORE_PATH`).
- For side-effect actions (create/update/delete and other writes), the middleware requires explicit confirmation before execution.
- If a manage-action dispatch fails and the request `db_session` still has an active transaction, `ManageActionRouter` now performs best-effort rollback before returning the failure response (transactional consistency guard).
- During intent sessions, skill context is loaded strictly from enabled entries in `extensions_config.json` (prioritized by novel relevance), and users can send `技能推荐` to force-refresh suggestions.
- Intent skill loading now supports a three-layer governance policy (system defaults -> workspace enabled -> session candidates), guarded by feature flag `intent_skill_governance` with degraded fallback controlled by `DEERFLOW_INTENT_SKILL_GOVERNANCE_FALLBACK_MODE` (`workspace_only|system_only|intersection`).
- Intent workflow session payloads include structured `action_protocol` fields (`action_type`, `slot_schema`, `missing_slots`, `confirmation_required`, `execute_result`) and keep legacy aliases for backward compatibility.
- Guided/side-effect intent responses set `X-Prompt-Cache: bypass` and `Cache-Control: no-store` so PromptCacheMiddleware never caches these intent-session workflow responses.
- Request trace context is normalized across gateway logs via `request_id/thread_id/project_id/session_key/idempotency_key`.
- Lifecycle traces additionally include `lifecycle_state/lifecycle_transition/lifecycle_mode/lifecycle_replay/lifecycle_token` to support replay and rollback diagnostics.
- Gateway logging now uses unified logger setup and supports optional rotating-file output via:
  - `DEERFLOW_GATEWAY_LOG_TO_FILE=1`
  - `DEERFLOW_GATEWAY_LOG_FILE_PATH=<path>`
  - `DEERFLOW_GATEWAY_LOG_MAX_BYTES` (default `10485760`)
  - `DEERFLOW_GATEWAY_LOG_BACKUP_COUNT` (default `30`)
  - `DEERFLOW_GATEWAY_LOG_LEVEL` (default `INFO`)
- Built-in in-process metrics are available at `/api/features/metrics/novel-pipeline`: success rate, failure rate, retry rate, P95 latency, duplicate-write interception rate.
- Canary rollout is user-scoped and deterministic (`rollout_percentage` + allow/deny user lists), and rollback can be done by `POST /api/features/{feature_name}/rollback`.

Novel finalize-gate enhancements:
- `POST /polish/projects/{project_id}/finalize-gate` and `/api/polish/...` accept optional fusion params (`model_gate_signals`, `quality_gate_fusion_feature_enabled`, `fusion_degraded_fallback_mode`, `apply_feedback_backflow`).
- Gate reports now include per-check fusion metadata (`rule_result`, `fusion.*`) and top-level `gate_fusion` summary while preserving existing keys.
- False-positive backflow endpoints:
  - `POST /polish/quality-gate/false-positive-feedback` (and `/api/polish/...`) to record feedback
  - `GET /polish/quality-gate/false-positive-feedback` (and `/api/polish/...`) to query aggregated backflow view
- WS-D acceptance suites are codified under:
  - `tests/novel_phase3/ws_d/` (targeted gate)
  - `tests/contracts/novel_phase3/ws_d/`
  - `tests/e2e/novel_phase3/ws_d/`
  - `tests/load/novel_phase3/ws_d/`

### IM Channels

The IM bridge supports Feishu, Slack, and Telegram. Slack and Telegram still use the final `runs.wait()` response path, while Feishu now streams through `runs.stream(["messages-tuple", "values"])` and updates a single in-thread card in place.

For Feishu card updates, DeerFlow stores the running card's `message_id` per inbound message and patches that same card until the run finishes, preserving the existing `OK` / `DONE` reaction flow.

---

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) package manager
- API keys for your chosen LLM provider

### Installation

```bash
cd deer-flow

# Copy configuration files
cp config.example.yaml config.yaml

# Install backend dependencies
cd backend
make install
```

### Configuration

Edit `config.yaml` in the project root:

```yaml
models:
  - name: gpt-4o
    display_name: GPT-4o
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY
    supports_thinking: false
    supports_vision: true

  - name: gpt-5-responses
    display_name: GPT-5 (Responses API)
    use: langchain_openai:ChatOpenAI
    model: gpt-5
    api_key: $OPENAI_API_KEY
    use_responses_api: true
    output_version: responses/v1
    supports_vision: true
```

Set your API keys:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

### Running

**Full Application** (from project root):

```bash
make dev  # Starts LangGraph + Gateway + Frontend + Nginx
```

Access at: http://localhost:2026

**Backend Only** (from backend directory):

```bash
# Terminal 1: LangGraph server
make dev

# Terminal 2: Gateway API
make gateway
```

Direct access: LangGraph at http://localhost:2024, Gateway at http://localhost:8001

### Novel Migrated Wave1 + Wave2 APIs

`app.gateway.routers.novel_migrated` is the gateway registration point for the migrated novel Wave 1/2 APIs. It conditionally aggregates:

- `app.gateway.novel_migrated.api.careers`
- `app.gateway.novel_migrated.api.foreshadows`
- `app.gateway.novel_migrated.api.memories`
- `app.gateway.novel_migrated.api.inspiration`
- `app.gateway.novel_migrated.api.wizard_stream`
- `app.gateway.novel_migrated.api.novel_stream`
- `app.gateway.novel_migrated.api.project_covers`
- `app.gateway.novel_migrated.api.book_import`

Scope:

- In scope (Wave 1): career system, foreshadow state machine, memory analysis, vector retrieval, and MCP tool-chain entry points.
- In scope (Wave 2): no-auth closure for Wave 1 routes, inspiration API, project cover generation/download, and book import pipeline.
- Wizard stream endpoints: `/api/wizard-stream/world-building|career-system|characters|outline`, plus `GET /api/projects/{id}` for resume state.
- Novel stream endpoints (P0): `POST /api/novels/{novel_id}/chapters/{chapter_id}/generate-stream`, `POST /api/novels/{novel_id}/chapters/{chapter_id}/continue-stream`, `POST /api/novels/{novel_id}/chapters/batch-generate-stream`, `POST /api/novels/{novel_id}/outlines/generate-stream`, `POST /api/novels/{novel_id}/characters/generate-stream`.
- Compatibility aliases: `POST /api/chapters/{chapter_id}/generate-stream|continue-stream|analyze`, `GET /api/chapters/{chapter_id}/analysis|analysis/status`, `POST /api/chapters/{chapter_id}/revision/confirm`.
- Batch resume/replay endpoints: `GET /api/novels/{novel_id}/chapters/batch-generate-tasks/{task_id}`, `POST /api/novels/{novel_id}/chapters/batch-generate-tasks/{task_id}/replay-failed-stream`, `GET /chapters/project/{project_id}/batch-generate/active`.
- Memory retrieval priority: local vector (when available) -> cloud embedding (OpenAI-compatible `/v1/embeddings`) -> keyword fallback.
- Single-user fallback: `novel_migrated` routes resolve `request.state.user_id` first, then fallback to `local_single_user` (override via `NOVEL_MIGRATED_DEFAULT_USER_ID`).
- `novel_stream` endpoints now include in-process request throttling (default `30` req/min per user+action, configurable via `NOVEL_STREAM_RATE_LIMIT_PER_MINUTE`).
- Chapter analysis in-memory cache (`_ANALYSIS_TASKS` / `_ANALYSIS_RESULTS`) now performs TTL + size cleanup (`NOVEL_ANALYSIS_CACHE_TTL_SECONDS`, `NOVEL_ANALYSIS_CACHE_MAX_ENTRIES`).
- Batch/analyze/regeneration long tasks now expose timeout auto-recovery + compensation metadata (`failed_chapters[].compensation`) for replayable recovery flows.
- Out of scope: `auth/users/admin`, user-model chain, and non-novel gateway endpoints.

---

## Project Structure

```
backend/
├── src/
│   ├── agents/                  # Agent system
│   │   ├── lead_agent/         # Main agent (factory, prompts)
│   │   ├── middlewares/        # 9 middleware components
│   │   ├── memory/             # Memory extraction & storage
│   │   └── thread_state.py    # ThreadState schema
│   ├── gateway/                # FastAPI Gateway API
│   │   ├── app.py             # Application setup
│   │   └── routers/           # FastAPI route modules
│   ├── sandbox/                # Sandbox execution
│   │   ├── local/             # Local filesystem provider
│   │   ├── sandbox.py         # Abstract interface
│   │   ├── tools.py           # bash, ls, read/write/str_replace
│   │   └── middleware.py      # Sandbox lifecycle
│   ├── subagents/              # Subagent delegation
│   │   ├── builtins/          # general-purpose, bash agents
│   │   ├── executor.py        # Background execution engine
│   │   └── registry.py        # Agent registry
│   ├── tools/builtins/         # Built-in tools
│   ├── mcp/                    # MCP protocol integration
│   ├── models/                 # Model factory
│   ├── skills/                 # Skill discovery & loading
│   ├── config/                 # Configuration system
│   ├── community/              # Community tools & providers
│   ├── reflection/             # Dynamic module loading
│   └── utils/                  # Utilities
├── docs/                       # Documentation
├── tests/                      # Test suite
├── langgraph.json              # LangGraph server configuration
├── pyproject.toml              # Python dependencies
├── Makefile                    # Development commands
└── Dockerfile                  # Container build
```

---

## Configuration

### Main Configuration (`config.yaml`)

Place in project root. Config values starting with `$` resolve as environment variables.

Key sections:
- `models` - LLM configurations with class paths, API keys, thinking/vision flags
- `tools` - Tool definitions with module paths and groups
- `tool_groups` - Logical tool groupings
- `sandbox` - Execution environment provider
- `skills` - Skills directory paths
- `title` - Auto-title generation settings
- `summarization` - Context summarization settings
- `subagents` - Subagent system (enabled/disabled)
- `memory` - Memory system settings (enabled, storage, debounce, facts limits)

Provider note:
- `models[*].use` references provider classes by module path (for example `langchain_openai:ChatOpenAI`).
- If a provider module is missing, DeerFlow now returns an actionable error with install guidance (for example `uv add langchain-google-genai`).

### Extensions Configuration (`extensions_config.json`)

MCP servers and skill states in a single file:

```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}
    },
    "secure-http": {
      "enabled": true,
      "type": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.example.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$MCP_OAUTH_CLIENT_ID",
        "client_secret": "$MCP_OAUTH_CLIENT_SECRET"
      }
    }
  },
  "skills": {
    "pdf-processing": {"enabled": true}
  }
}
```

### Environment Variables

- `DEER_FLOW_CONFIG_PATH` - Override config.yaml location
- `DEER_FLOW_EXTENSIONS_CONFIG_PATH` - Override extensions_config.json location
- Model API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, etc.
- Tool API keys: `TAVILY_API_KEY`, `GITHUB_TOKEN`, etc.

### LangSmith Tracing

DeerFlow has built-in [LangSmith](https://smith.langchain.com) integration for observability. When enabled, all LLM calls, agent runs, tool executions, and middleware processing are traced and visible in the LangSmith dashboard.

**Setup:**

1. Sign up at [smith.langchain.com](https://smith.langchain.com) and create a project.
2. Add the following to your `.env` file in the project root:

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=xxx
```

**Legacy variables:** The `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT`, and `LANGCHAIN_ENDPOINT` variables are also supported for backward compatibility. `LANGSMITH_*` variables take precedence when both are set.

### Langfuse Tracing

DeerFlow also supports [Langfuse](https://langfuse.com) observability for LangChain-compatible runs.

Add the following to your `.env` file:

```bash
LANGFUSE_TRACING=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

If you are using a self-hosted Langfuse deployment, set `LANGFUSE_BASE_URL` to your Langfuse host.

### Dual Provider Behavior

If both LangSmith and Langfuse are enabled, DeerFlow initializes and attaches both callbacks so the same run data is reported to both systems.

If a provider is explicitly enabled but required credentials are missing, or the provider callback cannot be initialized, DeerFlow raises an error when tracing is initialized during model creation instead of silently disabling tracing.

**Docker:** In `docker-compose.yaml`, tracing is disabled by default (`LANGSMITH_TRACING=false`). Set `LANGSMITH_TRACING=true` and/or `LANGFUSE_TRACING=true` in your `.env`, together with the required credentials, to enable tracing in containerized deployments.

---

## Development

### Commands

```bash
make install    # Install dependencies
make dev        # Run LangGraph server (port 2024)
make gateway    # Run Gateway API (port 8001)
make lint       # Run linter (ruff)
make format     # Format code (ruff)
```

### Code Style

- **Linter/Formatter**: `ruff`
- **Line length**: 240 characters
- **Python**: 3.12+ with type hints
- **Quotes**: Double quotes
- **Indentation**: 4 spaces

### Testing

```bash
uv run pytest
```

---

## Technology Stack

- **LangGraph** (1.0.6+) - Agent framework and multi-agent orchestration
- **LangChain** (1.2.3+) - LLM abstractions and tool system
- **FastAPI** (0.115.0+) - Gateway REST API
- **langchain-mcp-adapters** - Model Context Protocol support
- **agent-sandbox** - Sandboxed code execution
- **markitdown** - Multi-format document conversion
- **tavily-python** / **firecrawl-py** - Web search and scraping

---

## Documentation

- [Configuration Guide](docs/CONFIGURATION.md)
- [Architecture Details](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [File Upload](docs/FILE_UPLOAD.md)
- [Path Examples](docs/PATH_EXAMPLES.md)
- [Context Summarization](docs/summarization.md)
- [Plan Mode](docs/plan_mode_usage.md)
- [Setup Guide](docs/SETUP.md)

---

## License

See the [LICENSE](../LICENSE) file in the project root.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.


## Desktop Gateway Runtime (Windows)

Use the desktop build script to package the FastAPI gateway runtime with PyInstaller and run a health-check smoke test:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-desktop-backend.ps1
```

Defaults:

- health URL: `http://127.0.0.1:8001/health`
- smoke timeout: `30` seconds
- build output: `..\.desktop-runtime\backend`

The executable is built from `desktop/pyinstaller.spec`.
