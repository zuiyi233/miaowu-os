import logging
from typing import Optional

from langchain.chat_models import BaseChatModel

from deerflow.config import get_app_config
from deerflow.reflection import resolve_class
from deerflow.tracing import build_tracing_callbacks

logger = logging.getLogger(__name__)


def _deep_merge_dicts(base: dict | None, override: dict) -> dict:
    """Recursively merge two dictionaries without mutating the inputs."""
    merged = dict(base or {})
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def _vllm_disable_chat_template_kwargs(chat_template_kwargs: dict) -> dict:
    """Build the disable payload for vLLM/Qwen chat template kwargs."""
    disable_kwargs: dict[str, bool] = {}
    if "thinking" in chat_template_kwargs:
        disable_kwargs["thinking"] = False
    if "enable_thinking" in chat_template_kwargs:
        disable_kwargs["enable_thinking"] = False
    return disable_kwargs


def _enable_stream_usage_by_default(model_use_path: str, model_settings_from_config: dict) -> None:
    """Enable stream usage for OpenAI-compatible models unless explicitly configured.

    LangChain only auto-enables ``stream_usage`` for OpenAI models when no custom
    base URL or client is configured. DeerFlow frequently uses OpenAI-compatible
    gateways, so token usage tracking would otherwise stay empty and the
    TokenUsageMiddleware would have nothing to log.
    """
    if model_use_path != "langchain_openai:ChatOpenAI":
        return
    if "stream_usage" in model_settings_from_config:
        return
    if "base_url" in model_settings_from_config or "openai_api_base" in model_settings_from_config:
        model_settings_from_config["stream_usage"] = True


def _normalize_model_name(name: str | object | None) -> Optional[str]:
    """Normalize various model selector types into a string model name.

    Handles the following cases in order of precedence:
        1. **None** -> returns None (caller will use default model from config).
        2. **str** -> returned as-is (already a valid model name).
        3. **Object with `.name` attribute** -> uses the nested name if it's a non-empty string.
           This covers config objects or enums that carry a model identifier.
        4. **Fallback via `str()`** -> attempts string conversion; rejects objects whose
           `str()` representation looks like a default Python repr (e.g. `<MyClass at 0x...>`).

    Args:
        name: A model identifier which may be a string, an object with a `.name`
              attribute, or any object supporting `str()` conversion.

    Returns:
        The normalized model name as a string, or ``None`` when *name* is ``None``.

    Raises:
        TypeError: When *name* is not ``None``, not a string, has no usable ``.name``
                  attribute, and its ``str()`` representation appears to be a default
                  Python repr rather than a meaningful identifier.
    """
    # Case 1: Explicitly passed None – let the caller decide the default.
    if name is None:
        return None

    # Case 2: Already a string – nothing to do.
    if isinstance(name, str):
        return name

    # Case 3: Object carries a `.name` attribute (e.g. a Pydantic model or enum).
    nested_name = getattr(name, "name", None)
    if isinstance(nested_name, str) and nested_name:
        logger.warning(
            "create_chat_model received non-string model selector (%s); using nested name '%s'.",
            type(name).__name__,
            nested_name,
        )
        return nested_name

    # Case 4: Last-resort fallback – try converting to string.
    result = str(name)
    # Reject default Python repr strings like "<MyClass object at 0x...>"
    if not result or (result.startswith("<") and ">" in result):
        raise TypeError(
            f"Unsupported model selector: {type(name).__name__!r} (cannot derive a valid model name)"
        )

    logger.warning(
        "create_chat_model received non-string model selector (%s); using str() representation '%s'.",
        type(name).__name__,
        result,
    )
    return result


def create_chat_model(name: str | object | None = None, thinking_enabled: bool = False, **kwargs) -> BaseChatModel:
    """Create a chat model instance from the config.

    Args:
        name: The name/selector of the model to create. If None, the first model in the config will be used.

    Returns:
        A chat model instance.
    """
    # Backward compatibility: some call sites historically passed `model_name=...`.
    # Normalize both entry points through `_normalize_model_name`.
    legacy_model_name = kwargs.pop("model_name", None)
    if name is None and legacy_model_name is not None:
        logger.warning("create_chat_model(model_name=...) is deprecated; use name=... instead.")
        name = legacy_model_name

    config = get_app_config()
    normalized_name = _normalize_model_name(name)
    if normalized_name is None:
        normalized_name = config.models[0].name
    model_config = config.get_model_config(normalized_name)
    if model_config is None:
        raise ValueError(f"Model {normalized_name} not found in config") from None
    model_class = resolve_class(model_config.use, BaseChatModel)
    model_settings_from_config = model_config.model_dump(
        exclude_none=True,
        exclude={
            "use",
            "name",
            "display_name",
            "description",
            "supports_thinking",
            "supports_reasoning_effort",
            "when_thinking_enabled",
            "when_thinking_disabled",
            "thinking",
            "supports_vision",
        },
    )
    # Compute effective when_thinking_enabled by merging in the `thinking` shortcut field.
    # The `thinking` shortcut is equivalent to setting when_thinking_enabled["thinking"].
    has_thinking_settings = (model_config.when_thinking_enabled is not None) or (model_config.thinking is not None)
    effective_wte: dict = dict(model_config.when_thinking_enabled) if model_config.when_thinking_enabled else {}
    if model_config.thinking is not None:
        merged_thinking = {**(effective_wte.get("thinking") or {}), **model_config.thinking}
        effective_wte = {**effective_wte, "thinking": merged_thinking}
    if thinking_enabled and has_thinking_settings:
        if not model_config.supports_thinking:
            raise ValueError(
                f"Model {normalized_name} does not support thinking. "
                "Set `supports_thinking` to true in the `config.yaml` to enable thinking."
            ) from None
        if effective_wte:
            model_settings_from_config.update(effective_wte)
    if not thinking_enabled:
        if model_config.when_thinking_disabled is not None:
            # User-provided disable settings take full precedence
            model_settings_from_config.update(model_config.when_thinking_disabled)
        elif has_thinking_settings and effective_wte.get("extra_body", {}).get("thinking", {}).get("type"):
            # OpenAI-compatible gateway: thinking is nested under extra_body
            model_settings_from_config["extra_body"] = _deep_merge_dicts(
                model_settings_from_config.get("extra_body"),
                {"thinking": {"type": "disabled"}},
            )
            model_settings_from_config["reasoning_effort"] = "minimal"
        elif has_thinking_settings and (disable_chat_template_kwargs := _vllm_disable_chat_template_kwargs(effective_wte.get("extra_body", {}).get("chat_template_kwargs") or {})):
            # vLLM uses chat template kwargs to switch thinking on/off.
            model_settings_from_config["extra_body"] = _deep_merge_dicts(
                model_settings_from_config.get("extra_body"),
                {"chat_template_kwargs": disable_chat_template_kwargs},
            )
        elif has_thinking_settings and effective_wte.get("thinking", {}).get("type"):
            # Native langchain_anthropic: thinking is a direct constructor parameter
            model_settings_from_config["thinking"] = {"type": "disabled"}
    if not model_config.supports_reasoning_effort:
        kwargs.pop("reasoning_effort", None)
        model_settings_from_config.pop("reasoning_effort", None)

    _enable_stream_usage_by_default(model_config.use, model_settings_from_config)

    # For Codex Responses API models: map thinking mode to reasoning_effort
    from deerflow.models.openai_codex_provider import CodexChatModel

    if issubclass(model_class, CodexChatModel):
        # The ChatGPT Codex endpoint currently rejects max_tokens/max_output_tokens.
        model_settings_from_config.pop("max_tokens", None)

        # Use explicit reasoning_effort from frontend if provided (low/medium/high)
        explicit_effort = kwargs.pop("reasoning_effort", None)
        if not thinking_enabled:
            model_settings_from_config["reasoning_effort"] = "none"
        elif explicit_effort and explicit_effort in ("low", "medium", "high", "xhigh"):
            model_settings_from_config["reasoning_effort"] = explicit_effort
        elif "reasoning_effort" not in model_settings_from_config:
            model_settings_from_config["reasoning_effort"] = "medium"

    model_instance = model_class(**{**model_settings_from_config, **kwargs})

    callbacks = build_tracing_callbacks()
    if callbacks:
        existing_callbacks = model_instance.callbacks or []
        model_instance.callbacks = [*existing_callbacks, *callbacks]
        logger.debug(f"Tracing attached to model '{normalized_name}' with providers={len(callbacks)}")
    return model_instance
