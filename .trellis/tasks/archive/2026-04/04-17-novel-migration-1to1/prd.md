# brainstorm: 小说缺失功能1:1迁移至主项目

## Goal

将参考项目 `MuMuAINovel-main` 中“当前项目缺失能力”按 1:1 复刻迁移到 `deer-flow-main`，遵循“可复制就复制、禁止重复造轮子、与主项目既有深度 AI 能力对齐复用”的原则，形成可执行的分批迁移任务与验收口径。

## What I already know

- 用户要求：
  - 对缺失能力按 `小说功能对比分析文档.md` 与参考项目代码进行 1:1 复刻。
  - 能复制粘贴就直接复制粘贴，不要重新实现。
  - 若主项目已有相关能力，必须基于主项目现有能力搭建，禁止重复造轮子。
- 当前缺失能力（来自对比文档 5.1）：
  - 职业体系（`Career` / `CharacterCareer`）
  - 伏笔独立模型与状态机
  - 章节分析持久化（`PlotAnalysis`）与记忆持久化（`StoryMemory`）
  - 向量数据库与服务侧语义检索
  - 小说域 MCP 工具加载与多轮工具调用链
  - 拆书导入流水线与导入后自动生成链路
  - 封面生成、灵感生成独立 API
  - 小说域独立认证/后台链路
- 主项目后端结构事实：
  - 后端仅存在 `backend/app/gateway/*` 和 `backend/app/channels/*`，未见参考项目同层 `database/models/schemas/services` 目录结构。
  - `backend/app/gateway/app.py` 中 `CORE_ROUTER_MODULES` 当前只注册 `app.gateway.routers.novel`。
  - 主项目已存在可复用能力路由：`/api/models`、`/api/mcp/config`、`/api/memory`（由 deerflow 提供底层能力）。

## Assumptions (temporary)

- 迁移策略默认采用“源码最大化原样复制 + 最小接入适配层”而非重构。
- 参考项目中与主项目已存在能力重叠处，默认优先复用主项目现有模块，不新建平行实现。
- 第一阶段先打通后端小说域能力，再决定是否扩展到完整前端页面（当前仅做迁移文档，不做实现）。

## Open Questions

- 已确认：Wave 1 不包含 `auth/users/admin`，先聚焦纯小说业务域核心链路（职业/伏笔/记忆/MCP）。
- 已确认：当前阶段不做账号相关能力（`auth/users/admin`、OAuth、邮箱验证码、会话刷新等）。
- 已确认：采用单机单用户模式，小说域统一固定 `user_id` 回退，不引入账号系统。

## Requirements (evolving)

- 必须基于参考项目源码进行 1:1 迁移，不允许主观重写业务逻辑。
- 能直接复制的模块必须优先直接复制，变更仅限于：
  - 路由挂载路径与主项目网关对齐；
  - 依赖注入边界（配置、模型工厂、鉴权入口）对齐；
  - 必要 import 路径调整。
- 与主项目已有能力重叠模块必须复用，禁止重复实现：
  - 模型配置能力复用 `/api/models`；
  - MCP 配置与插件管理复用 `/api/mcp/config`；
  - 全局 memory 能力复用 `/api/memory`。
- 迁移执行必须按“缺失能力分波次”推进，每波次给出：
  - 来源文件清单（参考项目）
  - 目标落位（主项目）
  - 复用点与禁止重复点
  - 验收标准
- Wave 1 范围固定为：职业体系、伏笔状态机、记忆分析与向量检索、MCP 工具链；明确排除 `auth/users/admin`。
- Wave 2 前置要求：在 `novel_migrated` 内实现固定 `user_id` 回退层，仅小说域生效，不影响主项目其他路由。
- Wave 2 必须包含对已落地 Wave 1 接口的无账号化收口改造（`careers/foreshadows/memories/settings/common`），确保整条链路可在单机单用户模式运行。
- Wave 3（账号体系）改为延期，不进入当前实施窗口。

## Acceptance Criteria (evolving)

- [ ] 输出迁移文档包含完整“缺失能力 -> 源文件 -> 目标位置 -> 复用点 -> 验收项”映射表。
- [ ] 每个缺失能力都明确“可直接复制文件清单”与“仅允许的最小适配项”。
- [ ] 文档明确列出主项目已有能力复用清单，避免重复造轮子。
- [ ] 文档包含分批实施顺序（Wave 1/2/3）与边界（in/out）。
- [ ] 文档明确风险与验证缺口（静态分析/运行态联调/数据迁移依赖）。

## Definition of Done (team quality bar)

- 输出 PRD + 迁移执行清单文档。
- 迁移范围、边界、复用原则、验收标准可直接用于实施阶段。
- 文档中的文件路径与模块名已在仓库中核验可定位。
- 对未验证项（运行态、E2E、外部依赖）明确标注。

## Technical Approach

采用“复制优先 + 复用优先 + 最小适配”三层策略：

1. 复制优先：
- 参考项目缺失能力对应 API/Service/Model 文件按原结构拷入主项目的小说域目录（建议在 `backend/app/gateway/novel_migrated/*` 分层隔离）。

2. 复用优先：
- 与主项目既有能力重叠处，不复制其实现，改为接入调用（models/mcp/memory）。

3. 最小适配：
- 仅对路由注册、依赖注入、配置读取、鉴权钩子做薄适配，不改动核心业务逻辑代码路径。

## Decision (ADR-lite)

**Context**: 用户明确要求 1:1 复刻，且强调主项目已有深度 AI 能力，不接受重复造轮子。主项目后端架构与参考项目结构存在差异。  
**Decision**: 采用“参考源码原样迁移 + 网关薄适配 + 主项目能力复用”策略，禁止同功能并行重写。  
**Consequences**: 能最快获得功能对齐并降低语义漂移；但短期会引入结构并存与适配层复杂度，需要后续再做分层收敛。

## Out of Scope (explicit)

- 不在本阶段重构主项目后端整体架构。
- 不在本阶段做 UI 视觉重做或交互重设计。
- 不在本阶段引入与参考项目无关的新功能。
- 不在本阶段对参考项目业务逻辑做“优化性重写”。
- 不在 Wave 1 迁移 `auth/users/admin` 及用户模型链。
- 当前实施窗口不迁移 `auth/users/admin`、`oauth_service`、`email_service`、`user_manager`、`user_password`。

## Technical Notes

- 关键事实来源：
  - `/mnt/d/miaowu-os/小说功能对比分析文档.md`
  - `/mnt/d/miaowu-os/deer-flow-main/backend/app/gateway/app.py`
  - `/mnt/d/miaowu-os/deer-flow-main/backend/app/gateway/routers/{novel,memory,mcp,models}.py`
- 参考项目缺失能力关键源码：
  - API: `backend/app/api/{careers,foreshadows,memories,book_import,project_covers,inspiration,auth,admin,users}.py`
  - Services: `backend/app/services/{career_service,foreshadow_service,memory_service,book_import_service,cover_generation_service,ai_service,mcp_tools_loader}.py`
  - Models: `backend/app/models/{career,foreshadow,memory,user,project}.py`
- 当前验证方式：本地静态核验（未运行联调，未做 E2E）。
- 实施计划文档：
  - `/mnt/d/miaowu-os/.trellis/tasks/04-17-novel-migration-1to1/implementation-plan.md`

## Implementation Status (2026-04-18)

- 已完成 Wave 1 代码迁移落位：`backend/app/gateway/novel_migrated/{api,services,models,schemas,utils,core}`。
- 已完成 Wave 2 全量执行（W2-PR1 ~ W2-PR5）：
  - W2-PR1：固定 `user_id` 回退层与 Wave 1 无账号化收口（`common/settings/careers/foreshadows/memories`）。
  - W2-PR2：灵感模块迁移（`api/inspiration.py`）。
  - W2-PR3：封面模块迁移（`api/project_covers.py` + `services/cover_generation_service.py` + provider 闭包）。
  - W2-PR4：拆书导入迁移（`api/book_import.py` + `services/book_import_service.py` + `schemas/models` 依赖闭包）。
  - W2-PR5：路由聚合注册 + 文档收口（`README.md`、`CLAUDE.md`、任务文档状态回填）。
- 已完成网关接入：`backend/app/gateway/routers/novel_migrated.py` 在保留可选导入容错机制前提下，聚合 Wave 1 + Wave 2 模块。
- 已完成静态验证：`ruff check`（本次改动范围）与 `compileall`（本次改动范围）通过。
- 尚未完成项（Windows 端补验）：`uv sync` 后的运行态联调、`uv run pytest -q` 回归、Wave2 新接口 smoke。
