# 11个保留文件与 upstream 差异清单（2026-05-03）

基线：upstream `189b8240..44ab21fc`；本地：`merge/upstream-main`（commit `aa8b0192` 之后）

| 文件 | 上游涉及 commit | 上游增量(+/-) | 本地相对 upstream 偏离(+/-) | 风险标签 | 初步建议 |
|---|---|---:|---:|---|---|
| `backend/packages/harness/deerflow/agents/lead_agent/agent.py` | 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `11/15` | `140/72` | `novel-instructions-sensitive` | `sync-selective-hunks-only` |
| `backend/packages/harness/deerflow/agents/lead_agent/prompt.py` | 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `61/37` | `75/100` | `novel-instructions-sensitive` | `sync-selective-hunks-only` |
| `backend/packages/harness/deerflow/agents/middlewares/memory_middleware.py` | 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `9/3` | `22/16` | `middleware-config-path` | `sync-medium-risk-after-checking-app_config-threading` |
| `backend/packages/harness/deerflow/agents/middlewares/title_middleware.py` | 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `27/8` | `45/44` | `middleware-config-path` | `sync-medium-risk-after-checking-app_config-threading` |
| `backend/packages/harness/deerflow/runtime/runs/manager.py` | ca3332f8 fix(gateway): return ISO 8601 timestamps from threads endpoints (#2599) | `2/5` | `9/49` | `none` | `sync-low-risk` |
| `backend/packages/harness/deerflow/runtime/runs/worker.py` | 17447fcc fix(runtime): make rollback restore checkpoint supersede newer checkpoints (#2582)<br>8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `40/8` | `50/191` | `runtime-checkpoint-critical` | `partial-sync-recommended-for-rollback-marker-fix` |
| `backend/packages/harness/deerflow/subagents/executor.py` | 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `16/6` | `54/180` | `none` | `sync-selective-hunks-only` |
| `backend/tests/test_lead_agent_model_resolution.py` | 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `97/8` | `149/93` | `test-only` | `sync-if-and-only-if-corresponding-runtime-code-is-synced` |
| `backend/tests/test_run_worker_rollback.py` | 17447fcc fix(runtime): make rollback restore checkpoint supersede newer checkpoints (#2582)<br>8ba01dfd refactor: thread app_config through lead and subagent task path (#2666) | `133/17` | `36/178` | `test-only` | `sync-if-and-only-if-corresponding-runtime-code-is-synced` |
| `backend/tests/test_threads_router.py` | ca3332f8 fix(gateway): return ISO 8601 timestamps from threads endpoints (#2599) | `296/1` | `13/290` | `test-only` | `sync-if-and-only-if-corresponding-runtime-code-is-synced` |
| `backend/pyproject.toml` | 17447fcc fix(runtime): make rollback restore checkpoint supersede newer checkpoints (#2582) | `0/1` | `7/8` | `dependency-constraint` | `do-not-sync-this-change` |

## 逐文件判断

### backend/packages/harness/deerflow/agents/lead_agent/agent.py
- 上游commit：
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+11 / -15
- 当前偏离：+140 / -72（相对 upstream 44ab21fc）
- 建议：sync-selective-hunks-only

### backend/packages/harness/deerflow/agents/lead_agent/prompt.py
- 上游commit：
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+61 / -37
- 当前偏离：+75 / -100（相对 upstream 44ab21fc）
- 建议：sync-selective-hunks-only

### backend/packages/harness/deerflow/agents/middlewares/memory_middleware.py
- 上游commit：
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+9 / -3
- 当前偏离：+22 / -16（相对 upstream 44ab21fc）
- 建议：sync-medium-risk-after-checking-app_config-threading

### backend/packages/harness/deerflow/agents/middlewares/title_middleware.py
- 上游commit：
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+27 / -8
- 当前偏离：+45 / -44（相对 upstream 44ab21fc）
- 建议：sync-medium-risk-after-checking-app_config-threading

### backend/packages/harness/deerflow/runtime/runs/manager.py
- 上游commit：
  - ca3332f8 fix(gateway): return ISO 8601 timestamps from threads endpoints (#2599)
- 上游增量：+2 / -5
- 当前偏离：+9 / -49（相对 upstream 44ab21fc）
- 建议：sync-low-risk

### backend/packages/harness/deerflow/runtime/runs/worker.py
- 上游commit：
  - 17447fcc fix(runtime): make rollback restore checkpoint supersede newer checkpoints (#2582)
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+40 / -8
- 当前偏离：+50 / -191（相对 upstream 44ab21fc）
- 建议：partial-sync-recommended-for-rollback-marker-fix

### backend/packages/harness/deerflow/subagents/executor.py
- 上游commit：
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+16 / -6
- 当前偏离：+54 / -180（相对 upstream 44ab21fc）
- 建议：sync-selective-hunks-only

### backend/tests/test_lead_agent_model_resolution.py
- 上游commit：
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+97 / -8
- 当前偏离：+149 / -93（相对 upstream 44ab21fc）
- 建议：sync-if-and-only-if-corresponding-runtime-code-is-synced

### backend/tests/test_run_worker_rollback.py
- 上游commit：
  - 17447fcc fix(runtime): make rollback restore checkpoint supersede newer checkpoints (#2582)
  - 8ba01dfd refactor: thread app_config through lead and subagent task path (#2666)
- 上游增量：+133 / -17
- 当前偏离：+36 / -178（相对 upstream 44ab21fc）
- 建议：sync-if-and-only-if-corresponding-runtime-code-is-synced

### backend/tests/test_threads_router.py
- 上游commit：
  - ca3332f8 fix(gateway): return ISO 8601 timestamps from threads endpoints (#2599)
- 上游增量：+296 / -1
- 当前偏离：+13 / -290（相对 upstream 44ab21fc）
- 建议：sync-if-and-only-if-corresponding-runtime-code-is-synced

### backend/pyproject.toml
- 上游commit：
  - 17447fcc fix(runtime): make rollback restore checkpoint supersede newer checkpoints (#2582)
- 上游增量：+0 / -1
- 当前偏离：+7 / -8（相对 upstream 44ab21fc）
- 建议：do-not-sync-this-change

## 可补齐优先级（结论）

### P0（建议优先补齐）

1. `backend/packages/harness/deerflow/runtime/runs/worker.py`
- 建议补齐上游 `17447fcc` 中 rollback marker 相关逻辑：
  - 引入 `empty_checkpoint`。
  - 在 `_rollback_to_pre_run_checkpoint()` 中用新 marker 覆盖恢复 checkpoint 的 `id/ts`。
  - 增加 `_new_checkpoint_marker()` 辅助函数。
- 原因：这是“运行态正确性”修复，直接影响 rollback 后最新 checkpoint 是否覆盖成功。

2. `backend/packages/harness/deerflow/runtime/runs/manager.py`
- 建议补齐上游 `ca3332f8` 的时间工具调用切换（`now_iso`）。
- 原因：改动面小、风险低，能与 threads 时间 ISO 约束保持一致。

### P1（可补齐，但建议选择性摘取 hunk）

3. `backend/packages/harness/deerflow/agents/middlewares/memory_middleware.py`
- 建议补齐：`memory_config` 显式注入路径，避免隐式全局读取。
- 风险：需确保与你当前 memory worker 生命周期改造不冲突。

4. `backend/packages/harness/deerflow/agents/middlewares/title_middleware.py`
- 建议补齐：`TitleMiddleware` 支持 `app_config/title_config` 注入，`create_chat_model(..., app_config=...)` 透传。
- 风险：需检查你当前标题生成策略与模型路由覆盖是否受影响。

5. `backend/packages/harness/deerflow/subagents/executor.py`
- 建议补齐：
  - app_config 透传到 skill storage / task_tool context。
  - `ai_messages is None` 时初始化为空数组。
- 风险：与现有 subagent 执行链重构耦合较高，建议分小块验证。

6. `backend/packages/harness/deerflow/agents/lead_agent/agent.py`
7. `backend/packages/harness/deerflow/agents/lead_agent/prompt.py`
- 建议仅补齐“配置透传”相关 hunk，不动小说相关 prompt 自定义段。
- 高风险点：这两文件当前偏离 upstream 很大，且承载你的小说行为约束，禁止整文件覆盖。

### P2（仅在对应运行时代码补齐后再跟）

8. `backend/tests/test_run_worker_rollback.py`
9. `backend/tests/test_lead_agent_model_resolution.py`
10. `backend/tests/test_threads_router.py`
- 建议：只同步与已补 runtime 行为一致的测试；不要先引入测试再反向逼改 runtime。

### 明确不补齐

11. `backend/pyproject.toml`
- 上游删除的是 `[tool.uv.sources]` 下的 `deerflow-harness = { workspace = true }`。
- 本项目当前仍依赖 workspace 结构 + 你已锁定 `langgraph-prebuilt<1.0.9`，建议保留本地版本，不跟这条删除。

## 一句话判断

- 可以补：`worker.py`（rollback marker）+ `manager.py`（ISO time）+ 中间件/执行器/lead_agent 的“配置透传小块”。
- 不建议补：`pyproject.toml` 的上游删除项。
- 测试文件按“代码先行、测试后跟”原则补齐。
