# 阶段三：对话驱动小说创作稳定化与全生命周期运营

## Goal

将当前“已打通可用”的小说创作能力升级为“稳定可运营产品链路”：

1. 对话可管理小说全生命周期（创建、迭代、定稿、发布）
2. 技能调用按平台配置可控且默认按需生效
3. 任务与数据全链路可追踪、可恢复、可审计
4. 发布具备可观测、可灰度、可回滚能力

## Baseline Inputs

1. `AI_Novel_Connection_Test_Report.md`
2. `Novel_Creation_Process_Assessment_Report.md`
3. `主项目写作流程与小说创作深度联动打通方案.md`
4. 阶段二任务归档：`.trellis/tasks/archive/2026-04/04-21-novel-phase2-quality-closure/`
5. 原版对照：`D:\deer-flow-main`
6. 小说参考：`D:\miaowu-os\参考项目\MuMuAINovel-main`

## Scope

### In Scope

1. NovelAction Router（统一动作协议）
2. 技能治理三层优先级（系统默认 > 工作区启用 > 会话动态选择）
3. 生命周期状态机与恢复补偿
4. 可观测与灰度发布治理
5. 质量门禁升级（规则 + 模型判定融合）
6. 测试与验收流程代码（本阶段产出脚本，不执行全量测试）

### Out of Scope

1. 不重做全量小说业务 UI
2. 不新增前端依赖，不变更 Win-only 前端依赖模式
3. 不一次性替换全部 legacy 路由，仅做分层收敛
4. 本阶段不执行全量回归和压测，仅交付可执行测试流程代码

## Constraints

1. 严禁在 WSL 变更前端依赖
2. 保持 Deer-Flow 主链路兼容，新增能力默认受 feature flag 控制
3. 高风险写操作必须幂等 + 审计
4. 任何跨层协议变更必须有契约文档与回滚路径

## Architecture Plan

### 1) NovelAction Router（P0）

目标：将“自然语言指令 -> 业务动作”收敛为显式协议。

动作分类（首批）：

1. `project.create`
2. `chapter.update`
3. `outline.update`
4. `character.update`
5. `item.update`
6. `timeline.update`
7. `project.finalize`

统一 Action 协议字段：

1. `action_type`
2. `target_id`
3. `slot_schema`
4. `missing_slots`
5. `confirmation_required`
6. `idempotency_key`
7. `execute_result`

验收：

1. 常见创作指令全部走 Action 协议，不依赖 prompt 隐式猜测
2. 缺失字段追问由协议驱动，非分散逻辑

### 2) 技能治理与默认加载（P0）

目标：默认按需加载，同时严格遵循平台设置中心开关。

决策：

1. 不做代码级“全技能强开”
2. 实现技能解析器：从 Action 上下文计算候选技能
3. 与工作区启用清单做交集后再执行

验收：

1. 用户无需反复提示“请调用技能”
2. 被关闭的技能在任何会话都不会被调用

### 3) 生命周期状态机与恢复体系（P1）

建议状态：

1. `draft`
2. `analyzing`
3. `revising`
4. `gated`
5. `finalized`
6. `published`

任务统一挂接：

1. 章节分析
2. 批量修订
3. 门禁检查
4. 定稿执行

恢复能力：

1. 断点续跑
2. 幂等重放
3. 补偿回滚

验收：

1. 任一状态迁移可追溯（事件 + 时间 + 操作人）
2. 失败任务可恢复，且不重复写入成功节点

### 4) 可观测与发布治理（P1）

日志主键：

1. `request_id`
2. `thread_id`
3. `project_id`
4. `session_key`
5. `action_type`
6. `skill_name`
7. `idempotency_key`

指标集：

1. action 成功率/失败率
2. 技能调用成功率/耗时
3. 门禁阻断率/误报反馈率
4. 幂等冲突率

发布治理：

1. feature flag 矩阵
2. 一键回滚手册
3. 发布前检查脚本（配置完整性、路由可达性、开关一致性）

验收：

1. 线上问题 5 分钟内可定位到 action/route/skill 维度
2. 15 分钟内可完成降级或回滚

### 5) 质量门禁升级（P1）

目标：从纯规则升级为“规则 + 模型判定融合”。

交付：

1. 规则打分结果
2. 模型评估结果
3. 融合判定结果（pass/warn/block）
4. 误报反馈入口与回流

验收：

1. 阻断可解释（规则项 + 模型依据）
2. 误报反馈可被追踪并进入迭代闭环

### 6) 测试与验收体系（P0）

本阶段要求：产出“测试流程代码”，暂不执行全量测试。

交付：

1. 后端回归脚本模板
2. 前端 Win-only 测试脚本模板
3. 契约/E2E 场景脚本模板
4. CI 样例 workflow（可后续接入）

验收：

1. 每个 Action 有契约测试入口
2. 至少一条“创建 -> 迭代 -> 定稿”E2E 脚本
3. 测试命令可直接在后续阶段接入流水线

## Trellis Phase Plan

### Phase 1：协议与边界冻结（2-3 天）

1. 输出 Action 协议和槽位 schema
2. 输出技能治理优先级矩阵
3. 输出状态机迁移图与回滚策略

### Phase 2：后端核心实现（5-8 天）

1. 实现 NovelAction Router 与执行器
2. 实现技能选择器与权限门禁
3. 实现状态机与恢复补偿

### Phase 3：前端最小联动（3-5 天）

1. 聊天页消费结构化 Action 回执
2. 小说工作台显示生命周期状态与门禁结果
3. 展示技能调用结果与失败回退提示

### Phase 4：可观测与灰度收口（2-4 天）

1. 补齐日志字段和指标
2. 接入灰度开关与回滚脚本
3. 完成演练清单

### Phase 5：测试流程接线（2-3 天）

1. 启用本任务包已提供的测试流程脚本
2. 先跑定向集，再扩展到全量
3. 固化发布门禁

## Deliverables Checklist

1. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/prd.md`
2. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/task.json`
3. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/implement.jsonl`
4. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/check.jsonl`
5. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/debug.jsonl`
6. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/test-flows/run_backend_phase3.sh`
7. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/test-flows/run_frontend_phase3.ps1`
8. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/test-flows/run_contract_e2e_phase3.sh`
9. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/test-flows/ci_phase3_template.yml`
10. `.trellis/tasks/04-21-novel-phase3-lifecycle-operations/test-flows/README.md`

## Risks & Mitigations

1. 风险：Action 协议与现有 API 不一致导致回归
   对策：先加兼容层，保留 legacy fallback
2. 风险：技能默认加载误触发
   对策：强制通过“平台启用清单”二次过滤
3. 风险：状态机引入脏迁移
   对策：迁移守卫 + 审计事件 + 重放校验
4. 风险：灰度配置漂移
   对策：发布前自动化检查脚本 + 双人复核

## Definition of Done

1. 阶段三计划文档齐全并可执行
2. Trellis 任务上下文文件更新完成
3. 测试流程代码已落盘，命令可直接用于后续阶段
4. 明确声明本阶段未执行全量测试，仅提供测试流程代码
