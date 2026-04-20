"""项目创建向导流式 API（SSE）。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.career import Career
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.services.book_import_service import (
    book_import_service,
    normalize_narrative_perspective,
    normalize_target_words,
)
from app.gateway.novel_migrated.utils.sse_response import SSEResponse, create_sse_response

logger = get_logger(__name__)
router = APIRouter(tags=["wizard_stream"])


class WorldBuildingStreamRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    theme: str = Field(default="")
    genre: str | list[str] = Field(default="")
    narrative_perspective: str = Field(default="第三人称")
    target_words: int = Field(default=100000, ge=1000, le=3_000_000)
    chapter_count: int = Field(default=30, ge=5, le=300)
    character_count: int = Field(default=8, ge=5, le=20)
    outline_mode: Literal["one-to-one", "one-to-many"] = Field(default="one-to-many")


class CareerSystemStreamRequest(BaseModel):
    project_id: str


class CharactersStreamRequest(BaseModel):
    project_id: str
    count: int = Field(default=8, ge=5, le=20)
    world_context: dict[str, str] | None = None
    theme: str | None = None
    genre: str | None = None


class OutlineStreamRequest(BaseModel):
    project_id: str
    chapter_count: int = Field(default=30, ge=5, le=300)
    narrative_perspective: str = Field(default="第三人称")
    target_words: int = Field(default=100000, ge=1000, le=3_000_000)


def _normalize_genre(genre: str | list[str]) -> str:
    if isinstance(genre, list):
        normalized = [str(item).strip() for item in genre if str(item).strip()]
        return "、".join(normalized)[:50]
    return str(genre or "").strip()[:50]


def _error_event(message: str, code: int = 500) -> str:
    return SSEResponse.format_sse(
        {
            "type": "error",
            "message": message,
            "code": code,
        }
    )


def _complete_event() -> str:
    return SSEResponse.format_sse({"type": "complete"})


async def _stream_worker(
    worker: Callable[[Callable[[str, int, str], Awaitable[None]]], Awaitable[dict[str, Any]]],
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def progress_callback(message: str, progress: int, status: str = "processing") -> None:
        await queue.put(
            SSEResponse.format_sse(
                {
                    "type": "progress",
                    "message": message,
                    "progress": progress,
                    "status": status,
                }
            )
        )

    async def runner() -> None:
        try:
            result = await worker(progress_callback)
            await queue.put(await SSEResponse.send_result(result))
            await queue.put(_complete_event())
        except HTTPException as exc:
            detail = str(exc.detail) if exc.detail is not None else "请求失败"
            await queue.put(_error_event(detail, exc.status_code))
        except Exception as exc:  # pragma: no cover - 防御性分支
            logger.error("wizard-stream 任务执行失败: %s", exc, exc_info=True)
            await queue.put(_error_event(str(exc), 500))
        finally:
            await queue.put(None)

    task = asyncio.create_task(runner())

    try:
        while True:
            msg = await queue.get()
            if msg is None:
                break
            yield msg
    except GeneratorExit:
        task.cancel()


@router.get("/api/projects/{project_id}", summary="获取项目详情（向导恢复）")
async def get_project_detail(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)
    project = await verify_project_access(project_id, user_id, db)
    return {
        "id": project.id,
        "title": project.title,
        "description": project.description,
        "theme": project.theme,
        "genre": project.genre,
        "wizard_status": project.wizard_status,
        "wizard_step": project.wizard_step,
        "status": project.status,
        "outline_mode": project.outline_mode,
        "target_words": project.target_words,
        "chapter_count": project.chapter_count,
        "character_count": project.character_count,
        "narrative_perspective": project.narrative_perspective,
        "world_time_period": project.world_time_period,
        "world_location": project.world_location,
        "world_atmosphere": project.world_atmosphere,
        "world_rules": project.world_rules,
    }


@router.post("/api/wizard-stream/world-building", summary="流式生成世界观")
async def generate_world_building_stream(
    payload: WorldBuildingStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        genre_value = _normalize_genre(payload.genre)
        narrative_perspective = normalize_narrative_perspective(
            payload.narrative_perspective,
            fallback="第三人称",
        )
        target_words = normalize_target_words(payload.target_words, fallback=100000)

        project = Project(
            user_id=user_id,
            title=payload.title,
            description=payload.description,
            theme=payload.theme,
            genre=genre_value,
            status="planning",
            wizard_status="incomplete",
            wizard_step=0,
            outline_mode=payload.outline_mode,
            target_words=target_words,
            chapter_count=payload.chapter_count,
            character_count=payload.character_count,
            narrative_perspective=narrative_perspective,
            current_words=0,
        )
        db.add(project)
        await db.flush()
        await book_import_service._ensure_project_default_style(db=db, project_id=project.id)  # noqa: SLF001

        await progress_callback("开始生成世界观...", 5, "processing")
        await book_import_service._generate_world_building_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            progress_callback=progress_callback,
            progress_range=(10, 88),
            raise_on_error=True,
        )

        project.wizard_step = 1
        project.wizard_status = "incomplete"
        await db.commit()

        return {
            "project_id": project.id,
            "time_period": project.world_time_period or "",
            "location": project.world_location or "",
            "atmosphere": project.world_atmosphere or "",
            "rules": project.world_rules or "",
        }

    return create_sse_response(_stream_worker(worker))


@router.post("/api/wizard-stream/world-building/{project_id}/regenerate", summary="重新生成世界观")
async def regenerate_world_building(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    重新生成项目的世界观设定

    当用户对当前世界观不满意时，可以调用此接口重新生成。
    会保留项目基本信息（标题、类型等），只重新生成世界观相关字段。
    """
    user_id = get_user_id(request)
    project = await verify_project_access(project_id, user_id, db)

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        await progress_callback("开始重新生成世界观...", 5, "processing")

        # 重置世界观相关字段
        project.world_time_period = None
        project.world_location = None
        project.world_atmosphere = None
        project.world_rules = None
        await db.flush()

        # 调用现有的世界生成服务
        await book_import_service._generate_world_building_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            progress_callback=progress_callback,
            progress_range=(10, 88),
            raise_on_error=True,
        )

        await db.commit()

        logger.info(f"用户 {user_id} 重新生成了项目 {project_id} 的世界观")

        return {
            "project_id": project.id,
            "regenerated": True,
            "time_period": project.world_time_period or "",
            "location": project.world_location or "",
            "atmosphere": project.world_atmosphere or "",
            "rules": project.world_rules or "",
            "message": "世界观重新生成成功",
        }

    return create_sse_response(_stream_worker(worker))


@router.post("/api/wizard-stream/career-system", summary="流式生成职业体系")
async def generate_career_system_stream(
    payload: CareerSystemStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        project = await verify_project_access(payload.project_id, user_id, db)

        await progress_callback("开始生成职业体系...", 8, "processing")
        await book_import_service._generate_career_system_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            progress_callback=progress_callback,
            progress_range=(12, 88),
        )

        project.wizard_step = max(int(project.wizard_step or 0), 2)
        project.wizard_status = "incomplete"
        await db.commit()

        result = await db.execute(select(Career.type).where(Career.project_id == project.id))
        career_types = [row[0] for row in result.all()]
        main_count = sum(1 for ctype in career_types if ctype == "main")
        sub_count = sum(1 for ctype in career_types if ctype == "sub")

        return {
            "project_id": project.id,
            "main_careers_count": main_count,
            "sub_careers_count": sub_count,
        }

    return create_sse_response(_stream_worker(worker))


@router.post("/api/wizard-stream/characters", summary="流式生成角色与组织")
async def generate_characters_stream(
    payload: CharactersStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        project = await verify_project_access(payload.project_id, user_id, db)

        if payload.theme:
            project.theme = payload.theme
        if payload.genre:
            project.genre = payload.genre[:50]
        project.character_count = max(5, min(int(payload.count or project.character_count or 8), 20))

        await progress_callback("开始生成角色与组织...", 8, "processing")
        generated = await book_import_service._generate_characters_and_organizations_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            count=project.character_count,
            progress_callback=progress_callback,
            progress_range=(12, 88),
        )

        project.wizard_step = max(int(project.wizard_step or 0), 3)
        project.wizard_status = "incomplete"
        await db.commit()

        characters_result = await db.execute(
            select(Character.name)
            .where(Character.project_id == project.id, Character.is_organization.is_(False))
            .order_by(Character.name)
        )
        character_names = [row[0] for row in characters_result.fetchall()][:50]

        return {
            "project_id": project.id,
            "created_count": generated,
            "characters": character_names,
        }

    return create_sse_response(_stream_worker(worker))


@router.post("/api/wizard-stream/outline", summary="流式生成完整大纲")
async def generate_outline_stream(
    payload: OutlineStreamRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    user_id = get_user_id(request)

    async def worker(progress_callback: Callable[[str, int, str], Awaitable[None]]) -> dict[str, Any]:
        project = await verify_project_access(payload.project_id, user_id, db)

        await progress_callback("开始生成完整大纲...", 8, "processing")
        outlines_count = await book_import_service._generate_outline_from_project(  # noqa: SLF001
            db=db,
            user_id=user_id,
            project=project,
            chapter_count=payload.chapter_count,
            narrative_perspective=payload.narrative_perspective,
            target_words=payload.target_words,
            progress_callback=progress_callback,
            progress_range=(12, 92),
        )

        project.wizard_step = 4
        project.wizard_status = "completed"
        project.status = "writing"
        await db.commit()

        return {
            "project_id": project.id,
            "outlines_count": outlines_count,
            "chapter_count": project.chapter_count,
        }

    return create_sse_response(_stream_worker(worker))
