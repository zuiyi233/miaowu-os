# 同步 deer-flow upstream 最新更新并保证二开可合并

## Goal

在 `D:\miaowu-os` 根仓库中，将 `upstream/main` 的最新更新同步到当前分支 `merge/upstream-main`，并确保 `deer-flow-main/` 下本地二开功能不丢失、无冲突残留、可完成最小必要验证。

## What I already know

- 当前工作仓库根目录是 `D:\miaowu-os`，`deer-flow-main` 不是独立 git 仓库。
- 用户要求按既有规范执行同步。
- 已有同步规范文档：
  - `docs/upstream-sync-guide.md`
  - `docs/DEERFLOW_UPSTREAM_SYNC_RUNBOOK.md`
- 历史经验明确：本仓库与上游拓扑不一致，不应直接根级 `git merge upstream/main`，应采用已固化的“子树/目录级同步 + 本地优先裁决”策略。
- 本地 local-dev 运行契约中，后端基址约束为 `127.0.0.1:8551`（涉及冲突裁决时不得被上游 `8001` 文案覆盖）。

## Assumptions (temporary)

- `upstream` remote 已存在并可正常访问。
- 当前分支允许进行同步提交。
- 同步后以最小必要验证集作为本轮可行验证边界。

## Open Questions

- 无阻塞问题；按既有 runbook 直接执行。

## Requirements (evolving)

- 拉取并定位 `upstream/main` 最新提交。
- 先创建可回滚备份分支。
- 按 `docs/DEERFLOW_UPSTREAM_SYNC_RUNBOOK.md` 执行同步，不采用破坏拓扑的直连合并方案。
- 冲突裁决遵循“本地二开优先保留，同时吸收兼容上游修复”。
- 冲突处理后必须清零冲突标记。
- 完成最小必要验证（至少包含语法/类型/关键回归项中的可行集合）。
- 输出同步结果摘要：目标 commit、备份分支、冲突清单、验证结果、最终 `git status`。

## Acceptance Criteria (evolving)

- [ ] `upstream/main` 已 fetch 到本地并记录目标 commit。
- [ ] 已创建备份分支。
- [ ] 已完成同步并处理冲突，`rg` 不再命中冲突标记。
- [ ] 同步后的改动仍聚焦在预期范围（优先 `deer-flow-main/` 与必要文档）。
- [ ] 最小必要验证命令已执行并记录结果；如失败，明确失败点与影响范围。

## Definition of Done (team quality bar)

- 结果可追溯：关键命令、目标 commit、冲突裁决、验证证据齐全。
- 不引入与本次同步无关的重构或清理。
- 明确说明限制、失败项、残余风险。

## Out of Scope (explicit)

- 不进行 WSL 前端依赖操作。
- 不做小说功能新开发或无关功能重构。
- 不处理与本次 upstream 同步无关的历史技术债。

## Technical Notes

- 主要执行与参考文件：
  - `docs/upstream-sync-guide.md`
  - `docs/DEERFLOW_UPSTREAM_SYNC_RUNBOOK.md`
  - `docs/upstream-sync-conflicts-*.txt`（本轮将新增）
- 预期执行目录：`D:\miaowu-os`
- 预期同步对象：`upstream/main` → 当前 `merge/upstream-main`
