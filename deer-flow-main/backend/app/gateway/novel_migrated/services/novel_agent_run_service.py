"""Adapter that routes novel AI tasks through the main DeerFlow run runtime."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncGenerator, Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import Request

from app.gateway.deps import get_checkpointer, get_run_manager, get_stream_bridge
from app.gateway.routers.thread_runs import RunCreateRequest
from app.gateway.services import start_run
from deerflow.runtime import END_SENTINEL, HEARTBEAT_SENTINEL, RunRecord, serialize_channel_values


@dataclass(frozen=True)
class NovelAgentTask:
    prompt: str
    user_id: str
    project_id: str
    task_type: str
    chapter_id: str | None = None
    thread_id: str | None = None
    model: str | None = None
    runtime_model: str | None = None
    runtime_provider: str | None = None
    runtime_base_url: str | None = None
    runtime_api_key: str | None = None
    module_id: str = "novel-tools"
    metadata: dict[str, Any] = field(default_factory=dict)
    requested_skills: list[str] = field(default_factory=list)
    stream_mode: list[str] = field(default_factory=lambda: ["messages-tuple", "custom", "values"])


@dataclass(frozen=True)
class NovelRunResult:
    run_id: str
    thread_id: str
    status: str
    content: str
    state: dict[str, Any]
    metadata: dict[str, Any]


@dataclass(frozen=True)
class NovelRunStreamEvent:
    type: str
    run_id: str
    thread_id: str
    content: str = ""
    data: Any = None


StartRunFunc = Callable[[Any, str, Request], Any]


class NovelAgentRunService:
    """Small compatibility layer from novel services to main RunManager runs."""

    def __init__(
        self,
        *,
        start_run_func: StartRunFunc = start_run,
        stream_bridge_getter: Callable[[Request], Any] = get_stream_bridge,
        run_manager_getter: Callable[[Request], Any] = get_run_manager,
        checkpointer_getter: Callable[[Request], Any] = get_checkpointer,
    ) -> None:
        self._start_run = start_run_func
        self._get_stream_bridge = stream_bridge_getter
        self._get_run_manager = run_manager_getter
        self._get_checkpointer = checkpointer_getter

    async def run_task(self, *, request: Request, task: NovelAgentTask) -> NovelRunResult:
        thread_id = self._resolve_thread_id(task)
        body = self._build_body(task, thread_id=thread_id, stream_mode=["values"])
        record: RunRecord = await self._start_run(body, thread_id, request)

        if record.task is not None:
            try:
                await record.task
            except asyncio.CancelledError:
                pass

        state = await self._load_final_state(request=request, thread_id=thread_id)
        return NovelRunResult(
            run_id=record.run_id,
            thread_id=thread_id,
            status=record.status.value,
            content=self._extract_final_content(state),
            state=state,
            metadata=record.metadata,
        )

    async def stream_task(self, *, request: Request, task: NovelAgentTask) -> AsyncGenerator[NovelRunStreamEvent, None]:
        thread_id = self._resolve_thread_id(task)
        body = self._build_body(task, thread_id=thread_id, stream_mode=task.stream_mode)
        record: RunRecord = await self._start_run(body, thread_id, request)
        bridge = self._get_stream_bridge(request)

        yield NovelRunStreamEvent(
            type="metadata",
            run_id=record.run_id,
            thread_id=thread_id,
            data={"run_id": record.run_id, "thread_id": thread_id},
        )

        async for entry in bridge.subscribe(record.run_id):
            if entry is HEARTBEAT_SENTINEL:
                yield NovelRunStreamEvent(type="heartbeat", run_id=record.run_id, thread_id=thread_id)
                continue
            if entry is END_SENTINEL:
                break

            if entry.event == "messages":
                content = self.extract_stream_content(entry.data)
                if content:
                    yield NovelRunStreamEvent(
                        type="content",
                        run_id=record.run_id,
                        thread_id=thread_id,
                        content=content,
                        data=entry.data,
                    )
                continue

            if entry.event == "custom":
                yield NovelRunStreamEvent(
                    type="custom",
                    run_id=record.run_id,
                    thread_id=thread_id,
                    data=entry.data,
                )

        if record.task is not None:
            try:
                await record.task
            except asyncio.CancelledError:
                pass
        yield NovelRunStreamEvent(
            type="end",
            run_id=record.run_id,
            thread_id=thread_id,
            data={"status": record.status.value, "error": record.error},
        )

    def _build_body(self, task: NovelAgentTask, *, thread_id: str, stream_mode: list[str]) -> RunCreateRequest:
        configurable: dict[str, Any] = {
            "thread_id": thread_id,
            "include_novel": True,
            "module_id": task.module_id,
        }
        resolved_model = task.runtime_model or task.model
        if resolved_model:
            configurable["model_name"] = resolved_model

        metadata = {
            "source": "novel_migrated",
            "task_type": task.task_type,
            "user_id": task.user_id,
            "project_id": task.project_id,
            "chapter_id": task.chapter_id,
            **task.metadata,
        }
        context = {
            "user_id": task.user_id,
            "thread_id": thread_id,
            "project_id": task.project_id,
            "chapter_id": task.chapter_id,
            "module_id": task.module_id,
            "feature_id": task.module_id,
            "include_novel": True,
            "requested_novel_skills": task.requested_skills,
        }
        runtime_overrides = {
            "runtime_model": task.runtime_model or task.model,
            "runtime_provider": task.runtime_provider,
            "runtime_base_url": task.runtime_base_url,
            "runtime_api_key": task.runtime_api_key,
        }
        for key, value in runtime_overrides.items():
            if value:
                context[key] = value

        return RunCreateRequest(
            assistant_id="lead_agent",
            input={"messages": [{"role": "user", "content": task.prompt}]},
            metadata=metadata,
            config={"configurable": configurable},
            context=context,
            stream_mode=stream_mode,
            on_disconnect="continue",
            multitask_strategy="enqueue",
        )

    @staticmethod
    def _resolve_thread_id(task: NovelAgentTask) -> str:
        if task.thread_id:
            return task.thread_id
        suffix = task.chapter_id or task.project_id or str(uuid.uuid4())
        return f"novel-{task.task_type}-{suffix}"

    async def _load_final_state(self, *, request: Request, thread_id: str) -> dict[str, Any]:
        checkpointer = self._get_checkpointer(request)
        try:
            checkpoint_tuple = await checkpointer.aget_tuple({"configurable": {"thread_id": thread_id}})
            if checkpoint_tuple is None:
                return {}
            checkpoint = getattr(checkpoint_tuple, "checkpoint", {}) or {}
            channel_values = checkpoint.get("channel_values", {})
            return serialize_channel_values(channel_values)
        except Exception:
            return {}

    @classmethod
    def extract_stream_content(cls, data: Any) -> str:
        """Extract assistant text from serialized LangGraph messages-mode data."""
        chunk: Any
        if isinstance(data, list) and data:
            chunk = data[0]
        else:
            chunk = data

        if isinstance(chunk, dict):
            if cls._is_non_assistant_chunk(chunk):
                return ""
            return cls._stringify_content(chunk.get("content"))
        return ""

    @classmethod
    def _extract_final_content(cls, state: dict[str, Any]) -> str:
        messages = state.get("messages") if isinstance(state, dict) else None
        if not isinstance(messages, list):
            return ""
        for message in reversed(messages):
            if not isinstance(message, dict):
                continue
            if message.get("type") not in {"ai", "AIMessage", "assistant", None}:
                continue
            content = cls._stringify_content(message.get("content"))
            if content:
                return content
        return ""

    @staticmethod
    def _is_non_assistant_chunk(chunk: dict[str, Any]) -> bool:
        chunk_type = str(chunk.get("type") or chunk.get("role") or "")
        if chunk_type.lower() in {"human", "user", "tool", "system"}:
            return True
        return False

    @staticmethod
    def _stringify_content(content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text = item.get("text") or item.get("content")
                    if text:
                        parts.append(str(text))
            return "".join(parts)
        return str(content)
