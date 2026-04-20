"""自动组织引入服务 - 预测分析+生成"""
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json

from app.gateway.novel_migrated.models.project import Project
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService
from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class AutoOrganizationService:

    def __init__(self, ai_service: AIService):
        self.ai_service = ai_service

    async def analyze_need_for_new_organizations(
        self, project: Project, chapter_count: int, start_chapter: int,
        plot_stage: str, story_direction: str, db: AsyncSession,
        provider: Optional[str] = None, model: Optional[str] = None
    ) -> Dict[str, Any]:
        characters_result = await db.execute(
            select(Character).where(Character.project_id == project.id, Character.is_organization == True))
        organizations = characters_result.scalars().all()
        existing_orgs = "\n".join([
            f"- {o.name} ({o.organization_type or '组织'}): {o.organization_purpose[:80] if o.organization_purpose else '暂无'}"
            for o in organizations
        ]) if organizations else "暂无组织"

        chapters_result = await db.execute(
            select(Chapter.chapter_number, Chapter.title, Chapter.summary)
            .where(Chapter.project_id == project.id, Chapter.content != None, Chapter.content != "")
            .order_by(Chapter.chapter_number))
        chapters = chapters_result.all()
        all_chapters_brief = "\n".join([
            f"第{n}章《{t}》：{s[:80] if s else '暂无'}" for n, t, s in chapters
        ]) if chapters else "暂无已生成章节"

        template = PromptService.AUTO_ORGANIZATION_ANALYSIS
        prompt = template.format(
            chapter_count=chapter_count, title=project.title or "",
            genre=project.genre or "", theme=project.theme or "",
            time_period=project.world_time_period or "未设定",
            location=project.world_location or "未设定",
            atmosphere=project.world_atmosphere or "未设定",
            existing_organizations=existing_orgs,
            all_chapters_brief=all_chapters_brief,
            start_chapter=start_chapter,
            plot_stage=plot_stage, story_direction=story_direction
        )

        accumulated = ""
        async for chunk in self.ai_service.generate_text_stream(
            prompt=prompt, provider=provider, model=model, temperature=0.3
        ):
            accumulated += chunk

        try:
            cleaned = self.ai_service._clean_json_response(accumulated)
            return json.loads(cleaned)
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Parse auto org analysis failed: {e}")
            return {"needs_new_organizations": False, "reason": f"分析失败: {str(e)}"}

    async def generate_new_organization(
        self, project: Project, organization_specification: str,
        plot_context: str, db: AsyncSession,
        provider: Optional[str] = None, model: Optional[str] = None
    ) -> Dict[str, Any]:
        characters_result = await db.execute(
            select(Character).where(Character.project_id == project.id, Character.is_organization == True))
        organizations = characters_result.scalars().all()
        existing_orgs = "\n".join([
            f"- {o.name} ({o.organization_type or '组织'}): {o.organization_purpose[:80] if o.organization_purpose else '暂无'}"
            for o in organizations
        ]) if organizations else "暂无组织"

        template = PromptService.AUTO_ORGANIZATION_GENERATION
        prompt = template.format(
            title=project.title or "", genre=project.genre or "",
            theme=project.theme or "",
            time_period=project.world_time_period or "未设定",
            location=project.world_location or "未设定",
            atmosphere=project.world_atmosphere or "未设定",
            rules=project.world_rules or "未设定",
            existing_organizations=existing_orgs,
            plot_context=plot_context,
            organization_specification=organization_specification
        )

        accumulated = ""
        async for chunk in self.ai_service.generate_text_stream(
            prompt=prompt, provider=provider, model=model, temperature=0.7
        ):
            accumulated += chunk

        try:
            cleaned = self.ai_service._clean_json_response(accumulated)
            return json.loads(cleaned)
        except (json.JSONDecodeError, Exception) as e:
            logger.error(f"Parse auto org generation failed: {e}")
            return {"error": f"生成失败: {str(e)}", "raw_response": accumulated[:500]}


_auto_org_service = None

def get_auto_organization_service(ai_service: AIService) -> AutoOrganizationService:
    global _auto_org_service
    if _auto_org_service is None:
        _auto_org_service = AutoOrganizationService(ai_service)
    return _auto_org_service
