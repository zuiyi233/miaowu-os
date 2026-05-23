# Miaowu-OS 小说作者交互与业界差距研究报告

编制日期：2026-05-24  
范围：`N:\miaowu-os-merge-upstream-main` 当前小说功能、Trellis 任务 `05-24-novel-main-agent-convergence`、既有小说审查报告、公开联网资料。  
结论级别：已联网核验公开资料；未登录竞品后台做深度试用；未对当前本地前端执行浏览器走查；本报告是产品/架构研究与差距评估，不是代码验收报告。

## 1. 执行摘要

当前 Miaowu-OS 小说功能的工程能力已经不弱：有项目/章节/角色/大纲/伏笔/记忆/工作区文档/对象存储/流式生成/分析/润色/导入导出，主 DeerFlow lead agent 侧也已经注册了较完整的小说工具集。但“作者交互体验”还没有形成一个稳定的创作闭环。

最核心的问题不是“缺一个生成章节按钮”，而是：

1. **AI 仍像接口调用器，不像共同创作的作者助手**。作者给出目标后，系统生成、分析、润色是分散 API 和页面动作；缺少围绕当前作品、当前章节、当前问题的持续对话、提案、局部修改、解释和回滚。
2. **计划、写作、审校、修订没有闭环**。优秀产品会把 Story Bible/Codex、场景卡、时间线、评论、版本、目标和反馈放在一个工作台里；本项目目前功能多，但用户需要自己在页面、工具、流式接口和数据对象之间拼流程。
3. **长篇一致性能力还停在“有 RAG/有分析”阶段**。研究和产品都指向同一件事：长篇写作必须用详细大纲、分层上下文、角色/时间线状态、证据化一致性检查和人类确认门禁。当前项目已有 Novel RAG 与 workspace document 基础，但主生成路径还没有系统性地把这些能力转化为作者可见、可控制的交互。
4. **架构上正在走对方向，但还没有完全收口**。当前 Trellis 任务已经明确：小说模型推理要默认走主 Gateway-embedded LangGraph/RunManager/lead-agent 路径，Novel RAG 只做作品级上下文。这个方向与业界“AI 生态记住你的故事、工具协同、作者控制 AI 介入程度”的趋势一致。

优先建议：先不要继续堆更多单点工具。下一阶段应把“作者工作台闭环”作为产品主线，把现有能力收拢为 5 个核心交互：**作品诊断、场景计划、智能续写、证据化审校、可控修订**。

## 2. 研究方法与资料来源

### 2.1 本地核验

读取并对照了以下本地资料：

- `.trellis/tasks/05-24-novel-main-agent-convergence/prd.md`
- `.trellis/tasks/05-24-novel-main-agent-convergence/design.md`
- `.trellis/tasks/05-24-novel-main-agent-convergence/implement.md`
- `Novel_Creation_Process_Assessment_Report.md`
- `novel-tool-gap-analysis.md`
- `小说功能审查与优化建议_2026-05-20.md`
- `MIAOWU_OS_NOVEL_SAAS_REMAINING_TASKS.md`
- 关键代码：`AIService`、`novel_stream.py`、`memory_service.py`、DeerFlow lead agent/tool registration。

### 2.2 联网核验

公开资料以官方页面和论文页优先：

- [Sudowrite docs](https://docs.sudowrite.com/) 和 [Sudowrite 官网](https://sudowrite.com/)
- [Novelcrafter 官网](https://www.novelcrafter.com/)
- [Plottr features](https://plottr.com/features/)
- [ProWritingAid features](https://prowritingaid.com/features)
- [Dabble features](https://www.dabblewriter.com/features)
- [Reedsy Studio](https://reedsy.com/studio)
- [DOC: Improving Long Story Coherence With Detailed Outline Control](https://arxiv.org/abs/2212.10077)
- [LongStory: Coherent, Complete and Length Controlled Long story Generation](https://arxiv.org/abs/2311.15208)
- [Lost in Stories: Consistency Bugs in Long Story Generation by LLMs](https://arxiv.org/abs/2603.05890)

## 3. 业界优秀案例怎么做

### 3.1 Sudowrite：把 AI 包装成“写作动作”，而不是聊天框

公开资料显示，Sudowrite 的重点不是只提供一个万能聊天窗口，而是把 AI 拆成作者熟悉的动作：

- Story Bible：从想法、梗概、角色、世界观、大纲、场景到初稿逐步推进。
- Write：根据角色、语气、情节弧线继续写，并给作者多个候选。
- Rewrite / Expand / Describe：围绕局部文字做改写、扩写、感官描写增强。
- Feedback：给出可执行的改进点。
- Canvas / Brainstorm / Visualize：把灵感、参考、情节点、角色秘密、情节转折可视化。
- Plugins：允许用户模拟读者、和角色对话、把小说转剧本、构建自定义流程。

对 Miaowu-OS 的启发：

- 作者需要的是“下一步能点什么、能改哪里、为什么这样改”，不是只看到一段生成文本。
- AI 动作应该贴在编辑器选区、章节、场景卡、大纲节点、角色卡旁边。
- 生成输出要有多个候选和明确意图：继续、扩写、压缩、换 POV、加冲突、强化感官、转成对白、保留事实改文风。

### 3.2 Novelcrafter：Codex 是作品记忆中心，AI 只是协作层

Novelcrafter 的公开页面强调 Codex：角色、地点、设定等会自动追踪和链接，是头脑风暴、写作和审稿的基础。它还强调不同规划视图用于提前发现情节漏洞和世界观不一致；AI 可用于 brainstorm、write、review，用户可控制使用程度，并能连接不同 AI 平台或本地模型。

对 Miaowu-OS 的启发：

- Novel RAG 不能只是后端向量索引，应当变成作者可见的“作品事实面板”。
- 作者需要知道本次 AI 调用了哪些事实：角色状态、时间线、伏笔、上一章摘要、长期偏好。
- Codex/Story Bible 要支持跨书/系列复用，但必须区分“事实”“计划”“草稿”“已定稿”。
- AI 对话必须“记得当前作品”，但也必须让作者能看到、修正、锁定它记住的内容。

### 3.3 Plottr：结构化计划优先，场景级属性是核心

Plottr 的功能重点是 timeline、scene cards、plotlines、scene attributes、Story Bible、模板、系列规划和从 timeline 自动生成 outline。它不是以“AI 生成一大段”为中心，而是把故事拆成可移动、可过滤、可标注的结构。

对 Miaowu-OS 的启发：

- 大纲不应只停在章级；需要卷/章/场景/beat 层级。
- 每个场景应有结构化属性：POV、出场人物、地点、目标、冲突、线索、情绪、伏笔、状态变更。
- 作者交互的重点是拖动、筛选、对比、标记“这一场要解决什么”，然后再让 AI 写。
- 一致性检查应落在场景属性和时间线状态上，而不是只读全文让模型泛泛评价。

### 3.4 ProWritingAid：审校结果要可量化、可定位、可转化为行动

ProWritingAid 公开功能包括 25+ 写作报告、章节 critique、全文 manuscript analysis、plot/pacing/characterization 等分析、Virtual Beta Reader、目标进度、风格/节奏/对白/过度用词/感官报告等。

对 Miaowu-OS 的启发：

- 审校不能只返回“建议优化节奏”，应给出位置、证据、严重度、推荐操作。
- 分析结果应直接生成修订任务：接受、忽略、局部改写、加入下一章提醒、加入作品事实。
- 应有章节级、场景级、全书级三种报告。
- 质量指标要可追踪：节奏、冲突密度、对白占比、感官比例、重复词、角色出场平衡、伏笔过期数。

### 3.5 Reedsy Studio / Dabble：作者工作流不止 AI，还包括目标、版本、评论和出版

Reedsy Studio 公开页面强调 plan、draft、edit、format：写作目标和 daily check-ins、Boards 管理 notes/characters/research/worlds、实时协作、track changes/comments、分享预览、EPUB/PDF 输出。Dabble 强调 Plot Grid、Character Profiles、Worldbuilding、Focus Mode、Daily Word Count Goals、Sticky Notes、Comments、Beta Reader Workflow、导出等。

对 Miaowu-OS 的启发：

- “好交互”不等于“更多 AI”。作者每天还需要目标、进度、版本、评论、对比、导出。
- AI 修订必须和版本历史绑定；否则作者不敢让 AI 大幅修改。
- 应支持 beta reader/editor 风格反馈，即使第一阶段只是 AI 模拟读者，也要以评论/批注形式落在文本上。

### 3.6 学术研究共识：长篇生成必须有控制、记忆和一致性检查

三个研究方向与本项目高度相关：

- DOC 论文提出 detailed outliner + detailed controller，把创作负担前移到详细分层大纲，并在生成阶段控制文本贴合大纲。其人评结果显示，详细大纲控制能显著提升 plot coherence、outline relevance 和 interestingness。
- LongStory 强调长短期上下文权重和故事结构位置，用结构位置标记帮助模型控制长篇完整性、长度和一致性。
- ConStory-Bench / ConStory-Checker 指出，长篇 LLM 容易忘记事实、角色特征和世界规则；一致性错误常见于事实和时间维度，并倾向在叙事中段出现；检查器需要给出文本证据。

对 Miaowu-OS 的启发：

- 不能依赖一次 prompt 解决长篇一致性。
- 章节生成前必须明确“本章控制目标”和“不可违反事实”。
- 章节生成后必须自动更新：摘要、角色状态、时间线、伏笔、已发生事实。
- 一致性检查必须证据化：指出哪一章/哪一段和哪条事实冲突。

## 4. Miaowu-OS 当前真实状态

### 4.1 已经具备的关键资产

1. **小说领域模型与服务较完整**  
   现有模块覆盖 Project、Chapter、Character、Outline、Foreshadow、StoryMemory、PlotAnalysis、DocumentIndex、workspace documents、media assets、import/export 等。

2. **Novel RAG 和工作区文档基础已经存在**  
   `memory_service.py` 已支持从 workspace files + document_indexes 增量同步到向量记忆索引，并按 user/project 隔离；支持 `add_memory` 和 `search_memories`。

3. **DeerFlow lead agent 侧已有小说工具集**  
   `NOVEL_BUILTIN_TOOLS` 已包含 `create_novel`、`build_world`、`generate_characters`、`generate_outline`、`generate_chapter`、`analyze_chapter`、`manage_foreshadow`、`search_memories`、`check_consistency`、`polish_text`、`regenerate_chapter`、`partial_regenerate`、`finalize_project`、`import_book`、`update_character_states` 等。`lead_agent` 通过 `include_novel` 控制工具可用性。

4. **当前 Trellis 方向正确**  
   `05-24-novel-main-agent-convergence` 明确要求小说推理走主 RunManager/LangGraph lead-agent 路径，继承 MCP、skills、memory、thread isolation、middleware、logs、token usage、run history 和 tool policy；Novel RAG 保持作品级上下文，不污染主用户记忆。

### 4.2 当前最影响作者体验的缺口

1. **生成路径仍有双运行时痕迹**  
   `AIService` 仍直接创建模型并调用 `ainvoke` / `astream`，`novel_stream.py` 里仍有多处依赖 `AIService.generate_text_stream`、`get_user_ai_service` 的路径。虽然当前工作区已有 `NovelAgentRunService` 和 `NovelContextAssembler` 的新增文件，但从 git 状态看仍是未提交进行中改动，本报告不把它当作已完成验收。

2. **作者无法看见 AI 的“上下文来源”**  
   后端有 RAG、workspace documents、StoryMemory、PlotAnalysis，但前端交互缺少“本次生成引用了哪些事实/大纲/角色状态/伏笔”的可视化。作者无法判断 AI 是不是忘了关键设定。

3. **AI 建议不可行动化**  
   分析、润色、重写存在，但没有统一的 critique/task/comment 模型。优秀产品会把问题落成批注、评分、待办和一键修订；本项目更像“生成一个报告文本”。

4. **结构粒度不够细**  
   现有大纲与章节能力较强，但缺少明确的 scene/beat 工作台。长篇网文真正需要的是“这一场谁在场、冲突是什么、爽点是什么、伏笔怎么埋、状态如何变化”。

5. **修订缺少版本和信任机制**  
   作者不信任 AI 的根本原因是“改坏了怎么办”。没有段落级 diff、版本历史、可回滚、保留事实锁，作者就不会愿意深度交互。

6. **工具多，但作者旅程不连贯**  
   当前能力像工具箱，缺少从“我今天要写第 37 章”到“系统告诉我前情、目标、风险、建议、生成、审校、修订、入库”的主流程。

## 5. 差距矩阵

| 维度 | 优秀案例做法 | Miaowu-OS 当前情况 | 差距判断 |
|---|---|---|---|
| 作品记忆 | Story Bible/Codex 可见、可编辑、可被 AI 引用 | 有 StoryMemory/DocumentIndex/RAG，但作者不可见或不可控 | 高 |
| 分层计划 | 书/卷/章/场景/beat，多视图、可拖动、可筛选 | 章级和大纲能力较多，场景级结构不足 | 高 |
| AI 交互 | 选区动作、多个候选、局部修改、反馈闭环 | 主要是端点式生成/流式输出/报告 | 高 |
| 一致性检查 | 时间线、事实、角色、世界规则，证据化定位 | 有 check_consistency/PlotAnalysis 基础，但未形成证据化门禁 | 高 |
| 修订信任 | 评论、track changes、版本、diff、回滚 | 有重写/润色，但版本与评论闭环不足 | 高 |
| 主运行时 | AI 工具受统一 memory/skills/MCP/log/token 管理 | 正在收口；仍有 AIService 直调痕迹 | 高 |
| 写作习惯 | 目标、统计、每日进度、阅读/专注模式 | 已有部分编辑器和项目功能，目标/统计闭环弱 | 中 |
| 出版交付 | EPUB/PDF/Word/分享预览/beta reader | 导入导出已有基础，出版级体验弱 | 中 |
| 模型选择 | 允许 BYOK、多模型、本地模型、按任务路由 | 已有 AI Provider 设置和模型路由基础 | 中低 |

## 6. 推荐的产品形态：从“小说工具集”升级为“作者控制台”

建议把下一阶段交互收敛为 5 个一级工作流。

### 6.1 作品诊断台

目标：作者打开作品就知道当前问题和下一步。

需要展示：

- 今日写作目标、当前字数、进度。
- 最新章节状态：草稿、待审校、待修订、已定稿。
- 高风险列表：过期伏笔、角色状态冲突、时间线断点、未解决章节目标、节奏过快/过慢。
- AI 可执行建议：生成下一章、补场景、修订冲突、更新角色状态、回收伏笔。

关键交互：

- 每个风险项必须能跳到证据位置。
- 每个建议必须能预览输入上下文和修改范围。
- 作者可以接受、忽略、稍后处理。

### 6.2 场景计划台

目标：把长篇控制从“章纲”推进到“场景/beat”。

建议数据结构：

- `SceneCard`
  - project_id / chapter_id / order
  - scene_goal
  - pov_character
  - location
  - involved_characters
  - conflict
  - emotional_turn
  - foreshadow_in / foreshadow_out
  - required_facts
  - forbidden_facts
  - status_delta
  - target_word_count
  - draft_status

关键交互：

- AI 先生成 3 到 8 张场景卡，而不是直接写 3000 字。
- 作者拖动、合并、删除、锁定场景。
- 每张卡可单独“写正文/扩写/换 POV/加强冲突/补对白”。

### 6.3 智能续写台

目标：让 AI 续写像共同写作，而不是黑盒输出。

建议交互：

- 在编辑器中选区后出现动作：继续、扩写、压缩、改对白、加描写、换节奏、改视角、保留事实润色。
- 每次生成给 2 到 4 个候选，并标注差异：偏动作、偏情绪、偏悬疑、偏爽点。
- 右侧显示“本次上下文包”：用户长期偏好、作品事实、最近章节摘要、相关角色状态、相关伏笔、当前场景卡。
- 作者可以把候选插入、替换、追加到草稿，或要求“保留第二版结构，用第一版语气重写”。

### 6.4 证据化审校台

目标：让一致性检查从“AI 评价”变成“可核查的问题列表”。

建议输出模型：

- issue_id
- issue_type：事实、时间线、角色状态、世界规则、伏笔、节奏、重复、视角、敏感内容
- severity
- evidence_source：章节/段落/句子
- conflicting_fact：来自 Story Bible/Codex/RAG 的事实
- suggestion
- fix_action：局部改写、更新事实、标记例外、加入待办

关键原则：

- 没有证据不生成严重问题。
- 允许作者确认“AI 误判”，并把误判反馈写入审校偏好。
- 审校后自动生成修订队列，而不是只显示一段报告。

### 6.5 可控修订台

目标：建立作者对 AI 修改的信任。

需要：

- 段落级 diff。
- 版本历史。
- 可回滚。
- 保留元素锁：角色行为、世界规则、关键台词、伏笔。
- 修订任务来源：作者选区、审校 issue、大纲变更、角色状态变化。

作者交互：

- “只改这三段，不动结尾。”
- “加强冲突，但不要改变人物关系。”
- “按审校问题 1、3、5 修订，忽略 2、4。”
- “生成修订版但不覆盖原文。”

## 7. 推荐技术路线

### 7.1 P0：先完成主运行时收口

必须完成当前 Trellis 任务的核心方向：

- `NovelContextAssembler`：统一组装用户长期偏好、项目元数据、近期章节/大纲/角色/伏笔、Novel RAG、当前请求。
- `NovelAgentRunService`：小说生成默认走主 RunManager/LangGraph lead-agent，而不是 `AIService` 直调模型。
- 保持 legacy SSE 响应兼容，但把 `run_id`、`thread_id` 作为 additive metadata 暴露给前端。
- 至少迁移一个高价值流式章节生成路径和一个结构化非流式路径。
- `AIService` 退为 legacy/fallback/JSON 清洗兼容层。

这是所有作者交互升级的地基。否则 MCP、skills、主 memory、token usage、run history、thread isolation 和 tool policy 都会继续分裂。

### 7.2 P1：建立“上下文包可见性”

新增一个生成前预览接口：

- `POST /api/novel-migrated/projects/{project_id}/agent-context/preview`

返回：

- user_memory_summary
- project_facts
- chapter_context
- scene_cards
- character_states
- foreshadows
- rag_hits
- excluded_context_reason
- estimated_tokens

前端在生成前显示“AI 将参考这些内容”。作者可以取消某些上下文、锁定事实、补充临时指令。

### 7.3 P2：加入 SceneCard/Beat 层

不要急着全量重构；先做轻量 schema 和 UI：

- 每章允许有若干 scene cards。
- 批量生成章节时，先生成/确认 scene cards，再逐场景写作。
- 每场景生成后写回摘要、状态变化、伏笔变化。
- 后续章节生成时优先检索 scene card 和状态变化，而不是大段正文。

### 7.4 P3：审校 issue 模型化

把 PlotAnalyzer / consistency gate 的结果标准化为 `NovelIssue`：

- issue 分类、证据、严重度、状态、来源、目标实体、修复动作。
- 前端以批注/任务列表显示。
- 修订服务读取 issue 队列生成 patch，而不是要求作者复制建议。

### 7.5 P4：版本与修订安全

每次 AI 修改应产生：

- draft_version
- diff
- source_run_id
- source_context_hash
- accepted_by_user
- rollback_target

这能把 RunManager 的运行记录和小说工作区文档连接起来，形成可追溯创作链。

## 8. 可落地里程碑

### 里程碑 A：主运行时闭环，1 到 2 周

交付：

- `NovelContextAssembler`
- `NovelAgentRunService`
- 迁移章节生成 stream 和一个结构化路径
- 兼容旧 SSE
- 测试覆盖上下文顺序、污染边界、metadata、legacy route 兼容

验收：

- 本地 targeted tests 通过。
- 31 测试栈 smoke：能看到主 run_id/thread_id；生成内容仍写入小说 RAG/workspace；旧前端不破。

### 里程碑 B：上下文可见，1 周

交付：

- Context Preview API。
- 前端生成面板显示“引用来源”。
- RAG 命中项可展开、可排除。
- 事实锁定入口。

验收：

- 作者能在点击生成前看到 AI 会参考什么。
- 生成后 run 记录保存 context hash 和引用摘要。

### 里程碑 C：场景卡，2 到 3 周

交付：

- SceneCard 数据模型。
- 章节计划 UI。
- 章节生成先场景卡后正文。
- 每场景写回摘要和状态变化。

验收：

- 一章可拆 3 到 8 个场景。
- 作者能拖动/锁定/局部生成场景。
- 后续生成能引用上场景状态。

### 里程碑 D：证据化审校，2 周

交付：

- `NovelIssue` 模型。
- 一致性检查返回 evidence + conflicting fact。
- 审校结果落批注/任务。
- 可从 issue 发起局部修订。

验收：

- 至少支持事实冲突、时间线冲突、角色状态冲突、伏笔过期四类问题。
- 每个严重问题必须有证据定位。

### 里程碑 E：版本与可控修订，2 周

交付：

- AI 修改版本记录。
- 段落级 diff。
- 接受/拒绝/回滚。
- 修订动作与 run_id 关联。

验收：

- 作者可放心试多版修订，不覆盖原文。
- 审校 issue 可批量选择修复。

## 9. 当前不建议做的事

1. **不建议继续增加无状态 prompt 按钮**  
   按钮越多，流程越碎，作者越不知道该点什么。

2. **不建议把所有作品事实塞进主 DeerFlow memory**  
   主 memory 应保存用户长期写作偏好；作品事实、章节内容、伏笔和角色状态应留在 Novel RAG/workspace。

3. **不建议直接对标单个竞品复制 UI**  
   本项目的优势是 DeerFlow 主 agent、MCP、skills、run history 和本地/私有部署能力，应做“作者控制台 + agentic workflow”，而不是单纯做 Sudowrite clone。

4. **不建议绕过当前 Trellis 主运行时收口任务**  
   如果生成仍走 `AIService` 私有模型调用，后续所有审校、上下文、运行记录都会继续分裂。

## 10. 最小 MVP 定义

如果只做一个能明显改善作者交互的 MVP，建议定义为：

> 作者在章节编辑页点击“生成下一段”前，系统展示本次会参考的作品事实、角色状态、伏笔、上一章摘要和作者偏好；生成后自动给出 2 个候选；作者选择一个插入；系统自动产生审校 issue 和状态更新建议；作者可接受或忽略。

MVP 必须包含：

- 主运行时生成。
- 上下文预览。
- 两个候选。
- 插入/替换/追加三种写入方式。
- 至少一个证据化审校 issue。
- 生成 run 与章节版本绑定。

这个 MVP 比“再做 10 个生成工具”更有价值，因为它把作者从“调用工具”带到“共同创作”。

## 11. 风险与验证缺口

- 本报告未登录竞品后台，无法确认付费功能的全部细节；仅依据公开官方资料和论文摘要。
- 本报告没有运行当前工作区的未提交代码，也没有对 `NovelAgentRunService` / `NovelContextAssembler` 做验收。
- 当前工作区存在未提交改动：`mcp_plugins.py`、`novel_stream.py`、`polish.py`、新增 novel agent/context service 与测试文件等。本报告没有覆盖或回滚这些改动。
- 31 测试栈是否仍处于上次 smoke 通过状态未在本轮重新验证。
- 竞品资料是 2026-05-24 当天联网核验结果，后续功能和价格可能变化。

## 12. 最终判断

Miaowu-OS 小说模块已经具备“做优秀作者工具”的底层资产，但现在的问题是产品交互没有收束。业界优秀产品的共同点不是模型更神秘，而是把 AI 放进作者熟悉的创作动作里：计划、写作、审校、修订、版本、目标、评论、导出。

本项目下一步应该把“工具覆盖率”目标降级，把“作者闭环完成率”提升为主指标：

- 作者是否知道下一步做什么。
- AI 是否知道当前作品事实。
- 作者是否看得见 AI 用了哪些上下文。
- 生成是否能被局部采纳和回滚。
- 审校是否有证据和可执行修复。
- 作品级记忆是否持续更新但不污染用户全局记忆。

只要这条线打通，Miaowu-OS 的小说功能就会从“能调用很多能力”变成“能陪作者把一本书写完”。
