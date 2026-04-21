# WS-B（WP2 + WP5）：技能治理与质量门禁融合

## Goal

定义“系统默认 > 工作区启用 > 会话动态选择”三层技能治理策略，并与规则+模型质量门禁融合，建立误报回流闭环。

## WP 映射

- 对应工作包：WP2 + WP5
- 子任务目录：`.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate`
- 一句话目标：把技能选择和质量门禁统一到可解释、可回流、可控策略。

## Scope

### In Scope

1. 三层技能优先级策略定义与冲突决议规则。
2. 规则门禁与模型门禁融合判定规范（pass/warn/block）。
3. 误报反馈链路与回流迭代机制定义。
4. 技能调用授权边界与拒绝原因枚举。
5. 本子任务测试流程脚本和 CI 模板（仅交付，不执行）。

### Out of Scope

1. 不改 NovelAction Router 协议主结构（归 WS-A）。
2. 不改生命周期状态机和补偿流程（归 WS-C）。
3. 不做全量测试执行与性能压测（归 WS-D 统筹执行阶段）。

## Constraints

1. 技能最终调用必须受平台设置中心启用状态约束。
2. 门禁阻断必须提供可解释证据（规则项 + 模型依据摘要）。
3. 前端测试流程仅提供 Windows PowerShell 脚本。
4. 本阶段只交付流程与模板，不执行测试。

## 输入基线文档

1. `/mnt/d/miaowu-os/AI_Novel_Connection_Test_Report.md`
2. `/mnt/d/miaowu-os/Novel_Creation_Process_Assessment_Report.md`
3. `/mnt/d/miaowu-os/主项目写作流程与小说创作深度联动打通方案.md`
4. `/mnt/d/miaowu-os/.trellis/tasks/archive/2026-04/04-21-novel-phase2-quality-closure/prd.md`

## 交付物清单（精确路径）

1. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/prd.md`
2. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/task.json`
3. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/implement.jsonl`
4. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/check.jsonl`
5. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/debug.jsonl`
6. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/test-flows/run_backend_ws_b.sh`
7. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/test-flows/run_frontend_ws_b.ps1`
8. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/test-flows/run_contract_e2e_ws_b.sh`
9. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/test-flows/ci_ws_b_template.yml`
10. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/test-flows/README.md`

## 验收标准（可量化）

1. `prd.md` 明确包含三层技能优先级策略与门禁融合判定（pass/warn/block）。
2. 误报反馈回流机制至少包含“收集、标注、回放、策略更新”4 个步骤。
3. 交付物清单中的 10 个文件全部落盘。
4. `task.py validate` 对该子任务返回 0 错误。

## 风险与回滚策略

1. 风险：策略优先级冲突导致技能误触发。回滚：强制降级为“仅工作区启用白名单”。
2. 风险：门禁误报率短期升高。回滚：临时放宽 block 阈值，保留 warn 记录。
3. 风险：误报回流管道断链。回滚：切换到手工工单回流并保留日志导出。

## DoD

1. 子任务必需文件齐全。
2. 三层治理策略、融合门禁、误报回流机制均有明确定义。
3. 测试流程脚本和 CI 模板已提供且声明不执行。
4. `task.py validate` 通过。

## 文件写入边界（避免冲突）

### 本子任务独占写入

1. `.trellis/tasks/04-21-novel-phase3-ws-b-skill-governance-gate/**`
2. 未来实现预留：`deer-flow-main/backend/src/apps/novel/skill_governance/**`
3. 未来实现预留：`deer-flow-main/backend/src/apps/novel/quality_gate/**`

### 本子任务不得写入

1. `.trellis/tasks/04-21-novel-phase3-ws-a-action-router/**`
2. `.trellis/tasks/04-21-novel-phase3-ws-c-lifecycle-observability/**`
3. `.trellis/tasks/04-21-novel-phase3-ws-d-test-acceptance/**`
