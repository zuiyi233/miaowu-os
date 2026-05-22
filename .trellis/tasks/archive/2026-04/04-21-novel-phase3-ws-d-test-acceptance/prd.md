# WS-D（WP6）：测试与验收体系代码化

## Goal

代码化阶段三测试与验收流程，覆盖契约测试、E2E 场景、并发幂等压测流程脚本与 CI 模板，并定义“先定向后全量”的执行门禁。

## WP 映射

- 对应工作包：WP6
- 子任务目录：`.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance`
- 一句话目标：把阶段三验收流程固化为可落地脚本与流水线模板。

## Scope

### In Scope

1. 设计契约测试流程脚本模板。
2. 设计 E2E 场景执行脚本模板。
3. 设计并发幂等压测流程脚本模板（仅流程，不执行）。
4. 输出 CI 模板与“先定向后全量”门禁策略。
5. 提供 Windows 前端测试脚本模板。

### Out of Scope

1. 不执行真实测试与压测。
2. 不改业务逻辑代码。
3. 不定义 Action 协议细节（归 WS-A）。
4. 不定义技能治理与状态机核心规则（归 WS-B/WS-C）。

## Constraints

1. 前端测试脚本必须是 Windows PowerShell；禁止在 WSL 处理前端依赖。
2. 仅提供流程代码与模板，不执行测试。
3. 流程门禁必须体现“定向集通过后才允许全量”。
4. CI 模板默认手动触发，避免误跑。

## 输入基线文档

1. `/mnt/d/miaowu-os/AI_Novel_Connection_Test_Report.md`
2. `/mnt/d/miaowu-os/Novel_Creation_Process_Assessment_Report.md`
3. `/mnt/d/miaowu-os/主项目写作流程与小说创作深度联动打通方案.md`
4. `/mnt/d/miaowu-os/.trellis/tasks/archive/2026-04/04-21-novel-phase2-quality-closure/prd.md`

## 交付物清单（精确路径）

1. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/prd.md`
2. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/task.json`
3. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/implement.jsonl`
4. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/check.jsonl`
5. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/debug.jsonl`
6. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/test-flows/run_backend_ws_d.sh`
7. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/test-flows/run_frontend_ws_d.ps1`
8. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/test-flows/run_contract_e2e_ws_d.sh`
9. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/test-flows/ci_ws_d_template.yml`
10. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/test-flows/README.md`

## 验收标准（可量化）

1. `prd.md` 明确包含“先定向后全量”门禁策略。
2. 至少覆盖 3 类流程：契约测试、E2E 场景、并发幂等压测。
3. 交付物清单中的 10 个文件全部落盘。
4. `task.py validate` 对该子任务返回 0 错误。

## 风险与回滚策略

1. 风险：模板与真实目录不一致。回滚：统一由目录变量集中定义并保留 dry-run。
2. 风险：CI 模板误触发高成本任务。回滚：默认 `workflow_dispatch` + 明确开关参数。
3. 风险：定向集覆盖不足导致漏检。回滚：补充 smoke 关键路径为强制项。

## DoD

1. 子任务必需文件齐全。
2. 测试流程脚本与 CI 模板可读可复用。
3. README 明确“仅提供脚本，不执行”。
4. `task.py validate` 校验通过。

## 文件写入边界（避免冲突）

### 本子任务独占写入

1. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/**`
2. 未来实现预留：`deer-flow-main/backend/tests/novel_phase3/**`
3. 未来实现预留：`deer-flow-main/frontend/tests/novel_phase3/**`

### 本子任务不得写入

1. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/**`
2. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/**`
3. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/**`
