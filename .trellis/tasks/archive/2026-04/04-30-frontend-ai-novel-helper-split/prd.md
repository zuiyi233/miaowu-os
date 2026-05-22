# frontend helper split for ai service and novel api

## Goal

在不改变现有前端行为的前提下，把 `frontend/src/core/ai/global-ai-service.ts` 和 `frontend/src/core/novel/novel-api.ts` 中的重复/复杂逻辑抽到邻近 helper，保留公开接口稳定，并给缓存、重试和并发相关逻辑补上统一注释与最小规范化实现。

## What I already know

- 作用范围仅限于 `frontend/src/core/ai/global-ai-service.ts`、`frontend/src/core/novel/novel-api.ts`，以及这两个目录下新增的 helper/test 文件。
- `global-ai-service.ts` 已经依赖共享的 `request-utils`，当前剩余复杂点主要是 retry/backoff、AbortController 生命周期、SSE 流处理和请求结果规范化。
- `novel-api.ts` 已经有 `createTimedOrderedCache`，当前缓存逻辑主要集中在 `getNovelCached` / `clearNovelCache`，适合抽成更小的缓存 helper。
- frontend 侧已经有现成的 Vitest 单测目录，可直接用作最小回归基线。
- 本地开发环境下后端基址固定应按 8551 处理，不引入 8001 作为默认值。

## Assumptions

- 不改后端协议，不改 API 路径，不改现有调用方入参。
- helper 抽取保持“邻近、最小、可读”，不做跨目录大重组。
- 公开导出若会影响现有测试或调用方，可在原文件继续 re-export。

## Requirements

- 至少把 1 处重复/复杂逻辑抽到新增 helper 文件中，形成可见拆分。
- 在触达的缓存/重试/并发逻辑上补充统一注释，并做最小规范化实现（例如 retry 次数归一、cache 生命周期明确、请求并发生命周期清晰）。
- 保持现有 public behavior 尽量不变。
- 提供最小回归基线，并执行它。
- 最终只修改允许范围内文件。

## Acceptance Criteria

- [ ] 新增至少 1 个邻近 helper 文件，并被 target 文件实际引用。
- [ ] `global-ai-service.ts` / `novel-api.ts` 的复杂逻辑有明显拆分，且行为与现状一致。
- [ ] 缓存、重试、并发相关逻辑补上统一注释或最小规范化实现。
- [ ] `pnpm -C frontend typecheck` 通过。
- [ ] 若新增测试，则对应 Vitest 命令通过。

## Definition of Done

- helper 拆分可在 diff 中直接看见。
- 至少完成一次可复现的本地验证。
- 记录任何限制、风险或未覆盖项。

## Out of Scope

- 不做 backend 改动。
- 不做无关重构、命名清理或格式化。
- 不扩大到其他模块或跨层协议改造。

## Technical Notes

- 目标文件：`frontend/src/core/ai/global-ai-service.ts`、`frontend/src/core/novel/novel-api.ts`
- 候选 helper 位置：`frontend/src/core/ai/`、`frontend/src/core/novel/`
- 计划验证：`pnpm -C frontend typecheck`，必要时再补相关 Vitest baseline
