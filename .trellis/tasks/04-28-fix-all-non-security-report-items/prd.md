# 修复 CODE_REVIEW_REPORT 非安全问题（全量）

## Goal

基于 `D:\miaowu-os\deer-flow-main\CODE_REVIEW_REPORT.md`，一次性修复报告中的全部非安全问题（包含 Bug/性能/架构/功能/质量），并保持现有二开能力与本地运行链路稳定。

## What I already know

- 用户明确要求：忽略安全类问题，仅修复其他问题，且不需要再做优先级分批。
- 已完成报告逐条核验：非安全项共 26 条，22 条明确存在，4 条部分成立。
- 当前工作区：`D:\miaowu-os\deer-flow-main`（Windows）。
- 按项目约束，local-dev 默认端口应保持 8551，不可回退 8001。

## Scope (In)

- 修复以下后端问题：
  - H-04, H-05
  - M-01, M-02, M-03, M-04, M-05, M-08, M-09, M-10, M-11, M-12, M-13, M-14, M-15, M-16
  - L-02, L-03, L-04, L-05, L-06, L-07, L-08, L-10
- 修复以下前端问题：
  - L-01, L-09
- 同步更新必要的测试/断言（若现有测试受影响）。

## Out of Scope

- 安全类问题（H-01/H-02/H-03/H-06、M-06、M-07）本轮不处理。
- 与本次问题无关的重构、样式改造、目录迁移。

## Requirements

1. 所有非安全问题都要有对应代码落地修复，不遗漏。
2. 修复应尽量小而完整，避免引入临时 hack。
3. 架构类问题（如重复逻辑、私有方法跨层、大文件）至少落实到本轮可执行的改进，不仅写 TODO。
4. 保持 novel 相关接口行为与现有调用兼容（包含 8551 本地开发约束）。
5. 不修改安全类问题相关策略与行为。

## Acceptance Criteria

- [ ] 报告中的非安全问题均有对应修复变更（代码层可追踪）。
- [ ] 后端 lint/typecheck（或等效检查）可执行项通过。
- [ ] 前端 lint/typecheck（或等效检查）可执行项通过。
- [ ] 至少完成与改动直接相关的测试/回归验证；若有失败，明确记录缺口。
- [ ] 输出最终核对清单：每个问题 -> 已修复证据路径。

## Technical Notes

- 相关报告：`D:\miaowu-os\deer-flow-main\CODE_REVIEW_REPORT.md`
- 对比基线：
  - 原版 Deer-Flow：`D:\deer-flow-main`（相关 novel_migrated 文件大多不存在，无法直接复用）
  - 小说参考：`D:\miaowu-os\参考项目\MuMuAINovel-main`（已抽样对比章节局部重写、book import、memories 逻辑）
- 预期主要改动区域：
  - `backend/app/gateway/novel_migrated/**`
  - `backend/app/gateway/middleware/**`
  - `backend/packages/harness/deerflow/**`
  - `frontend/src/core/novel/**`
