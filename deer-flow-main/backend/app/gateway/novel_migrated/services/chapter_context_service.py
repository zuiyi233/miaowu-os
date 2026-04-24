"""章节上下文构建服务 - 实现RTCO框架的智能上下文构建"""
# ruff: noqa: E701, UP006, UP035, UP045

import json
from dataclasses import dataclass, field
from typing import Any, ClassVar, Dict, List, Optional

from sqlalchemy import or_, select

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.career import Career, CharacterCareer
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.character import Character
from app.gateway.novel_migrated.models.memory import StoryMemory
from app.gateway.novel_migrated.models.relationship import CharacterRelationship, Organization, OrganizationMember

logger = get_logger(__name__)


@dataclass
class BaseChapterContext:
    chapter_outline: str = ""
    target_word_count: int = 3000
    narrative_perspective: str = "第三人称"
    chapter_number: int = 1
    chapter_title: str = ""
    title: str = ""
    genre: str = ""
    theme: str = ""
    chapter_characters: str = ""
    chapter_careers: Optional[str] = None
    foreshadow_reminders: Optional[str] = None
    relevant_memories: Optional[str] = None
    context_stats: Dict[str, Any] = field(default_factory=dict)

    _LENGTH_FIELDS: ClassVar[tuple[str, ...]] = ()

    def get_total_context_length(self) -> int:
        total = 0
        for field_name in self._LENGTH_FIELDS:
            field_value = getattr(self, field_name, None)
            if field_value:
                total += len(field_value)
        return total


@dataclass
class OneToManyContext(BaseChapterContext):
    chapter_outline: str = ""
    recent_chapters_context: Optional[str] = None
    continuation_point: Optional[str] = None
    previous_chapter_summary: Optional[str] = None
    previous_chapter_events: Optional[List[str]] = None
    emotional_tone: str = ""
    _LENGTH_FIELDS: ClassVar[tuple[str, ...]] = (
        "chapter_outline",
        "recent_chapters_context",
        "continuation_point",
        "chapter_characters",
        "chapter_careers",
        "relevant_memories",
        "foreshadow_reminders",
        "previous_chapter_summary",
    )


@dataclass
class OneToOneContext(BaseChapterContext):
    chapter_outline: str = ""
    continuation_point: Optional[str] = None
    previous_chapter_summary: Optional[str] = None
    _LENGTH_FIELDS: ClassVar[tuple[str, ...]] = (
        "chapter_outline",
        "continuation_point",
        "previous_chapter_summary",
        "chapter_characters",
        "chapter_careers",
        "foreshadow_reminders",
        "relevant_memories",
    )


class OneToManyContextBuilder:
    ENDING_LENGTH = 500
    MEMORY_COUNT = 10
    MEMORY_SIMILARITY_THRESHOLD = 0.6
    RECENT_CHAPTERS_COUNT = 10

    def __init__(self, memory_service=None, foreshadow_service=None):
        self.memory_service = memory_service
        self.foreshadow_service = foreshadow_service

    async def build(self, chapter, project, outline, user_id, db,
                    style_content=None, target_word_count=3000,
                    temp_narrative_perspective=None) -> OneToManyContext:
        cn = chapter.chapter_number
        np_ = temp_narrative_perspective or project.narrative_perspective or "第三人称"
        ctx = OneToManyContext(
            chapter_number=cn, chapter_title=chapter.title or "",
            title=project.title or "", genre=project.genre or "", theme=project.theme or "",
            target_word_count=target_word_count, narrative_perspective=np_)

        ctx.chapter_outline = self._build_chapter_outline_1n(chapter, outline)
        if cn > 1:
            ctx.recent_chapters_context = await self._build_recent_chapters_context(chapter, project.id, db)
            ending = await self._get_last_ending_enhanced(chapter, db, self.ENDING_LENGTH)
            ctx.continuation_point = ending.get('ending_text')
            ctx.previous_chapter_summary = ending.get('summary')
            ctx.previous_chapter_events = ending.get('key_events')

        chars_info, careers_info = await self._build_chapter_characters_1n(chapter, project, outline, db)
        ctx.chapter_characters = chars_info
        ctx.chapter_careers = careers_info
        ctx.emotional_tone = self._extract_emotional_tone(chapter, outline)

        if self.memory_service:
            ctx.relevant_memories = await self._get_relevant_memories_enhanced(
                user_id, project.id, cn, ctx.chapter_outline, db)
        if self.foreshadow_service:
            ctx.foreshadow_reminders = await self._get_foreshadow_reminders(project.id, cn, db)

        ctx.context_stats = {"mode": "one-to-many", "chapter_number": cn,
                             "total_length": ctx.get_total_context_length()}
        return ctx

    def _build_chapter_outline_1n(self, chapter, outline):
        if chapter.expansion_plan:
            try:
                plan = json.loads(chapter.expansion_plan)
                return (f"剧情摘要：{plan.get('plot_summary') or chapter.summary or '无'}\n\n"
                        f"关键事件：\n{chr(10).join(f'- {e}' for e in plan.get('key_events', []))}\n\n"
                        f"角色焦点：{', '.join(plan.get('character_focus', []))}\n"
                        f"情感基调：{plan.get('emotional_tone', '未设定')}\n"
                        f"叙事目标：{plan.get('narrative_goal', '未设定')}\n"
                        f"冲突类型：{plan.get('conflict_type', '未设定')}")
            except json.JSONDecodeError:
                pass
        return outline.content if outline else chapter.summary or '暂无大纲'

    async def _build_chapter_characters_1n(self, chapter, project, outline, db):
        res = await db.execute(select(Character).where(Character.project_id == project.id))
        all_chars = res.scalars().all()
        if not all_chars:
            return "暂无角色信息", None

        char_map = {c.id: c.name for c in all_chars}
        filter_names = None
        if chapter.expansion_plan:
            try:
                plan = json.loads(chapter.expansion_plan)
                filter_names = plan.get('character_focus', [])
            except json.JSONDecodeError:
                pass

        chars = [c for c in all_chars if c.name in filter_names] if filter_names else all_chars
        if not chars:
            return "暂无相关角色", None
        chars = chars[:10]
        char_ids = [c.id for c in chars]

        rels_res = await db.execute(
            select(CharacterRelationship).where(
                CharacterRelationship.project_id == project.id,
                or_(CharacterRelationship.character_from_id.in_(char_ids),
                    CharacterRelationship.character_to_id.in_(char_ids))))
        rels_map: Dict[str, list] = {cid: [] for cid in char_ids}
        for r in rels_res.scalars().all():
            if r.character_from_id in rels_map:
                rels_map[r.character_from_id].append(r)
            if r.character_to_id in rels_map:
                rels_map[r.character_to_id].append(r)

        non_org_ids = [c.id for c in chars if not c.is_organization]
        org_mem_map: Dict[str, list] = {cid: [] for cid in non_org_ids}
        if non_org_ids:
            mem_res = await db.execute(
                select(OrganizationMember, Character.name).join(
                    Organization, OrganizationMember.organization_id == Organization.id
                ).join(Character, Organization.character_id == Character.id
                       ).where(OrganizationMember.character_id.in_(non_org_ids)))
            for m, on in mem_res.all():
                if m.character_id in org_mem_map:
                    org_mem_map[m.character_id].append((m, on))

        cc_res = await db.execute(select(CharacterCareer).where(CharacterCareer.character_id.in_(char_ids)))
        all_cc = cc_res.scalars().all()
        career_ids = {cc.career_id for cc in all_cc}
        for c in chars:
            if not c.is_organization and c.main_career_id:
                career_ids.add(c.main_career_id)
        careers_map = {}
        if career_ids:
            cr = await db.execute(select(Career).where(Career.id.in_(list(career_ids))))
            careers_map = {c.id: c for c in cr.scalars().all()}

        cc_rel: Dict[str, Dict[str, list]] = {}
        for cc in all_cc:
            cc_rel.setdefault(cc.character_id, {'main': [], 'sub': []})
            cc_rel[cc.character_id]['main' if cc.career_type == 'main' else 'sub'].append(cc)

        parts = []
        for c in chars:
            et = '组织' if c.is_organization else '角色'
            rt = {'protagonist': '主角', 'antagonist': '反派', 'supporting': '配角'}.get(c.role_type, c.role_type or '配角')
            lines = [f"【{c.name}】({et}, {rt})"]
            if c.age: lines.append(f"  年龄: {c.age}")
            if c.gender: lines.append(f"  性别: {c.gender}")
            if c.appearance: lines.append(f"  外貌: {c.appearance[:100]}")
            if c.personality: lines.append(f"  性格: {c.personality[:100]}")
            if c.background: lines.append(f"  背景: {c.background[:150]}")

            if c.id in cc_rel:
                for cc in cc_rel[c.id]['main']:
                    car = careers_map.get(cc.career_id)
                    if car: lines.append(f"  主职业: {car.name} ({cc.current_stage}/{car.max_stage}阶)")
                for cc in cc_rel[c.id]['sub']:
                    car = careers_map.get(cc.career_id)
                    if car: lines.append(f"  副职业: {car.name} ({cc.current_stage}/{car.max_stage}阶)")
            elif not c.is_organization and c.main_career_id:
                car = careers_map.get(c.main_career_id)
                if car: lines.append(f"  主职业: {car.name}（第{c.main_career_stage or 1}阶段）")

            if not c.is_organization and c.id in rels_map and rels_map[c.id]:
                rp = []
                for r in rels_map[c.id]:
                    tn = char_map.get(r.character_to_id if r.character_from_id == c.id else r.character_from_id, "未知")
                    rp.append(f"与{tn}：{r.relationship_name or '相关'}")
                lines.append(f"  关系网络: {'；'.join(rp)}")

            if not c.is_organization and c.id in org_mem_map and org_mem_map[c.id]:
                op = [f"{on}（{m.position}）" for m, on in org_mem_map[c.id][:2]]
                lines.append(f"  组织归属: {'、'.join(op)}")

            if c.is_organization:
                if c.organization_type: lines.append(f"  组织类型: {c.organization_type}")
                if c.organization_purpose: lines.append(f"  组织目的: {c.organization_purpose[:100]}")

            parts.append("\n".join(lines))

        chars_str = "\n\n".join(parts)
        careers_parts = []
        for cid, car in careers_map.items():
            cl = [f"{car.name} ({car.type}职业)"]
            if car.description: cl.append(f"  描述: {car.description}")
            try:
                stages = json.loads(car.stages) if isinstance(car.stages, str) else car.stages
                if stages:
                    cl.append(f"  阶段体系: (共{car.max_stage}阶)")
                    for s in stages:
                        cl.append(f"    {s.get('level', '?')}阶-{s.get('name', '未命名')}: {s.get('description', '')}")
            except (json.JSONDecodeError, AttributeError, TypeError):
                cl.append(f"  阶段体系: 共{car.max_stage}阶")
            if car.special_abilities: cl.append(f"  特殊能力: {car.special_abilities}")
            careers_parts.append("\n".join(cl))

        return chars_str, "\n\n".join(careers_parts) if careers_parts else None

    async def _build_recent_chapters_context(self, chapter, project_id, db):
        try:
            res = await db.execute(
                select(Chapter.chapter_number, Chapter.title, Chapter.expansion_plan, Chapter.summary)
                .where(Chapter.project_id == project_id, Chapter.chapter_number < chapter.chapter_number)
                .order_by(Chapter.chapter_number.desc()).limit(self.RECENT_CHAPTERS_COUNT))
            rows = sorted(res.all(), key=lambda x: x[0])
            if not rows: return None
            lines = ["【最近章节规划】"]
            for n, t, ep, s in rows:
                if ep:
                    try:
                        p = json.loads(ep)
                        line = f"第{n}章《{t}》：{p.get('plot_summary', '')}"
                        ke = p.get('key_events', [])
                        if ke: line += f"（关键事件：{'；'.join(ke[:3])}）"
                        lines.append(line)
                    except json.JSONDecodeError:
                        if s: lines.append(f"第{n}章《{t}》：{s[:100]}")
                elif s:
                    lines.append(f"第{n}章《{t}》：{s[:100]}")
            return "\n".join(lines) if len(lines) > 1 else None
        except Exception as e:
            logger.error(f"Recent chapters context failed: {e}")
            return None

    async def _get_relevant_memories_enhanced(self, user_id, project_id, cn, outline, db):
        if not self.memory_service: return None
        try:
            q = outline[:500].replace('\n', ' ')
            mems = await self.memory_service.search_memories(user_id=user_id, project_id=project_id, query=q, limit=15, min_importance=0.0)
            filtered = [m for m in mems if m.get('similarity', 0) > self.MEMORY_SIMILARITY_THRESHOLD]
            if not filtered: return None
            lines = ["【相关记忆】"]
            for m in filtered[:self.MEMORY_COUNT]:
                lines.append(f"- (相关度:{m.get('similarity', 0):.2f}) {m.get('content', '')[:100]}")
            return "\n".join(lines) if len(lines) > 1 else None
        except Exception as e:
            logger.error(f"Relevant memories failed: {e}")
            return None

    async def _get_last_ending_enhanced(self, chapter, db, max_length):
        info = {'ending_text': None, 'summary': None, 'key_events': []}
        if chapter.chapter_number <= 1: return info
        res = await db.execute(
            select(Chapter).where(Chapter.project_id == chapter.project_id,
                                  Chapter.chapter_number < chapter.chapter_number)
            .order_by(Chapter.chapter_number.desc()).limit(1))
        prev = res.scalar_one_or_none()
        if not prev: return info
        if prev.content:
            c = prev.content.strip()
            info['ending_text'] = c if len(c) <= max_length else c[-max_length:]
        sr = await db.execute(
            select(StoryMemory.content).where(StoryMemory.project_id == chapter.project_id,
                                              StoryMemory.chapter_id == prev.id,
                                              StoryMemory.memory_type == 'chapter_summary').limit(1))
        sm = sr.scalar_one_or_none()
        if sm: info['summary'] = sm[:300]
        elif prev.summary: info['summary'] = prev.summary[:300]
        if prev.expansion_plan:
            try:
                p = json.loads(prev.expansion_plan)
                if p.get('key_events'): info['key_events'] = p['key_events'][:5]
            except json.JSONDecodeError: pass
        return info

    def _extract_emotional_tone(self, chapter, outline):
        if chapter.expansion_plan:
            try:
                p = json.loads(chapter.expansion_plan)
                if p.get('emotional_tone'): return p['emotional_tone']
            except json.JSONDecodeError: pass
        if outline and outline.structure:
            try:
                s = json.loads(outline.structure)
                t = s.get('emotion') or s.get('emotional_tone')
                if t: return t
            except json.JSONDecodeError: pass
        return "未设定"

    async def _get_foreshadow_reminders(self, project_id, cn, db):
        if not self.foreshadow_service: return None
        try:
            lines = []
            must = await self.foreshadow_service.get_must_resolve_foreshadows(db=db, project_id=project_id, chapter_number=cn)
            if must:
                lines.append("【本章必须回收的伏笔】")
                for f in must:
                    lines.append(f"- {f.title}\n  埋入章节：第{f.plant_chapter_number}章\n  伏笔内容：{f.content[:100]}{'...' if len(f.content) > 100 else ''}")
            overdue = await self.foreshadow_service.get_overdue_foreshadows(db=db, project_id=project_id, current_chapter=cn)
            if overdue:
                lines.append("【超期待回收伏笔】")
                for f in overdue[:3]:
                    oc = cn - (f.target_resolve_chapter_number or 0)
                    lines.append(f"- {f.title} [已超期{oc}章]\n  埋入章节：第{f.plant_chapter_number}章")
            return "\n".join(lines) if lines else None
        except Exception as e:
            logger.error(f"Foreshadow reminders failed: {e}")
            return None


class OneToOneContextBuilder:
    def __init__(self, memory_service=None, foreshadow_service=None):
        self.memory_service = memory_service
        self.foreshadow_service = foreshadow_service

    async def build(self, chapter, project, outline, user_id, db, target_word_count=3000) -> OneToOneContext:
        cn = chapter.chapter_number
        ctx = OneToOneContext(
            chapter_number=cn, chapter_title=chapter.title or "",
            title=project.title or "", genre=project.genre or "", theme=project.theme or "",
            target_word_count=target_word_count,
            narrative_perspective=project.narrative_perspective or "第三人称")

        ctx.chapter_outline = self._build_outline_from_structure(outline, chapter)

        if cn > 1:
            pr = await db.execute(
                select(Chapter).where(Chapter.project_id == chapter.project_id,
                                      Chapter.chapter_number < cn)
                .order_by(Chapter.chapter_number.desc()).limit(1))
            prev = pr.scalar_one_or_none()
            if prev and prev.content:
                c = prev.content.strip()
                ctx.continuation_point = c if len(c) <= 500 else c[-500:]
                sr = await db.execute(
                    select(StoryMemory.content).where(StoryMemory.project_id == chapter.project_id,
                                                      StoryMemory.chapter_id == prev.id,
                                                      StoryMemory.memory_type == 'chapter_summary').limit(1))
                sm = sr.scalar_one_or_none()
                ctx.previous_chapter_summary = sm[:300] if sm else (prev.summary[:300] if prev.summary else None)

        char_names = []
        if outline and outline.structure:
            try:
                s = json.loads(outline.structure)
                char_names = [c['name'] if isinstance(c, dict) else c for c in s.get('characters', [])]
            except json.JSONDecodeError: pass

        if char_names:
            cr = await db.execute(
                select(Character).where(Character.project_id == project.id, Character.name.in_(char_names)))
            chars = cr.scalars().all()
            if chars:
                ci, cai = await self._build_characters_and_careers(db, project.id, chars, char_names)
                ctx.chapter_characters = ci
                ctx.chapter_careers = cai
            else:
                ctx.chapter_characters = "暂无角色信息"
        else:
            ctx.chapter_characters = "暂无角色信息"

        if self.foreshadow_service:
            ctx.foreshadow_reminders = await self._get_foreshadow_reminders(project.id, cn, db)

        if self.memory_service and ctx.chapter_outline:
            try:
                q = ctx.chapter_outline[:500].replace('\n', ' ')
                mems = await self.memory_service.search_memories(user_id=user_id, project_id=project.id, query=q, limit=15, min_importance=0.0)
                filtered = [m for m in mems if m.get('similarity', 0) > 0.6]
                if filtered:
                    lines = ["【相关记忆】"]
                    for m in filtered[:10]:
                        lines.append(f"- (相关度:{m.get('similarity', 0):.2f}) {m.get('content', '')[:100]}")
                    ctx.relevant_memories = "\n".join(lines)
            except Exception as e:
                logger.error(f"Search memories failed: {e}")

        ctx.context_stats = {"mode": "one-to-one", "chapter_number": cn, "total_length": ctx.get_total_context_length()}
        return ctx

    def _build_outline_from_structure(self, outline, chapter):
        if outline and outline.structure:
            try:
                s = json.loads(outline.structure)
                parts = []
                if s.get('summary'): parts.append(f"【章节概要】\n{s['summary']}")
                if s.get('scenes'): parts.append(f"【场景设定】\n{chr(10).join(f'- {sc}' for sc in s['scenes'])}")
                if s.get('key_points'): parts.append(f"【情节要点】\n{chr(10).join(f'- {p}' for p in s['key_points'])}")
                if s.get('emotion'): parts.append(f"【情感基调】\n{s['emotion']}")
                if s.get('goal'): parts.append(f"【叙事目标】\n{s['goal']}")
                return "\n\n".join(parts) if parts else "暂无大纲"
            except json.JSONDecodeError: pass
        return outline.content if outline else "暂无大纲"

    async def _build_characters_and_careers(self, db, project_id, characters, filter_character_names=None):
        if not characters: return '暂无角色信息', None
        if filter_character_names:
            characters = [c for c in characters if c.name in filter_character_names] or characters
        char_ids = [c.id for c in characters[:10]]
        if not char_ids: return '暂无角色信息', None

        fc_res = await db.execute(select(Character).where(Character.id.in_(char_ids)))
        full_chars = {c.id: c for c in fc_res.scalars().all()}

        cc_res = await db.execute(select(CharacterCareer).where(CharacterCareer.character_id.in_(char_ids)))
        all_cc = cc_res.scalars().all()
        career_ids = {cc.career_id for cc in all_cc}
        careers_map = {}
        if career_ids:
            cr = await db.execute(select(Career).where(Career.id.in_(list(career_ids))))
            careers_map = {c.id: c for c in cr.scalars().all()}

        cc_rel = {}
        for cc in all_cc:
            cc_rel.setdefault(cc.character_id, {'main': [], 'sub': []})
            cc_rel[cc.character_id]['main' if cc.career_type == 'main' else 'sub'].append(cc)

        parts = []
        for cid in char_ids:
            c = full_chars.get(cid)
            if not c: continue
            et = '组织' if c.is_organization else '角色'
            rt = {'protagonist': '主角', 'antagonist': '反派', 'supporting': '配角'}.get(c.role_type, c.role_type or '配角')
            lines = [f"【{c.name}】({et}, {rt})"]
            if c.age: lines.append(f"  年龄: {c.age}")
            if c.gender: lines.append(f"  性别: {c.gender}")
            if c.appearance: lines.append(f"  外貌: {c.appearance[:100]}")
            if c.personality: lines.append(f"  性格: {c.personality[:100]}")
            if c.background: lines.append(f"  背景: {c.background[:150]}")

            if cid in cc_rel:
                for cc in cc_rel[cid]['main']:
                    car = careers_map.get(cc.career_id)
                    if car: lines.append(f"  主职业: {car.name} ({cc.current_stage}/{car.max_stage}阶)")
                for cc in cc_rel[cid]['sub']:
                    car = careers_map.get(cc.career_id)
                    if car: lines.append(f"  副职业: {car.name} ({cc.current_stage}/{car.max_stage}阶)")

            if not c.is_organization:
                rr = await db.execute(
                    select(CharacterRelationship).where(
                        CharacterRelationship.project_id == project_id,
                        or_(CharacterRelationship.character_from_id == c.id,
                            CharacterRelationship.character_to_id == c.id)))
                rels = rr.scalars().all()
                if rels:
                    rids = set()
                    for r in rels: rids.update([r.character_from_id, r.character_to_id])
                    rids.discard(c.id)
                    if rids:
                        nr = await db.execute(select(Character.id, Character.name).where(Character.id.in_(rids)))
                        nm = {row.id: row.name for row in nr}
                        rp = []
                        for r in rels:
                            tn = nm.get(r.character_to_id if r.character_from_id == c.id else r.character_from_id, "未知")
                            rp.append(f"与{tn}：{r.relationship_name or '相关'}")
                        lines.append(f"  关系网络: {'；'.join(rp)}")

            if c.is_organization:
                if c.organization_type: lines.append(f"  组织类型: {c.organization_type}")
                if c.organization_purpose: lines.append(f"  组织目的: {c.organization_purpose[:100]}")

            parts.append("\n".join(lines))

        chars_str = "\n\n".join(parts)
        careers_parts = []
        for cid, car in careers_map.items():
            cl = [f"{car.name} ({car.type}职业)"]
            if car.description: cl.append(f"  描述: {car.description}")
            try:
                stages = json.loads(car.stages) if isinstance(car.stages, str) else car.stages
                if stages:
                    cl.append(f"  阶段体系: (共{car.max_stage}阶)")
                    for s in stages:
                        cl.append(f"    {s.get('level', '?')}阶-{s.get('name', '未命名')}: {s.get('description', '')}")
            except (json.JSONDecodeError, AttributeError, TypeError):
                cl.append(f"  阶段体系: 共{car.max_stage}阶")
            if car.special_abilities: cl.append(f"  特殊能力: {car.special_abilities}")
            careers_parts.append("\n".join(cl))

        return chars_str, "\n\n".join(careers_parts) if careers_parts else None

    async def _get_foreshadow_reminders(self, project_id, cn, db):
        if not self.foreshadow_service: return None
        try:
            lines = []
            must = await self.foreshadow_service.get_must_resolve_foreshadows(db=db, project_id=project_id, chapter_number=cn)
            if must:
                lines.append("【本章必须回收的伏笔】")
                for f in must:
                    lines.append(f"- {f.title}\n  埋入章节：第{f.plant_chapter_number}章")
            return "\n".join(lines) if lines else None
        except Exception as e:
            logger.error(f"Foreshadow reminders failed: {e}")
            return None
