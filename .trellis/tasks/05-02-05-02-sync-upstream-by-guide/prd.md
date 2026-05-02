# PRD：按 upstream-sync-guide 继续同步上游更新

## 背景
已有经验文档 `docs/upstream-sync-guide.md` 已定义标准同步策略（Squash、保留二开、遗留修复、验证清单）。本次需要在 `merge/upstream-main` 基础上继续吸收 `upstream/main` 新增更新。

## 目标
1. 仅按经验文档执行，不采用直接 merge 全历史方案。
2. 保留二开功能（特别是小说相关逻辑），不引入功能回退。
3. 完成最小必要验证并给出证据。

## 非目标
- 不做无关重构。
- 不修改与本次同步无关模块。

## 约束
- local-dev 地址约束：后端 8551，前端 4560。
- 变更范围尽量限定在 `deer-flow-main/`。
- 冲突修复优先参考原版 `D:\deer-flow-main` 与小说参考库 `D:\miaowu-os\参考项目\MuMuAINovel-main`（仅当涉及小说功能）。

## 验收标准
- upstream 新增提交完成同步（或明确说明无新增）。
- 若有遗留问题，按手册列出并修复。
- 至少完成：前端 tsc、后端关键 pytest（手册指定用例）和必要编译检查。
- 输出：变更摘要、验证结果、剩余风险。
