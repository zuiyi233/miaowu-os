# 小说功能缺口修复执行方案（交接文档）

> 适用仓库：`D:\miaowu-os\deer-flow-main`
> 对照参考：`D:\miaowu-os\参考项目\MuMuAINovel-main`
> 目标：把当前小说二开中的关键缺口转为可执行改造任务，供后续 AI 直接落地。

## 1. 背景与范围

本方案聚焦“小说功能”主链路，不覆盖通用聊天、账号体系、非小说插件能力。

本次审计范围：
- 前端小说工作区（创建、编辑、AI 面板、阅读、工坊、拆书导入）
- 后端 novel_migrated 与 deerflow novel tools（internal/HTTP 双路径）
- 流程一致性（前后端合同、降级策略、错误显式化）
- 可验证性（e2e/集成测试缺口）

## 2. 问题总览（按优先级）

### P0-1 AI 面板生成能力为占位，未接入真实创作链路
- 证据：`frontend/src/components/novel/AiPanel.tsx:51-55`
- 现状：`generate` tab 显示 `AI Generation tools coming soon`。
- 影响：编辑器内最核心入口无法发起世界观/大纲/章节生成。

### P0-2 新建小说流程偏本地落库，未统一走后端编排
- 证据：`frontend/src/components/novel/NovelCreationDialog.tsx:45-83`
- 现状：创建流程直接 `databaseService.saveNovel(...)`。
- 影响：与后端执行协议、会话门控、状态追踪脱钩，后续链路稳定性差。

### P0-3 写操作“远端失败后静默降级到本地缓存”
- 证据：`frontend/src/core/novel/novel-api.ts:811-830`
- 现状：`executeRemoteFirst` 对异常直接 fallback 本地。
- 影响：出现“用户以为成功，服务端未落库”的数据分裂。

### P1-1 项目工作区导航缺少“拆书导入”入口（入口分裂）
- 证据：
  - 已有入口：`frontend/src/components/workspace/workspace-nav-chat-list.tsx:64-70`
  - 路由存在：`frontend/src/app/workspace/novel/book-import/page.tsx:1-4`
  - 项目工作区菜单缺失：`frontend/src/components/novel/routes/ProjectWorkspaceLayout.tsx:97-124`
- 影响：用户在项目上下文中找不到导入流程，操作跳转割裂。

### P1-2 Prompt 工坊可用性治理不足（配置缺失时运行期报错）
- 证据：`backend/app/gateway/novel_migrated/services/workshop_client.py:223-248, 61-72`
- 现状：配置缺失时使用默认客户端，调用时才抛 `WorkshopClientError`。
- 影响：用户面向功能的可用性不可预测，故障提示滞后。

### P1-3 伏笔查询存在“异常吞没 -> 空结果”路径
- 证据：`backend/app/gateway/novel_migrated/services/foreshadow_service.py:605-607`
- 现状：异常时直接 `return []`。
- 影响：真实故障被伪装成“暂无数据”，误导创作判断。

### P2-1 internal 直连合同仍有文档级未收口项
- 证据：`docs/novel-tools-internal-refactor.md:498, 602`
- 现状：文档明确提示 `request=None` 场景需确认，但缺少强制验证收口。
- 影响：后续迭代容易产生 internal/HTTP 回归。

### P2-2 小说主流程 E2E 覆盖不足
- 证据：
  - 现有 e2e 偏通用：`frontend/tests/e2e/landing.spec.ts`, `frontend/tests/e2e/chat.spec.ts`
  - 未覆盖 `workspace/novel/*` 主链路。
- 影响：缺少自动化回归护栏，改动后容易反复破坏。

## 3. 执行方案（可直接分派给其他 AI）

---

## 任务 A（P0）：打通“创建 -> 生成”主链路

### A1. 改造 AI 面板 `generate` tab（占位改真实）

#### 目标
在 `AiPanel` 中提供可执行生成入口，最小支持：
- 世界观生成
- 大纲生成
- 章节生成（单章/批量二选一，先做单章即可）

#### 建议改造点
- 文件：`frontend/src/components/novel/AiPanel.tsx`
- 实施：
  1. 新增 `GeneratePanel` 子组件（可放 `frontend/src/components/novel/ai/GeneratePanel.tsx`）。
  2. `TabsContent value="generate"` 从占位文案替换为实际表单 + 触发按钮。
  3. 接入已有 API 封装（优先复用 `novelApiService`/现有 hooks；避免新造 parallel contract）。
  4. 每次请求必须展示：pending / success / error 三态。

#### 验收标准
- 在小说工作区打开 AI 面板，`Generate` 可发起真实请求。
- 请求失败时必须给出显式错误，不允许“静默无反应”。

---

### A2. 新建小说从“本地直存”改为“后端优先创建”

#### 目标
`NovelCreationDialog` 创建动作默认走后端创建接口，成功后再同步本地缓存。

#### 建议改造点
- 文件：`frontend/src/components/novel/NovelCreationDialog.tsx`
- 现状问题：当前直接 `databaseService.saveNovel(...)`。
- 实施：
  1. 将创建动作改为调用后端创建接口（优先复用已存在的 novel API）。
  2. 创建成功后再写 Dexie 本地缓存（作为镜像，不是事实源）。
  3. 保留本地兜底仅限“明确离线模式”，并在 UI 明示“离线草稿”。

#### 验收标准
- 正常网络环境下，新建小说后后端可查询到对应项目。
- 本地与远端 ID 可关联，不再出现仅本地存在的孤立项目。

---

### A3. 收紧写操作降级策略（禁止静默 fallback）

#### 目标
区分读写语义：
- 读：允许 fallback
- 写：默认 fail-closed（失败即提示并中止）

#### 建议改造点
- 文件：`frontend/src/core/novel/novel-api.ts`
- 实施：
  1. 将 `executeRemoteFirst` 扩展为带策略参数：`mode: 'read' | 'write'`。
  2. `mode=write` 时 remote 异常直接抛出（不自动 fallback）。
  3. 仅对白名单操作允许本地 fallback（需显式注释说明）。
  4. 调整 `novel-domain-service.ts` 中各调用点，给出正确 `mode`。

#### 验收标准
- 断开后端时，写操作显示失败提示；不会“看起来成功”。
- 读操作仍可在离线时读取本地缓存。

---

## 任务 B（P1）：完善入口与可用性治理

### B1. 将“拆书导入”纳入项目工作区菜单

#### 目标
在 `ProjectWorkspaceLayout` 中可直接进入拆书导入，且保留现有全局入口。

#### 建议改造点
- 文件：`frontend/src/components/novel/routes/ProjectWorkspaceLayout.tsx`
- 实施：
  1. 在 `增强能力` 组增加菜单项，例如 `导入素材` -> `/workspace/novel/book-import`。
  2. 处理 active 态与返回项目路径的 UX（可附带 `?from=<novelId>`）。

#### 验收标准
- 从项目工作区可一跳进入拆书导入。
- 导入完成后可返回对应项目上下文。

---

### B2. Prompt 工坊可用性前置探测

#### 目标
把“运行期才报错”改为“进入页面前即可知状态”。

#### 建议改造点
- 后端：`backend/app/gateway/novel_migrated/services/workshop_client.py`
- 前端：Prompt workshop 页面对应请求层
- 实施：
  1. 增加工坊健康检查接口（或复用现有 `check_connection` 暴露状态）。
  2. 前端加载前先拉状态：可用/降级/不可用。
  3. 不可用时禁用提交与浏览动作，展示明确原因。

#### 验收标准
- 配置缺失或云端不可达时，页面显示“不可用原因 + 建议动作”。
- 不再出现点击后才抛未知错误。

---

### B3. 伏笔查询错误显式化

#### 目标
避免把系统错误伪装为空列表。

#### 建议改造点
- 文件：`backend/app/gateway/novel_migrated/services/foreshadow_service.py`
- 实施：
  1. 返回结构中加入 `error_code/error_message`（或抛业务异常由 API 层格式化）。
  2. 前端收到错误态应显示“加载失败”而非“暂无伏笔”。

#### 验收标准
- 人为制造数据库异常时，前端能看到失败提示。
- 正常空数据与异常数据可区分。

---

## 任务 C（P2）：收口合同与测试

### C1. internal `request=None` 合同测试化

#### 目标
把文档中的“需确认”变成自动化测试，阻断回归。

#### 建议改造点
- 参考文档：`docs/novel-tools-internal-refactor.md:498, 602`
- 测试建议路径：`backend/tests/test_novel_internal_contracts.py`（新建）
- 实施：
  1. 覆盖 `generate_chapter` internal 调用（`request=None`）。
  2. 覆盖 `analyze_chapter` internal 调用（`request=None`）。
  3. 校验 user_id 透传与 fallback 分支行为。

#### 验收标准
- 新增 contract tests 全通过。
- 改动相关 API 签名时，测试能第一时间失败。

---

### C2. 新增小说主链路 E2E

#### 目标
补足最低回归护栏。

#### 建议新增用例
- `frontend/tests/e2e/novel-create-and-generate.spec.ts`
- `frontend/tests/e2e/novel-book-import.spec.ts`
- `frontend/tests/e2e/novel-analysis-foreshadow.spec.ts`

#### 最小断言
1. 创建小说成功后可进入章节页。
2. 章节生成触发后出现进度并落地内容。
3. 章节分析后可看到伏笔/记忆相关结果。

## 4. 建议执行顺序（给其他 AI）

1. 先做任务 A（P0）
2. 再做任务 B（P1）
3. 最后做任务 C（P2）

不要并行改同一合同层（尤其 `novel-api.ts` 和 `novel-domain-service.ts`），避免交叉冲突。

## 5. 验证命令（Win-only）

> 在 `D:\miaowu-os\deer-flow-main` 执行。

### 后端
```powershell
cd backend
# 先最小验证（按实际新增测试文件补充）
.\.venv\Scripts\python.exe -m pytest tests\test_novel_tools.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_book_import_router_overrides.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_careers_router_overrides.py -q
```

### 前端
```powershell
cd frontend
pnpm lint
pnpm test
# 如已配置 playwright：
pnpm exec playwright test frontend/tests/e2e
```

### 本地联调（固定端口约束）
- 后端基址必须是 `http://127.0.0.1:8551`
- 前端 `4560`
- 严禁把 `8001` 当默认值。

## 6. 非目标（避免跑偏）

- 不做与小说功能无关的全局重构。
- 不改 WSL 前端依赖方案（保持 Win-only）。
- 不在本轮处理 UI 视觉优化类需求（先保证链路可用与一致性）。

## 7. 交付要求（给执行方 AI）

执行完成后必须提交：
1. 修改文件清单（含每个文件的目的）
2. 验证命令与结果（通过/失败/未执行）
3. 已解决缺口与剩余风险
4. 若有未完成项，明确阻塞原因与下一步
