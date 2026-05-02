# 账号管理页无法进入 / 空白 - PRD

## Goal

恢复账号管理（Settings -> Account）页面的正常展示与使用，并输出一份可留档的排查文档，说明问题根因、修复方式和验证结果。

## What I already know

- 用户反馈：注册已可用，登录不报错，但登录后看起来“没有跳转”，账号管理页面无法进入下一步。
- 近期提交里，`3e792a08` 和 `d5a5c44d` 都涉及 auth / 前端设置页 / 上游同步。
- 对比原版项目 `D:\deer-flow-main` 后，当前项目的 `frontend/src/components/workspace/settings/settings-dialog.tsx` 里保留了 `account` 侧边栏入口，但遗漏了 `AccountSettingsPage` 的导入和渲染分支。
- 原版项目在 `activeSection === "account"` 时会渲染 `AccountSettingsPage`。

## Assumptions (temporary)

- 用户描述的“登录后没有跳转”实际对应的是账号管理弹窗中账户页空白/无内容，而不是后端登录接口本身失败。
- 如果后续验证发现登录页本身还有独立跳转问题，再扩大范围补修；本次先收敛到账号管理页的可用性问题。

## Open Questions

- 无阻塞问题。当前证据已经足够定位到前端 settings-dialog 的渲染漏项。

## Requirements (evolving)

- 恢复 `SettingsDialog` 中 `account` 分支的实际内容渲染。
- 保持现有 settings dialog 的新版布局不回退。
- 增加一个回归测试，防止 `account` 入口再次只显示导航、不显示内容。
- 产出一份文档，说明症状、根因、修复和验证。

## Acceptance Criteria (evolving)

- [ ] 打开设置弹窗并切到 Account 时，右侧能看到账户信息、改密表单和退出按钮。
- [ ] 账号管理页不再是空白区域。
- [ ] 有回归测试覆盖 account section 渲染。
- [ ] 文档已写入仓库，包含问题复盘和验证说明。

## Definition of Done (team quality bar)

- 代码修复已提交。
- 相关单元测试已新增/更新并通过。
- 进行了可行的 lint / test 验证。
- 文档已更新。
- 没有引入无关重构。

## Out of Scope (explicit)

- 不重构整个 auth 流程。
- 不改登录 / 注册 API 的协议。
- 不调整 settings dialog 的整体视觉设计，除非修复需要。

## Technical Notes

- 目标文件：`deer-flow-main/frontend/src/components/workspace/settings/settings-dialog.tsx`
- 参考文件：`D:\deer-flow-main\frontend\src\components\workspace\settings\settings-dialog.tsx`
- 计划新增测试：`deer-flow-main/frontend/tests/unit/components/workspace/settings/settings-dialog.test.ts`
- 计划新增文档：`deer-flow-main/docs/BUG_ACCOUNT_SETTINGS_PAGE.md`
