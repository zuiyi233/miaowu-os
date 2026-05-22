# WS-C（WP3 + WP4）：生命周期状态机、恢复补偿、可观测灰度回滚

## Goal

定义 `draft -> analyzing -> revising -> gated -> finalized -> published` 生命周期状态机，补齐幂等/重放/补偿策略，以及日志指标键、灰度发布与回滚 runbook。

## WP 映射

- 对应工作包：WP3 + WP4
- 子任务目录：`.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability`
- 一句话目标：把生命周期推进、失败恢复、可观测与灰度回滚统一成可运营流程。

## Scope

### In Scope

1. 生命周期状态与迁移守卫定义。
2. 幂等键策略、重放策略、补偿回滚策略定义。
3. 可观测日志主键与核心指标键定义。
4. 灰度开关矩阵与回滚 runbook 规范。
5. 本子任务测试流程脚本和 CI 模板（仅交付，不执行）。

### Out of Scope

1. 不改 Action 协议定义（归 WS-A）。
2. 不改技能治理策略定义（归 WS-B）。
3. 不执行全量回归、压测与验收（归 WS-D 后续执行）。

## Constraints

1. 状态迁移必须可追溯（事件、时间、操作者、幂等键）。
2. 同一幂等键重放不得产生重复写入副作用。
3. 灰度必须有一键降级路径。
4. 本阶段仅提供脚本，不执行测试。

## 输入基线文档

1. `/mnt/d/miaowu-os/AI_Novel_Connection_Test_Report.md`
2. `/mnt/d/miaowu-os/Novel_Creation_Process_Assessment_Report.md`
3. `/mnt/d/miaowu-os/主项目写作流程与小说创作深度联动打通方案.md`
4. `/mnt/d/miaowu-os/.trellis/tasks/archive/2026-04/04-21-novel-phase2-quality-closure/prd.md`

## 交付物清单（精确路径）

1. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/prd.md`
2. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/task.json`
3. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/implement.jsonl`
4. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/check.jsonl`
5. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/debug.jsonl`
6. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/test-flows/run_backend_ws_c.sh`
7. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/test-flows/run_frontend_ws_c.ps1`
8. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/test-flows/run_contract_e2e_ws_c.sh`
9. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/test-flows/ci_ws_c_template.yml`
10. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/test-flows/README.md`

## 验收标准（可量化）

1. `prd.md` 明确列出 6 个状态：`draft`、`analyzing`、`revising`、`gated`、`finalized`、`published`。
2. 幂等/重放/补偿策略至少各 1 条可执行规则。
3. 可观测部分至少列出 7 个日志主键或指标键。
4. 交付物清单中的 10 个文件全部落盘，且 `task.py validate` 0 错误。

## 风险与回滚策略

1. 风险：状态迁移守卫过严阻塞正常流程。回滚：降级为核心状态最小集（draft/revising/finalized）。
2. 风险：补偿策略误回滚成功数据。回滚：补偿前置快照 + 双确认开关。
3. 风险：灰度配置漂移导致不可控发布。回滚：统一回退到全量关闭 flag。

## DoD

1. 子任务文件齐备且结构完整。
2. 状态机、恢复补偿、可观测与灰度回滚文档化完成。
3. 测试流程脚本及 CI 模板已提供且标明不执行。
4. `task.py validate` 校验通过。

## 文件写入边界（避免冲突）

### 本子任务独占写入

1. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/**`
2. 未来实现预留：`deer-flow-main/backend/src/apps/novel/lifecycle/**`
3. 未来实现预留：`deer-flow-main/backend/src/apps/novel/observability/**`

### 本子任务不得写入

1. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/**`
2. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/**`
3. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/**`
