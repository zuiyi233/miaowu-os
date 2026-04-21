# WS-A（WP1）：NovelAction Router 与槽位追问协议

## Goal

统一小说对话入口到 Action 执行链路的协议层，冻结 `action_type`、`slot_schema`、`missing_slots`、`confirmation_required`、`execute_result` 等核心字段，确保“可追问、可确认、可执行、可回执”。

## WP 映射

- 对应工作包：WP1
- 子任务目录：`.trellis/tasks/04-21-novel-phase3-ws-a-action-router`
- 一句话目标：建立聊天入口到 Action 执行的统一边界契约。

## Scope

### In Scope

1. 定义 NovelAction Router 输入/输出契约。
2. 规范槽位追问协议（缺槽位识别、追问轮次、确认语义）。
3. 约束 Action 执行回执结构与错误码分层。
4. 输出聊天入口到 Action 执行边界契约文档。
5. 提供本子任务测试流程脚本与 CI 模板（仅交付，不执行）。

### Out of Scope

1. 不改业务实现逻辑，不改现网路由。
2. 不新增前端依赖，不在 WSL 执行前端依赖相关操作。
3. 不实现技能治理策略（归 WS-B）。
4. 不实现状态机/可观测链路（归 WS-C）。

## Constraints

1. 保持与 Deer-Flow 主链路协议兼容，新增字段通过兼容扩展方式引入。
2. 所有协议变更必须可审计、可回滚。
3. 前端测试脚本仅允许 Windows PowerShell 方式。
4. 本阶段仅交付脚本和模板，禁止在本任务中执行测试。

## 输入基线文档

1. `/mnt/d/miaowu-os/AI_Novel_Connection_Test_Report.md`
2. `/mnt/d/miaowu-os/Novel_Creation_Process_Assessment_Report.md`
3. `/mnt/d/miaowu-os/主项目写作流程与小说创作深度联动打通方案.md`
4. `/mnt/d/miaowu-os/.trellis/tasks/archive/2026-04/04-21-novel-phase2-quality-closure/prd.md`

## 交付物清单（精确路径）

1. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/prd.md`
2. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/task.json`
3. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/implement.jsonl`
4. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/check.jsonl`
5. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/debug.jsonl`
6. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/test-flows/run_backend_ws_a.sh`
7. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/test-flows/run_frontend_ws_a.ps1`
8. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/test-flows/run_contract_e2e_ws_a.sh`
9. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/test-flows/ci_ws_a_template.yml`
10. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/test-flows/README.md`

## 验收标准（可量化）

1. `prd.md` 明确列出 5 个协议关键字段：`action_type`、`slot_schema`、`missing_slots`、`confirmation_required`、`execute_result`。
2. 交付物清单中的 10 个文件全部落盘。
3. `task.py validate` 对该子任务返回 0 错误。
4. `test-flows/README.md` 明确写明“本阶段仅提供脚本，不执行”。

## 风险与回滚策略

1. 风险：协议字段定义与现有调用方不兼容。回滚：保持旧字段兼容层并在网关处降级到 legacy map。
2. 风险：槽位追问规则过严导致对话卡住。回滚：切回“弱校验+人工确认”策略。
3. 风险：执行回执字段不完整影响上层 UI。回滚：回退到最小回执集合（状态+消息）。

## DoD

1. 子任务结构完整，所有必需文件已创建。
2. 协议边界、输入基线、验收标准、风险回滚、DoD 全部写清。
3. 测试流程脚本与 CI 模板已提供且可读。
4. 明确声明本阶段不执行测试。

## 文件写入边界（避免冲突）

### 本子任务独占写入

1. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/**`
2. 未来实现预留：`deer-flow-main/backend/src/apps/novel/action_router/**`
3. 未来实现预留：`deer-flow-main/backend/tests/contracts/novel_action_router/**`

### 本子任务不得写入

1. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/**`
2. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/**`
3. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/**`
