# 第三轮性能优化（质量报告查询去重）

## 背景
当前质量报告相关查询在布局层与页面/面板层存在重复入口，增加了重复请求和状态维护开销。

## 目标
1. 统一 query source：将 quality-report 查询抽到共享 hook（优先 `frontend/src/core/novel/queries.ts`），让 `ProjectWorkspaceLayout` 与 `QualityReportPanel` 复用同一 `queryKey/queryFn`。
2. 降低重复开销：避免布局和页面各自维护独立查询逻辑。
3. 在质量报告页启用更积极刷新策略：由现有 15s 调整为 5s 或 8s（优先 5s）。
4. 保持现有 UI 行为不变：`Phase2StatusBar`、`QualityReportPanel` 刷新按钮继续可用。
5. 最小必要改动：仅改与该目标直接相关的前端文件，并保持与当前分支逻辑兼容。

## 非目标
- 不调整后端接口与契约。
- 不处理与质量报告查询去重无关的前端重构。

## 验收
- `ProjectWorkspaceLayout` 与 `QualityReportPanel` 通过同一查询入口访问质量报告数据。
- 质量报告页刷新周期明显比 15s 更积极（按实现值验证）。
- `pnpm -C frontend lint` 与 `pnpm -C frontend typecheck` 可执行并报告结果；若仅有既有 warning，明确“无新增 error”。
