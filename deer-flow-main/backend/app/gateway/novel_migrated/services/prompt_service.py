"""Unified prompt template service for novel_migrated.

支持完整小说创作流程的提示词模板管理：
- 世界构建与职业体系（拆书导入/向导生成）
- 灵感模式引导创建（INSPIRATION系列）
- 未来可扩展：章节生成、大纲续写、情节分析等

模板来源：参考项目 MuMuAINovel-main 完整移植
适用范围：主项目与小说项目统一调用
"""

from __future__ import annotations

from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)


class PromptService:
    """统一提示词服务 - 支持主项目与小说项目调用。

    模板分类：
    - 基础模板：世界构建、职业体系、角色生成、大纲生成、拆书导入
    - 灵感模式：书名/简介/主题/类型生成 + 智能补全（9个模板）
    """

    # ========== 基础模板（拆书导入与向导生成） ==========

    WORLD_BUILDING = """<system>
你是资深的世界观设计师，擅长为{genre}类型的小说构建真实、自洽的世界观。
</system>

<task>
为小说《{title}》生成世界观，要求贴合主题"{theme}"与简介内容。
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

    WIZARD_COMPLETE_OUTLINE_GENERATION = """<system>
你是资深网文总编与剧情架构师，擅长把项目设定拆解为可执行章节大纲。
</system>

<task>
基于项目设定生成完整章节大纲，章节数必须精确等于 {chapter_count}。
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
叙事视角：{narrative_perspective}
目标字数：{target_words}
章节总数：{chapter_count}
大纲模式：{outline_mode}
</input>

<output>
仅输出JSON数组（不要markdown），长度必须等于 {chapter_count}。
每项格式：
{{
  "chapter_number": 1,
  "title": "章节标题",
  "summary": "本章概要（80-180字）",
  "scenes": ["场景1", "场景2"],
  "key_points": ["关键事件1", "关键事件2"],
  "emotion": "情感基调",
  "goal": "叙事目标"
}}
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

    # ========== 灵感模式提示词（从参考项目 MuMuAINovel-main 移植） ==========
    # 来源：D:\miaowu-os\参考项目\MuMuAINovel-main\backend\app\services\prompt_service.py (第1652-1760行)
    # 用途：支持灵感模式引导式创建小说项目

    INSPIRATION_TITLE_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}

请根据用户的想法，生成6个吸引人的书名建议，要求：
1. 紧扣用户的原始想法和核心故事构思
2. 富有创意和吸引力
3. 涵盖不同的风格倾向
4. 书名中不要带有"《》"符号

返回JSON格式：
{{
    "prompt": "根据你的想法，我为你准备了几个书名建议：",
    "options": ["书名1", "书名2", "书名3", "书名4", "书名5", "书名6"]
}}

只返回纯JSON，不要有其他文字。"""

    INSPIRATION_TITLE_USER = "用户的想法：{initial_idea}\n请生成6个书名建议"

    INSPIRATION_DESCRIPTION_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}
已确定的书名：{title}

请生成6个精彩的小说简介，要求：
1. 必须紧扣用户的原始想法，确保简介是原始想法的具体展开
2. 符合已确定的书名风格
3. 简洁有力，每个50-100字
4. 包含核心冲突
5. 涵盖不同的故事走向，但都基于用户的原始构思

返回JSON格式：
{{"prompt":"选择一个简介：","options":["简介1","简介2","简介3","简介4","简介5","简介6"]}}

只返回纯JSON，不要有其他文字，不要换行。"""

    INSPIRATION_DESCRIPTION_USER = "原始想法：{initial_idea}\n书名：{title}\n请生成6个简介选项"

    INSPIRATION_THEME_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}
小说信息：
- 书名：{title}
- 简介：{description}

请生成6个深刻的主题选项，要求：
1. 必须与用户的原始想法保持高度一致
2. 符合书名和简介的风格
3. 有深度和思想性
4. 每个50-150字
5. 涵盖不同角度（如：成长、复仇、救赎、探索等），但都围绕用户的核心构思

返回JSON格式：
{{"prompt":"这本书的核心主题是什么？","options":["主题1","主题2","主题3","主题4","主题5","主题6"]}}

只返回纯JSON，不要有其他文字，不要换行。"""

    INSPIRATION_THEME_USER = "原始想法：{initial_idea}\n书名：{title}\n简介：{description}\n请生成6个主题选项"

    INSPIRATION_GENRE_SYSTEM = """你是一位专业的小说创作顾问。
用户的原始想法：{initial_idea}
小说信息：
- 书名：{title}
- 简介：{description}
- 主题：{theme}

请生成6个合适的类型标签（每个2-4字），要求：
1. 必须符合用户原始想法中暗示的类型倾向
2. 符合小说整体风格
3. 可以多选组合

常见类型：玄幻、都市、科幻、武侠、仙侠、历史、言情、悬疑、奇幻、修仙等

返回JSON格式：
{{"prompt":"选择类型标签（可多选）：","options":["类型1","类型2","类型3","类型4","类型5","类型6"]}}

只返回紧凑的纯JSON，不要换行，不要有其他文字。"""

    INSPIRATION_GENRE_USER = (
        "原始想法：{initial_idea}\n书名：{title}\n简介：{description}\n主题：{theme}\n请生成6个类型标签"
    )

    INSPIRATION_QUICK_COMPLETE = """你是一位专业的小说创作顾问。用户提供了部分小说信息，请补全缺失的字段。

用户已提供的信息：
{existing}

请生成完整的小说方案，包含：
1. title: 书名（3-6字，如果用户已提供则保持原样）
2. description: 简介（50-100字，必须基于用户提供的信息，不要偏离原意）
3. theme: 核心主题（30-50字，必须与用户提供的信息保持一致）
4. genre: 类型标签数组（2-3个）

重要：所有补全的内容都必须与用户提供的信息保持高度关联，确保前后一致性。

返回JSON格式：
{{
    "title": "书名",
    "description": "简介内容...",
    "theme": "主题内容...",
    "genre": ["类型1", "类型2"]
}}

只返回纯JSON，不要有其他文字。"""

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
