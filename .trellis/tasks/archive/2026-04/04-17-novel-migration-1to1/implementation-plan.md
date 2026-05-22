# Implementation Plan - novel-migration-1to1

## 0. 文档信息

- 任务目录：`/mnt/d/miaowu-os/.trellis/tasks/04-17-novel-migration-1to1`
- 计划版本：`v2`
- 计划日期：`2026-04-18`
- 基线方案：`/mnt/d/miaowu-os/小说功能完整迁移方案_2026-04-18.md`
- 对照代码库：
  - 主项目（二开）：`/mnt/d/miaowu-os/deer-flow-main`
  - 原版项目：`/mnt/d/deer-flow-main`
  - 小说参考：`/mnt/d/miaowu-os/参考项目/MuMuAINovel-main`
- 当前任务状态：`planning`

---

## 1. Trellis 规则对齐

本实现计划按 `.trellis/workflow.md` 与 `spec/guides/*` 执行：

1. Read Before Write
- 先读事实文档与代码，再写代码；计划已基于三库交叉核验。

2. Incremental Development
- 按阶段切片 + 小步 PR；每个 PR 独立可验证、可回滚。

3. Cross-Layer Thinking
- 本任务跨前端路由/状态层、网关路由层、服务层、模型层、SSE 流协议层。

4. Code Reuse First
- 以参考项目成熟实现为主，主项目只做最小适配；禁止无必要重写。

5. Verifiable Delivery
- 每阶段定义“准入条件 + 退出条件 + 验证命令”；无验证证据不宣布完成。

---

## 2. 范围定义

## 2.1 In-Scope（本轮必须完成）

- 小说工作区从“单页 viewMode 切换”迁移为“子路由导航”。
- 章节/大纲/角色/世界观的核心 AI 流式能力落地。
- `novelApiService` 扩展 AI 流方法，`useNovelStore` 扩展细粒度数组操作。
- 建立 `DTO <-> UI Model` 映射层（`project_id <-> novelId`、`chapter_number <-> order`）。
- 建立 Sync Hooks 与 TanStack Query 的单一事实源策略。

## 2.2 Out-of-Scope（本轮排除）

- 账号/用户体系（登录、注册、管理员、多租户隔离）。
- 与小说主流程无关的全局架构重构。
- 大规模 UI 重设计（以功能对齐和稳定为主）。

## 2.3 环境约束（强制）

- 前端依赖安装、构建、测试仅在 Windows 原生环境执行。
- 严禁在 WSL 里执行前端依赖操作（`pnpm install` / `pnpm build` / `pnpm test`）。

---

## 3. 关键契约（实施前冻结）

## 3.1 API 路径契约

- 主路径采用主项目风格：`/api/novels/{novel_id}/...`
- 兼容别名可选：`/api/chapters/{chapter_id}/generate-stream` 等（用于兼容参考前端调用习惯）
- P0 接口：
  - `POST /api/novels/{novel_id}/chapters/{chapter_id}/generate-stream`
  - `POST /api/novels/{novel_id}/chapters/{chapter_id}/continue-stream`
  - `POST /api/novels/{novel_id}/chapters/batch-generate-stream`
  - `POST /api/novels/{novel_id}/outlines/generate-stream`
  - `POST /api/novels/{novel_id}/characters/generate-stream`

## 3.2 数据契约

- API DTO 层：沿参考项目 snake_case（`project_id`, `chapter_number`, `expansion_plan`）。
- 前端 UI 层：沿主项目 camelCase（`novelId`, `order`, `expansionPlanRaw`）。
- 映射统一收口在 `novel-api.ts`/adapter，禁止页面层自行散落转换。

## 3.3 状态契约

- TanStack Query：服务端状态唯一事实源（列表、详情、正文）。
- Zustand：仅保存 UI 状态（当前章节、侧栏、进度、选择态等）。
- 同一份业务数据禁止 Query + Store 长期双写。

## 3.4 流协议契约

- `Content-Type: text/event-stream; charset=utf-8`
- 事件字段：`event/type/id/seq/chapterId/data/done/error`
- 支持 `AbortController` 取消。
- 预留断线恢复能力：`id + Last-Event-ID` 或业务 `cursor`。

---

## 4. 分阶段实施计划（Trellis 执行版）

## 阶段 0：后端 P0 能力打通（预计 10 个工作日）

### 目标
- 先打通章节/大纲/角色核心流式接口，解除前端主路径阻塞。

### PR 切片
1. PR0-1：路由与 schema 骨架
- 新增 `novel_migrated` 下章节/大纲/角色流式路由骨架、请求模型、响应事件模型。

2. PR0-2：章节生成/续写流
- 落地 `generate-stream` + `continue-stream`。
- 支持进度、内容增量、完成、错误事件。

3. PR0-3：批量章节生成流
- 落地 `batch-generate-stream`，定义 item 级事件。

4. PR0-4：大纲与角色流
- 落地 `outlines/generate-stream`、`characters/generate-stream`。

### 退出条件
- 5 个 P0 端点可用，响应协议稳定。
- 接口文档与事件契约冻结。

### 验证
- `cd deer-flow-main/backend && uv run ruff check app`
- `cd deer-flow-main/backend && uv run python -m compileall app`
- `cd deer-flow-main/backend && uv run pytest -q`（可跑部分就记录缺口）

---

## 阶段 1：前端基础设施（预计 4 个工作日）

### 目标
- 为路由化迁移建立基础框架，不改业务行为。

### 任务
- 新增 `workspace/novel/[novelId]/layout.tsx` 与侧边栏布局。
- 扩展 `useNovelStore`：`add/update/remove`（chapter/character/outline）。
- 新增 `sync-hooks.ts`（chapter/character/outline 三类）。
- 扩展 `novelApiService`：流式方法签名与请求封装。

### 退出条件
- 页面路由骨架可运行。
- Store/Api/Hook 具备后续页面迁移所需最小能力。

### 验证
- Windows 环境：`pnpm -C deer-flow-main/frontend lint`
- Windows 环境：`pnpm -C deer-flow-main/frontend typecheck`

---

## 阶段 2：章节管理核心闭环（预计 5 个工作日）

### 目标
- 章节列表页 + 编辑页 + 生成流 + 局部重写形成可用闭环。

### 任务
- `.../chapters/page.tsx`：列表、创建、删除、状态显示。
- `.../chapters/[chapterId]/page.tsx`：编辑、保存、切章保护。
- 接入 `generate/continue/batch` 流，展示进度面板。
- 接入局部重写工具栏（选区同步 + 防抖）。

### 退出条件
- 用户可完成“创建章节 -> 流式生成 -> 编辑保存 -> 切章”全流程。

### 验证
- Windows 环境：`pnpm -C deer-flow-main/frontend lint`
- Windows 环境：`pnpm -C deer-flow-main/frontend typecheck`
- 手工 smoke：流程脚本 + 关键失败路径（断网、取消、超时）。

---

## 阶段 3：角色/大纲/世界观页迁移（预计 8 个工作日）

### 目标
- 完成三大页面能力与 AI 流式对齐。

### 任务
- 角色页：列表、CRUD、AI 生成流。
- 大纲页：列表、生成、展开（单条/批量）。
- 世界观页：展示、编辑、重生成流。

### 退出条件
- 三页核心操作可用，数据回流与缓存刷新正确。

### 验证
- 同阶段 2。

---

## 阶段 4：非核心页与路由补齐（预计 5 个工作日）

### 目标
- 完成组织/职业/关系/伏笔/风格/工坊与分析页路由化补齐。

### 任务
- 页面迁移优先“可用”而非“美化”，保持主项目视觉体系。

### 退出条件
- 基线方案中定义的目标路由全部可访问且无 500。

---

## 阶段 5：联调、回归与文档收口（预计 3 个工作日）

### 目标
- 端到端稳定性验证、缺陷修复、文档一致性。

### 任务
- 回归清单执行。
- 补齐 Trellis 任务记录、会话记录、必要 spec 更新。

### 退出条件
- 功能清单通过率 >= 95%。
- 所有未通过项有明确 issue/风险登记。

---

## 阶段 6：性能优化（附加，可并行推进，预计 3 个工作日）

### P0 优先
- chunk 合并提交（避免 token 级重渲染）。
- 心跳与断线恢复策略落地。
- 取消链路完整（切章/离页/超时）。

### P1 优先
- 指标埋点：重连次数、解析失败率、渲染次数。
- Worker 化文本后处理。

### 退出条件
- 章节长文本生成期间页面不卡死，无明显内存增长异常。

---

## 5. Trellis 子任务拆分建议

建议在当前任务下建立子任务（可直接执行）：

```bash
python3 ./.trellis/scripts/task.py create "novel migration phase0 backend p0" --slug novel-mig-p0-backend --parent .trellis/tasks/04-17-novel-migration-1to1
python3 ./.trellis/scripts/task.py create "novel migration phase1 frontend infra" --slug novel-mig-p1-frontend-infra --parent .trellis/tasks/04-17-novel-migration-1to1
python3 ./.trellis/scripts/task.py create "novel migration phase2 chapters" --slug novel-mig-p2-chapters --parent .trellis/tasks/04-17-novel-migration-1to1
python3 ./.trellis/scripts/task.py create "novel migration phase3 world outline characters" --slug novel-mig-p3-main-pages --parent .trellis/tasks/04-17-novel-migration-1to1
python3 ./.trellis/scripts/task.py create "novel migration phase4 secondary pages" --slug novel-mig-p4-secondary-pages --parent .trellis/tasks/04-17-novel-migration-1to1
python3 ./.trellis/scripts/task.py create "novel migration phase5 integration qa" --slug novel-mig-p5-integration-qa --parent .trellis/tasks/04-17-novel-migration-1to1
python3 ./.trellis/scripts/task.py create "novel migration phase6 performance" --slug novel-mig-p6-performance --parent .trellis/tasks/04-17-novel-migration-1to1
```

---

## 6. 验收矩阵（Definition of Done）

## 6.1 功能验收

- [ ] 目标路由可达。
- [ ] 章节生成/续写/批量生成可用（含进度反馈）。
- [ ] 大纲生成、角色生成、世界观重生成可用。
- [ ] 切章与保存逻辑稳定，无脏数据覆盖。

## 6.2 技术验收

- [ ] Query/Store 职责符合契约，无长期双写。
- [ ] DTO/UI 映射集中化，无页面层散落转换。
- [ ] 流式协议稳定，可处理中断与取消。

## 6.3 质量验收

- [ ] Backend lint/compile/test 通过（或缺口有记录）。
- [ ] Frontend lint/typecheck 通过（Windows）。
- [ ] 关键 smoke 场景通过并留证据。

---

## 7. 风险与回滚

## 7.1 核心风险

- 后端 P0 进度拖延，导致前端路由迁移被阻塞。
- 章节编辑器与流式写入耦合，切章状态容易异常。
- 字段映射分散导致数据错位（`project_id/novelId` 等）。

## 7.2 回滚策略

- 以 PR 为回滚粒度，保持每个 PR 可独立撤销。
- 新增路由集中在 `novel_migrated` 注册块，故障可快速摘除。
- 映射层失败时先回退到“只读展示 + 基础 CRUD”，保护写路径。

---

## 8. 首周执行清单（可直接开工）

Day 1-2
- 完成阶段 0 的 PR0-1（路由/schema 骨架）。

Day 3-4
- 完成 PR0-2（章节 generate/continue 流）。

Day 5
- 完成 PR0-3（batch 流）并跑首轮联调。

Day 6-7
- 进入阶段 1，完成 Store + API + sync hooks 基建。

---

## 9. 备注

- 本计划是“执行计划”，不是最终设计冻结文档。
- 若实现中发现与基线文档冲突，按“代码事实优先”更新该计划与基线文档。
- 每阶段结束后必须回填任务状态与验证证据到 Trellis 任务上下文。
