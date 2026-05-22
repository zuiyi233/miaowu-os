"""章节重新生成服务"""
import difflib
import hashlib
from collections import OrderedDict
from collections.abc import AsyncGenerator
from typing import Any

from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.models.chapter import Chapter
from app.gateway.novel_migrated.models.memory import PlotAnalysis
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.prompt_service import PromptService

logger = get_logger(__name__)


class ChapterRegenerator:
    _SEGMENT_SIZE = 1500
    _MAX_SEGMENT_CACHE_ENTRIES = 16

    def __init__(self, ai_service: AIService):
        self.ai_service = ai_service
        self._segmented_content_cache: OrderedDict[str, tuple[str, ...]] = OrderedDict()

    async def regenerate_with_feedback(
        self,
        chapter: Chapter,
        analysis: PlotAnalysis | None,
        modification_instructions: str,
        project_context: dict[str, Any],
        style_content: str = "",
        target_word_count: int = 3000,
        custom_instructions: str = "",
        focus_areas: list = None,
        preserve_elements: dict = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        try:
            logger.info(f"Regenerating chapter {chapter.chapter_number}")
            yield {'type': 'progress', 'progress': 5, 'message': 'Building modification instructions...'}

            full_instructions = self._build_modification_instructions(
                analysis=analysis,
                modification_instructions=modification_instructions,
                custom_instructions=custom_instructions,
                focus_areas=focus_areas,
                preserve_elements=preserve_elements
            )

            yield {'type': 'progress', 'progress': 10, 'message': 'Building prompt...'}
            full_prompt = await self._build_regeneration_prompt(
                chapter=chapter,
                modification_instructions=full_instructions,
                project_context=project_context,
                style_content=style_content,
                target_word_count=target_word_count
            )

            system_prompt = None
            if style_content:
                system_prompt = f"【写作风格要求 - 最高优先级】\n\n{style_content}\n\n请严格遵循上述写作风格要求进行重写。"

            yield {'type': 'progress', 'progress': 15, 'message': 'Starting AI generation...'}
            accumulated_length = 0

            async for chunk in self.ai_service.generate_text_stream(
                prompt=full_prompt, system_prompt=system_prompt, temperature=0.7
            ):
                yield {'type': 'chunk', 'content': chunk}
                accumulated_length += len(chunk)
                generation_progress = min(15 + (accumulated_length / target_word_count) * 80, 95)
                yield {'type': 'progress', 'progress': int(generation_progress), 'word_count': accumulated_length}

            yield {'type': 'progress', 'progress': 100, 'message': 'Generation complete'}

        except Exception as e:
            logger.error(f"Regeneration failed: {e}", exc_info=True)
            raise

    def _build_modification_instructions(
        self,
        analysis: PlotAnalysis | None = None,
        modification_instructions: str = "",
        custom_instructions: str = "",
        focus_areas: list = None,
        preserve_elements: dict = None,
    ) -> str:
        instructions = ["# 章节修改指令\n"]

        if modification_instructions:
            instructions.append("## 需要改进的问题：\n")
            instructions.append(modification_instructions)
            instructions.append("")

        if custom_instructions:
            instructions.append("## 用户自定义修改要求：\n")
            instructions.append(custom_instructions)
            instructions.append("")

        if focus_areas:
            instructions.append("## 重点优化方向：\n")
            focus_map = {
                "pacing": "节奏把控", "emotion": "情感渲染",
                "description": "场景描写", "dialogue": "对话质量", "conflict": "冲突强度"
            }
            for area in focus_areas:
                if area in focus_map:
                    instructions.append(f"- {focus_map[area]}")
            instructions.append("")

        if preserve_elements:
            instructions.append("## 必须保留的元素：\n")
            if preserve_elements.get('preserve_structure'):
                instructions.append("- 保持原章节的整体结构和情节框架")
            if preserve_elements.get('preserve_dialogues'):
                instructions.append("- 保留关键对话")
            if preserve_elements.get('preserve_plot_points'):
                instructions.append("- 保留关键情节点")
            if preserve_elements.get('preserve_character_traits'):
                instructions.append("- 保持角色性格特征一致")
            instructions.append("")

        return "\n".join(instructions)

    async def _build_regeneration_prompt(
        self,
        chapter: Chapter,
        modification_instructions: str,
        project_context: dict[str, Any],
        style_content: str = "",
        target_word_count: int = 3000,
    ) -> str:
        template = PromptService.CHAPTER_REGENERATION_SYSTEM
        original_content = self._get_segmented_content(chapter.content or "")

        prompt = f"""{template}

【原始章节内容】
{original_content}

【修改指令】
{modification_instructions}

【项目信息】
书名：{project_context.get('title', '')}
类型：{project_context.get('genre', '')}
主题：{project_context.get('theme', '')}

【目标字数】
{target_word_count}字

请根据以上修改指令，重新创作这个章节。直接输出重写后的正文内容。"""

        return prompt

    def _get_segmented_content(self, content: str) -> str:
        """
        分段缓存长文本，避免重复切片导致内存峰值持续抬升。

        保持输出契约不变：返回内容与原始 content 完全一致。
        """
        if not content:
            return ""

        if len(content) <= self._SEGMENT_SIZE:
            return content

        cache_key = self._build_content_cache_key(content)
        cached_segments = self._segmented_content_cache.get(cache_key)
        if cached_segments is None:
            cached_segments = tuple(
                content[idx : idx + self._SEGMENT_SIZE]
                for idx in range(0, len(content), self._SEGMENT_SIZE)
            )
            self._segmented_content_cache[cache_key] = cached_segments
            self._segmented_content_cache.move_to_end(cache_key)
            self._evict_segment_cache_if_needed()
        else:
            self._segmented_content_cache.move_to_end(cache_key)

        return "".join(cached_segments)

    @staticmethod
    def _build_content_cache_key(content: str) -> str:
        digest = hashlib.sha1(content.encode("utf-8")).hexdigest()
        return f"{len(content)}:{digest}"

    def _evict_segment_cache_if_needed(self) -> None:
        while len(self._segmented_content_cache) > self._MAX_SEGMENT_CACHE_ENTRIES:
            self._segmented_content_cache.popitem(last=False)

    def calculate_content_diff(self, original_content: str, new_content: str) -> dict[str, Any]:
        diff_stats = {
            'original_length': len(original_content),
            'new_length': len(new_content),
            'length_change': len(new_content) - len(original_content),
        }
        if len(original_content) > 0:
            diff_stats['length_change_percent'] = round(
                (len(new_content) - len(original_content)) / len(original_content) * 100, 2)
        else:
            diff_stats['length_change_percent'] = 0

        similarity = difflib.SequenceMatcher(None, original_content, new_content).ratio()
        diff_stats['similarity'] = round(similarity * 100, 2)
        diff_stats['difference'] = round((1 - similarity) * 100, 2)

        original_paragraphs = [p for p in original_content.split('\n\n') if p.strip()]
        new_paragraphs = [p for p in new_content.split('\n\n') if p.strip()]
        diff_stats['original_paragraph_count'] = len(original_paragraphs)
        diff_stats['new_paragraph_count'] = len(new_paragraphs)

        return diff_stats


_regenerator_instance = None

def get_chapter_regenerator(ai_service: AIService) -> ChapterRegenerator:
    global _regenerator_instance
    if _regenerator_instance is None:
        _regenerator_instance = ChapterRegenerator(ai_service)
    return _regenerator_instance
