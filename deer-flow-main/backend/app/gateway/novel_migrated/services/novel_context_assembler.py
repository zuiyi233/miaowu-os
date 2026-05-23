"""Context assembly for novel tasks routed through the main DeerFlow agent."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.project import Project

RagRetriever = Callable[[str, str, str, int], Awaitable[list[dict[str, Any]]]]


@dataclass(frozen=True)
class NovelContextRequest:
    user_id: str
    project: Project
    chapter: Chapter | None = None
    task_type: str = "chapter_generate"
    current_request: str = ""
    project_context: dict[str, Any] = field(default_factory=dict)
    recent_context: dict[str, Any] = field(default_factory=dict)
    main_memory_context: str = ""
    rag_query: str = ""
    rag_limit: int = 8
    max_chars: int = 12000


@dataclass(frozen=True)
class NovelAssembledContext:
    prompt: str
    metadata: dict[str, Any]
    sections: list[tuple[str, str]]
    rag_results: list[dict[str, Any]] = field(default_factory=list)


class NovelContextAssembler:
    """Build deterministic novel task context for the main lead agent.

    The main DynamicContextMiddleware normally injects user memory before the
    task prompt.  ``main_memory_context`` exists for tests and explicit callers
    that already fetched a memory snapshot; project plot state still belongs to
    the novel RAG/workspace layer.
    """

    def __init__(self, *, rag_retriever: RagRetriever | None = None) -> None:
        self._rag_retriever = rag_retriever

    async def assemble(
        self,
        *,
        db: AsyncSession | None = None,
        request: NovelContextRequest,
    ) -> NovelAssembledContext:
        del db  # Reserved for future DB-backed enrichment; callers pass rich objects today.

        rag_results: list[dict[str, Any]] = []
        rag_query = (request.rag_query or request.current_request or request.project.title or "").strip()
        if self._rag_retriever is not None and rag_query:
            rag_results = await self._rag_retriever(
                request.user_id,
                request.project.id,
                rag_query,
                request.rag_limit,
            )

        sections: list[tuple[str, str]] = []
        self._append_section(sections, "user_long_term_memory", request.main_memory_context)
        self._append_section(sections, "project_metadata", self._format_project_metadata(request.project, request.project_context))
        self._append_section(sections, "recent_novel_context", self._format_mapping(request.recent_context))
        self._append_section(sections, "novel_rag_results", self._format_rag_results(rag_results))
        self._append_section(sections, "current_request", request.current_request)

        prompt = self._truncate_sections(sections, request.max_chars)
        metadata = {
            "task_type": request.task_type,
            "user_id": request.user_id,
            "project_id": request.project.id,
            "chapter_id": request.chapter.id if request.chapter is not None else None,
            "context_sections": [name for name, content in sections if content.strip()],
            "rag_result_count": len(rag_results),
            "memory_policy": "main_user_memory_for_preferences__novel_rag_for_work_context",
        }
        return NovelAssembledContext(prompt=prompt, metadata=metadata, sections=sections, rag_results=rag_results)

    @staticmethod
    def _append_section(sections: list[tuple[str, str]], name: str, content: str | None) -> None:
        normalized = (content or "").strip()
        if normalized:
            sections.append((name, normalized))

    @staticmethod
    def _format_project_metadata(project: Project, extra: dict[str, Any]) -> str:
        lines = [
            f"title: {project.title}",
            f"genre: {project.genre or ''}",
            f"theme: {project.theme or ''}",
            f"description: {project.description or ''}",
            f"world_time_period: {project.world_time_period or ''}",
            f"world_location: {project.world_location or ''}",
            f"world_rules: {project.world_rules or ''}",
            f"narrative_perspective: {project.narrative_perspective or ''}",
        ]
        for key, value in extra.items():
            if value is None:
                continue
            lines.append(f"{key}: {value}")
        return "\n".join(line for line in lines if line.split(": ", 1)[-1])

    @staticmethod
    def _format_mapping(payload: dict[str, Any]) -> str:
        lines: list[str] = []
        for key, value in payload.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                rendered = "\n".join(f"- {item}" for item in value if str(item).strip())
            else:
                rendered = str(value).strip()
            if rendered:
                lines.append(f"{key}:\n{rendered}")
        return "\n\n".join(lines)

    @staticmethod
    def _format_rag_results(results: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for index, item in enumerate(results, start=1):
            content = str(item.get("content") or "").strip()
            if not content:
                continue
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            title = str(metadata.get("title") or item.get("id") or f"result-{index}").strip()
            lines.append(f"[{index}] {title}\n{content}")
        return "\n\n".join(lines)

    @staticmethod
    def _truncate_sections(sections: list[tuple[str, str]], max_chars: int) -> str:
        budget = max(1000, int(max_chars or 12000))
        chunks: list[str] = []
        used = 0
        for name, content in sections:
            block = f"<{name}>\n{content.strip()}\n</{name}>"
            remaining = budget - used
            if remaining <= 0:
                break
            if len(block) > remaining:
                block = block[: max(0, remaining - 24)].rstrip() + "\n...[truncated]"
            chunks.append(block)
            used += len(block)
        return "\n\n".join(chunks)
