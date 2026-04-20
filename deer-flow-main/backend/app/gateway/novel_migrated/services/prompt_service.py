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

    # ========== P0 章节创作模板 ==========

    CHAPTER_GENERATION_ONE_TO_MANY = """<system>
你是《{project_title}》的作者，一位专注于{genre}类型的网络小说家。
</system>

<task>
【创作任务】
撰写第{chapter_number}章《{chapter_title}》的完整正文。

【基本要求】
- 目标字数：{target_word_count}字（允许±200字浮动）
- 叙事视角：{narrative_perspective}
</task>

<outline priority="P0">
【本章大纲 - 必须遵循】
{chapter_outline}
</outline>

<characters priority="P1">
【本章角色 - 请严格遵循角色设定】
{characters_info}

⚠️ 角色互动须知：
- 角色之间的对话和行为必须符合其关系设定（如师徒、敌对等）
- 涉及组织的情节须体现角色在组织中的身份和职位
- 角色的能力表现须符合其职业和阶段设定
</characters>

<careers priority="P2">
【本章职业】
{chapter_careers}
</careers>

<foreshadow_reminders priority="P2">
【🎯 伏笔提醒】
{foreshadow_reminders}
</foreshadow_reminders>

<memory priority="P2">
【相关记忆】
{relevant_memories}
</memory>

<constraints>
【必须遵守】
✅ 严格按照大纲推进情节
✅ 保持角色性格、说话方式一致
✅ 角色互动须符合关系设定（师徒、朋友、敌对等）
✅ 组织相关情节须体现成员身份和职位层级
✅ 字数控制在目标范围内
✅ 如有伏笔提醒，请在本章中适当埋入或回收相应伏笔

【禁止事项】
❌ 输出章节标题、序号等元信息
❌ 使用"总之"、"综上所述"等AI常见总结语
❌ 在结尾处使用开放式反问
❌ 添加作者注释或创作说明
❌ 角色行为超出其职业阶段的能力范围
</constraints>

<output>
【输出规范】
直接输出小说正文内容，从故事场景或动作开始。
无需任何前言、后记或解释性文字。

现在开始创作：
</output>"""

    CHAPTER_GENERATION_ONE_TO_ONE = """<system>
你是《{project_title}》的作者，一位专注于{genre}类型的网络小说家。
</system>

<task priority="P0">
【创作任务】
撰写第{chapter_number}章《{chapter_title}》的完整正文。

【基本要求】
- 目标字数：{target_word_count}字（允许±200字浮动）
- 叙事视角：{narrative_perspective}
</task>

<outline priority="P0">
【本章大纲】
{chapter_outline}
</outline>

<characters priority="P1">
【本章角色】
{characters_info}
</characters>

<careers priority="P2">
【本章职业】
{chapter_careers}
</careers>

<foreshadow_reminders priority="P2">
【🎯 伏笔提醒】
{foreshadow_reminders}
</foreshadow_reminders>

<memory priority="P2">
【相关记忆】
{relevant_memories}
</memory>

<constraints>
【必须遵守】
✅ 严格按照大纲推进情节
✅ 保持角色性格、说话方式一致
✅ 字数需要严格控制在目标字数内
✅ 如有伏笔提醒，请在本章中适当埋入或回收相应伏笔

【禁止事项】
❌ 输出章节标题、序号等元信息
❌ 使用"总之"、"综上所述"等AI常见总结语
❌ 添加作者注释或创作说明
❌ 生成字数禁止超过目标字数
</constraints>

<output>
【输出规范】
直接输出小说正文内容，从故事场景或动作开始。
无需任何前言、后记或解释性文字。

现在开始创作：
</output>"""

    CHAPTER_GENERATION_ONE_TO_ONE_NEXT = """<system>
你是《{project_title}》的作者，一位专注于{genre}类型的网络小说家。
</system>

<task priority="P0">
【创作任务】
撰写第{chapter_number}章《{chapter_title}》的完整正文。

【基本要求】
- 目标字数：{target_word_count}字（允许±200字浮动）
- 叙事视角：{narrative_perspective}
</task>

<outline priority="P0">
【本章大纲】
{chapter_outline}
</outline>

<previous_chapter_summary priority="P1">
【上一章剧情概要】
{previous_chapter_summary}
</previous_chapter_summary>

<previous_chapter priority="P1">
【上一章末尾500字内容】
{previous_chapter_content}
</previous_chapter>

<characters priority="P1">
【本章角色】
{characters_info}
</characters>

<careers priority="P2">
【本章职业】
{chapter_careers}
</careers>

<foreshadow_reminders priority="P2">
【🎯 伏笔提醒】
{foreshadow_reminders}
</foreshadow_reminders>

<memory priority="P2">
【相关记忆】
{relevant_memories}
</memory>

<constraints>
【必须遵守】
✅ 严格按照大纲推进情节
✅ 自然承接上一章末尾内容，保持连贯性
✅ 保持角色性格、说话方式一致
✅ 字数需要严格控制在目标字数内
✅ 如有伏笔提醒，请在本章中适当埋入或回收相应伏笔

【禁止事项】
❌ 输出章节标题、序号等元信息
❌ 使用"总之"、"综上所述"等AI常见总结语
❌ 在结尾处使用开放式反问
❌ 添加作者注释或创作说明
❌ 重复上一章已发生的事件
❌ 生成字数禁止超过目标字数
</constraints>

<output>
【输出规范】
直接输出小说正文内容，从故事场景或动作开始。
无需任何前言、后记或解释性文字。

现在开始创作：
</output>"""

    CHAPTER_GENERATION_ONE_TO_MANY_NEXT = """<system>
你是《{project_title}》的作者，一位专注于{genre}类型的网络小说家。
</system>

<task>
【创作任务】
撰写第{chapter_number}章《{chapter_title}》的完整正文。

【基本要求】
- 目标字数：{target_word_count}字（允许±200字浮动）
- 叙事视角：{narrative_perspective}
</task>

<outline priority="P0">
【本章大纲 - 必须遵循】
{chapter_outline}
</outline>

<recent_context priority="P1">
【最近章节规划 - 故事脉络参考】
{recent_chapters_context}
</recent_context>

<continuation priority="P0">
【衔接锚点 - 必须承接】
上一章结尾：
「{continuation_point}」

【🔴 上一章已完成剧情（禁止重复！）】
{previous_chapter_summary}

⚠️ 严重警告：
1. 上述"已完成剧情"和"衔接锚点"是**已经写过的**内容
2. 本章必须推进到**新的情节点**，绝对不能重新叙述已经发生的事件
3. 如果锚点是对话结束，请描写对话后的动作或场景转换，不要重复对话
4. 如果锚点是场景描写，请直接开始人物行动，不要重复描写环境
</continuation>

<characters priority="P1">
【本章角色 - 请严格遵循角色设定】
{characters_info}

⚠️ 角色互动须知：
- 角色之间的对话和行为必须符合其关系设定（如师徒、敌对等）
- 涉及组织的情节须体现角色在组织中的身份和职位
- 角色的能力表现须符合其职业和阶段设定
</characters>

<careers priority="P2">
【本章职业】
{chapter_careers}
</careers>

<foreshadow_reminders priority="P1">
【🎯 伏笔提醒 - 需关注】
{foreshadow_reminders}
</foreshadow_reminders>

<memory priority="P2">
【相关记忆 - 参考】
{relevant_memories}
</memory>

<constraints>
【必须遵守】
✅ 严格按照大纲推进情节
✅ 自然承接上一章结尾，不重复已发生事件
✅ 保持角色性格、说话方式一致
✅ 角色互动须符合关系设定（师徒、朋友、敌对等）
✅ 组织相关情节须体现成员身份和职位层级
✅ 字数控制在目标范围内
✅ 如有伏笔提醒，请在本章中适当埋入或回收相应伏笔

【🔴 反重复特别指令】
✅ 检查本章开篇是否与"衔接锚点"内容重复
✅ 检查本章情节是否与"上一章已完成剧情"重复
✅ 确保本章推进到了大纲中规划的新事件

【禁止事项】
❌ 输出章节标题、序号等元信息
❌ 使用"总之"、"综上所述"等AI常见总结语
❌ 在结尾处使用开放式反问
❌ 添加作者注释或创作说明
❌ 重复叙述上一章已发生的事件（包括环境描写、心理活动）
❌ 在开篇使用"接上回"、"书接上文"等套话
❌ 角色行为超出其职业阶段的能力范围
</constraints>

<output>
【输出规范】
直接输出小说正文内容，从故事场景或动作开始。
无需任何前言、后记或解释性文字。

现在开始创作：
</output>"""

    # ========== P1 大纲与情节分析模板 ==========

    OUTLINE_CREATE = """<system>
你是经验丰富的小说作家和编剧，擅长为{genre}类型的小说设计精彩开篇。
</system>

<task>
【创作任务】
为小说《{title}》生成开篇{chapter_count}章的大纲。

【重要说明】
这是项目初始化的开头部分，不是完整大纲：
- 完成开局设定和世界观展示
- 引入主要角色，建立初始关系
- 埋下核心矛盾和悬念钩子
- 为后续剧情发展打下基础
- 不需要完整闭环，为续写留空间
</task>

<project priority="P0">
【项目信息】
书名：{title}
主题：{theme}
类型：{genre}
开篇章节数：{chapter_count}
叙事视角：{narrative_perspective}
</project>

<worldview priority="P1">
【世界观】
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
世界规则：{rules}
</worldview>

<characters priority="P1">
【角色信息】
{characters_info}
</characters>

<mcp_context priority="P2">
{mcp_references}
</mcp_context>

<requirements priority="P1">
【其他要求】
{requirements}
</requirements>

<output priority="P0">
【输出格式】
返回包含{chapter_count}个章节对象的JSON数组：

[
  {{
   "chapter_number": 1,
   "title": "章节标题",
   "summary": "章节概要（500-1000字）：主要情节、角色互动、关键事件、冲突与转折",
   "scenes": ["场景1描述", "场景2描述", "场景3描述"],
   "characters": [
     {{"name": "角色名1", "type": "character"}},
     {{"name": "组织/势力名1", "type": "organization"}}
   ],
   "key_points": ["情节要点1", "情节要点2"],
   "emotion": "本章情感基调",
   "goal": "本章叙事目标"
 }}
]

【characters字段说明】
- type为"character"表示个人角色，type为"organization"表示组织/势力/门派/帮派等
- 必须区分角色和组织，不要把组织当作角色

【格式规范】
- 纯JSON数组输出，无markdown标记
- 内容描述中严禁使用特殊符号
- 专有名词直接书写
- 字段结构与已有章节完全一致
</output>

<constraints>
【开篇大纲要求】
✅ 开局设定：前几章完成世界观呈现、主角登场、初始状态
✅ 矛盾引入：引出核心冲突，但不急于展开
✅ 角色亮相：主要角色依次登场，展示性格和关系
✅ 节奏控制：开篇不宜过快，给读者适应时间
✅ 悬念设置：埋下伏笔和钩子，为续写预留空间
✅ 视角统一：采用{narrative_perspective}视角
✅ 留白艺术：结尾不收束过紧，留发展空间

【必须遵守】
✅ 数量精确：数组包含{chapter_count}个章节对象
✅ 符合类型：情节符合{genre}类型特征
✅ 主题贴合：体现主题"{theme}"
✅ 开篇定位：是开局而非完整故事
✅ 描述详细：每个summary 500-1000字

【禁止事项】
❌ 输出markdown或代码块标记
❌ 在描述中使用特殊符号
❌ 试图在开篇完结故事
❌ 节奏过快，信息过载
</constraints>"""

    OUTLINE_CONTINUE = """<system>
你是经验丰富的小说作家和编剧，擅长续写{genre}类型的小说大纲。
</system>

<task>
【续写任务】
基于已有{current_chapter_count}章内容，续写第{start_chapter}章到第{end_chapter}章的大纲（共{chapter_count}章）。

【当前情节阶段】
{plot_stage_instruction}

【故事发展方向】
{story_direction}
</task>

<project priority="P0">
【项目信息】
书名：{title}
主题：{theme}
类型：{genre}
叙事视角：{narrative_perspective}
</project>

<worldview priority="P1">
【世界观】
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
世界规则：{rules}
</worldview>

<previous_context priority="P0">
{recent_outlines}
</previous_context>

<characters priority="P0">
【所有角色信息】
{characters_info}
</characters>

<user_input priority="P0">
【用户输入】
续写章节数：{chapter_count}章
情节阶段：{plot_stage_instruction}
故事方向：{story_direction}
其他要求：{requirements}
</user_input>

<mcp_context priority="P2">
{mcp_references}
</mcp_context>

<output priority="P0">
【输出格式】
返回第{start_chapter}到第{end_chapter}章的JSON数组（共{chapter_count}个对象）：

[
  {{
   "chapter_number": {start_chapter},
   "title": "章节标题",
   "summary": "章节概要（500-1000字）：主要情节、角色互动、关键事件、冲突与转折",
   "scenes": ["场景1描述", "场景2描述", "场景3描述"],
   "characters": [
     {{"name": "角色名1", "type": "character"}},
     {{"name": "组织/势力名1", "type": "organization"}}
   ],
   "key_points": ["情节要点1", "情节要点2"],
   "emotion": "本章情感基调",
   "goal": "本章叙事目标"
 }}
]

【格式规范】
- 纯JSON数组输出，无markdown标记
- 内容描述中严禁使用特殊符号
- 专有名词直接书写
- 字段结构与已有章节完全一致
</output>

<constraints>
【续写要求】
✅ 剧情连贯：与前文自然衔接，保持连贯性
✅ 角色发展：遵循角色成长轨迹，充分利用角色信息
✅ 情节阶段：遵循{plot_stage_instruction}的要求
✅ 风格一致：保持与已有章节相同风格和详细程度
✅ 大纲详细：充分解析最近10章大纲的structure字段信息

【必须遵守】
✅ 数量精确：数组包含{chapter_count}个章节
✅ 编号正确：从第{start_chapter}章开始
✅ 描述详细：每个summary 500-1000字
✅ 承上启下：自然衔接前文

【禁止事项】
❌ 输出markdown或代码块标记
❌ 在描述中使用特殊符号
❌ 与前文矛盾或脱节
❌ 忽略已有角色发展
❌ 忽略最近大纲中的情节线索
</constraints>"""

    OUTLINE_EXPAND_SINGLE = """<system>
你是专业的小说情节架构师，擅长将大纲节点展开为详细章节规划。
</system>

<task>
【展开任务】
将第{outline_order_index}节大纲《{outline_title}》展开为{target_chapter_count}个章节的详细规划。

【展开策略】
{strategy_instruction}
</task>

<project priority="P1">
【项目信息】
小说名称：{project_title}
类型：{project_genre}
主题：{project_theme}
叙事视角：{project_narrative_perspective}

【世界观背景】
时间背景：{project_world_time_period}
地理位置：{project_world_location}
氛围基调：{project_world_atmosphere}
</project>

<characters priority="P1">
【角色信息】
{characters_info}
</characters>

<outline_node priority="P0">
【当前大纲节点 - 展开对象】
序号：第 {outline_order_index} 节
标题：{outline_title}
内容：{outline_content}
</outline_node>

<context priority="P2">
【上下文参考】
{context_info}
</context>

<output priority="P0">
【输出格式】
返回{target_chapter_count}个章节规划的JSON数组：

[
  {{
    "sub_index": 1,
    "title": "章节标题（体现核心冲突或情感）",
    "plot_summary": "剧情摘要（200-300字）：详细描述该章发生的事件，仅限当前大纲内容",
    "key_events": ["关键事件1", "关键事件2", "关键事件3"],
    "character_focus": ["角色A", "角色B"],
    "emotional_tone": "情感基调（如：紧张、温馨、悲伤）",
    "narrative_goal": "叙事目标（该章要达成的叙事效果）",
    "conflict_type": "冲突类型（如：内心挣扎、人际冲突）",
    "estimated_words": 3000
  }}
]

【格式规范】
- 纯JSON数组输出，无其他文字
- 内容描述中严禁使用特殊符号
</output>

<constraints>
【⚠️ 内容边界约束 - 必须严格遵守】
✅ 只能展开当前大纲节点的内容
✅ 深化当前大纲，而非跨越到后续
✅ 放慢叙事节奏，充分体验当前阶段

❌ 绝对不能推进到后续大纲内容
❌ 不要让剧情快速推进
❌ 不要提前展开【后一节】的内容

【展开原则】
✅ 将单一事件拆解为多个细节丰富的章节
✅ 深入挖掘情感、心理、环境、对话
✅ 每章是当前大纲内容的不同侧面或阶段

【🔴 相邻章节差异化约束（防止重复）】
✅ 每章有独特的开场方式（不同场景、时间点、角色状态）
✅ 每章有独特的结束方式（不同悬念、转折、情感收尾）
✅ key_events在相邻章节间绝不重叠
✅ plot_summary描述该章独特内容，不与其他章雷同
✅ 同一事件的不同阶段要明确区分"前、中、后"

【禁止事项】
❌ 输出非JSON格式
❌ 剧情越界到后续大纲
❌ 相邻章节内容重复
❌ 关键事件雷同
</constraints>"""

    OUTLINE_EXPAND_MULTI = """<system>
你是专业的小说情节架构师，擅长分批展开大纲节点。
</system>

<task>
【展开任务】
继续展开第{outline_order_index}节大纲《{outline_title}》，生成第{start_index}-{end_index}节（共{target_chapter_count}个章节）的详细规划。

【分批说明】
- 这是整个展开的一部分
- 必须与前面已生成的章节自然衔接
- 从第{start_index}节开始编号
- 继续深化当前大纲内容

【展开策略】
{strategy_instruction}
</task>

<project priority="P1">
【项目信息】
小说名称：{project_title}
类型：{project_genre}
主题：{project_theme}
叙事视角：{project_narrative_perspective}

【世界观背景】
时间背景：{project_world_time_period}
地理位置：{project_world_location}
氛围基调：{project_world_atmosphere}
</project>

<characters priority="P1">
【角色信息】
{characters_info}
</characters>

<outline_node priority="P0">
【当前大纲节点 - 展开对象】
序号：第 {outline_order_index} 节
标题：{outline_title}
内容：{outline_content}
</outline_node>

<context priority="P2">
【上下文参考】
{context_info}

【已生成的前序章节】
{previous_context}
</context>

<output priority="P0">
【输出格式】
返回第{start_index}-{end_index}节章节规划的JSON数组（共{target_chapter_count}个对象）：

[
  {{
    "sub_index": {start_index},
    "title": "章节标题",
    "plot_summary": "剧情摘要（200-300字）：详细描述该章发生的事件",
    "key_events": ["关键事件1", "关键事件2", "关键事件3"],
    "character_focus": ["角色A", "角色B"],
    "emotional_tone": "情感基调",
    "narrative_goal": "叙事目标",
    "conflict_type": "冲突类型",
    "estimated_words": 3000
  }}
]

【格式规范】
- 纯JSON数组输出，无其他文字
- 内容描述中严禁使用特殊符号
- sub_index从{start_index}开始
</output>

<constraints>
【⚠️ 内容边界约束】
✅ 只能展开当前大纲节点的内容
✅ 深化当前大纲，而非跨越到后续
✅ 放慢叙事节奏

❌ 绝对不能推进到后续大纲内容
❌ 不要让剧情快速推进

【分批连续性约束】
✅ 与前面已生成章节自然衔接
✅ 从第{start_index}节开始编号
✅ 保持叙事连贯性

【🔴 相邻章节差异化约束（防止重复）】
✅ 每章有独特的开场和结束方式
✅ key_events在相邻章节间绝不重叠
✅ plot_summary描述该章独特内容
✅ 特别注意与前序章节的差异化
✅ 避免重复已有内容

【禁止事项】
❌ 输出非JSON格式
❌ 剧情越界到后续大纲
❌ 相邻章节内容重复
❌ 与前序章节重复
</constraints>"""

    PLOT_ANALYSIS = """<system>
你是专业的小说编辑和剧情分析师，擅长深度剖析章节内容。
</system>

<task>
【分析任务】
全面分析第{chapter_number}章《{title}》的剧情要素、钩子、伏笔、冲突和角色发展。

【🔴 伏笔追踪任务（重要）】
系统已提供【已埋入伏笔列表】，当你识别到章节中有回收伏笔时：
1. 必须从列表中找出对应的伏笔ID
2. 在 foreshadows 数组中使用 reference_foreshadow_id 字段关联
3. 如果无法确定是哪个伏笔，reference_foreshadow_id 填 null
</task>

<chapter priority="P0">
【章节信息】
章节：第{chapter_number}章
标题：{title}
字数：{word_count}字

【章节内容】
{content}
</chapter>

<existing_foreshadows priority="P1">
【已埋入伏笔列表 - 用于回收匹配】
以下是本项目中已埋入但尚未回收的伏笔，分析时如发现章节内容回收了某个伏笔，请使用对应的ID：

{existing_foreshadows}
</existing_foreshadows>

<characters priority="P1">
【项目角色信息 - 用于角色状态分析】
以下是项目中已有的角色列表，分析 character_states 和 relationship_changes 时请使用这些角色的准确名称：

{characters_info}
</characters>

<analysis_framework priority="P0">
【分析维度】

**1. 剧情钩子 (Hooks)**
识别吸引读者的关键元素：
- 悬念钩子：未解之谜、疑问、谜团
- 情感钩子：引发共鸣的情感点
- 冲突钩子：矛盾对抗、紧张局势
- 认知钩子：颠覆认知的信息

每个钩子需要：
- 类型分类
- 具体内容描述
- 强度评分(1-10)
- 出现位置(开头/中段/结尾)
- **关键词**：【必填】从原文逐字复制8-25字的文本片段，用于精确定位

**2. 伏笔分析 (Foreshadowing) - 🔴 支持ID追踪**
- 埋下的新伏笔：内容、预期作用、隐藏程度(1-10)
- 回收的旧伏笔：【必须】从已埋入伏笔列表中匹配ID
- 伏笔质量：巧妙性和合理性
- **关键词**：【必填】从原文逐字复制8-25字

每个伏笔需要：
- **title**：简洁标题（10-20字，概括伏笔核心）
  - ⚠️ 回收伏笔时，标题应与原伏笔标题保持一致，不要添加"回收"等后缀
  - 例如：原伏笔标题是"绿头发的视觉符号"，回收时标题仍为"绿头发的视觉符号"，而非"绿头发的视觉符号回收"
- **content**：详细描述伏笔内容和预期作用
- **type**：planted（埋下）或 resolved（回收）
- **strength**：强度1-10（对读者的吸引力）
- **subtlety**：隐藏度1-10（越高越隐蔽）
- **reference_chapter**：回收时引用的原埋入章节号，埋下时为null
- **reference_foreshadow_id**：【回收时必填】被回收伏笔的ID（从已埋入伏笔列表中选择），埋下时为null
  - 🔴 重要：回收伏笔时，必须从【已埋入伏笔列表】中找到对应的伏笔ID并填写
  - 如果列表中有标注【ID: xxx】的伏笔，回收时必须使用该ID
  - 如果无法确定是哪个伏笔，才填写null（但应尽量避免）
- **keyword**：【必填】从原文逐字复制8-25字的定位文本
- **category**：分类（identity=身世/mystery=悬念/item=物品/relationship=关系/event=事件/ability=能力/prophecy=预言）
- **is_long_term**：是否长线伏笔（跨10章以上回收为true）
- **related_characters**：涉及的角色名列表
- **estimated_resolve_chapter**：【必填】预估回收章节号（埋下时必须预估，回收时为当前章节）

**3. 冲突分析 (Conflict)**
- 冲突类型：人与人/人与己/人与环境/人与社会
- 冲突各方及立场
- 冲突强度(1-10)
- 解决进度(0-100%)

**4. 情感曲线 (Emotional Arc)**
- 主导情绪（最多10字）
- 情感强度(1-10)
- 情绪变化轨迹

**5. 角色状态追踪 (Character Development)**
对每个出场角色分析：
- 心理状态变化(前→后)
- 关系变化
- 关键行动和决策
- 成长或退步
- **💀 存活状态（重要）**：
  - survival_status: 角色当前存活状态
  - 可选值：active(正常)/deceased(死亡)/missing(失踪)/retired(退场)
  - 默认为null（表示无变化），仅当章节中角色明确死亡、失踪或永久退场时才填写
  - 死亡/失踪需要有明确的剧情依据，不可臆测
- ** 职业变化（可选）**：
  - 仅当章节明确描述职业进展时填写
  - main_career_stage_change: 整数(+1晋升/-1退步/0无变化)
  - sub_career_changes: 副职业变化数组
  - new_careers: 新获得职业
  - career_breakthrough: 突破过程描述
- **🏛️ 组织变化（可选）**：
  - 仅当章节明确描述角色与组织关系变化时填写
  - organization_changes: 组织变动数组
  - 每项包含：organization_name(组织名)、change_type(加入joined/离开left/晋升promoted/降级demoted/开除expelled/叛变betrayed)、new_position(新职位，可选)、loyalty_change(忠诚度变化描述，可选)、description(变化描述)

**5b. 组织状态追踪 (Organization Status) - 可选**
仅当章节涉及组织势力变化时填写，分析出场组织的状态变化：
- 组织名称
- 势力等级变化(power_change: 整数，+N增强/-N削弱/0无变化)
- 据点变化(new_location: 新据点，可选)
- 宗旨/目标变化(new_purpose: 新目标，可选)
- 组织状态描述(status_description: 当前状态概述)
- 关键事件(key_event: 触发变化的事件)
- **💀 组织存续状态（重要）**：
  - is_destroyed: 组织是否被覆灭（true/false，默认false）
  - 仅当章节明确描述组织被彻底消灭、瓦解、灭亡时设为true

**6. 关键情节点 (Plot Points)**
列出3-5个核心情节点：
- 情节内容
- 类型(revelation/conflict/resolution/transition)
- 重要性(0.0-1.0)
- 对故事的影响
- **关键词**：【必填】从原文逐字复制8-25字

**7. 场景与节奏**
- 主要场景
- 叙事节奏(快/中/慢)
- 对话与描写比例

**8. 质量评分（支持小数，严格区分度）**
评分范围：1.0-10.0，支持一位小数（如 6.5、7.8）
每个维度必须根据以下标准严格评分，避免所有内容都打中等分数：

**节奏把控 (pacing)**：
- 1.0-3.9（差）：节奏混乱，该快不快该慢不慢；场景切换生硬；大段无意义描写拖沓
- 4.0-5.9（中下）：节奏基本可读但有明显问题；部分场景过于冗长或仓促
- 6.0-7.9（中上）：节奏整体流畅，偶有小问题；张弛有度但不够精妙
- 8.0-9.4（优秀）：节奏把控精准，高潮迭起；场景切换自然，详略得当
- 9.5-10.0（完美）：节奏大师级，每个段落都恰到好处

**吸引力 (engagement)**：
- 1.0-3.9（差）：内容乏味，缺乏钩子；读者难以继续阅读
- 4.0-5.9（中下）：有基本情节但缺乏亮点；钩子设置生硬或缺失
- 6.0-7.9（中上）：有一定吸引力，钩子有效但不够巧妙
- 8.0-9.4（优秀）：引人入胜，钩子设置精妙；让人欲罢不能
- 9.5-10.0（完美）：极具吸引力，每个段落都有阅读动力

**连贯性 (coherence)**：
- 1.0-3.9（差）：逻辑混乱，前后矛盾；角色行为不合理
- 4.0-5.9（中下）：基本连贯但有明显漏洞；部分情节衔接生硬
- 6.0-7.9（中上）：整体连贯，偶有小瑕疵；角色行为基本合理
- 8.0-9.4（优秀）：逻辑严密，衔接自然；角色行为高度一致
- 9.5-10.0（完美）：无懈可击的连贯性

**整体质量 (overall)**：
- 计算公式：(pacing + engagement + coherence) / 3，保留一位小数
- 可根据综合印象±0.5调整，必须与各项分数保持一致性

**9. 改进建议（与分数关联）**
建议数量必须与整体质量分数关联：
- overall < 4.0：必须提供4-5条具体改进建议，指出严重问题
- overall 4.0-5.9：必须提供3-4条改进建议，指出主要问题
- overall 6.0-7.9：提供1-2条优化建议，指出可提升之处
- overall ≥ 8.0：提供0-1条锦上添花的建议

每条建议必须：
- 指出具体问题位置或类型
- 说明为什么是问题
- 给出明确的改进方向
</analysis_framework>

<output priority="P0">
【输出格式】
返回纯JSON对象（无markdown标记）：

{{
  "hooks": [
    {{
      "type": "悬念",
      "content": "具体描述",
      "strength": 8,
      "position": "中段",
      "keyword": "从原文逐字复制的8-25字文本"
    }}
  ],
  "foreshadows": [
    {{
      "title": "伏笔简洁标题",
      "content": "伏笔详细内容和预期作用",
      "type": "planted",
      "strength": 7,
      "subtlety": 8,
      "reference_chapter": null,
      "reference_foreshadow_id": null,
      "keyword": "从原文逐字复制的8-25字文本",
      "category": "mystery",
      "is_long_term": false,
      "related_characters": ["角色A", "角色B"],
      "estimated_resolve_chapter": 15
    }},
    {{
      "title": "回收的伏笔标题",
      "content": "伏笔如何被回收的描述",
      "type": "resolved",
      "strength": 8,
      "subtlety": 6,
      "reference_chapter": 5,
      "reference_foreshadow_id": "abc123-已埋入伏笔的ID",
      "keyword": "从原文逐字复制的8-25字文本",
      "category": "mystery",
      "is_long_term": false,
      "related_characters": ["角色A"],
      "estimated_resolve_chapter": 10
    }}
  ],
  "conflict": {{
    "types": ["人与人", "人与己"],
    "parties": ["主角-复仇", "反派-维护现状"],
    "level": 8,
    "description": "冲突描述",
    "resolution_progress": 0.3
  }},
  "emotional_arc": {{
    "primary_emotion": "紧张焦虑",
    "intensity": 8,
    "curve": "平静→紧张→高潮→释放",
    "secondary_emotions": ["期待", "焦虑"]
  }},
  "character_states": [
    {{
      "character_name": "张三",
      "survival_status": null,
      "state_before": "犹豫",
      "state_after": "坚定",
      "psychological_change": "心理变化描述",
      "key_event": "触发事件",
      "relationship_changes": {{"李四": "关系改善"}},
      "career_changes": {{
        "main_career_stage_change": 1,
        "sub_career_changes": [{{"career_name": "炼丹", "stage_change": 1}}],
        "new_careers": [],
        "career_breakthrough": "突破描述"
      }},
      "organization_changes": [
        {{
          "organization_name": "某门派",
          "change_type": "promoted",
          "new_position": "长老",
          "loyalty_change": "忠诚度提升",
          "description": "因立下大功被提拔为长老"
        }}
      ]
    }}
  ],
  "plot_points": [
    {{
      "content": "情节点描述",
      "type": "revelation",
      "importance": 0.9,
      "impact": "推动故事发展",
      "keyword": "从原文逐字复制的8-25字文本"
    }}
  ],
  "scenes": [
    {{
      "location": "地点",
      "atmosphere": "氛围",
      "duration": "时长估计"
    }}
  ],
  "organization_states": [
    {{
      "organization_name": "某门派",
      "power_change": -10,
      "new_location": null,
      "new_purpose": null,
      "status_description": "因内乱势力受损，但核心力量未动摇",
      "key_event": "长老叛变导致分支瓦解",
      "is_destroyed": false
    }}
  ],
  "pacing": "varied",
  "dialogue_ratio": 0.4,
  "description_ratio": 0.3,
  "scores": {{
    "pacing": 6.5,
    "engagement": 5.8,
    "coherence": 7.2,
    "overall": 6.5,
    "score_justification": "节奏整体流畅但中段略显拖沓；钩子设置有效但不够巧妙；逻辑连贯无明显漏洞"
  }},
  "plot_stage": "发展",
  "suggestions": [
    "【节奏问题】第三场景的心理描写过长（约500字），建议精简至200字以内，保留核心情感即可",
    "【吸引力不足】章节中段缺乏有效钩子，建议在主角发现线索后增加一个小悬念"
  ]
}}
</output>

<constraints>
【必须遵守】
✅ keyword字段必填：钩子、伏笔、情节点的keyword不能为空
✅ 逐字复制：keyword必须从原文复制，长度8-25字
✅ 精确定位：keyword能在原文中精确找到
✅ 职业变化可选：仅当章节明确描述时填写
✅ 组织变化可选：仅当章节明确描述角色与组织关系变动时填写（character_states中的organization_changes）
✅ 组织状态可选：仅当章节明确描述组织势力/据点/目标变化时填写（organization_states顶级字段）
✅ 存活状态谨慎：survival_status仅当章节有明确死亡/失踪/退场描写时填写，默认null
✅ 组织覆灭谨慎：is_destroyed仅当组织被彻底消灭时设true，组织受损不算覆灭
✅ 【伏笔ID追踪】回收伏笔时，必须从【已埋入伏笔列表】中查找匹配的ID填入 reference_foreshadow_id

【评分约束 - 严格执行】
✅ 严格按评分标准打分，支持小数（如6.5、7.2、8.3）
✅ 不要默认给7.0-8.0分，差的内容必须给低分（1.0-5.0），好的内容才给高分（8.0-10.0）
✅ score_justification必填：简要说明各项评分的依据
✅ 建议数量必须与overall分数关联：
   - overall≤4.0 → 4-5条建议
   - overall 4.0-6.0 → 3-4条建议
   - overall 6.0-8.0 → 1-2条建议
   - overall≥8.0 → 0-1条建议
✅ 每条建议必须标注问题类型（如【节奏问题】【描写不足】等）

【禁止事项】
❌ keyword使用概括或改写的文字
❌ 输出markdown标记
❌ 遗漏必填的keyword字段
❌ 无根据地添加职业变化
❌ 无根据地添加组织变化或组织状态变化
❌ 无确切剧情依据地标记角色死亡或组织覆灭
❌ 所有章节都打7-8分的"安全分"
❌ 高分章节给大量建议，或低分章节不给建议
</constraints>"""

    # ========== P2 角色与世界构建增强模板 ==========

    SINGLE_CHARACTER_GENERATION = """<system>
你是专业的角色设定师，擅长创建立体饱满的小说角色。
</system>

<task>
【设计任务】
根据用户需求和项目上下文，创建一个完整的角色设定。
</task>

<context priority="P0">
【项目上下文】
{project_context}

【用户需求】
{user_input}
</context>

<output priority="P0">
【输出格式】
生成完整的角色卡片JSON对象：

{{
  "name": "角色姓名（如用户未提供则生成符合世界观的名字）",
  "age": "年龄（具体数字或年龄段）",
  "gender": "男/女/其他",
  "appearance": "外貌描述（100-150字）：身高体型、面容特征、着装风格",
  "personality": "性格特点（150-200字）：核心性格特质、优缺点、特殊习惯",
  "background": "背景故事（200-300字）：家庭背景、成长经历、重要转折、与主题关联",
  "traits": ["特长1", "特长2", "特长3"],
  "relationships_text": "人际关系的自然语言描述",
  "relationships": [
    {{
      "target_character_name": "已存在的角色名称",
      "relationship_type": "关系类型",
      "intimacy_level": 75,
      "description": "关系的详细描述",
      "started_at": "关系开始的故事时间点（可选）"
    }}
  ],
  "organization_memberships": [
    {{
      "organization_name": "已存在的组织名称",
      "position": "职位名称",
      "rank": 8,
      "loyalty": 80,
      "joined_at": "加入时间（可选）",
      "status": "active"
    }}
  ],
  "career_info": {{
    "main_career_name": "从可用主职业列表中选择的职业名称",
    "main_career_stage": 5,
    "sub_careers": [
      {{
        "career_name": "从可用副职业列表中选择的职业名称",
        "stage": 3
      }}
    ]
  }}
}}

【职业信息说明】
如果项目上下文包含职业列表：
- 主职业：从"可用主职业"列表中选择最符合角色的职业
- 主职业阶段：根据角色实力设定合理阶段（1到max_stage）
- 副职业：可选择0-2个副职业
- ⚠️ 填写职业名称而非ID，系统会自动匹配
- 职业选择必须与角色背景、能力和定位高度契合

【关系类型参考】
- 家族：父亲、母亲、兄弟、姐妹、子女、配偶、恋人
- 社交：师父、徒弟、朋友、同学、同事、邻居、知己
- 职业：上司、下属、合作伙伴
- 敌对：敌人、仇人、竞争对手、宿敌

【数值范围】
- intimacy_level：-100到100（负值表示敌对）
- loyalty：0到100
- rank：0到10
</output>

<constraints>
【必须遵守】
✅ 符合世界观：角色设定与项目世界观一致
✅ 主题关联：背景故事与项目主题关联
✅ 立体饱满：性格复杂有矛盾性，不脸谱化
✅ 为故事服务：设定要推动剧情发展
✅ 职业匹配：职业选择与角色高度契合

【格式约束】
✅ 纯JSON对象输出，无markdown标记
✅ 内容描述中严禁使用特殊符号
✅ 专有名词直接书写

【禁止事项】
❌ 输出markdown或代码块标记
❌ 在描述中使用特殊符号（引号、方括号等）
❌ 引用不存在的角色或组织
❌ 脸谱化的角色设定
</constraints>"""

    SINGLE_ORGANIZATION_GENERATION = """<system>
你是专业的组织设定师，擅长创建完整的组织/势力设定。
</system>

<task>
【设计任务】
根据用户需求和项目上下文，创建一个完整的组织/势力设定。
</task>

<context priority="P0">
【项目上下文】
{project_context}

【用户需求】
{user_input}
</context>

<output priority="P0">
【输出格式】
生成完整的组织设定JSON对象：

{{
  "name": "组织名称（如用户未提供则生成符合世界观的名称）",
  "is_organization": true,
  "organization_type": "组织类型（帮派/公司/门派/学院/政府机构/宗教组织等）",
  "personality": "组织特性（150-200字）：核心理念、行事风格、文化价值观、运作方式",
  "background": "组织背景（200-300字）：建立历史、发展历程、重要事件、当前地位",
  "appearance": "外在表现（100-150字）：总部位置、标志性建筑、组织标志、制服等",
  "organization_purpose": "组织目的和宗旨：明确目标、长期愿景、行动准则",
  "power_level": 75,
  "location": "所在地点：主要活动区域、势力范围",
  "motto": "组织格言或口号",
  "traits": ["特征1", "特征2", "特征3"],
  "color": "组织代表颜色（如：深红色、金色、黑色等）",
  "organization_members": ["重要成员1", "重要成员2", "重要成员3"]
}}

【字段说明】
- power_level：0-100的整数，表示在世界中的影响力
- organization_members：组织内重要成员名字列表（可关联已有角色）
</output>

<constraints>
【必须遵守】
✅ 符合世界观：组织设定与项目世界观一致
✅ 主题关联：背景与项目主题关联
✅ 推动剧情：组织能推动故事发展
✅ 有层级结构：内部有明确的层级和结构
✅ 势力互动：与其他势力有互动关系

【格式约束】
✅ 纯JSON对象输出，无markdown标记
✅ 内容描述中严禁使用特殊符号
✅ 专有名词直接书写

【禁止事项】
❌ 输出markdown或代码块标记
❌ 在描述中使用特殊符号（引号、方括号等）
❌ 过于理想化或脸谱化的设定
❌ 空泛的描述
</constraints>"""

    AUTO_CHARACTER_ANALYSIS = """<system>
你是专业的小说角色设计顾问，擅长预测剧情发展对角色的需求。
</system>

<task>
【分析任务】
预测在接下来的{chapter_count}章续写中，根据剧情发展方向和阶段，是否需要引入新角色。

【重要说明】
这是预测性分析，而非基于已生成内容的事后分析。
</task>

<project priority="P1">
【项目信息】
书名：{title}
类型：{genre}
主题：{theme}

【世界观】
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
</project>

<context priority="P0">
【已有角色】
{existing_characters}

【已有章节概览】
{all_chapters_brief}

【续写计划】
- 起始章节：第{start_chapter}章
- 续写数量：{chapter_count}章
- 剧情阶段：{plot_stage}
- 发展方向：{story_direction}
</context>

<output priority="P0">
【输出格式】
返回纯JSON对象（两种情况之一）：

**情况A：需要新角色**
{{
  "needs_new_characters": true,
  "reason": "预测分析原因（150-200字），说明为什么即将的剧情需要新角色",
  "character_count": 2,
  "character_specifications": [
    {{
      "name": "建议的角色名字（可选）",
      "role_description": "角色在剧情中的定位和作用（100-150字）",
      "suggested_role_type": "supporting/antagonist/protagonist",
      "importance": "high/medium/low",
      "appearance_chapter": {start_chapter},
      "key_abilities": ["能力1", "能力2"],
      "plot_function": "在剧情中的具体功能",
      "relationship_suggestions": [
        {{
          "target_character": "现有角色名",
          "relationship_type": "建议的关系类型",
          "reason": "为什么建立这种关系"
        }}
      ]
    }}
  ]
}}

**情况B：不需要新角色**
{{
  "needs_new_characters": false,
  "reason": "现有角色足以支撑即将的剧情发展，说明理由"
}}
</output>

<constraints>
【必须遵守】
✅ 这是预测性分析，面向未来剧情
✅ 考虑剧情的自然发展和节奏
✅ 确保引入必要性，不为引入而引入
✅ 优先考虑角色的长期作用

【禁止事项】
❌ 输出markdown标记
❌ 基于已生成内容做事后分析
❌ 为了引入角色而强行引入
❌ 设计一次性功能角色
</constraints>"""

    AUTO_CHARACTER_GENERATION = """<system>
你是专业的角色设定师，擅长根据剧情需求创建完整的角色设定。
</system>

<task>
【生成任务】
为小说生成新角色的完整设定，包括基本信息、性格背景、关系网络和职业信息。
</task>

<project priority="P1">
【项目信息】
书名：{title}
类型：{genre}
主题：{theme}

【世界观】
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
世界规则：{rules}
</project>

<context priority="P0">
【已有角色】
{existing_characters}

【剧情上下文】
{plot_context}

【角色规格要求】
{character_specification}
</context>

<requirements priority="P0">
【核心要求】
1. 角色必须符合剧情需求和世界观设定
2. **必须分析新角色与已有角色的关系**，至少建立1-3个有意义的关系
3. 性格、背景要有深度和独特性
4. 外貌描写要具体生动
5. 特长和能力要符合角色定位
6. **如果【已有角色】中包含职业列表，必须为角色设定职业**
</requirements>

<output priority="P0">
【输出格式】
返回纯JSON对象：

{{
  "name": "角色姓名",
  "age": 25,
  "gender": "男/女/其他",
  "role_type": "supporting",
  "personality": "性格特点的详细描述（100-200字）",
  "background": "背景故事的详细描述（100-200字）",
  "appearance": "外貌描述（50-100字）",
  "traits": ["特长1", "特长2", "特长3"],
  "relationships_text": "用自然语言描述该角色与其他角色的关系网络",
  "relationships": [
    {{
      "target_character_name": "已存在的角色名称",
      "relationship_type": "关系类型",
      "intimacy_level": 75,
      "description": "关系的具体描述",
      "status": "active"
    }}
  ],
  "organization_memberships": [
    {{
      "organization_name": "已存在的组织名称",
      "position": "职位",
      "rank": 5,
      "loyalty": 80
    }}
  ],
  "career_info": {{
    "main_career_name": "从可用主职业列表中选择的职业名称",
    "main_career_stage": 5,
    "sub_careers": [
      {{
        "career_name": "从可用副职业列表中选择的职业名称",
        "stage": 3
      }}
    ]
  }}
}}

【数值范围】
- intimacy_level：-100到100（负值表示敌对）
- loyalty：0到100
- rank：0到10
</output>

<constraints>
【必须遵守】
✅ 符合剧情需求和世界观设定
✅ relationships数组必填：至少1-3个关系
✅ target_character_name必须精确匹配【已有角色】
✅ organization_memberships只能引用已存在的组织

【禁止事项】
❌ 输出markdown标记
❌ 在描述中使用特殊符号
❌ 引用不存在的角色或组织
❌ 使用职业ID而非职业名称
</constraints>"""

    AUTO_ORGANIZATION_ANALYSIS = """<system>
你是专业的小说世界构建顾问，擅长预测剧情发展对组织/势力的需求。
</system>

<task>
【分析任务】
预测在接下来的{chapter_count}章续写中，根据剧情发展方向和阶段，是否需要引入新的组织或势力。

【重要说明】
这是预测性分析，而非基于已生成内容的事后分析。
组织包括：帮派、门派、公司、政府机构、神秘组织、家族等。
</task>

<project priority="P1">
【项目信息】
书名：{title}
类型：{genre}
主题：{theme}

【世界观】
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
</project>

<context priority="P0">
【已有组织】
{existing_organizations}

【已有章节概览】
{all_chapters_brief}

【续写计划】
- 起始章节：第{start_chapter}章
- 续写数量：{chapter_count}章
- 剧情阶段：{plot_stage}
- 发展方向：{story_direction}
</context>

<output priority="P0">
【输出格式】
返回纯JSON对象（两种情况之一）：

**情况A：需要新组织**
{{
  "needs_new_organizations": true,
  "reason": "预测分析原因（150-200字）",
  "organization_count": 1,
  "organization_specifications": [
    {{
      "name": "建议的组织名字（可选）",
      "organization_type": "组织类型",
      "role_description": "组织在剧情中的定位和作用（100-150字）",
      "importance": "high/medium/low",
      "appearance_chapter": {start_chapter},
      "key_features": ["特征1", "特征2"],
      "plot_function": "在剧情中的具体功能"
    }}
  ]
}}

**情况B：不需要新组织**
{{
  "needs_new_organizations": false,
  "reason": "现有组织足以支撑即将的剧情发展，说明理由"
}}
</output>

<constraints>
【必须遵守】
✅ 这是预测性分析，面向未来剧情
✅ 考虑剧情的自然发展和节奏
✅ 确保引入必要性，不为引入而引入

【禁止事项】
❌ 输出markdown标记
❌ 基于已生成内容做事后分析
❌ 为了引入组织而强行引入
</constraints>"""

    AUTO_ORGANIZATION_GENERATION = """<system>
你是专业的组织设定师，擅长根据剧情需求创建完整的组织/势力设定。
</system>

<task>
【生成任务】
为小说生成新组织的完整设定。
</task>

<project priority="P1">
【项目信息】
书名：{title}
类型：{genre}
主题：{theme}

【世界观】
时间背景：{time_period}
地理位置：{location}
氛围基调：{atmosphere}
世界规则：{rules}
</project>

<context priority="P0">
【已有组织】
{existing_organizations}

【剧情上下文】
{plot_context}

【组织规格要求】
{organization_specification}
</context>

<output priority="P0">
【输出格式】
返回纯JSON对象：

{{
  "name": "组织名称",
  "is_organization": true,
  "organization_type": "组织类型",
  "personality": "组织特性（150-200字）",
  "background": "组织背景（200-300字）",
  "appearance": "外在表现（100-150字）",
  "organization_purpose": "组织目的和宗旨",
  "power_level": 75,
  "location": "所在地点",
  "motto": "组织格言或口号",
  "traits": ["特征1", "特征2", "特征3"],
  "color": "组织代表颜色",
  "organization_members": ["重要成员1", "重要成员2"]
}}

【字段说明】
- power_level：0-100的整数，表示在世界中的影响力
</output>

<constraints>
【必须遵守】
✅ 符合剧情需求和世界观设定
✅ 有层级结构和内部运作方式
✅ 能推动故事发展

【禁止事项】
❌ 输出markdown标记
❌ 在描述中使用特殊符号
❌ 空泛的描述
</constraints>"""

    # ========== P3 辅助功能模板 ==========

    CHAPTER_REGENERATION_SYSTEM = """<system>
你是经验丰富的专业小说编辑和作家，擅长根据反馈意见重新创作章节。
你的任务是根据修改指令，对原始章节进行深度改写和优化。
</system>

<task>
【重写任务】
1. 仔细理解原始章节的内容、情节走向和叙事意图
2. 认真分析所有的修改要求，包括AI分析建议和用户自定义指令
3. 针对每一条修改建议，在新版本中进行具体改进
4. 在保持故事连贯性和角色一致性的前提下，创作改进后的新版本
5. 确保新版本在艺术性、可读性和叙事质量上都有明显提升
</task>

<guidelines>
【改写原则】
- **问题导向**：针对修改指令中指出的每个问题进行改进
- **保持精华**：保留原章节中优秀的描写、对话和情节设计
- **深化细节**：增强场景描写、情感渲染和人物刻画
- **节奏优化**：调整叙事节奏，避免拖沓或过快
- **风格一致**：如果提供了写作风格要求，必须严格遵循
</guidelines>

<output>
【输出规范】
直接输出重写后的章节正文内容。
- 不要包含章节标题、序号或其他元信息
- 不要输出任何解释、注释或创作说明
- 从故事内容直接开始，保持叙事的连贯性
</output>
"""

    PARTIAL_REGENERATE = """<system>
你是经验丰富的专业小说编辑，擅长对文本进行局部改写和优化。
</system>

<task>
【局部改写任务】
根据用户的修改要求，对选中的文本片段进行改写。
改写后的文本需要与上下文自然衔接。
</task>

<context>
【上下文 - 选中片段之前的内容】
{context_before}

【选中需要改写的文本】
{selected_text}

【上下文 - 选中片段之后的内容】
{context_after}
</context>

<instructions>
【用户修改要求】
{user_instructions}
</instructions>

<output>
【输出规范】
直接输出改写后的文本片段（仅替换选中部分）。
不要包含任何解释、注释或标记。
</output>
"""

    MCP_TOOL_TEST = """你是MCP插件测试助手，需要测试插件 '{plugin_name}' 的功能。

⚠️ 重要规则：生成参数时，必须严格使用工具 schema 中定义的原始参数名称，不要转换为 snake_case 或其他格式。

请选择一个合适的工具进行测试，优先选择搜索、查询类工具。
生成真实有效的测试参数。

现在开始测试这个插件。"""

    MCP_TOOL_TEST_SYSTEM = """你是专业的API测试工具。当给定工具列表时，选择一个工具并使用合适的参数调用它。

⚠️ 关键规则：调用工具时，必须严格使用 schema 中定义的原始参数名，不要自行转换命名风格。"""

    MCP_WORLD_BUILDING_PLANNING = """你正在为小说《{title}》设计世界观。

【小说信息】
- 题材：{genre}
- 主题：{theme}
- 简介：{description}

【任务】
请使用可用工具搜索相关背景资料，帮助构建更真实、更有深度的世界观设定。
你可以查询：
1. 历史背景（如果是历史题材）
2. 地理环境和文化特征
3. 相关领域的专业知识
4. 类似作品的设定参考

请查询最关键的1个问题（不要超过1个）。"""

    MCP_CHARACTER_PLANNING = """你正在为小说《{title}》设计角色。

【小说信息】
- 题材：{genre}
- 主题：{theme}
- 时代背景：{time_period}
- 地理位置：{location}

【任务】
请使用可用工具搜索相关参考资料，帮助设计更真实、更有深度的角色。
你可以查询：
1. 该时代/地域的真实历史人物特征
2. 文化背景和社会习俗
3. 职业特点和生活方式
4. 相关领域的人物原型

请查询最关键的1个问题（不要超过1个）。"""

    NOVEL_COVER_PROMPT_TEMPLATE = """为小说《{title}》生成封面图像。

小说信息：
- 类型：{genre}
- 主题：{theme}
- 简介：{description}

请生成一个符合小说类型和主题的封面图像提示词。"""

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
        """获取模板（优先返回用户自定义模板，否则返回系统默认）。

        Args:
            template_key: 模板标识（如 WORLD_BUILDING, CHAPTER_GENERATION_ONE_TO_MANY）
            user_id: 用户ID（用于查询自定义模板）
            db: 数据库会话（AsyncSession）

        Returns:
            模板内容字符串

        Raises:
            ValueError: 模板不存在时抛出
        """
        # 1. 尝试从数据库获取用户自定义模板（优先级最高）
        if user_id and db:
            try:
                from sqlalchemy import select
                from app.gateway.novel_migrated.models.prompt_template import PromptTemplate

                result = await db.execute(
                    select(PromptTemplate).where(
                        PromptTemplate.user_id == user_id,
                        PromptTemplate.template_key == template_key,
                        PromptTemplate.is_active == True
                    )
                )
                custom = result.scalar_one_or_none()
                if custom and custom.template_content:
                    logger.debug("使用用户自定义模板: %s (user=%s)", template_key, user_id)
                    return custom.template_content
            except Exception as e:
                # 数据库查询失败时降级到系统默认模板，不阻断业务
                logger.warning("查询自定义模板失败: %s, 将使用系统默认模板。错误: %s", template_key, e)

        # 2. 回退到系统内置模板（类属性）
        template_content = getattr(cls, template_key, None)
        if template_content is None:
            logger.warning("未找到提示词模板: %s", template_key)
            raise ValueError(f"未找到提示词模板: {template_key}")

        logger.debug("使用系统默认模板: %s", template_key)
        return template_content

    # ========== P2 补齐：新增方法（参考项目兼容） ==========

    @staticmethod
    def apply_style_to_prompt(base_prompt: str, style_name: str, style_description: str = "") -> str:
        """
        应用写作风格到基础提示词
        
        Args:
            base_prompt: 基础提示词
            style_name: 风格名称（如"古风"、"赛博朋克"）
            style_description: 风格描述
            
        Returns:
            应用风格后的提示词
        """
        style_instruction = f"""
<writing_style>
风格名称：{style_name}
{'风格描述：' + style_description if style_description else ''}
</writing_style>

请严格遵循上述写作风格进行创作。
"""
        return f"{base_prompt}\n\n{style_instruction}"

    @staticmethod
    def build_novel_cover_prompt(
        title: str,
        genre: str,
        theme: str,
        description: str,
        atmosphere: str = "",
    ) -> str:
        """
        构建小说封面生成提示词
        
        Args:
            title: 书名
            genre: 类型
            theme: 主题
            description: 简介
            atmosphere: 氛围基调
            
        Returns:
            封面生成提示词
        """
        return f"""请为以下小说设计一张精美的封面：

书名：《{title}》
类型：{genre}
主题：{theme}
简介：{description[:200] if description else '暂无'}
{'氛围基调：' + atmosphere if atmosphere else ''}

要求：
1. 突出小说的核心主题和氛围
2. 色彩搭配符合类型特点
3. 构图简洁大气，适合作为书籍封面
4. 避免过于复杂的元素
5. 风格统一，具有艺术感"""

    @staticmethod
    def get_chapter_regeneration_prompt(
        chapter_title: str,
        chapter_outline: str,
        previous_context: str = "",
        regeneration_reason: str = "质量优化",
    ) -> str:
        """
        获取章节重新生成提示词
        
        Args:
            chapter_title: 章节标题
            chapter_outline: 章节大纲
            previous_context: 前文上下文
            regeneration_reason: 重新生成原因
            
        Returns:
            章节重写提示词
        """
        return f"""请根据以下信息重新生成章节内容：

章节标题：{chapter_title}
章节大纲：
{chapter_outline}
{'前文上下文：\n' + previous_context[-500:] if previous_context else ''}

重新生成原因：{regeneration_reason}

要求：
1. 严格遵循章节大纲的情节安排
2. 保持与前文的连贯性
3. 提升文字质量和表现力
4. 保持人物性格和语气一致
5. 字数控制在合理范围内（3000-5000字）"""

    @staticmethod
    def get_mcp_tool_test_prompts() -> dict:
        """
        获取 MCP 工具测试提示词集合
        
        Returns:
            包含各类工具测试场景的提示词字典
        """
        return {
            "weather_test": "请查询北京今天的天气情况",
            "search_test": "请搜索'人工智能最新进展'相关信息",
            "calculator_test": "请计算 123 * 456 的结果",
            "translation_test": "请将'Hello, how are you?'翻译成中文",
            "code_test": "请用Python写一个快速排序算法",
        }

    @staticmethod
    def get_all_system_templates() -> list[dict]:
        """
        获取所有系统默认模板列表（用于模板管理界面）
        
        Returns:
            模板字典列表，每个包含 template_key, template_name, content, description, category, parameters
        """
        templates = []
        
        # 收集所有以大写字母开头的类属性（模板常量）
        for attr_name in dir(PromptService):
            if attr_name.isupper() and not attr_name.startswith("_"):
                attr_value = getattr(PromptService, attr_name, None)
                if isinstance(attr_value, str) and len(attr_value) > 50:
                    templates.append({
                        "template_key": attr_name,
                        "template_name": attr_name.replace("_", " ").title(),
                        "content": attr_value,
                        "description": f"系统内置模板：{attr_name}",
                        "category": _infer_template_category(attr_name),
                        "parameters": _extract_template_parameters(attr_value),
                    })
        
        logger.info(f"📋 获取到 {len(templates)} 个系统默认模板")
        return templates

    @staticmethod
    def get_system_template_info(template_key: str) -> dict | None:
        """
        获取指定系统模板的信息
        
        Args:
            template_key: 模板标识（如 WORLD_BUILDING, CAREER_SYSTEM_GENERATION）
            
        Returns:
            模板信息字典，如果不存在则返回 None
        """
        template_content = getattr(PromptService, template_key, None)
        if template_content is None or not isinstance(template_content, str):
            return None
        
        return {
            "template_key": template_key,
            "template_name": template_key.replace("_", " ").title(),
            "content": template_content,
            "description": f"系统内置模板：{template_key}",
            "category": _infer_template_category(template_key),
            "parameters": _extract_template_parameters(template_content),
        }


def _infer_template_category(template_key: str) -> str:
    """根据模板名称推断分类"""
    key_lower = template_key.lower()
    if any(k in key_lower for k in ["world", "世界观"]):
        return "世界构建"
    elif any(k in key_lower for k in ["career", "职业"]):
        return "职业体系"
    elif any(k in key_lower for k in ["character", "角色"]):
        return "角色创建"
    elif any(k in key_lower for k in ["outline", "大纲"]):
        return "大纲生成"
    elif any(k in key_lower for k in ["inspiration", "灵感"]):
        return "灵感模式"
    elif any(k in key_lower for k in ["chapter", "章节"]):
        return "章节生成"
    else:
        return "通用"


def _extract_template_parameters(template: str) -> list[dict]:
    """从模板内容中提取参数列表（简单的 {xxx} 匹配）"""
    import re
    
    parameters = []
    pattern = r"\{(\w+)\}"
    
    for match in re.finditer(pattern, template):
        param_name = match.group(1)
        if param_name not in [p["name"] for p in parameters]:
            parameters.append({
                "name": param_name,
                "required": True,
                "description": f"参数: {param_name}",
            })
    
    return parameters
