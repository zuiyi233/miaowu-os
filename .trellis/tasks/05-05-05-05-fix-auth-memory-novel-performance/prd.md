# 修复 local-dev 鉴权401 记忆500 与小说页面性能

## Goal

在 `D:\miaowu-os\deer-flow-main` 的 Win-only local-dev 场景（frontend `4560`，backend `8551`）下，一次性修复并验证以下回归：
1) `/api/features` 点击工具触发 401；
2) 小说书籍进入触发 `Novel API request failed: 401`；
3) `/api/memory` 持续 500；
4) 小说相关页面（尤其 `/inspiration`、`/world-setting`）加载/编译卡顿明显。

## What I already know

- 你已完成部分修复，当前工作区已有 11 个未提交改动，主要集中在：
  - `frontend/src/core/features/api.ts`
  - `frontend/src/core/novel/novel-api.ts`
  - `frontend/src/components/novel/*`
  - `backend/packages/harness/deerflow/agents/memory/*`
  - `backend/packages/harness/deerflow/config/paths.py`
- local-dev 最新后端日志（`logs/local-dev/backend-20260505-120006.log`）能稳定复现：
  - `GET /api/features 401`
  - `GET /api/novels... 401`
  - `GET /api/memory 500`
- `auth_middleware` 对非 public 路径要求 `access_token` cookie；`frontend` 某些模块仍在用原生 `fetch` + 手工 `credentials`/`Authorization`，一致性不足。
- 当前 `memory` 改动已引入 `user_id` 维度，但关联路径隔离能力（`Paths` 线程/沙箱路径）未完整补齐，已有测试报错 `unexpected keyword argument 'user_id'`。
- 本仓 local-dev 端口契约固定是 backend `8551`，不可回退到 `8001`。

## Assumptions (temporary)

- 401 的主要根因是前端请求封装不统一（部分接口未经过统一 `fetcher` 合同、cookie/CSRF 策略不一致），而不是后端 auth 中间件逻辑本身。
- `/api/memory` 500 与当前 memory user-scope 改动不完整有关，需补齐 `Paths` 与调用链签名一致性。
- 小说页面性能劣化存在可通过前端请求/状态更新优化快速缓解的热点（重复请求、不必要重渲染、可并行/缓存未利用）。

## Open Questions

- 无阻塞性问题，先按最小回归面修复并跑针对性验证；若遇到产品取舍再回问。

## Requirements

- 修复 `tools/features` 调用链，确保在已登录 local-dev 会话中不再出现 `/api/features` 401。
- 修复小说 API 调用链，确保进入书籍详情不再出现 `Novel API request failed: 401`。
- 修复 `/api/memory` 500，确保 memory 基础读写接口可用（至少 `GET /api/memory` 正常）。
- 在不破坏既有二开功能前提下，优化小说相关页面的明显性能瓶颈（优先 `/inspiration`、`/world-setting` 路径上的可测瓶颈）。
- 修复应保持与上游核心鉴权/请求合同兼容，不引入绕过鉴权的临时后门。

## Acceptance Criteria

- [ ] 已登录 local-dev 会话下，`GET /api/features` 返回 2xx（不再 401）。
- [ ] 进入小说书籍详情时，不再出现 `Novel API request failed: 401`，相关核心请求返回 2xx。
- [ ] `GET /api/memory` 返回 2xx，且 memory 接口不再连续 500。
- [ ] 关键性能点有可量化改进（通过构建日志、页面请求次数或交互耗时对比给出证据）。
- [ ] 相关后端/前端针对性测试与 lint/typecheck 在可行范围内通过；若有失败，明确列出缺口与原因。

## Definition of Done

- 完成代码修复 + 最小必要验证证据。
- 不回滚/覆盖用户已有未提交工作，只在其基础上补齐缺口。
- 输出中明确：已完成项、未完成项、风险与后续建议。

## Technical Approach

- 先审计并补全前端 API 统一请求层使用（`core/api/fetcher`）以消除鉴权不一致。
- 补齐 `memory user_id` 相关 backend 路径/签名断点，修复 500。
- 对小说重型页面进行局部性能修正（请求去重、依赖收敛、避免不必要状态写入）。
- 使用并行子代理分别处理：鉴权链、memory 500、性能优化；主线程做集成与冲突消解。

## Decision (ADR-lite)

Context: 问题横跨 frontend 请求合同、backend memory 路径隔离、novel 页面性能，且已有半成品改动。
Decision: 采用“保留现有改动 + 补齐缺口 + 并行排查 + 主线程统一验证”的增量修复策略。
Consequences: 收敛速度快、对现有改动侵入小；需要主线程严格做最终集成验证，避免子修复互相打架。

## Out of Scope

- 不做与本次故障无关的大规模重构。
- 不改动 WSL 前端依赖流程（保持 Win-only 依赖约束）。
- 不把 local-dev 端口契约改回 8001。

## Technical Notes

- active repo: `D:\miaowu-os\deer-flow-main`
- local-dev contract: frontend `4560`, backend `8551`
- related logs: `logs/local-dev/backend-20260505-120006.log`
- key changed files in-progress:
  - `frontend/src/core/features/api.ts`
  - `frontend/src/core/novel/novel-api.ts`
  - `frontend/src/core/memory/api.ts`
  - `backend/packages/harness/deerflow/agents/memory/storage.py`
  - `backend/packages/harness/deerflow/agents/memory/updater.py`
  - `backend/packages/harness/deerflow/config/paths.py`
