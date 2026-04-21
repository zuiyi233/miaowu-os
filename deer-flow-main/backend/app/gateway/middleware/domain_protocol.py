"""Unified domain protocol definitions for novel lifecycle integration.

Defines the canonical data structures shared between:
- Intent recognition middleware (方案1)
- Tool calling dispatcher (方案2)
- Frontend structured response consumer
- Novel domain orchestrator

All write operations flow through DomainAction; all tool invocations
conform to DomainToolCall; session state follows the three-state model.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class SessionMode(str, Enum):
    NORMAL = "normal"
    CREATE = "create"
    MANAGE = "manage"


class SessionStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"
    EXPIRED = "expired"


class Entity(str, Enum):
    PROJECT = "project"
    CHAPTER = "chapter"
    OUTLINE = "outline"
    CHARACTER = "character"
    RELATIONSHIP = "relationship"
    ORGANIZATION = "organization"
    ITEM = "item"
    FORESHADOW = "foreshadow"


class Operation(str, Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    LIST = "list"
    GENERATE = "generate"
    SWITCH = "switch"


@dataclass
class DomainAction:
    action: str
    entity: Entity
    operation: Operation
    scope: dict[str, Any] = field(default_factory=dict)
    payload: dict[str, Any] = field(default_factory=dict)
    idempotency_key: str = field(default_factory=lambda: uuid.uuid4().hex[:16])
    requires_confirmation: bool = True
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "entity": self.entity.value,
            "operation": self.operation.value,
            "scope": self.scope,
            "payload": self.payload,
            "idempotency_key": self.idempotency_key,
            "requires_confirmation": self.requires_confirmation,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class DomainToolCall:
    name: str
    args: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: f"call_{uuid.uuid4().hex[:12]}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "args": self.args,
            "id": self.id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DomainToolCall:
        return cls(
            name=data.get("name", ""),
            args=data.get("args", {}),
            id=data.get("id", f"call_{uuid.uuid4().hex[:12]}"),
        )


@dataclass
class DomainScope:
    user_id: str | None = None
    project_id: str | None = None
    thread_id: str | None = None
    novel_id: str | None = None
    chapter_id: str | None = None
    writing_mode: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in {
            "user_id": self.user_id,
            "project_id": self.project_id,
            "thread_id": self.thread_id,
            "novel_id": self.novel_id,
            "chapter_id": self.chapter_id,
            "writing_mode": self.writing_mode,
        }.items() if v is not None}

    @classmethod
    def from_context(cls, context: dict[str, Any] | None) -> DomainScope:
        if not context:
            return cls()
        return cls(
            user_id=context.get("user_id") or context.get("userId"),
            project_id=context.get("project_id") or context.get("projectId"),
            thread_id=context.get("thread_id") or context.get("threadId"),
            novel_id=context.get("novel_id") or context.get("novelId"),
            chapter_id=context.get("chapter_id") or context.get("chapterId"),
            writing_mode=context.get("writing_mode") or context.get("writingMode"),
        )


@dataclass
class SessionBrief:
    mode: SessionMode
    status: SessionStatus = SessionStatus.ACTIVE
    missing_fields: list[str] = field(default_factory=list)
    awaiting_confirm: bool = False
    active_project_id: str | None = None
    active_project_title: str | None = None
    pending_action: str | None = None
    idempotency_key: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in {
            "mode": self.mode.value,
            "status": self.status.value,
            "missing_fields": self.missing_fields,
            "awaiting_confirm": self.awaiting_confirm,
            "active_project_id": self.active_project_id,
            "active_project_title": self.active_project_title,
            "pending_action": self.pending_action,
            "idempotency_key": self.idempotency_key,
        }.items() if v is not None and v != [] and v is not False}


CONTEXT_FIELD_WHITELIST: tuple[str, ...] = (
    "novel_id", "novelId",
    "project_id", "projectId",
    "chapter_id", "chapterId",
    "writing_mode", "writingMode",
    "scene_id", "sceneId",
    "thread_id", "threadId",
    "user_id", "userId",
)


def extract_context_fields(context: dict[str, Any] | None) -> dict[str, Any]:
    if not context:
        return {}
    return {k: v for k, v in context.items() if k in CONTEXT_FIELD_WHITELIST and v is not None}
