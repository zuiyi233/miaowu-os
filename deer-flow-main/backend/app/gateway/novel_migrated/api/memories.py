"""记忆管理API - 提供记忆的查询、分析等接口"""
import asyncio
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service_with_overrides
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.memory import PlotAnalysis, StoryMemory
from app.gateway.novel_migrated.services.ai_service import create_user_ai_service_from_db
from app.gateway.novel_migrated.services.career_update_service import CareerUpdateService
from app.gateway.novel_migrated.services.character_state_update_service import CharacterStateUpdateService
from app.gateway.novel_migrated.services.foreshadow_service import foreshadow_service
from app.gateway.novel_migrated.services.memory_service import memory_service
from app.gateway.novel_migrated.services.plot_analyzer import get_plot_analyzer
from app.gateway.novel_migrated.services.workspace_document_service import WorkspaceSecurityError, workspace_document_service

logger = get_logger(__name__)
router = APIRouter(prefix="/api/memories", tags=["memories"])
MEMORY_MODULE_ID = "memory-ai"
_ANALYZE_CHAPTER_TIMEOUT_SECONDS = 180


def _compose_memory_markdown(*, title: str, content: str, memory_type: str, chapter_id: str, chapter_number: int, metadata: dict[str, Any]) -> str:
    payload = {
        "title": title,
        "content": content,
        "memory_type": memory_type,
        "chapter_id": chapter_id,
        "chapter_number": chapter_number,
        "metadata": metadata,
    }
    return f"# {title or '记忆片段'}\n\n```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```\n"


def _extract_json_block(markdown: str) -> dict[str, Any] | None:
    text = (markdown or "").replace("\r\n", "\n")
    start = text.find("```json")
    if start < 0:
        return None
    start += len("```json")
    end = text.find("```", start)
    if end < 0:
        return None
    raw = text[start:end].strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


async def _best_effort_sync_workspace_memory_index(
    *,
    user_id: str,
    project_id: str,
    db: AsyncSession,
) -> None:
    """按文件索引增量刷新向量记忆（失败不阻断主流程）。"""
    try:
        sync_stats = await memory_service.sync_workspace_documents_incremental(
            user_id=user_id,
            project_id=project_id,
            db=db,
        )
        if sync_stats.get("indexed", 0) or sync_stats.get("failed", 0):
            logger.info(
                "🧠 workspace->memory 增量同步: project=%s indexed=%s skipped=%s failed=%s",
                project_id,
                sync_stats.get("indexed", 0),
                sync_stats.get("skipped", 0),
                sync_stats.get("failed", 0),
            )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.warning("⚠️ workspace->memory 增量同步失败（已降级继续）: project=%s error=%s", project_id, exc)


@router.post("/projects/{project_id}/analyze-chapter/{chapter_id}")
async def analyze_chapter(
    project_id: str,
    chapter_id: str,
    request: Request = None,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = None,
):
    """
    分析章节并生成记忆
    
    对指定章节进行剧情分析,提取钩子、伏笔、情节点等,并存入记忆系统
    """
    try:
        effective_user_id = user_id if user_id else get_user_id(request) if request else "local_single_user"
        
        # 验证用户权限
        await verify_project_access(project_id, effective_user_id, db)
        
        # 获取章节内容
        result = await db.execute(
            select(Chapter).where(
                and_(
                    Chapter.id == chapter_id,
                    Chapter.project_id == project_id
                )
            )
        )
        chapter = result.scalar_one_or_none()
        
        if not chapter:
            raise HTTPException(status_code=404, detail="章节不存在")
        
        if not chapter.content:
            raise HTTPException(status_code=400, detail="章节内容为空,无法分析")
        
        if request is not None:
            ai_service = await get_user_ai_service_with_overrides(
                request,
                db,
                module_id=MEMORY_MODULE_ID,
            )
        else:
            ai_service = await create_user_ai_service_from_db(
                db=db,
                user_id=effective_user_id,
                module_id=MEMORY_MODULE_ID,
            )
        
        # 获取已埋入的伏笔列表（用于回收匹配）
        existing_foreshadows = await foreshadow_service.get_planted_foreshadows_for_analysis(
            db=db,
            project_id=project_id
        )
        logger.info(f"📋 已获取{len(existing_foreshadows)}个已埋入伏笔用于分析匹配")
        
        # 执行剧情分析（传入已有伏笔列表）
        analyzer = get_plot_analyzer(ai_service)
        analysis_result = await asyncio.wait_for(
            analyzer.analyze_chapter(
                chapter_number=chapter.chapter_number,
                title=chapter.title,
                content=chapter.content,
                word_count=chapter.word_count or len(chapter.content),
                user_id=effective_user_id,
                db=db,
                existing_foreshadows=existing_foreshadows
            ),
            timeout=_ANALYZE_CHAPTER_TIMEOUT_SECONDS,
        )
        
        if not analysis_result:
            raise HTTPException(status_code=500, detail="剧情分析失败")
        
        # 保存分析结果到数据库
        plot_analysis = PlotAnalysis(
            id=str(uuid.uuid4()),
            project_id=project_id,
            chapter_id=chapter_id,
            plot_stage=analysis_result.get('plot_stage'),
            conflict_level=analysis_result.get('conflict', {}).get('level'),
            conflict_types=analysis_result.get('conflict', {}).get('types'),
            emotional_tone=analysis_result.get('emotional_arc', {}).get('primary_emotion'),
            emotional_intensity=analysis_result.get('emotional_arc', {}).get('intensity', 0) / 10,
            emotional_curve=analysis_result.get('emotional_arc'),
            hooks=analysis_result.get('hooks'),
            hooks_count=len(analysis_result.get('hooks', [])),
            hooks_avg_strength=sum(h.get('strength', 0) for h in analysis_result.get('hooks', [])) / max(len(analysis_result.get('hooks', [])), 1),
            foreshadows=analysis_result.get('foreshadows'),
            foreshadows_planted=sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'planted'),
            foreshadows_resolved=sum(1 for f in analysis_result.get('foreshadows', []) if f.get('type') == 'resolved'),
            plot_points=analysis_result.get('plot_points'),
            plot_points_count=len(analysis_result.get('plot_points', [])),
            character_states=analysis_result.get('character_states'),
            scenes=analysis_result.get('scenes'),
            pacing=analysis_result.get('pacing'),
            dialogue_ratio=analysis_result.get('dialogue_ratio'),
            description_ratio=analysis_result.get('description_ratio'),
            overall_quality_score=analysis_result.get('scores', {}).get('overall'),
            pacing_score=analysis_result.get('scores', {}).get('pacing'),
            engagement_score=analysis_result.get('scores', {}).get('engagement'),
            coherence_score=analysis_result.get('scores', {}).get('coherence'),
            analysis_report=analyzer.generate_analysis_summary(analysis_result),
            suggestions=analysis_result.get('suggestions'),
            word_count=chapter.word_count
        )
        
        # 检查是否已存在分析记录，如有则删除
        existing_result = await db.execute(
            select(PlotAnalysis).where(PlotAnalysis.chapter_id == chapter_id)
        )
        existing_analysis = existing_result.scalar_one_or_none()
        if existing_analysis:
            await db.delete(existing_analysis)
            await db.flush()

        db.add(plot_analysis)
        await db.flush()

        # 文件真值：章节分析报告
        analysis_record = await workspace_document_service.write_document(
            user_id=effective_user_id,
            project_id=project_id,
            entity_type="analysis",
            entity_id=chapter_id,
            content=analysis_result,
            title=f"章节分析 第{chapter.chapter_number}章",
            tags=["analysis", "chapter"],
        )
        await workspace_document_service.sync_record_to_db(
            db=db,
            user_id=effective_user_id,
            project_id=project_id,
            record=analysis_record,
            status="indexed",
        )
        
        # 从分析结果中提取记忆片段
        memories_data = analyzer.extract_memories_from_analysis(
            analysis_result,
            chapter_id,
            chapter.chapter_number
        )

        # 重新分析前，先清理该章节旧记忆（关系库 + 向量库）
        old_memories_result = await db.execute(
            select(StoryMemory).where(StoryMemory.chapter_id == chapter_id)
        )
        old_memories = old_memories_result.scalars().all()
        if old_memories:
            await db.execute(delete(StoryMemory).where(StoryMemory.chapter_id == chapter_id))
            await db.flush()

        if effective_user_id:
            try:
                await memory_service.delete_chapter_memories(
                    user_id=effective_user_id,
                    project_id=project_id,
                    chapter_id=chapter_id
                )
            except Exception as vector_delete_error:
                logger.warning(f"⚠️ 清理章节向量记忆失败（继续分析）: {str(vector_delete_error)}")

        # 保存记忆到数据库和向量库
        saved_count = 0
        memory_entries = []
        for mem_data in memories_data:
            memory_id = str(uuid.uuid4())
            memory = StoryMemory(
                id=memory_id,
                project_id=project_id,
                chapter_id=chapter_id,
                memory_type=mem_data['type'],
                title=mem_data.get('title', ''),
                content=mem_data['content'],
                story_timeline=chapter.chapter_number,
                vector_id=memory_id,
                **mem_data['metadata']
            )
            db.add(memory)
            memory_entries.append((memory_id, mem_data))

        await db.flush()

        if effective_user_id:
            async def _add_vector(mid: str, md: dict) -> None:
                await memory_service.add_memory(
                    user_id=effective_user_id,
                    project_id=project_id,
                    memory_id=mid,
                    content=md['content'],
                    memory_type=md['type'],
                    metadata=md['metadata']
                )

            results = await asyncio.gather(
                *[_add_vector(mid, md) for mid, md in memory_entries],
                return_exceptions=True,
            )
            saved_count = sum(1 for r in results if not isinstance(r, Exception))
            for r in results:
                if isinstance(r, Exception):
                    logger.warning("⚠️ 向量库写入失败: %s", r)
        else:
            saved_count = len(memory_entries)

        await db.flush()

        # 文件真值：记忆片段
        for memory_id, mem_data in memory_entries:
            memory_title = str(mem_data.get("title") or mem_data.get("type") or f"记忆 {memory_id}")
            memory_markdown = _compose_memory_markdown(
                title=memory_title,
                content=str(mem_data.get("content") or ""),
                memory_type=str(mem_data.get("type") or ""),
                chapter_id=chapter_id,
                chapter_number=chapter.chapter_number or 0,
                metadata=mem_data.get("metadata", {}),
            )
            memory_record = await workspace_document_service.write_document(
                user_id=effective_user_id,
                project_id=project_id,
                entity_type="memory",
                entity_id=memory_id,
                content=memory_markdown,
                title=memory_title,
                tags=["memory", str(mem_data.get("type") or "unknown")],
            )
            await workspace_document_service.sync_record_to_db(
                db=db,
                user_id=effective_user_id,
                project_id=project_id,
                record=memory_record,
                status="indexed",
            )

        entity_changes = {
            "careers": {"updated_count": 0, "changes": []},
            "character_states": {
                "state_updated_count": 0,
                "relationship_created_count": 0,
                "relationship_updated_count": 0,
                "org_updated_count": 0,
                "changes": []
            },
            "organization_states": {"updated_count": 0, "changes": []}
        }

        # 更新角色职业 / 角色状态关系 / 组织状态
        if analysis_result.get('character_states'):
            try:
                career_update_result = await CareerUpdateService.update_careers_from_analysis(
                    db=db,
                    project_id=project_id,
                    character_states=analysis_result.get('character_states', []),
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number
                )
                entity_changes["careers"] = career_update_result
            except Exception as career_error:
                logger.error(f"⚠️ 更新角色职业失败（不影响分析结果）: {str(career_error)}", exc_info=True)

            try:
                state_update_result = await CharacterStateUpdateService.update_from_analysis(
                    db=db,
                    project_id=project_id,
                    character_states=analysis_result.get('character_states', []),
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number
                )
                entity_changes["character_states"] = state_update_result
            except Exception as state_error:
                logger.error(f"⚠️ 更新角色状态、关系和组织成员失败（不影响分析结果）: {str(state_error)}", exc_info=True)

        if analysis_result.get('organization_states'):
            try:
                org_state_result = await CharacterStateUpdateService.update_organization_states(
                    db=db,
                    project_id=project_id,
                    organization_states=analysis_result.get('organization_states', []),
                    chapter_number=chapter.chapter_number
                )
                entity_changes["organization_states"] = org_state_result
            except Exception as org_state_error:
                logger.error(f"⚠️ 更新组织自身状态失败（不影响分析结果）: {str(org_state_error)}", exc_info=True)

        # 【新增】自动更新伏笔状态
        foreshadow_stats = {"planted_count": 0, "resolved_count": 0, "created_count": 0}
        analysis_foreshadows = analysis_result.get('foreshadows', [])

        if analysis_foreshadows:
            try:
                foreshadow_stats = await foreshadow_service.auto_update_from_analysis(
                    db=db,
                    project_id=project_id,
                    chapter_id=chapter_id,
                    chapter_number=chapter.chapter_number,
                    analysis_foreshadows=analysis_foreshadows
                )
                logger.info(f"📊 伏笔自动更新: 埋入{foreshadow_stats['planted_count']}个, 回收{foreshadow_stats['resolved_count']}个")
            except Exception as fs_error:
                logger.error(f"⚠️ 伏笔自动更新失败（不影响分析结果）: {str(fs_error)}")

        await db.commit()
        logger.info(f"✅ 章节分析完成: 保存{saved_count}条记忆")

        return {
            "success": True,
            "message": f"分析完成,提取了{saved_count}条记忆",
            "analysis": plot_analysis.to_dict(),
            "memories_count": saved_count,
            "foreshadow_stats": foreshadow_stats,
            "entity_changes": entity_changes
        }
        
    except HTTPException:
        raise
    except TimeoutError:
        logger.error("❌ 章节分析超时: project_id=%s chapter_id=%s timeout=%ss", project_id, chapter_id, _ANALYZE_CHAPTER_TIMEOUT_SECONDS)
        await db.rollback()
        raise HTTPException(status_code=504, detail="章节分析超时，请稍后重试")
    except Exception as e:
        logger.error(f"❌ 章节分析失败: {str(e)}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


@router.get("/projects/{project_id}/memories")
async def get_project_memories(
    project_id: str,
    request: Request,
    memory_type: str | None = None,
    chapter_id: str | None = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """获取项目的记忆列表"""
    try:
        user_id = get_user_id(request)
        await verify_project_access(project_id, user_id, db)

        indexes = await workspace_document_service.list_index_records(
            db=db,
            user_id=user_id,
            project_id=project_id,
            entity_type="memory",
        )
        memories: list[dict[str, Any]] = []
        for idx in indexes:
            if len(memories) >= limit:
                break
            doc = await workspace_document_service.read_document(
                user_id=user_id,
                project_id=project_id,
                entity_type="memory",
                entity_id=idx.entity_id,
            )
            parsed = _extract_json_block(str(doc.get("content") or ""))
            if not parsed:
                continue
            if memory_type and str(parsed.get("memory_type") or "") != memory_type:
                continue
            if chapter_id and str(parsed.get("chapter_id") or "") != chapter_id:
                continue
            memories.append(
                {
                    "id": idx.entity_id,
                    "project_id": project_id,
                    "chapter_id": parsed.get("chapter_id"),
                    "memory_type": parsed.get("memory_type"),
                    "title": parsed.get("title"),
                    "content": parsed.get("content"),
                    "metadata": parsed.get("metadata") or {},
                    "doc_path": doc.get("doc_path"),
                    "content_source": "file",
                    "content_hash": doc.get("content_hash"),
                    "doc_updated_at": doc.get("doc_updated_at"),
                }
            )

        return {
            "success": True,
            "memories": memories,
            "total": len(memories)
        }
    except (WorkspaceSecurityError, ValueError) as e:
        logger.error(f"❌ 获取记忆失败: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ 获取记忆失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/analysis/{chapter_id}")
async def get_chapter_analysis(
    project_id: str,
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """获取章节的剧情分析"""
    try:
        user_id = get_user_id(request)
        await verify_project_access(project_id, user_id, db)

        payload = await workspace_document_service.read_document(
            user_id=user_id,
            project_id=project_id,
            entity_type="analysis",
            entity_id=chapter_id,
        )
        raw_content = str(payload.get("content") or "").strip()
        if not raw_content:
            raise HTTPException(status_code=404, detail="该章节还未进行分析")
        try:
            analysis = json.loads(raw_content)
        except json.JSONDecodeError:
            analysis = {"raw": raw_content}
        
        return {
            "success": True,
            "analysis": analysis,
            "doc_path": payload.get("doc_path"),
            "content_source": "file",
            "content_hash": payload.get("content_hash"),
            "doc_updated_at": payload.get("doc_updated_at"),
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="该章节还未进行分析")
    except (WorkspaceSecurityError, ValueError) as e:
        logger.error(f"❌ 获取分析失败: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ 获取分析失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/search")
async def search_memories(
    project_id: str,
    query: str,
    request: Request = None,
    memory_types: list[str] | None = None,
    limit: int = 10,
    api_version: str = Query(
        default="v1",
        pattern=r"^v[12]$",
        description="API 版本。v2 仅支持 min_similarity，不再接受 min_importance。",
    ),
    min_similarity: float = 0.0,
    min_importance: float | None = Query(
        default=None,
        deprecated=True,
        description="已弃用（计划于 2026-08-31 移除），请改用 min_similarity。",
    ),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = None,
):
    """语义搜索项目记忆"""
    try:
        effective_user_id = user_id if user_id else get_user_id(request) if request else "local_single_user"
        
        # 验证用户权限
        await verify_project_access(project_id, effective_user_id, db)
        await _best_effort_sync_workspace_memory_index(
            user_id=effective_user_id,
            project_id=project_id,
            db=db,
        )
        
        # 统一语义：内部只使用 min_similarity。
        # v1 兼容旧客户端：若传入已弃用的 min_importance，则作为别名映射。
        # v2 明确禁用 min_importance，避免参数语义混淆。
        if api_version == "v2" and min_importance is not None:
            raise HTTPException(
                status_code=400,
                detail="`min_importance` 已在 v2 移除，请改用 `min_similarity`。",
            )

        effective_min_similarity = min_importance if min_importance is not None else min_similarity
        if min_importance is not None:
            logger.warning(
                "⚠️ 参数 min_importance 已弃用，将于 2026-08-31 移除，请迁移到 min_similarity。"
            )

        memories = await memory_service.search_memories(
            user_id=effective_user_id,
            project_id=project_id,
            query=query,
            memory_types=memory_types,
            limit=limit,
            min_similarity=effective_min_similarity,
        )
        
        return {
            "success": True,
            "query": query,
            "memories": memories,
            "total": len(memories)
        }
        
    except Exception as e:
        logger.error(f"❌ 搜索记忆失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/foreshadows")
async def get_unresolved_foreshadows(
    project_id: str,
    request: Request,
    current_chapter: int,
    db: AsyncSession = Depends(get_db)
):
    """获取未完结的伏笔"""
    try:
        user_id = get_user_id(request)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        await _best_effort_sync_workspace_memory_index(
            user_id=user_id,
            project_id=project_id,
            db=db,
        )
        
        # 从向量库搜索
        foreshadows = await memory_service.find_unresolved_foreshadows(
            user_id=user_id,
            project_id=project_id,
            current_chapter=current_chapter
        )
        
        return {
            "success": True,
            "foreshadows": foreshadows,
            "total": len(foreshadows)
        }
        
    except Exception as e:
        logger.error(f"❌ 获取伏笔失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/stats")
async def get_memory_stats(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """获取记忆统计信息"""
    try:
        user_id = get_user_id(request)
        
        # 验证用户权限
        await verify_project_access(project_id, user_id, db)
        await _best_effort_sync_workspace_memory_index(
            user_id=user_id,
            project_id=project_id,
            db=db,
        )
        
        stats = await memory_service.get_memory_stats(
            user_id=user_id,
            project_id=project_id
        )
        
        return {
            "success": True,
            "stats": stats
        }
        
    except Exception as e:
        logger.error(f"❌ 获取统计失败: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects/{project_id}/chapters/{chapter_id}/memories")
async def delete_chapter_memories(
    project_id: str,
    chapter_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """删除章节的所有记忆"""
    try:
        user_id = get_user_id(request)
        await verify_project_access(project_id, user_id, db)

        # 从数据库删除（运行态兼容）
        result = await db.execute(
            select(StoryMemory).where(
                and_(
                    StoryMemory.project_id == project_id,
                    StoryMemory.chapter_id == chapter_id
                )
            )
        )
        memories = result.scalars().all()
        for memory in memories:
            await db.delete(memory)

        # 删除文件真值中的记忆文档
        deleted_file_count = 0
        indexes = await workspace_document_service.list_index_records(
            db=db,
            user_id=user_id,
            project_id=project_id,
            entity_type="memory",
            include_stale=False,
        )
        workspace = workspace_document_service.workspace_dir(user_id, project_id)
        for idx in indexes:
            try:
                doc_payload = await workspace_document_service.read_document(
                    user_id=user_id,
                    project_id=project_id,
                    entity_type="memory",
                    entity_id=idx.entity_id,
                )
            except FileNotFoundError:
                continue
            parsed = _extract_json_block(str(doc_payload.get("content") or ""))
            if not parsed:
                continue
            if str(parsed.get("chapter_id") or "") != chapter_id:
                continue

            relative_path = str(idx.doc_path or "").strip()
            if not relative_path:
                continue
            target = (workspace / relative_path).resolve()
            if not str(target).startswith(str(workspace.resolve())):
                continue
            if target.exists() and target.is_file():
                target.unlink()
                deleted_file_count += 1

        # 重扫并标记 stale
        records = await workspace_document_service.rescan_workspace(
            user_id=user_id,
            project_id=project_id,
        )
        sync_stats = await workspace_document_service.sync_records_to_db(
            db=db,
            user_id=user_id,
            project_id=project_id,
            records=records,
            status="pending",
            mark_stale=True,
        )

        # 从向量库删除
        await memory_service.delete_chapter_memories(
            user_id=user_id,
            project_id=project_id,
            chapter_id=chapter_id
        )
        await db.commit()

        return {
            "success": True,
            "message": f"已删除{len(memories)}条数据库记忆与{deleted_file_count}个文件记忆",
            "deleted_db_count": len(memories),
            "deleted_file_count": deleted_file_count,
            "index_sync": sync_stats,
        }
    except WorkspaceSecurityError as e:
        logger.error(f"❌ 删除记忆失败(路径安全): {str(e)}")
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"❌ 删除记忆失败: {str(e)}")
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
