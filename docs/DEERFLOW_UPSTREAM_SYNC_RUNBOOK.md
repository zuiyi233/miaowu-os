# DeerFlow 上游同步 Runbook（miaowu-os 固化版）

> 适用范围：`D:\miaowu-os` 根仓库中 `deer-flow-main` 基础框架的上游同步。
> 
> 目标：后续 AI 按本文执行，可在“保留本地二开优先”的前提下完成增量同步，不再从零摸索。

---

## 1. 仓库结构与关键约束

- 根仓库：`D:\miaowu-os`（有自己的 Git 历史）
- 基础框架目录：`D:\miaowu-os\deer-flow-main`
- 上游仓库：`https://github.com/bytedance/deer-flow`（分支 `main`）
- 本地 `deer-flow-main` **不是独立 git 仓库**（无 `deer-flow-main/.git`）
- 前端依赖策略：**Win-only，禁止 WSL 操作前端依赖**

### 为什么不能直接 `git merge upstream/main`

`D:\miaowu-os` 根仓库与 `upstream/main` 不共享直接 merge-base（仓库拓扑不同），
因此需要把 `deer-flow-main` 视作“子树”做三方合并，而不是根仓库直接 merge 上游。

---

## 2. 2026-04-20 本次同步事实快照

- 同步前本地基准：`c8dabd92c40667bc7054e935f3a4814ed1f888d1`
- 上游目标提交：`c99865f53dc7d82a888a326463b146625d128ae2`
- 安全备份分支：`backup-before-upstream-sync-20260420-013110`
- 冲突报告文件：`docs/upstream-sync-conflicts-20260420-014233.txt`

### 本次人工冲突裁决结果（已完成）

以下文件已人工裁决并落地：

1. `backend/packages/harness/deerflow/agents/middlewares/clarification_middleware.py`
   - 吸收上游稳定 message id 逻辑（clarification 重试去重）
2. `backend/packages/harness/deerflow/models/factory.py`
   - 吸收上游 OpenAI-compatible `stream_usage` 修复
   - 保留本地 `name/model_name` 兼容选择器逻辑（本地二开优先）
3. `backend/packages/harness/deerflow/sandbox/tools.py`
   - 吸收上游 `ls_tool` 本地路径掩码处理
4. `backend/packages/harness/deerflow/tools/builtins/task_tool.py`
   - 吸收上游 subagent 继承 `tool_groups` 限制
5. `backend/packages/harness/deerflow/utils/file_conversion.py`
   - 吸收上游 uploads 配置 dict/attr 双兼容读取

---

## 3. 固化执行流程（下次同步按此顺序）

## Step A：同步前检查

在 `D:\miaowu-os` 执行：

```powershell
git status --short --branch
git remote -v
git fetch --prune upstream main
git rev-parse upstream/main
```

要求：工作区尽量干净；若不干净先确认哪些改动是“可保留的二开改动”。

## Step B：先打备份点（强制）

```powershell
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
git branch "backup-before-upstream-sync-$ts"
```

## Step C：判断是否可直接 merge

```powershell
git merge-base HEAD upstream/main
```

- 若有 merge-base：可评估直接 merge（仍需本地优先策略）
- 若无 merge-base（本项目常态）：走 **Step D 子树三方合并**

## Step D：对子树 `deer-flow-main` 做三方合并

三方输入：

- base：`a695d1c8:deer-flow-main`（初始导入基线）
- local：`HEAD:deer-flow-main`
- upstream：`upstream/main`

合并策略（本地优先）

1. 仅本地改：保留本地
2. 仅上游改：接收上游
3. 双方均改：
   - 若 local==base、upstream!=base：接收上游
   - 若 upstream==base、local!=base：保留本地
   - 否则尝试 `git merge-file -p` 三方合并
   - 合并失败则进入人工裁决清单

> 每次同步都要生成冲突清单：`docs/upstream-sync-conflicts-<timestamp>.txt`

## Step E：人工冲突裁决

原则：

- **优先完整保留本地二开业务逻辑**
- 在不破坏本地功能前提下吸收上游修复
- 裁决后必须检查冲突标记是否清零：

```powershell
rg -n "^(<<<<<<<|=======|>>>>>>>)" deer-flow-main
```

---

## 4. 最小必要验证（固定命令集）

> 只在 Windows 环境执行，不用 WSL。

### 4.1 依赖准备

```powershell
cd D:\miaowu-os\deer-flow-main\backend
uv sync
```

若出现 `.venv\lib64` 权限异常（os error 5），先清理再重建：

```powershell
Remove-Item -LiteralPath '.venv' -Recurse -Force
uv sync
```

### 4.2 语法级验证

```powershell
python -m compileall \
  packages/harness/deerflow/agents/lead_agent/agent.py \
  packages/harness/deerflow/agents/middlewares/clarification_middleware.py \
  packages/harness/deerflow/agents/middlewares/llm_error_handling_middleware.py \
  packages/harness/deerflow/mcp/cache.py \
  packages/harness/deerflow/models/factory.py \
  packages/harness/deerflow/sandbox/tools.py \
  packages/harness/deerflow/tools/builtins/task_tool.py \
  packages/harness/deerflow/utils/file_conversion.py
```

### 4.3 定向回归测试（本次同步相关）

```powershell
uv run pytest -q \
  tests/test_clarification_middleware.py \
  tests/test_file_conversion.py \
  tests/test_llm_error_handling_middleware.py \
  tests/test_model_factory.py \
  tests/test_sandbox_search_tools.py \
  tests/test_task_tool_core_logic.py \
  tests/test_uploads_router.py
```

本次结果（2026-04-20）：

- 137 passed
- 2 failed（均在 `tests/test_sandbox_search_tools.py`，Windows 路径分隔符断言差异）

失败用例：

- `test_glob_tool_returns_virtual_paths_and_ignores_common_dirs`
- `test_glob_tool_supports_skills_virtual_paths`

---

## 5. 下次同步时的交付标准

同步任务完成不等于“代码改完”，必须同时满足：

1. 已拉取并记录上游目标 commit
2. 已生成备份分支
3. 已执行子树三方合并并输出冲突清单
4. 已完成人工冲突裁决（或明确列出残留冲突）
5. `rg` 冲突标记检查通过
6. 跑完最小必要验证并明确通过/失败项
7. 输出最终 `git status` 与变更文件摘要

---

## 6. 建议固定提示词（给下一个 AI）

可直接复用：

```text
请按 docs/DEERFLOW_UPSTREAM_SYNC_RUNBOOK.md 执行 deer-flow-main 上游同步，遵循“本地二开优先保留”原则。
先做 Step A~D，再给出冲突清单；冲突裁决后执行 Step 4 最小验证。
要求输出：
1) upstream 目标 commit
2) 备份分支名
3) 冲突文件与裁决说明
4) pytest/compileall 结果
5) 最终 git status
```

---

维护说明：
- 每次同步完成后，更新本文件“事实快照”和“已知失败项”。
- 若基线 commit（当前为 `a695d1c8:deer-flow-main`）发生调整，必须同步改本文 Step D。
