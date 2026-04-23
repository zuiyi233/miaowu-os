# Novel Tool Gap Analysis — AI Context Document

> 本文档为 AI 辅助开发提供关键上下文，非面向人类阅读的说明文档。
> 
> **状态更新 (2026-04-24)**：方案 B（统一工具架构）已实施，本文档标注实施状态。

## 1. 现状

### 1.1 对话流已注册小说工具（14个）✅ 已修复

| 工具 | 功能 | 文件 |
|------|------|------|
| `create_novel` | 创建项目（含会话门控+双写+补偿） | `novel_tools.py` |
| `build_world` | AI 生成世界观 | `novel_creation_tools.py` ✅ 新增 |
| `generate_characters` | AI 生成角色/组织 | `novel_creation_tools.py` ✅ 新增 |
| `generate_outline` | 生成/续写大纲 | `novel_creation_tools.py` ✅ 新增 |
| `expand_outline` | 展开大纲为子章节 | `novel_creation_tools.py` ✅ 新增 |
| `generate_chapter` | 生成章节（批量） | `novel_creation_tools.py` ✅ 新增 |
| `generate_career_system` | AI 生成职业体系 | `novel_creation_tools.py` ✅ 新增 |
| `analyze_chapter` | 情节分析 | `novel_analysis_tools.py` ✅ 新增 |
| `manage_foreshadow` | 伏笔管理（CRUD+状态） | `novel_analysis_tools.py` ✅ 新增 |
| `search_memories` | 语义检索记忆 | `novel_analysis_tools.py` ✅ 新增 |
| `check_consistency` | 跨章一致性检查 | `novel_analysis_tools.py` ✅ 新增 |
| `polish_text` | 文本润色 | `novel_analysis_tools.py` ✅ 新增 |
| `generate_image_draft` | 图片草稿（封面等） | `media_draft_tools.py` |
| `generate_tts_draft` | 语音草稿 | `media_draft_tools.py` |

注册入口：`backend/packages/harness/deerflow/tools/tools.py` → `BUILTIN_TOOLS` → `get_available_tools()` → `make_lead_agent()`

### 1.2 后端能力（novel_migrated）

- **33** 服务文件（`backend/app/gateway/novel_migrated/services/`）
- **31** 数据表（`backend/app/gateway/novel_migrated/models/`）
- **120+** API 端点（`backend/app/gateway/novel_migrated/api/`）
- **8** 智能体类型：writer/critic/polish/outline/summary/continue/world_build/character

**关键**：后端能力完整，但全部未暴露为对话流工具。

## 2. 工具覆盖缺口

创作环节覆盖率：**14/19（73.7%）** ✅ 从 15.8% 提升至 73.7%

| 环节 | 后端服务 | 对话流工具 | 缺口 |
|------|---------|-----------|------|
| 小说初始化 | `inspiration.py` | `create_novel` ✅ | 🟡 仅创建，无灵感/补全 |
| 世界观构建 | `prompt_service.py` + `wizard_stream.py` | `build_world` ✅ | ✅ 已修复 |
| 职业体系 | `career_service.py` + `career_update_service.py` | `generate_career_system` ✅ | ✅ 已修复 |
| 角色生成 | `auto_character_service.py` | `generate_characters` ✅ | ✅ 已修复 |
| 组织生成 | `auto_organization_service.py` | `generate_characters` ✅ | ✅ 已修复 |
| 大纲生成/续写 | `plot_expansion_service.py` + `prompt_service.py` | `generate_outline` ✅ | ✅ 已修复 |
| 大纲展开 | `plot_expansion_service.py` | `expand_outline` ✅ | ✅ 已修复 |
| 章节创作(1-N/1-1) | `chapter_context_service.py` + `novel_stream.py` | `generate_chapter` ✅ | ✅ 已修复 |
| 章节重写 | `chapter_regenerator.py` | ❌ | 🟡 可通过 API 直接调用 |
| 局部重写 | `chapter_regenerator.py` | ❌ | 🟡 可通过 API 直接调用 |
| 情节分析 | `plot_analyzer.py` + `orchestration_service.py` | `analyze_chapter` ✅ | ✅ 已修复 |
| 伏笔管理 | `foreshadow_service.py`（~1700行） | `manage_foreshadow` ✅ | ✅ 已修复 |
| 记忆检索 | `memory_service.py`（向量+降级） | `search_memories` ✅ | ✅ 已修复 |
| 拆书导入 | `book_import_service.py` | ❌ | 🟡 低频 |
| 封面生成 | `cover_generation_service.py` | `generate_image_draft` 🟡 | 🟡 草稿模式 |
| 一致性检查 | `consistency_gate_service.py` | `check_consistency` ✅ | ✅ 已修复 |
| 定稿门禁 | `consistency_gate_service.py` | ❌ | 🟡 可通过 API 直接调用 |
| 润色 | `polish.py` API | `polish_text` ✅ | ✅ 已修复 |
| 角色状态更新 | `character_state_update_service.py` | ❌ | 🟡 通过 analyze_chapter 间接触发 |

## 3. 并行调用与数据一致性风险

### 3.1 双体系执行差异 ✅ 已修复

| 维度 | DeerFlow Agent | Novel AIService |
|------|---------------|-----------------|
| 执行引擎 | LangGraph ToolNode | 手动 `_handle_tool_calls_loop` |
| 并行 | ✅ 原生并行 | ✅ `asyncio.gather` 并行（已修复） |
| 限制 | `task` 工具限 2~4 并发 | 无限制 |

### 3.2 数据风险修复状态

1. **AIService 顺序瓶颈** ✅ 已修复：`ai_service.py` 工具循环改为 `asyncio.gather` 并行执行
2. **双写无事务** ✅ 已修复：`novel_tools.py` legacy 写入失败时记录到 `novel_dual_write_log` 表，后台任务指数退避重试
3. **生命周期状态竞争** ⚠️ 部分修复：Project/Chapter 添加 `version` 字段 + `optimistic_lock.py` 辅助函数，但需逐步在各 API 路由中采用
4. **伏笔/记忆并行写入** ⚠️ 部分修复：写入工具添加 `idempotency_key` 参数 + `novel_idempotency.py` 去重模块，但后端服务内部仍需适配

## 4. 需新增的对话流工具

### P0 — 核心创作流程 ✅ 已完成

| 工具名 | 对应 API | 功能 | 状态 |
|--------|---------|------|------|
| `build_world` | `POST /projects/world-build` | AI 生成世界观 | ✅ |
| `generate_characters` | `POST /characters/generate` | AI 生成角色/组织 | ✅ |
| `generate_outline` | `POST /outlines/project/{id}` + 续写 | 生成/续写大纲 | ✅ |
| `expand_outline` | `POST /outlines/expand` | 展开大纲为子章节 | ✅ |
| `generate_chapter` | `POST /chapters/batch-generate` | 生成章节 | ✅ |
| `analyze_chapter` | `POST /api/chapters/{id}/analyze` | 情节分析 | ✅ |
| `manage_foreshadow` | `/api/foreshadows` CRUD + 状态操作 | 伏笔管理 | ✅ |
| `generate_career_system` | `GET /api/careers/generate-system` | 职业体系 | ✅ |
| `search_memories` | `POST /api/memories/projects/{id}/search` | 语义检索记忆 | ✅ |
| `check_consistency` | `GET /polish/projects/{id}/consistency-report` | 一致性检查 | ✅ |
| `polish_text` | `POST /polish` | 文本润色 | ✅ |

### P1 — 并行与一致性 ✅ 已完成

- ✅ AIService `_handle_tool_calls_loop` 改为 `asyncio.gather` 并行执行
- ✅ 核心模型添加 `version` 字段 + `optimistic_lock.py` 乐观锁
- ✅ 写入工具添加 `idempotency_key`（`novel_idempotency.py` 去重模块）
- ✅ `create_novel` 双写失败记录到 `novel_dual_write_log` 表 + 后台指数退避重试

### P2 — 工具分组 ✅ 已完成

- ✅ `NOVEL_TOOL_NAMES` 集合定义，`CORE_TOOLS` / `NOVEL_TOOLS` 分离
- ✅ `get_available_tools` 新增 `include_novel` 参数，非小说对话可排除小说工具
- ⚠️ 意图识别中间件动态注入：`include_novel` 参数已暴露，需在 `make_lead_agent` 调用处接入意图判断

## 5. 关键文件索引

| 用途 | 路径 |
|------|------|
| 工具注册总入口 | `backend/packages/harness/deerflow/tools/tools.py` |
| 小说工具定义 | `backend/packages/harness/deerflow/tools/builtins/novel_tools.py` |
| 小说创作工具（6个）✅ | `backend/packages/harness/deerflow/tools/builtins/novel_creation_tools.py` |
| 小说分析工具（5个）✅ | `backend/packages/harness/deerflow/tools/builtins/novel_analysis_tools.py` |
| 工具共享辅助 ✅ | `backend/packages/harness/deerflow/tools/builtins/novel_tool_helpers.py` |
| 幂等键去重 ✅ | `backend/packages/harness/deerflow/tools/builtins/novel_idempotency.py` |
| 媒体草稿工具 | `backend/packages/harness/deerflow/tools/builtins/media_draft_tools.py` |
| Agent 工厂 | `backend/packages/harness/deerflow/agents/lead_agent/agent.py` |
| 意图识别中间件 | `backend/app/gateway/middleware/intent_recognition_middleware.py` |
| AIService（并行工具循环）✅ | `backend/app/gateway/novel_migrated/services/ai_service.py` |
| MCP 工具桥接 | `backend/app/gateway/novel_migrated/services/mcp_tools_loader.py` |
| 生命周期状态机 | `backend/app/gateway/novel_migrated/services/lifecycle_service.py` |
| 乐观锁辅助 ✅ | `backend/app/gateway/novel_migrated/services/optimistic_lock.py` |
| 双写补偿服务 ✅ | `backend/app/gateway/novel_migrated/services/dual_write_service.py` |
| 伏笔管理 | `backend/app/gateway/novel_migrated/services/foreshadow_service.py` |
| 记忆服务 | `backend/app/gateway/novel_migrated/services/memory_service.py` |
| 章节上下文 | `backend/app/gateway/novel_migrated/services/chapter_context_service.py` |
| 章节重写 | `backend/app/gateway/novel_migrated/services/chapter_regenerator.py` |
| 情节分析 | `backend/app/gateway/novel_migrated/services/plot_analyzer.py` |
| 大纲展开 | `backend/app/gateway/novel_migrated/services/plot_expansion_service.py` |
| 角色自动引入 | `backend/app/gateway/novel_migrated/services/auto_character_service.py` |
| 职业生成 | `backend/app/gateway/novel_migrated/services/career_service.py` |
| 一致性门禁 | `backend/app/gateway/novel_migrated/services/consistency_gate_service.py` |
| Agent 配置模型 | `backend/app/gateway/novel_migrated/models/novel_agent_config.py` |
| Project 模型（含 version）✅ | `backend/app/gateway/novel_migrated/models/project.py` |
| Chapter 模型（含 version）✅ | `backend/app/gateway/novel_migrated/models/chapter.py` |
| 双写日志模型 ✅ | `backend/app/gateway/novel_migrated/models/dual_write_log.py` |
| 工具配置模型 | `backend/packages/harness/deerflow/config/tool_config.py` |
