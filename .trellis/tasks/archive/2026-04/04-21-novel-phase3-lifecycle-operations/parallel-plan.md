# 阶段三父任务并行执行总控

## 子任务与 WP 映射

1. `04-21-novel-phase3-ws-a-action-router`（WP1）
2. `04-21-novel-phase3-ws-b-skill-governance-gate`（WP2 + WP5）
3. `04-21-novel-phase3-ws-c-lifecycle-observability`（WP3 + WP4）
4. `04-21-novel-phase3-ws-d-test-acceptance`（WP6）

## 并行顺序（执行基线）

1. 波次 1（并行）：WS-A、WS-B、WS-C。
2. 波次 2（串到并行）：WS-D 对齐 WS-A/B/C 产物，补齐契约/E2E/幂等压测流程代码与 CI 模板。
3. 波次 3（父任务收口）：统一文档、开关矩阵、回滚手册、风险清单与验证缺口。

## 依赖关系

1. WS-A 与 WS-B：文件级可并行，协议级通过 `action_protocol` 契约对齐。
2. WS-C 依赖 WS-A/WS-B 的产物语义（action/gate 状态），但实现文件可并行开发后收口联调。
3. WS-D 依赖 WS-A/B/C 的最终测试入口与契约字段，必须第二波执行。

## 冲突边界

1. WS-A：`backend/app/gateway/middleware/*`、`backend/app/gateway/api/ai_provider.py`、对应测试。
2. WS-B：`backend/app/gateway/novel_migrated/services/skill_governance_service.py`、`quality_gate_fusion_service.py`，以及治理接线测试。
3. WS-C：`backend/app/gateway/novel_migrated/services/lifecycle_service.py`、`orchestration_service.py`、`consistency_gate_service.py`、可观测上下文与对应测试。
4. WS-D：`backend/tests/{contracts,e2e,load,novel_phase3}/ws_d/**` 与 `.trellis/tasks/*/test-flows/**`。

## 合并节奏

1. T+0：WS-A/B/C 并行完成并通过最小定向验证。
2. T+1：冻结协议与生命周期字段，确认兼容策略（legacy fallback + feature flag）。
3. T+2：WS-D 接入测试流程代码（targeted -> contract/e2e/load），CI 模板加入门禁。
4. T+3：父任务层收口文档（矩阵、回滚、风险、验证缺口）。

## 里程碑

1. M1：WS-A/B/C 关键测试通过（定向）。
2. M2：WS-D 新增测试路径与脚本完成对接。
3. M3：四个子任务 `task.py validate` 全通过。
4. M4：父任务收口文档完成并可用于发布演练。

## 开关矩阵

| 开关名 | 默认值 | 作用范围 | 关闭时降级行为 |
|---|---:|---|---|
| `intent_recognition` | `true` | 对话识别与 action 会话入口 | 直接退回普通聊天链路 |
| `intent_skill_governance` | `false` | 三层技能治理（system/workspace/session） | 退回 workspace 兼容筛选 |
| `novel_quality_gate_fusion` | `false` | 规则 + 模型门禁融合 | `rule_only`（或 `warn_only`） |
| `novel_lifecycle_v2` | `false` | 生命周期状态机、幂等重放、补偿建议 | legacy `status` 路径 |

## 回滚手册（Feature Flag + Degraded Fallback）

1. 回滚 WS-A：关闭 `intent_recognition`，入口退回普通聊天，不触发小说会话协议。
2. 回滚 WS-B：
1. 关闭 `intent_skill_governance`，技能选择回退到旧工作区过滤。
2. 关闭 `novel_quality_gate_fusion`，门禁结果回退为规则判定。
3. 回滚 WS-C：关闭 `novel_lifecycle_v2`，定稿流程回退为 legacy `finalized` 更新逻辑。
4. 回滚顺序建议：入口（WS-A）-> 门禁（WS-B）-> 生命周期（WS-C），避免状态语义漂移。

## 风险清单

1. 风险：融合门禁上线初期误报上升。
2. 缓解：保留 `warn_only` 降级、开放误报回流接口。
3. 风险：生命周期迁移约束过严影响生产定稿。
4. 缓解：`novel_lifecycle_v2` 一键关闭并走 legacy fallback。
5. 风险：测试流程脚本与真实路径脱节。
6. 缓解：WS-D 新增 contract/e2e/load 真实测试代码并在脚本内显式引用。

## 验证缺口

1. 本轮未执行全量回归与压测，仅做最小定向验证。
2. 前端验证脚本仅提供 Win-PowerShell 路径，未在当前 WSL 会话执行。
3. CI 模板为手动触发模板，尚未接入正式流水线环境变量与密钥。
