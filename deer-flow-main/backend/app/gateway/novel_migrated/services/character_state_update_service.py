"""角色状态更新服务 - 从章节分析自动更新角色状态/关系/组织成员"""
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json

from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.models.relationship import CharacterRelationship, Organization, OrganizationMember
from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class CharacterStateUpdateService:

    async def update_character_states_from_analysis(
        self, analysis: PlotAnalysis, project_id: str, db: AsyncSession
    ) -> Dict[str, Any]:
        result = {"characters_updated": 0, "relationships_updated": 0, "org_memberships_updated": 0}
        if not analysis or not analysis.character_states:
            return result

        try:
            character_states = analysis.character_states
            if isinstance(character_states, str):
                character_states = json.loads(character_states)

            if not isinstance(character_states, list):
                return result

            characters_result = await db.execute(
                select(Character).where(Character.project_id == project.id))
            characters_map = {c.name: c for c in characters_result.scalars().all()}

            for state in character_states:
                char_name = state.get("name", "")
                character = characters_map.get(char_name)
                if not character:
                    continue

                updated = False
                if state.get("current_state") and character.current_state != state["current_state"]:
                    character.current_state = state["current_state"]
                    updated = True

                if state.get("personality_development"):
                    existing = character.personality or ""
                    new_personality = f"{existing}\n[发展] {state['personality_development']}" if existing else state['personality_development']
                    if len(new_personality) <= 2000:
                        character.personality = new_personality
                        updated = True

                if updated:
                    result["characters_updated"] += 1

            if result["characters_updated"] > 0:
                await db.commit()

        except Exception as e:
            logger.error(f"Update character states failed: {e}")
            await db.rollback()

        return result

    async def update_relationships_from_analysis(
        self, analysis: PlotAnalysis, project_id: str, db: AsyncSession
    ) -> Dict[str, Any]:
        result = {"relationships_updated": 0}
        if not analysis:
            return result

        try:
            suggestions = analysis.suggestions
            if isinstance(suggestions, str):
                suggestions = json.loads(suggestions)

            if not isinstance(suggestions, list):
                return result

            characters_result = await db.execute(
                select(Character).where(Character.project_id == project_id))
            characters_map = {c.name: c for c in characters_result.scalars().all()}

            for suggestion in suggestions:
                if not isinstance(suggestion, dict):
                    continue
                if suggestion.get("type") != "relationship_change":
                    continue

                char1_name = suggestion.get("character1", "")
                char2_name = suggestion.get("character2", "")
                new_type = suggestion.get("new_relationship_type", "")

                char1 = characters_map.get(char1_name)
                char2 = characters_map.get(char2_name)
                if not char1 or not char2 or not new_type:
                    continue

                existing = await db.execute(
                    select(CharacterRelationship).where(
                        CharacterRelationship.project_id == project_id,
                        CharacterRelationship.character_from_id == char1.id,
                        CharacterRelationship.character_to_id == char2.id
                    ))
                rel = existing.scalar_one_or_none()
                if rel:
                    rel.relationship_name = new_type
                    result["relationships_updated"] += 1

            if result["relationships_updated"] > 0:
                await db.commit()

        except Exception as e:
            logger.error(f"Update relationships failed: {e}")
            await db.rollback()

        return result

    async def update_all_from_analysis(
        self, analysis: PlotAnalysis, project_id: str, db: AsyncSession
    ) -> Dict[str, Any]:
        char_result = await self.update_character_states_from_analysis(analysis, project_id, db)
        rel_result = await self.update_relationships_from_analysis(analysis, project_id, db)
        return {
            "characters_updated": char_result["characters_updated"],
            "relationships_updated": rel_result["relationships_updated"]
        }


_character_state_update_service = None

def get_character_state_update_service() -> CharacterStateUpdateService:
    global _character_state_update_service
    if _character_state_update_service is None:
        _character_state_update_service = CharacterStateUpdateService()
    return _character_state_update_service
