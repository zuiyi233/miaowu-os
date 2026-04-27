from typing import Annotated, NotRequired, TypedDict

from langchain.agents import AgentState


class SandboxState(TypedDict):
    sandbox_id: NotRequired[str | None]


class ThreadDataState(TypedDict):
    workspace_path: NotRequired[str | None]
    uploads_path: NotRequired[str | None]
    outputs_path: NotRequired[str | None]


class ViewedImageData(TypedDict):
    base64: str
    mime_type: str


class ExecutionGateState(TypedDict):
    status: NotRequired[str]
    execution_mode: NotRequired[bool]
    pending_action: NotRequired[dict | None]
    confirmation_required: NotRequired[bool]
    updated_at: NotRequired[str | None]
    replay_requested: NotRequired[bool]
    answer_only_turn: NotRequired[bool]
    planning_only_turn: NotRequired[bool]
    last_user_fingerprint: NotRequired[str | None]


def merge_artifacts(existing: list[str] | None, new: list[str] | None) -> list[str]:
    """Reducer for artifacts list - merges and deduplicates artifacts."""
    if existing is None:
        return new or []
    if new is None:
        return existing
    # Use dict.fromkeys to deduplicate while preserving order
    return list(dict.fromkeys(existing + new))


def merge_viewed_images(existing: dict[str, ViewedImageData] | None, new: dict[str, ViewedImageData] | None) -> dict[str, ViewedImageData]:
    """Reducer for viewed_images dict - merges image dictionaries.

    Special case: If new is an empty dict {}, it clears the existing images.
    This allows middlewares to clear the viewed_images state after processing.
    """
    if existing is None:
        return new or {}
    if new is None:
        return existing
    # Special case: empty dict means clear all viewed images
    if len(new) == 0:
        return {}
    # Merge dictionaries, new values override existing ones for same keys
    return {**existing, **new}


def merge_draft_media(existing: dict[str, dict] | None, new: dict[str, dict | None] | None) -> dict[str, dict]:
    """Reducer for draft media map.

    - Merges by id (key).
    - When a value is ``None`` in the update, the key is removed.
    - When *new* is an empty dict ``{}``, it clears all existing draft media.
    """
    if existing is None:
        existing = {}
    if new is None:
        return existing
    if len(new) == 0:
        return {}
    merged = dict(existing)
    for key, value in new.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def merge_execution_gate(existing: ExecutionGateState | None, new: ExecutionGateState | None) -> ExecutionGateState:
    """Reducer for execution gate state.

    - Merge dict keys by overwrite.
    - Empty dict ``{}`` means clear gate state.
    """
    if existing is None:
        return new or {}
    if new is None:
        return existing
    if len(new) == 0:
        return {}
    merged: ExecutionGateState = dict(existing)
    merged.update(new)
    return merged


class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]
    todos: NotRequired[list | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]  # image_path -> {base64, mime_type}
    draft_media: Annotated[dict[str, dict], merge_draft_media]
    execution_gate: Annotated[ExecutionGateState, merge_execution_gate]
