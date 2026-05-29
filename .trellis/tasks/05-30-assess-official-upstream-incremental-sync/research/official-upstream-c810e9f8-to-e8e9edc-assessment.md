# 官方上游增量同步候选评估（`c810e9f8..e8e9edc`）

## 评估范围

- 官方仓库：`https://github.com/bytedance/deer-flow`
- 本地已收口基线：`c810e9f8`
- 官方当前扫描到的最新主分支提交：`e8e9edc`
- 差距：`66` 个提交

## 总体结论

官方新增改动主要集中在以下区域：

- `backend/packages/harness/**`：57 个文件
- `backend/app/gateway/**`：8 个文件
- `frontend/src/core/**`：22 个文件
- `frontend/src/components/**`：6 个文件
- 测试与文档：大量新增，但对二开业务逻辑影响较小

这说明新增更新大部分仍然落在 DeerFlow 核心 runtime、middleware、MCP、tools、frontend core，而不是纯外围文档。

## 与本地多账号改造直接重叠的文件

本地最近多用户设置改造提交 `d0cce38` 与官方新增范围直接重叠的文件只有 8 个：

- `deer-flow-main/backend/app/gateway/routers/mcp.py`
- `deer-flow-main/backend/app/gateway/services.py`
- `deer-flow-main/backend/packages/harness/deerflow/agents/lead_agent/agent.py`
- `deer-flow-main/backend/packages/harness/deerflow/mcp/tools.py`
- `deer-flow-main/backend/packages/harness/deerflow/tools/builtins/task_tool.py`
- `deer-flow-main/backend/packages/harness/deerflow/tools/tools.py`
- `deer-flow-main/frontend/src/components/workspace/artifacts/artifact-file-detail.tsx`
- `deer-flow-main/frontend/src/core/auth/AuthProvider.tsx`

直接含义：不是所有 66 个 commit 都会撞上多账号改造，但**MCP、gateway services、agent/tool 链路、AuthProvider** 是本轮最高风险交汇区。

## 可优先增量同步的低风险主题

这些主题基本不直接触碰本地多账号隔离主链，适合优先作为第一批候选：

1. 运行时稳态/持久化修复
   - `cbf8b19` JSONL async I/O 与 DB put_batch 校验
   - `0fb0582` run creation persistence atomic
   - `66d6a6a` run finalization persistence hardening
   - `2eeb597` active progress counters
   - `9b19cca` RunManager.cancel 幂等
   - `737abc0` stale run reconnect conflicts

2. 前端纯体验修复
   - `11dd5b0` 未闭合 `<think>` 标签处理
   - `f68bcb7` clipboard guard
   - `2fdfff0` 历史 Mermaid 预览修复
   - `e7967a7` streaming assistant turn 隐藏 copy

3. 低耦合后端/工具修复
   - `3599b57` async-only tools sync 包装
   - `e19bec1` task-tool safety timeout cleanup
   - `e8e9edc` channels hidden control messages 过滤
   - `b00749a` internal gateway token worker 共享

4. 基础测试与检测脚本
   - `0c22349` async/thread boundary detector
   - `e344be8` / `052b1e2` Blockbuster runtime gate
   - `da41701` blocking IO inventory

这些变更大多可以按“逐提交复制/手动补丁”方式先吸收，验证成本相对可控。

## 可同步但必须专题裁决的中风险主题

1. `9c03a71` `backend/app/gateway/services.py`
   - 价值：保留 `additional_kwargs`，直接关系到文件附件、role、message 元数据正确传递
   - 风险：该文件已被本地多账号、novel/runtime/provider 路径深度定制，必须以本地逻辑为主干人工合并

2. `c881d95` + `162fb21` MCP session pooling
   - 价值：状态型 MCP server（如 Playwright）跨调用保活
   - 风险：本地刚完成用户级 MCP 工具过滤与权限隔离，session 作用域如果仍按 thread/server 维度处理，可能与 user scope 边界互相影响

3. `7ec8d3a` `routers/mcp.py` secret masking
   - 价值：防止 MCP 配置接口泄露明文 secret，安全收益高
   - 风险：本地已改 admin/user 级 MCP 设置接口与权限；需要确认 masked round-trip 不会破坏多用户配置保存

4. `d46a577` + `d0fa37e` + `0287240` `frontend/src/core/threads/hooks.ts`
   - 价值：消息保留、新线程立即显示、避免重复 optimistic message
   - 风险：`hooks.ts` 是本地小说/多线程/进度 toast 等定制高密度冲突点，不能直接覆盖

5. `604fcbb` + `b103d1a` `artifact-file-detail.tsx`
   - 价值：artifact preview 稳定性和静态模式支撑
   - 风险：该文件和 `AuthProvider.tsx` 已与本地工作区、鉴权、文件链路发生交叠，需要看多用户静态模式是否有意义

## 暂不建议优先同步的高风险主题

1. `b103d1a` static website demo mode
   - 原因：触达 `AuthProvider.tsx`、`api-client.ts`、`static-user.ts`、workspace layout/page/providers 等，属于官方单用户静态演示能力；对当前多账号主产品价值低，且容易污染鉴权流

2. `ca48757` ToolOutputBudgetMiddleware
   - 原因：改动面很大，新增 middleware + config + 大量测试，影响所有工具输出路径；虽然长期有价值，但它会碰到本地 MCP/技能/小说工具/附件展示全链路，建议单独立项验证

3. `44677c5` patched MiMo reasoning content support
   - 原因：和本地已有 MiMo/TTS/小说链路存在潜在语义重叠；如果要吸收，应与本地 MiMo 双轨任务一起评估，而不是混入常规 upstream sync

4. `be0eae9` provider safety termination + `ca48757` budget middleware 组合
   - 原因：都直接介入 lead agent/tool middleware 执行边界；对多账号本身不是刚需，且容易引入回归

## 建议的同步批次顺序

### 批次 1：低风险基础修复

- runtime persistence / cancel / reconnect / JSONL I/O
- channels hidden control messages
- clipboard / `<think>` / mermaid / copy 按钮类前端修复
- async-only tools sync wrapper
- task-tool timeout cleanup

### 批次 2：安全与契约修复

- `routers/mcp.py` secret masking
- `services.py` additional_kwargs 保留
- internal gateway token worker 共享

前提：先补一轮针对多账号用户设置、MCP 配置保存、附件上传消息的回归用例。

### 批次 3：线程与交互体验修复

- `hooks.ts` 三个提交：summarization message preserve / optimistic dedupe / new thread sidebar

前提：必须以本地 `hooks.ts` 为基底逐段回补，不能直接用上游版本。

### 批次 4：专题评估后再决定

- MCP session pooling
- ToolOutputBudgetMiddleware
- static demo mode
- patched MiMo reasoning support

这些都不适合混在第一轮常规同步里。

## 当前阻塞与限制

- 当前主工作区有 30 个未提交改动，不应直接在此基础上执行同步。
- 本地仓库的 `upstream` remote 当前不是官方 `bytedance/deer-flow`，后续正式同步前需再次核对 remote 策略。
- 本轮只是评估，没有在本地实际应用 patch，因此最终仍需在真实合并时重新做冲突与测试验证。
