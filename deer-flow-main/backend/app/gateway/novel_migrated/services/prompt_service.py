"""Prompt templates used by novel_migrated book-import flow.

仅保留拆书导入与向导生成必需模板：
- WORLD_BUILDING
- CAREER_SYSTEM_GENERATION
- CHARACTERS_BATCH_GENERATION
- BOOK_IMPORT_REVERSE_PROJECT_SUGGESTION
- BOOK_IMPORT_REVERSE_OUTLINES
"""

from __future__ import annotations

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class PromptService:
    """最小提示词服务。"""

    WORLD_BUILDING = """<system>
你是资深的世界观设计师，擅长为{genre}类型的小说构建真实、自洽的世界观。
</system>

<task>
为小说《{title}》生成世界观，要求贴合主题“{theme}”与简介内容。
</task>

<input>
书名：{title}
类型：{genre}
主题：{theme}
简介：{description}
</input>

<output>
仅输出JSON对象（不要markdown）：
{{
  "time_period": "时间背景与社会状态（300-500字）",
  "location": "空间环境与地理特征（300-500字）",
  "atmosphere": "感官体验与情感基调（300-500字）",
  "rules": "世界规则与社会结构（300-500字）"
}}
</output>"""

    CAREER_SYSTEM_GENERATION = """<system>
你是专业的职业体系设计师，擅长为不同世界观设计完整职业体系。
</system>

<task>
根据世界观与项目信息设计职业体系。
必须精确返回3个主职业与2个副职业。
</task>

<input>
书名：{title}
类型：{genre}
主题：{theme}
简介：{description}
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
世界规则：{rules}
</input>

<output>
仅输出JSON对象（不要markdown）：
{{
  "main_careers": [
    {{
      "name": "职业名称",
      "description": "职业描述",
      "category": "职业分类",
      "stages": [{{"level": 1, "name": "阶段名", "description": "阶段描述"}}],
      "max_stage": 8,
      "requirements": "职业要求",
      "special_abilities": "特殊能力",
      "worldview_rules": "与世界观关系",
      "attribute_bonuses": {{"strength": "+10%"}}
    }}
  ],
  "sub_careers": [
    {{
      "name": "副职业名称",
      "description": "副职业描述",
      "category": "职业分类",
      "stages": [{{"level": 1, "name": "阶段名", "description": "阶段描述"}}],
      "max_stage": 6,
      "requirements": "职业要求",
      "special_abilities": "特殊能力"
    }}
  ]
}}
</output>"""

    CHARACTERS_BATCH_GENERATION = """<system>
你是专业角色设定师，擅长生成角色与组织并建立关系网络。
</system>

<task>
生成{count}个角色/组织实体，需贴合世界观与剧情需求。
</task>

<input>
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
世界规则：{rules}
主题：{theme}
类型：{genre}
额外要求：{requirements}
</input>

<output>
仅输出JSON数组（不要markdown）：
[
  {{
    "name": "名称",
    "is_organization": false,
    "role_type": "protagonist/supporting/antagonist",
    "age": "年龄",
    "gender": "性别",
    "personality": "性格",
    "background": "背景",
    "appearance": "外貌",
    "traits": ["特征1", "特征2"],
    "career_assignment": {{
      "main_career": "主职业名称",
      "main_stage": 1,
      "sub_careers": [{{"career": "副职业名称", "stage": 1}}]
    }},
    "relationships_array": [
      {{
        "target_character_name": "目标角色名",
        "relationship_type": "关系名",
        "intimacy_level": 50,
        "status": "active",
        "description": "关系描述"
      }}
    ],
    "organization_memberships": [
      {{
        "organization_name": "组织名",
        "position": "职位",
        "rank": 5,
        "loyalty": 80,
        "status": "active",
        "joined_at": "加入时间"
      }}
    ]
  }}
]
</output>"""

    BOOK_IMPORT_REVERSE_PROJECT_SUGGESTION = """<system>
你是资深网文策划编辑，擅长从小说正文反向提炼项目立项信息。
</system>

<task>
基于给定前3章内容，提炼项目建议信息。
</task>

<input>
书名：{title}
前3章内容：
{sampled_text}
</input>

<output>
仅输出JSON对象（不要markdown）：
{{
  "description": "小说简介",
  "theme": "核心主题",
  "genre": "小说类型",
  "narrative_perspective": "第一人称/第三人称/全知视角",
  "target_words": 100000
}}
</output>"""

    BOOK_IMPORT_REVERSE_OUTLINES = """<system>
你是资深网文总编与剧情策划，擅长基于章节正文反向提炼标准化章节大纲。
</system>

<task>
基于给定章节正文（每批最多5章）生成对齐结构的大纲。
</task>

<project>
书名：{title}
类型：{genre}
主题：{theme}
叙事视角：{narrative_perspective}
</project>

<input>
第{start_chapter}章 - 第{end_chapter}章，共{expected_count}章。
章节内容：
{chapters_text}
</input>

<output>
仅输出JSON数组（不要markdown），长度必须等于 {expected_count}。
每项格式：
{{
  "chapter_number": 1,
  "title": "章节标题",
  "summary": "章节概要",
  "scenes": ["场景1", "场景2"],
  "characters": [{{"name": "角色名", "type": "character"}}],
  "key_points": ["要点1", "要点2"],
  "emotion": "情感基调",
  "goal": "叙事目标"
}}
</output>"""

    @staticmethod
    def format_prompt(template: str, **kwargs) -> str:
        """格式化提示词模板。"""
        try:
            return template.format(**kwargs)
        except KeyError as exc:
            raise ValueError(f"缺少必需的参数: {exc}") from exc

    @classmethod
    async def get_template_with_fallback(
        cls,
        template_key: str,
        user_id: str | None = None,
        db=None,
    ) -> str:
        """兼容接口：当前仅返回系统模板。"""
        del user_id, db
        return await cls.get_template(template_key=template_key, user_id="", db=None)

    @classmethod
    async def get_template(
        cls,
        template_key: str,
        user_id: str,
        db,
    ) -> str:
        """获取模板（novel_migrated 当前无自定义模板表，直接返回内置模板）。"""
        del user_id, db
        template_content = getattr(cls, template_key, None)
        if template_content is None:
            logger.warning("未找到提示词模板: %s", template_key)
            raise ValueError(f"未找到提示词模板: {template_key}")
        return template_content
