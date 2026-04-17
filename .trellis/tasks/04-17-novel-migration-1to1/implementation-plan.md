# Implementation Plan - novel-migration-1to1

## 0. 文档信息

- 任务目录：`/mnt/d/miaowu-os/.trellis/tasks/04-17-novel-migration-1to1`
- 计划日期：2026-04-17
- 计划范围：Wave 1 + Wave 2（已执行）
- Wave 1 In-Scope：职业体系、伏笔状态机、记忆分析与向量检索、MCP 工具链
- Wave 1 Out-of-Scope：`auth/users/admin` 与用户模型链
- Wave 2 执行前提：单机单用户固定 `user_id` 回退层（仅 `novel_migrated`）
- Wave 3 状态：延期（当前不做账号体系）

---

## 1. Trellis 规则对齐

本计划按 `.trellis/workflow.md` 与 `brainstorm` 产出规则执行：

1. Read Before Write
- 已完成：基于现有事实文档与参考/主项目代码静态核验后制定计划。

2. Incremental Development
- 采用小步 PR（Wave1: PR1~PR4；Wave2: W2-PR1~W2-PR5），每个 PR 独立可验证、可回滚。

3. Cross-Layer Thinking
- 本任务跨 3+ 层（Gateway Router -> Service -> Model/Vector Store -> Frontend 调用面），在每个 PR 里明确边界契约与验证点。

4. Code Reuse First
- 严格执行“不造轮子”：复用主项目 `models/mcp/memory` 既有能力，避免平行实现。

5. 可验证交付
- 每个 PR 都包含最小验证命令与通过标准；无证据不宣称完成。

---

## 2. 执行目标与原则

## 2.1 执行目标

在不重写业务逻辑的前提下，把参考项目 Wave 1 相关模块按 1:1 复制到主项目，并完成最小接入，使主项目具备可调用的同类能力链路。

## 2.2 固定原则

- 复制优先：能直接复制的文件优先原样复制。
- 适配最小化：仅修改导入路径、路由注册、依赖注入接点、配置入口。
- 复用优先：
  - 模型配置复用 `/api/models`
  - MCP 配置复用 `/api/mcp/config`
  - 全局 memory 管理复用 `/api/memory`
- 禁止项：禁止基于主观理解重写参考项目业务逻辑。

---

## 3. Wave 1 迁移清单（文件级）

## 3.1 业务模块（必须迁移）

- Career
  - `参考: backend/app/api/careers.py`
  - `参考: backend/app/services/career_service.py`
  - `参考: backend/app/services/career_update_service.py`
  - `参考: backend/app/models/career.py`

- Foreshadow
  - `参考: backend/app/api/foreshadows.py`
  - `参考: backend/app/services/foreshadow_service.py`
  - `参考: backend/app/models/foreshadow.py`

- Memory + Vector
  - `参考: backend/app/api/memories.py`
  - `参考: backend/app/services/memory_service.py`
  - `参考: backend/app/models/memory.py`

- MCP Tools Loader
  - `参考: backend/app/services/mcp_tools_loader.py`

## 3.2 传递依赖（按需复制，避免重写）

以下为 Wave 1 文件可见直接依赖，需通过“复制或桥接”满足：

- 基础支撑：
  - `app.database`
  - `app.logger`
  - `app.utils.sse_response`
- API 依赖：
  - `app.api.common`
  - `app.api.settings`
- Schema 依赖：
  - `app.schemas.career`
  - `app.schemas.foreshadow`
- Model 依赖（Wave1 路由/服务直接引用）：
  - `app.models.project`
  - `app.models.chapter`
  - `app.models.character`
  - `app.models.settings`
- Service 依赖：
  - `app.services.plot_analyzer`
  - `app.services.ai_service`（需与主项目既有模型/MCP/memory能力桥接）

---

## 4. 目录落位方案（执行约束）

为避免污染现有网关结构，先隔离落位：

- 目标根：`deer-flow-main/backend/app/gateway/novel_migrated/`
- 建议结构：
  - `api/`
  - `services/`
  - `models/`
  - `schemas/`
  - `utils/`
  - `core/`（如需承载 `database/logger` 桥接）

路由入口先通过单独 router 模块聚合，再由 `gateway/app.py` 增量注册。

---

## 5. 小步 PR 计划（Trellis 推荐格式）

## PR1: 迁移脚手架与依赖闭包建立

### 目标
- 建立 `novel_migrated` 目录与包结构。
- 完成 Wave 1 所需基础依赖的“复制/桥接”闭包。

### 变更
- 新增 `novel_migrated/{api,services,models,schemas,utils}` 目录与 `__init__.py`。
- 复制基础模块：`database/logger/sse_response/common/settings/schemas` 的最小集。
- 在不启用业务路由的前提下，确保模块可 import。

### 验证
- `cd deer-flow-main/backend && uv run python -m compileall app`
- `cd deer-flow-main/backend && uv run ruff check app`

### 通过标准
- `novel_migrated` 目录可被 Python 正常导入。
- 无循环导入/缺失依赖导致的 import error。

---

## PR2: Career + Foreshadow 1:1 迁移接入

### 目标
- 完成职业体系与伏笔状态机路由/服务/模型迁移。

### 变更
- 原样复制 `careers.py / foreshadows.py` 与对应 services/models。
- 做最小适配：导入路径、路由聚合、依赖注入接点。
- 在网关中注册迁移路由（可用开关控制启用）。

### 验证
- `cd deer-flow-main/backend && uv run ruff check app`
- `cd deer-flow-main/backend && uv run pytest -q`（如现有测试可运行）
- 手工 smoke：路由可见、参数校验与 4xx/5xx 行为符合预期。

### 通过标准
- 路由可访问且不会影响现有 `/api/novel*` 路由。
- 业务逻辑代码保持参考项目语义（无重写）。

---

## PR3: Memory/Vector + MCP Tools 链路迁移

### 目标
- 完成章节分析记忆链路、向量检索服务、MCP tools loader 迁移。

### 变更
- 原样复制 `memories.py`、`memory_service.py`、`memory.py`、`mcp_tools_loader.py`。
- 适配主项目已有能力：
  - 对接 `/api/models`（模型配置来源）
  - 对接 `/api/mcp/config`（MCP 配置来源）
  - 对接 `/api/memory`（全局 memory 基础能力）
- 补齐 `chromadb`、`sentence_transformers` 依赖声明（若当前依赖未覆盖）。

### 验证
- `cd deer-flow-main/backend && uv sync`
- `cd deer-flow-main/backend && uv run ruff check app`
- `cd deer-flow-main/backend && uv run python -m compileall app`
- 手工 smoke：analyze/search 路由、异常路径、空数据路径。

### 通过标准
- 记忆与向量链路接口可调用。
- 与主项目现有 `models/mcp/memory` 能力无重复冲突。

---

## PR4: Wave 1 收口（联调与回归）

### 目标
- 完成 Wave 1 跨层联调、文档与规范回填。

### 变更
- 补最小测试（路由 smoke / service 单测）。
- 更新任务 PRD、迁移清单与必要 spec 注记。

### 验证
- `cd deer-flow-main/backend && uv run ruff check app`
- `cd deer-flow-main/backend && uv run pytest -q`
- 必要时配合前端调用链做网关接口联调（仅 Wave1 涉及路径）。

### 通过标准
- Wave 1 in-scope 能力可验证。
- 文档与代码一致，缺口和风险有记录。

---

## 6. 跨层契约与边界（执行时必须逐项核验）

## 6.1 边界 A：Frontend -> Gateway Router

- 输入：HTTP JSON + Query
- 输出：JSON/SSE
- 风险：路径冲突、字段命名漂移
- 约束：保留参考项目 API 语义，新增路径避免覆盖现有 `novel.py` 路由

## 6.2 边界 B：Router -> Service

- 输入：Pydantic Schema / Request payload
- 输出：domain dict / DB model
- 风险：validation 分散、多处重复校验
- 约束：入口校验集中在 router/schema，service 保持参考实现逻辑

## 6.3 边界 C：Service -> Storage/Vector

- 输入：结构化剧情数据
- 输出：DB 记录 + 向量索引
- 风险：依赖缺失、模型缓存路径、性能开销
- 约束：先保证 correctness，性能优化不进入 Wave 1

---

## 7. 质量门禁（每个 PR 必做）

- Lint：`cd deer-flow-main/backend && uv run ruff check app`
- 编译检查：`cd deer-flow-main/backend && uv run python -m compileall app`
- 测试：`cd deer-flow-main/backend && uv run pytest -q`（能跑多少跑多少，失败需记录）
- 手工核验：
  - 新路由启动可见
  - 关键 4xx/5xx 错误路径可复现
  - 不影响现有网关能力

---

## 8. 风险与回滚计划

## 8.1 主要风险

- 架构差异：参考项目的 SQLAlchemy 全栈依赖在主项目并不存在。
- 依赖重量：`sentence_transformers` 与 `chromadb` 增加环境复杂度。
- 路由冲突：新旧小说域端点路径可能重叠。

## 8.2 回滚策略

- 以 PR 为回滚粒度，逐个回退。
- 新增路由统一放在独立注册块，故障时可快速移除注册。
- 迁移代码隔离在 `novel_migrated`，避免污染原有 `gateway/routers/novel.py`。

---

## 9. 完成定义（Wave 1）

- [x] PR1~PR4 合并完成。
- [x] Wave 1 四项能力可调用并有最小验证证据。
- [x] `auth/users/admin` 未进入 Wave 1（保持排除）。
- [x] 所有“未验证项/失败项”均在任务文档中明确记录。

---

## 11. Wave 2 执行记录（已完成）

### 11.1 Wave 2 In-Scope（已落地）

- Wave 1 已落地模块的“无账号化收口改造”（必须先做）
  - `api/common.py`
  - `api/settings.py`
  - `api/careers.py`
  - `api/foreshadows.py`
  - `api/memories.py`
- `api/book_import.py` + `services/book_import_service.py`
- `api/project_covers.py` + `services/cover_generation_service.py`
- `api/inspiration.py`

### 11.2 Wave 2 前置任务（必须先做）

- 在 `novel_migrated` 内新增“固定 `user_id` 回退层”：
  - 仅作用于 `novel_migrated` 路由；
  - 不修改全局网关鉴权链；
  - 默认固定用户标识（例如 `local_single_user`），可通过配置覆盖。
- 将 Wave 1 已落地接口全部切换到该回退层，移除对 `request.state.user_id` 的硬依赖。

### 11.3 Wave 2 执行状态（W2-PR1 ~ W2-PR5）

1. W2-PR1：`[已完成]` 单机单用户回退层 + Wave 1 无账号化收口（`careers/foreshadows/memories/settings/common`）。
2. W2-PR2：`[已完成]` 灵感模块接入（`api/inspiration.py`）。
3. W2-PR3：`[已完成]` 封面模块接入（`api/project_covers.py` + `services/cover_generation_service.py`）。
4. W2-PR4：`[已完成]` 拆书导入模块接入（`api/book_import.py` + `services/book_import_service.py` + 依赖闭包）。
5. W2-PR5：`[本次完成]` 路由聚合注册 + 文档收口（`README.md`、`CLAUDE.md`、本任务文档）。

### 11.4 Wave 2 验收状态

- [x] Wave 1 与 Wave 2 API 均可在 `novel_migrated` 路由下接入且不依赖账号登录链路（小说域内固定 `user_id` 回退）。
- [x] 不影响现有 `/api/models`、`/api/mcp/config`、`/api/memory`、`/api/novel*` 路由边界。
- [ ] 运行态联调与异常路径全量回归待 Windows 侧补验（见 14.2）。

---

## 12. Wave 3 计划（延期）

### 12.1 延期范围

- `auth.py`、`users.py`、`admin.py`
- `models/user.py`
- `services/oauth_service.py`、`services/email_service.py`
- `user_manager.py`、`user_password.py`

### 12.2 延期原因

- 当前目标是单机单用户小说域能力落地，账号体系不在本期范围。
- 若提前并入，会显著扩大跨层改动面和联调复杂度。

## 13. Wave 1 实施状态（历史记录）

- PR1：`[本次完成]` 已建立 `backend/app/gateway/novel_migrated/` 包结构，迁移 `core/logger`、`core/database`、`utils/sse_response`、`api/common`、`api/settings`，并补齐共享模型 `project/chapter/character/settings`。
- PR2：`[本次完成]` 已完成 `careers.py`、`foreshadows.py` 及对应 `services/models/schemas` 迁移，导入路径已对齐 `app.gateway.novel_migrated.*`。
- PR3：`[本次完成]` 已完成 `memories.py`、`memory_service.py`、`memory.py`、`mcp_tools_loader.py`、`plot_analyzer.py` 迁移与桥接，新增兼容 `ai_service.py`，并在 `backend/pyproject.toml` 补齐 `chromadb`、`sentence-transformers`、`sqlalchemy`、`aiosqlite` 依赖声明。
- PR4：`[本次完成]` 已新增 `app.gateway.routers.novel_migrated` 聚合路由并接入 `CORE_ROUTER_MODULES`，同步更新 `backend/README.md`、`backend/CLAUDE.md`。

### 13.1 本地验证结果（WSL）

- 已通过：`python3 -m compileall app/gateway/novel_migrated app/gateway/routers/novel_migrated.py app/gateway/app.py`
- 已通过：`.venv/bin/ruff check app/gateway/novel_migrated app/gateway/routers/novel_migrated.py app/gateway/app.py`
- 未执行：`pytest`（当前 WSL 环境与 Windows 侧依赖安装不一致，按任务约束跳过）
- 未执行：完整运行态联调（需在可用依赖环境执行 `uv sync` 后再做）

## 14. Wave 2 收口状态（本次更新）

### 14.1 代码与文档收口

- 已完成 `app/gateway/routers/novel_migrated.py` 可选模块注册补齐：
  - `app.gateway.novel_migrated.api.inspiration`
  - `app.gateway.novel_migrated.api.project_covers`
  - `app.gateway.novel_migrated.api.book_import`
- 已保持原有“可选导入容错”机制（`ModuleNotFoundError` 仅跳过模块，不阻断网关启动）。
- 已同步更新 `backend/README.md` 与 `backend/CLAUDE.md`，明确 Wave 2 模块覆盖与无账号化回退前提（`NOVEL_MIGRATED_DEFAULT_USER_ID`）。
- 已回填本任务文档（`implementation-plan.md` + `prd.md`）中的 Wave 2 执行状态。

### 14.2 验证与补验说明

- WSL 本次仅执行最小静态验证（`compileall` + `ruff check`），不执行重型测试。
- Windows 端补验建议：
  - `cd deer-flow-main/backend && uv sync`
  - `cd deer-flow-main/backend && uv run pytest -q`
  - 对 Wave2 新接口做 smoke：
    - `/api/inspiration/*`
    - `/api/projects/{project_id}/cover/*`
    - `/book-import/*`
