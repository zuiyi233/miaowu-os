import logging

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.runnables import RunnableConfig

from deerflow.agents.lead_agent.prompt import apply_prompt_template
from deerflow.agents.memory.summarization_hook import memory_flush_hook
from deerflow.agents.middlewares.clarification_middleware import ClarificationMiddleware
from deerflow.agents.middlewares.loop_detection_middleware import LoopDetectionMiddleware
from deerflow.agents.middlewares.memory_middleware import MemoryMiddleware
from deerflow.agents.middlewares.subagent_limit_middleware import SubagentLimitMiddleware
from deerflow.agents.middlewares.summarization_middleware import BeforeSummarizationHook, DeerFlowSummarizationMiddleware
from deerflow.agents.middlewares.title_middleware import TitleMiddleware
from deerflow.agents.middlewares.todo_middleware import TodoMiddleware
from deerflow.agents.middlewares.token_usage_middleware import TokenUsageMiddleware
from deerflow.agents.middlewares.tool_error_handling_middleware import build_lead_runtime_middlewares
from deerflow.agents.middlewares.view_image_middleware import ViewImageMiddleware
from deerflow.agents.thread_state import ThreadState
from deerflow.config.agents_config import load_agent_config, validate_agent_name
from deerflow.config.app_config import AppConfig, get_app_config
from deerflow.models import create_chat_model
from deerflow.skills.tool_policy import filter_tools_by_skill_allowed_tools
from deerflow.skills.types import Skill

logger = logging.getLogger(__name__)


def _build_runtime_overrides(
    *,
    app_config: AppConfig | object | None,
    model_name: str | None,
    runtime_model: str | None,
    runtime_base_url: str | None,
    runtime_api_key: str | None,
    caller_label: str,
    fallback_base_url: str | None = None,
) -> dict[str, object]:
    """Build runtime override kwargs for create_chat_model() with OpenAI-compatible guard.

    Only injects runtime_model/base_url/api_key when the resolved model config
    is OpenAI-compatible.  Skips overrides for non-OpenAI models and logs safely
    (no plaintext api_key).

    When app_config is None or model_config cannot be resolved, assumes
    OpenAI-compatible as a safe fallback (runtime overrides are only provided
    when the gateway has already validated the provider).

    When *fallback_base_url* is provided and runtime_base_url is absent but
    runtime_model is present, the fallback is used as base_url.  This supports
    the lead-agent pattern where the config-sourced base_url should be carried
    forward when the runtime only overrides the model name.
    """
    model_config = None
    if app_config is not None and model_name is not None:
        if hasattr(app_config, "get_model_config"):
            model_config = app_config.get_model_config(model_name)
        else:
            for m in getattr(app_config, "models", []):
                if getattr(m, "name", None) == model_name:
                    model_config = m
                    break

    model_use = getattr(model_config, "use", None) if model_config else None
    is_openai_compatible = isinstance(model_use, str) and "openai" in model_use.lower()

    if model_config is not None and not is_openai_compatible:
        if any((runtime_model, runtime_base_url, runtime_api_key)):
            logger.info(
                "[%s] Skip runtime overrides for non-openai model class '%s'.",
                caller_label,
                model_use,
            )
        return {}

    overrides: dict[str, object] = {}
    if runtime_model:
        overrides["model"] = runtime_model
    if runtime_base_url:
        overrides["base_url"] = runtime_base_url
    elif runtime_model and fallback_base_url:
        overrides["base_url"] = fallback_base_url
    if runtime_api_key:
        overrides["api_key"] = runtime_api_key
    return overrides


def _get_runtime_config(config: RunnableConfig) -> dict:
    """Merge legacy configurable options with LangGraph runtime context."""
    cfg = dict(config.get("configurable", {}) or {})
    context = config.get("context", {}) or {}
    if isinstance(context, dict):
        cfg.update(context)
    return cfg


def _as_non_empty_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _read_feature_api_key(cfg: dict, feature: str) -> str | None:
    try:
        from app.gateway.services import get_runtime_feature_api_key
        return get_runtime_feature_api_key(feature)
    except ImportError:
        return _as_non_empty_str(cfg.get(f"{feature}_runtime_api_key"))


def _resolve_model_name(requested_model_name: str | None = None, *, app_config: AppConfig | None = None) -> str:
    """Resolve a runtime model name safely, falling back to default if invalid. Returns None if no models are configured."""
    app_config = app_config or get_app_config()
    default_model_name = app_config.models[0].name if app_config.models else None
    if default_model_name is None:
        raise ValueError("No chat models are configured. Please configure at least one model in config.yaml.")

    if requested_model_name and app_config.get_model_config(requested_model_name):
        return requested_model_name

    if requested_model_name and requested_model_name != default_model_name:
        logger.warning(f"Model '{requested_model_name}' not found in config; fallback to default model '{default_model_name}'.")
    return default_model_name


def _create_summarization_middleware(
    *,
    app_config: AppConfig | None = None,
    model_name: str | None = None,
    runtime_model: str | None = None,
    runtime_base_url: str | None = None,
    runtime_api_key: str | None = None,
) -> DeerFlowSummarizationMiddleware | None:
    """Create and configure the summarization middleware from config."""
    resolved_app_config = app_config or get_app_config()
    config = resolved_app_config.summarization

    if not config.enabled:
        return None

    # Prepare trigger parameter
    trigger = None
    if config.trigger is not None:
        if isinstance(config.trigger, list):
            trigger = [t.to_tuple() for t in config.trigger]
        else:
            trigger = config.trigger.to_tuple()

    # Prepare keep parameter
    keep = config.keep.to_tuple()

    # Prepare model parameter.
    # Bind "middleware:summarize" tag so RunJournal identifies these LLM calls
    # as middleware rather than lead_agent (SummarizationMiddleware is a
    # LangChain built-in, so we tag the model at creation time).
    chat_model_kwargs = _build_runtime_overrides(
        app_config=resolved_app_config,
        model_name=config.model_name,
        runtime_model=runtime_model,
        runtime_base_url=runtime_base_url,
        runtime_api_key=runtime_api_key,
        caller_label="summarization",
    )

    selected_model_name = model_name or config.model_name
    if selected_model_name:
        model = create_chat_model(
            name=selected_model_name,
            thinking_enabled=False,
            app_config=resolved_app_config,
            **chat_model_kwargs,
        )
    else:
        model = create_chat_model(
            thinking_enabled=False,
            app_config=resolved_app_config,
            **chat_model_kwargs,
        )
    if hasattr(model, "with_config"):
        model = model.with_config(tags=["middleware:summarize"])

    # Prepare kwargs
    kwargs = {
        "model": model,
        "trigger": trigger,
        "keep": keep,
    }

    if config.trim_tokens_to_summarize is not None:
        kwargs["trim_tokens_to_summarize"] = config.trim_tokens_to_summarize

    if config.summary_prompt is not None:
        kwargs["summary_prompt"] = config.summary_prompt

    hooks: list[BeforeSummarizationHook] = []
    if resolved_app_config.memory.enabled:
        hooks.append(memory_flush_hook)

    # The logic below relies on two assumptions holding true: this factory is
    # the sole entry point for DeerFlowSummarizationMiddleware, and the runtime
    # config is not expected to change after startup.
    skills_container_path = resolved_app_config.skills.container_path or "/mnt/skills"

    return DeerFlowSummarizationMiddleware(
        **kwargs,
        skills_container_path=skills_container_path,
        skill_file_read_tool_names=config.skill_file_read_tool_names,
        before_summarization=hooks,
        preserve_recent_skill_count=config.preserve_recent_skill_count,
        preserve_recent_skill_tokens=config.preserve_recent_skill_tokens,
        preserve_recent_skill_tokens_per_skill=config.preserve_recent_skill_tokens_per_skill,
    )


def _create_todo_list_middleware(is_plan_mode: bool) -> TodoMiddleware | None:
    """Create and configure the TodoList middleware.

    Args:
        is_plan_mode: Whether to enable plan mode with TodoList middleware.

    Returns:
        TodoMiddleware instance if plan mode is enabled, None otherwise.
    """
    if not is_plan_mode:
        return None

    # Custom prompts matching DeerFlow's style
    system_prompt = """
<todo_list_system>
You have access to the `write_todos` tool to help you manage and track complex multi-step objectives.

**CRITICAL RULES:**
- Mark todos as completed IMMEDIATELY after finishing each step - do NOT batch completions
- Keep EXACTLY ONE task as `in_progress` at any time (unless tasks can run in parallel)
- Update the todo list in REAL-TIME as you work - this gives users visibility into your progress
- DO NOT use this tool for simple tasks (< 3 steps) - just complete them directly

**When to Use:**
This tool is designed for complex objectives that require systematic tracking:
- Complex multi-step tasks requiring 3+ distinct steps
- Non-trivial tasks needing careful planning and execution
- User explicitly requests a todo list
- User provides multiple tasks (numbered or comma-separated list)
- The plan may need revisions based on intermediate results

**When NOT to Use:**
- Single, straightforward tasks
- Trivial tasks (< 3 steps)
- Purely conversational or informational requests
- Simple tool calls where the approach is obvious

**Best Practices:**
- Break down complex tasks into smaller, actionable steps
- Use clear, descriptive task names
- Remove tasks that become irrelevant
- Add new tasks discovered during implementation
- Don't be afraid to revise the todo list as you learn more

**Task Management:**
Writing todos takes time and tokens - use it when helpful for managing complex problems, not for simple requests.
</todo_list_system>
"""

    tool_description = """Use this tool to create and manage a structured task list for complex work sessions.

**IMPORTANT: Only use this tool for complex tasks (3+ steps). For simple requests, just do the work directly.**

## When to Use

Use this tool in these scenarios:
1. **Complex multi-step tasks**: When a task requires 3 or more distinct steps or actions
2. **Non-trivial tasks**: Tasks requiring careful planning or multiple operations
3. **User explicitly requests todo list**: When the user directly asks you to track tasks
4. **Multiple tasks**: When users provide a list of things to be done
5. **Dynamic planning**: When the plan may need updates based on intermediate results

## When NOT to Use

Skip this tool when:
1. The task is straightforward and takes less than 3 steps
2. The task is trivial and tracking provides no benefit
3. The task is purely conversational or informational
4. It's clear what needs to be done and you can just do it

## How to Use

1. **Starting a task**: Mark it as `in_progress` BEFORE beginning work
2. **Completing a task**: Mark it as `completed` IMMEDIATELY after finishing
3. **Updating the list**: Add new tasks, remove irrelevant ones, or update descriptions as needed
4. **Multiple updates**: You can make several updates at once (e.g., complete one task and start the next)

## Task States

- `pending`: Task not yet started
- `in_progress`: Currently working on (can have multiple if tasks run in parallel)
- `completed`: Task finished successfully

## Task Completion Requirements

**CRITICAL: Only mark a task as completed when you have FULLY accomplished it.**

Never mark a task as completed if:
- There are unresolved issues or errors
- Work is partial or incomplete
- You encountered blockers preventing completion
- You couldn't find necessary resources or dependencies
- Quality standards haven't been met

If blocked, keep the task as `in_progress` and create a new task describing what needs to be resolved.

## Best Practices

- Create specific, actionable items
- Break complex tasks into smaller, manageable steps
- Use clear, descriptive task names
- Update task status in real-time as you work
- Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
- Remove tasks that are no longer relevant
- **IMPORTANT**: When you write the todo list, mark your first task(s) as `in_progress` immediately
- **IMPORTANT**: Unless all tasks are completed, always have at least one task `in_progress` to show progress

Being proactive with task management demonstrates thoroughness and ensures all requirements are completed successfully.

**Remember**: If you only need a few tool calls to complete a task and it's clear what to do, it's better to just do the task directly and NOT use this tool at all.
"""

    return TodoMiddleware(system_prompt=system_prompt, tool_description=tool_description)


# ThreadDataMiddleware must be before SandboxMiddleware to ensure thread_id is available
# UploadsMiddleware should be after ThreadDataMiddleware to access thread_id
# DanglingToolCallMiddleware patches missing ToolMessages before model sees the history
# SummarizationMiddleware should be early to reduce context before other processing
# TodoListMiddleware should be before ClarificationMiddleware to allow todo management
# TitleMiddleware generates title after first exchange
# MemoryMiddleware queues conversation for memory update (after TitleMiddleware)
# ViewImageMiddleware should be before ClarificationMiddleware to inject image details before LLM
# ToolErrorHandlingMiddleware should be before ClarificationMiddleware to convert tool exceptions to ToolMessages
# ClarificationMiddleware should be last to intercept clarification requests after model calls
def _build_middlewares(
    config: RunnableConfig,
    model_name: str | None,
    agent_name: str | None = None,
    custom_middlewares: list[AgentMiddleware] | None = None,
    *,
    app_config: AppConfig | None = None,
):
    """Build middleware chain based on runtime configuration.

    Args:
        config: Runtime configuration containing configurable options like is_plan_mode.
        agent_name: If provided, MemoryMiddleware will use per-agent memory storage.
        custom_middlewares: Optional list of custom middlewares to inject into the chain.

    Returns:
        List of middleware instances.
    """
    resolved_app_config = app_config or get_app_config()
    middlewares = build_lead_runtime_middlewares(app_config=resolved_app_config, lazy_init=True)

    from deerflow.agents.middlewares.dynamic_context_middleware import DynamicContextMiddleware

    middlewares.append(DynamicContextMiddleware(agent_name=agent_name, app_config=resolved_app_config))

    cfg = _get_runtime_config(config)

    title_runtime_model = _as_non_empty_str(cfg.get("title_runtime_model"))
    title_runtime_base_url = _as_non_empty_str(cfg.get("title_runtime_base_url"))
    title_runtime_api_key = _read_feature_api_key(cfg, "title")

    memory_runtime_model = _as_non_empty_str(cfg.get("memory_runtime_model"))
    memory_runtime_base_url = _as_non_empty_str(cfg.get("memory_runtime_base_url"))
    memory_runtime_api_key = _read_feature_api_key(cfg, "memory")

    summarization_runtime_model = _as_non_empty_str(cfg.get("summarization_runtime_model"))
    summarization_runtime_base_url = _as_non_empty_str(cfg.get("summarization_runtime_base_url"))
    summarization_runtime_api_key = _read_feature_api_key(cfg, "summarization")

    summarization_middleware = _create_summarization_middleware(
        app_config=resolved_app_config,
        runtime_model=summarization_runtime_model,
        runtime_base_url=summarization_runtime_base_url,
        runtime_api_key=summarization_runtime_api_key,
    )
    if summarization_middleware is not None:
        middlewares.append(summarization_middleware)

    is_plan_mode = cfg.get("is_plan_mode", False)
    todo_list_middleware = _create_todo_list_middleware(is_plan_mode)
    if todo_list_middleware is not None:
        middlewares.append(todo_list_middleware)

    if resolved_app_config.token_usage.enabled:
        middlewares.append(TokenUsageMiddleware())

    middlewares.append(TitleMiddleware(
        app_config=resolved_app_config,
        runtime_model=title_runtime_model,
        runtime_base_url=title_runtime_base_url,
        runtime_api_key=title_runtime_api_key,
    ))

    middlewares.append(MemoryMiddleware(
        agent_name=agent_name,
        memory_config=resolved_app_config.memory,
        runtime_model=memory_runtime_model,
        runtime_base_url=memory_runtime_base_url,
        runtime_api_key=memory_runtime_api_key,
    ))

    model_config = resolved_app_config.get_model_config(model_name) if model_name else None
    if model_config is not None and model_config.supports_vision:
        middlewares.append(ViewImageMiddleware())

    if resolved_app_config.tool_search.enabled:
        from deerflow.agents.middlewares.deferred_tool_filter_middleware import DeferredToolFilterMiddleware

        middlewares.append(DeferredToolFilterMiddleware())

    subagent_enabled = cfg.get("subagent_enabled", False)
    if subagent_enabled:
        max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
        middlewares.append(SubagentLimitMiddleware(max_concurrent=max_concurrent_subagents))

    loop_detection_config = resolved_app_config.loop_detection
    if loop_detection_config.enabled:
        middlewares.append(LoopDetectionMiddleware.from_config(loop_detection_config))

    if custom_middlewares:
        middlewares.extend(custom_middlewares)

    middlewares.append(ClarificationMiddleware())
    return middlewares


def _available_skill_names(agent_config, is_bootstrap: bool) -> set[str] | None:
    if is_bootstrap:
        return {"bootstrap"}
    if agent_config and agent_config.skills is not None:
        return set(agent_config.skills)
    return None


def _load_enabled_skills_for_tool_policy(available_skills: set[str] | None, *, app_config: AppConfig) -> list[Skill]:
    try:
        from deerflow.agents.lead_agent.prompt import get_enabled_skills_for_config

        skills = get_enabled_skills_for_config(app_config)
    except Exception:
        logger.exception("Failed to load skills for allowed-tools policy")
        raise

    if available_skills is None:
        return skills
    return [skill for skill in skills if skill.name in available_skills]


def make_lead_agent(config: RunnableConfig):
    """LangGraph graph factory; keep the signature compatible with LangGraph Server."""
    runtime_config = _get_runtime_config(config)
    runtime_app_config = runtime_config.get("app_config")
    return _make_lead_agent(config, app_config=runtime_app_config or get_app_config())


def _make_lead_agent(config: RunnableConfig, *, app_config: AppConfig):
    # Lazy import to avoid circular dependency
    from deerflow.tools import get_available_tools
    from deerflow.tools.builtins import setup_agent, update_agent

    cfg = _get_runtime_config(config)
    resolved_app_config = app_config

    thinking_enabled = cfg.get("thinking_enabled", True)
    reasoning_effort = cfg.get("reasoning_effort", None)
    requested_model_name: str | None = cfg.get("model_name") or cfg.get("model")
    runtime_model_name = _as_non_empty_str(cfg.get("runtime_model"))
    runtime_provider = _as_non_empty_str(cfg.get("runtime_provider"))
    runtime_base_url = _as_non_empty_str(cfg.get("runtime_base_url"))
    runtime_api_key: str | None = None
    try:
        from app.gateway.services import get_runtime_api_key
        runtime_api_key = get_runtime_api_key()
    except ImportError:
        runtime_api_key = _as_non_empty_str(cfg.get("runtime_api_key"))
    is_plan_mode = cfg.get("is_plan_mode", False)
    subagent_enabled = cfg.get("subagent_enabled", False)
    max_concurrent_subagents = cfg.get("max_concurrent_subagents", 3)
    is_bootstrap = cfg.get("is_bootstrap", False)
    include_novel = cfg.get("include_novel", True)
    agent_name = validate_agent_name(cfg.get("agent_name"))
    runtime_available_skills = cfg.get("available_skills")
    runtime_enabled_mcp_servers = cfg.get("enabled_mcp_servers")

    agent_config = load_agent_config(agent_name) if not is_bootstrap else None
    available_skills = _available_skill_names(agent_config, is_bootstrap)
    if available_skills is None and isinstance(runtime_available_skills, list):
        available_skills = {
            str(skill_name).strip()
            for skill_name in runtime_available_skills
            if isinstance(skill_name, str) and skill_name.strip()
        }
    # Custom agent model from agent config (if any), or None to let _resolve_model_name pick the default
    agent_model_name = agent_config.model if agent_config and agent_config.model else None

    # Final model name resolution: request → agent config → global default, with fallback for unknown names
    model_name = _resolve_model_name(requested_model_name or agent_model_name, app_config=resolved_app_config)

    model_config = resolved_app_config.get_model_config(model_name)

    if model_config is None:
        raise ValueError("No chat model could be resolved. Please configure at least one model in config.yaml or provide a valid 'model_name'/'model' in the request.")
    if thinking_enabled and not model_config.supports_thinking:
        logger.warning(f"Thinking mode is enabled but model '{model_name}' does not support it; fallback to non-thinking mode.")
        thinking_enabled = False

    config_base_url: str | None = None
    if hasattr(model_config, "model_dump"):
        dumped = model_config.model_dump(exclude_none=True)
        config_base_url = dumped.get("base_url") or dumped.get("api_base")

    model_runtime_overrides = _build_runtime_overrides(
        app_config=resolved_app_config,
        model_name=model_name,
        runtime_model=runtime_model_name,
        runtime_base_url=runtime_base_url,
        runtime_api_key=runtime_api_key,
        caller_label="lead_agent",
        fallback_base_url=config_base_url,
    )

    logger.info(
        (
            "Create Agent(%s) -> thinking_enabled: %s, reasoning_effort: %s, "
            "model_name: %s, runtime_model: %s, runtime_provider: %s, "
            "runtime_base_url: %s, runtime_api_key: %s, is_plan_mode: %s, "
            "subagent_enabled: %s, max_concurrent_subagents: %s"
        ),
        agent_name or "default",
        thinking_enabled,
        reasoning_effort,
        model_name,
        runtime_model_name,
        runtime_provider,
        "set" if runtime_base_url else "missing",
        "set" if runtime_api_key else "missing",
        is_plan_mode,
        subagent_enabled,
        max_concurrent_subagents,
    )

    # Inject run metadata for LangSmith trace tagging
    if "metadata" not in config:
        config["metadata"] = {}

    config["metadata"].update(
        {
            "agent_name": agent_name or "default",
            "model_name": model_name or "default",
            "runtime_model_name": runtime_model_name,
            "runtime_provider": runtime_provider,
            "thinking_enabled": thinking_enabled,
            "reasoning_effort": reasoning_effort,
            "is_plan_mode": is_plan_mode,
            "subagent_enabled": subagent_enabled,
            "tool_groups": agent_config.tool_groups if agent_config else None,
            "available_skills": sorted(available_skills) if available_skills is not None else None,
        }
    )

    skills_for_tool_policy = _load_enabled_skills_for_tool_policy(available_skills, app_config=resolved_app_config)

    if is_bootstrap:
        # Special bootstrap agent with minimal prompt for initial custom agent creation flow
        tools = get_available_tools(
            model_name=model_name,
            subagent_enabled=subagent_enabled,
            include_novel=include_novel,
            app_config=resolved_app_config,
            enabled_mcp_servers=runtime_enabled_mcp_servers,
        ) + [setup_agent]
        return create_agent(
            model=create_chat_model(name=model_name, thinking_enabled=thinking_enabled, app_config=resolved_app_config, **model_runtime_overrides),
            tools=filter_tools_by_skill_allowed_tools(tools, skills_for_tool_policy),
            middleware=_build_middlewares(config, model_name=model_name, app_config=resolved_app_config),
            system_prompt=apply_prompt_template(
            subagent_enabled=subagent_enabled,
            max_concurrent_subagents=max_concurrent_subagents,
            available_skills=set(["bootstrap"]),
            app_config=resolved_app_config,
            include_novel=False,
        ),
            state_schema=ThreadState,
        )

    # Custom agents can update their own SOUL.md / config via update_agent.
    # The default agent (no agent_name) does not see this tool.
    extra_tools = [update_agent] if agent_name else []
    # Default lead agent (unchanged behavior)
    tools = get_available_tools(
        model_name=model_name,
        groups=agent_config.tool_groups if agent_config else None,
        subagent_enabled=subagent_enabled,
        include_novel=include_novel,
        app_config=resolved_app_config,
        enabled_mcp_servers=runtime_enabled_mcp_servers,
    )
    return create_agent(
        model=create_chat_model(
            name=model_name,
            thinking_enabled=thinking_enabled,
            reasoning_effort=reasoning_effort,
            app_config=resolved_app_config,
            **model_runtime_overrides,
        ),
        tools=filter_tools_by_skill_allowed_tools(tools + extra_tools, skills_for_tool_policy),
        middleware=_build_middlewares(config, model_name=model_name, agent_name=agent_name, app_config=resolved_app_config),
        system_prompt=apply_prompt_template(
            subagent_enabled=subagent_enabled,
            max_concurrent_subagents=max_concurrent_subagents,
            agent_name=agent_name,
            available_skills=available_skills,
            app_config=resolved_app_config,
            include_novel=include_novel,
        ),
        state_schema=ThreadState,
    )
