"""大纲剧情展开服务 - 将大纲节点展开为多个章节"""
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import json

from app.gateway.novel_migrated.models.outline import Outline
from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService
from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class PlotExpansionService:

    def __init__(self, ai_service: AIService):
        self.ai_service = ai_service

    async def analyze_outline_for_chapters(
        self, outline: Outline, project: Project, db: AsyncSession,
        target_chapter_count: int = 3, expansion_strategy: str = "balanced",
        enable_scene_analysis: bool = True, provider: Optional[str] = None,
        model: Optional[str] = None, batch_size: int = 5,
        progress_callback=None
    ) -> List[Dict[str, Any]]:
        logger.info(f"Analyzing outline {outline.id}, target {target_chapter_count} chapters")
        if target_chapter_count <= batch_size:
            return await self._generate_chapters_single_batch(
                outline, project, db, target_chapter_count, expansion_strategy,
                enable_scene_analysis, provider, model)
        return await self._generate_chapters_in_batches(
            outline, project, db, target_chapter_count, expansion_strategy,
            enable_scene_analysis, provider, model, batch_size, progress_callback)

    async def _generate_chapters_single_batch(
        self, outline, project, db, target_chapter_count, expansion_strategy,
        enable_scene_analysis, provider, model
    ) -> List[Dict[str, Any]]:
        characters_result = await db.execute(select(Character).where(Character.project_id == project.id))
        characters = characters_result.scalars().all()
        characters_info = "\n".join([
            f"- {c.name} ({'组织' if c.is_organization else '角色'}, {c.role_type}): "
            f"{c.personality[:100] if c.personality else '暂无描述'}"
            for c in characters
        ])
        context_info = await self._get_outline_context(outline, project.id, db)

        template = PromptService.OUTLINE_EXPAND_SINGLE
        prompt = template.format(
            project_title=project.title, project_genre=project.genre or '通用',
            project_theme=project.theme or '未设定',
            project_narrative_perspective=project.narrative_perspective or '第三人称',
            project_world_time_period=project.world_time_period or '未设定',
            project_world_location=project.world_location or '未设定',
            project_world_atmosphere=project.world_atmosphere or '未设定',
            characters_info=characters_info or '暂无角色',
            outline_order_index=outline.order_index, outline_title=outline.title,
            outline_content=outline.content, context_info=context_info,
            strategy_instruction=expansion_strategy,
            target_chapter_count=target_chapter_count
        )

        accumulated_text = ""
        async for chunk in self.ai_service.generate_text_stream(prompt=prompt, provider=provider, model=model):
            accumulated_text += chunk

        return self._parse_expansion_response(accumulated_text, outline.id)

    async def _generate_chapters_in_batches(
        self, outline, project, db, target_chapter_count, expansion_strategy,
        enable_scene_analysis, provider, model, batch_size, progress_callback
    ) -> List[Dict[str, Any]]:
        total_batches = (target_chapter_count + batch_size - 1) // batch_size
        logger.info(f"Batch plan: {target_chapter_count} chapters in {total_batches} batches")

        characters_result = await db.execute(select(Character).where(Character.project_id == project.id))
        characters = characters_result.scalars().all()
        characters_info = "\n".join([
            f"- {c.name} ({'组织' if c.is_organization else '角色'}, {c.role_type}): "
            f"{c.personality[:100] if c.personality else '暂无描述'}"
            for c in characters
        ])
        context_info = await self._get_outline_context(outline, project.id, db)
        all_plans = []

        for batch_num in range(total_batches):
            remaining = target_chapter_count - len(all_plans)
            current_batch_size = min(batch_size, remaining)
            current_start_index = len(all_plans) + 1

            if progress_callback:
                await progress_callback(batch_num + 1, total_batches, current_start_index, current_batch_size)

            previous_context = ""
            if all_plans:
                summaries = []
                used_events = []
                for ch in all_plans:
                    ke_str = "、".join(ch.get('key_events', [])[:3])
                    summaries.append(f"第{ch['sub_index']}节《{ch['title']}》: {ch.get('plot_summary', '')[:150]} (关键事件：{ke_str})")
                    used_events.extend(ch.get('key_events', []))
                used_str = "、".join(used_events[-20:]) if used_events else "暂无"
                previous_context = f"【已生成章节】\n{chr(10).join(summaries)}\n\n【已使用的关键事件（不可重复）】\n{used_str}"

            template = PromptService.OUTLINE_EXPAND_MULTI
            prompt = template.format(
                project_title=project.title, project_genre=project.genre or '通用',
                project_theme=project.theme or '未设定',
                project_narrative_perspective=project.narrative_perspective or '第三人称',
                project_world_time_period=project.world_time_period or '未设定',
                project_world_location=project.world_location or '未设定',
                project_world_atmosphere=project.world_atmosphere or '未设定',
                characters_info=characters_info or '暂无角色',
                outline_order_index=outline.order_index, outline_title=outline.title,
                outline_content=outline.content, context_info=context_info,
                previous_context=previous_context,
                strategy_instruction=expansion_strategy,
                start_index=current_start_index,
                end_index=current_start_index + current_batch_size - 1,
                target_chapter_count=current_batch_size
            )

            accumulated_text = ""
            async for chunk in self.ai_service.generate_text_stream(prompt=prompt, provider=provider, model=model):
                accumulated_text += chunk

            batch_plans = self._parse_expansion_response(accumulated_text, outline.id)
            for i, plan in enumerate(batch_plans):
                plan["sub_index"] = current_start_index + i
            all_plans.extend(batch_plans)

        return all_plans

    async def create_chapters_from_plans(
        self, outline_id: str, chapter_plans: List[Dict[str, Any]],
        project_id: str, db: AsyncSession, start_chapter_number: int = None
    ) -> List[Chapter]:
        logger.info(f"Creating {len(chapter_plans)} chapters from plans")

        if start_chapter_number is None:
            outline_result = await db.execute(select(Outline).where(Outline.id == outline_id))
            current_outline = outline_result.scalar_one_or_none()
            if not current_outline:
                raise ValueError(f"Outline {outline_id} not found")

            prev_result = await db.execute(
                select(Outline).where(Outline.project_id == project_id,
                                      Outline.order_index < current_outline.order_index)
                .order_by(Outline.order_index))
            prev_outlines = prev_result.scalars().all()
            total_prev = 0
            for po in prev_outlines:
                cr = await db.execute(
                    select(func.count(Chapter.id)).where(
                        Chapter.project_id == project_id, Chapter.outline_id == po.id))
                total_prev += cr.scalar() or 0
            start_chapter_number = total_prev + 1

        chapters = []
        for idx, plan in enumerate(chapter_plans):
            expansion_plan_json = json.dumps({
                "key_events": plan.get("key_events", []),
                "character_focus": plan.get("character_focus", []),
                "emotional_tone": plan.get("emotional_tone", ""),
                "narrative_goal": plan.get("narrative_goal", ""),
                "conflict_type": plan.get("conflict_type", ""),
                "estimated_words": plan.get("estimated_words", 3000),
            }, ensure_ascii=False)

            chapter = Chapter(
                project_id=project_id, outline_id=outline_id,
                chapter_number=start_chapter_number + idx,
                sub_index=plan.get("sub_index", idx + 1),
                title=plan.get("title", f"第{start_chapter_number + idx}章"),
                summary=plan.get("plot_summary", ""),
                expansion_plan=expansion_plan_json,
                status="draft"
            )
            db.add(chapter)
            chapters.append(chapter)

        await db.commit()
        for ch in chapters:
            await db.refresh(ch)

        await self._renumber_subsequent_chapters(project_id, outline_id, db)
        return chapters

    async def _get_outline_context(self, outline, project_id, db):
        prev_result = await db.execute(
            select(Outline).where(Outline.project_id == project_id,
                                  Outline.order_index < outline.order_index)
            .order_by(Outline.order_index.desc()).limit(1))
        prev_outline = prev_result.scalar_one_or_none()

        next_result = await db.execute(
            select(Outline).where(Outline.project_id == project_id,
                                  Outline.order_index > outline.order_index)
            .order_by(Outline.order_index).limit(1))
        next_outline = next_result.scalar_one_or_none()

        context = ""
        if prev_outline:
            context += f"【前一节】{prev_outline.title}: {prev_outline.content[:200]}...\n\n"
        if next_outline:
            context += f"【后一节】{next_outline.title}: {next_outline.content[:200]}...\n"
        return context if context else "（无前后文）"

    def _parse_expansion_response(self, ai_response: str, outline_id: str) -> List[Dict[str, Any]]:
        try:
            cleaned = self.ai_service._clean_json_response(ai_response)
            plans = json.loads(cleaned)
            if not isinstance(plans, list):
                plans = [plans]
            for idx, plan in enumerate(plans):
                plan["outline_id"] = outline_id
                if "ending_type" not in plan:
                    ng = plan.get("narrative_goal", "")
                    if "悬念" in ng: plan["ending_type"] = "悬念"
                    elif "冲突" in ng: plan["ending_type"] = "冲突升级"
                    elif "转折" in ng: plan["ending_type"] = "情节转折"
                    else: plan["ending_type"] = f"自然过渡-{idx + 1}"
                if not plan.get("key_events"):
                    plan["key_events"] = [f"章节{idx + 1}核心事件"]
            return plans
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Parse expansion response failed: {e}")
            return [{
                "outline_id": outline_id, "sub_index": 1,
                "title": "默认章节", "plot_summary": ai_response[:500],
                "key_events": ["解析失败"], "character_focus": [],
                "emotional_tone": "未知", "narrative_goal": "需要重新生成",
                "conflict_type": "未知", "ending_type": "未知", "estimated_words": 3000
            }]

    async def _renumber_subsequent_chapters(self, project_id, current_outline_id, db):
        current_result = await db.execute(select(Outline).where(Outline.id == current_outline_id))
        current_outline = current_result.scalar_one_or_none()
        if not current_outline: return

        prev_result = await db.execute(
            select(Outline).where(Outline.project_id == project_id,
                                  Outline.order_index < current_outline.order_index)
            .order_by(Outline.order_index))
        prev_outlines = prev_result.scalars().all()
        current_chapter_number = 1
        for po in prev_outlines:
            cr = await db.execute(
                select(func.count(Chapter.id)).where(
                    Chapter.project_id == project_id, Chapter.outline_id == po.id))
            current_chapter_number += cr.scalar() or 0

        subsequent_result = await db.execute(
            select(Outline).where(Outline.project_id == project_id,
                                  Outline.order_index >= current_outline.order_index)
            .order_by(Outline.order_index))
        for outline in subsequent_result.scalars().all():
            ch_result = await db.execute(
                select(Chapter).where(Chapter.project_id == project_id,
                                      Chapter.outline_id == outline.id)
                .order_by(Chapter.sub_index))
            for ch in ch_result.scalars().all():
                if ch.chapter_number != current_chapter_number:
                    ch.chapter_number = current_chapter_number
                current_chapter_number += 1
        await db.commit()


def create_plot_expansion_service(ai_service: AIService) -> PlotExpansionService:
    return PlotExpansionService(ai_service)
