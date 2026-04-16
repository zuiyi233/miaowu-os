# novelist-ai-windows 功能迁移计划

## 项目背景

将 novelist-ai-windows 中的小说创作相关功能迁移至 deer-flow-main 项目。
deer-flow-main 已有更完整的 AI 能力（上下文记忆系统、后端服务），因此本次迁移主要是 UI 组件和辅助功能的迁移。

## 架构差异

| 维度 | novelist-ai-windows | deer-flow-main |
|------|---------------------|----------------|
| 数据存储 | IndexedDB (直接) | IndexedDB (databaseService) + React Query |
| 状态管理 | Zustand (多store) | Zustand (部分store) + React Query |
| AI 服务 | services/llmService.ts | core/novel/ai-service.ts (更完整) |
| 上下文系统 | contextEngineService | deer-flow-main 自有记忆系统 |
| 路由 | useState 模拟路由 | Next.js App Router |

## 迁移原则

1. **保留 deer-flow-main 的核心 AI 能力**，不迁移 novelist-ai-windows 的旧 AI 服务
2. **迁移 UI 组件**，将其数据层适配到 deer-flow-main 的 React Query 架构
3. **迁移辅助 Hooks**，适配到 deer-flow-main 的查询系统
4. **迁移状态管理**，补充 deer-flow-main 缺少的 Zustand stores

## 已完成迁移

### 状态管理层 (5个)
- [x] `useSettingsStore.ts` - 设置状态
- [x] `useModalStore.ts` - 模态框状态
- [x] `useUiStore.ts` - UI 状态
- [x] `useOutlineStore.ts` - 大纲状态
- [x] `useStyleStore.ts` - 文风状态

### Hooks (1个)
- [x] `useCreationModal.tsx` - 通用创建模态框

## 第一阶段：核心表单组件 (优先级: 高)

这些是小说创作的核心功能，必须首先迁移。

### 1.1 实体表单 (7个)
- [ ] `forms/CharacterForm.tsx` - 角色创建表单
- [ ] `forms/ItemForm.tsx` - 物品创建表单
- [ ] `forms/FactionForm.tsx` - 势力创建表单
- [ ] `forms/SettingForm.tsx` - 场景创建表单
- [ ] `forms/VolumeForm.tsx` - 卷创建表单
- [ ] `forms/ChapterForm.tsx` - 章节创建表单
- [ ] `forms/NovelForm.tsx` - 小说创建表单

### 1.2 实体详情和对话框 (10个)
- [ ] `character/CharacterDetail.tsx` - 角色详情
- [ ] `character/CharacterDeleteDialog.tsx` - 角色删除确认
- [ ] `character/CharacterEditDialog.tsx` - 角色编辑对话框
- [ ] `item/ItemDetail.tsx` - 物品详情
- [ ] `item/ItemDeleteDialog.tsx` - 物品删除确认
- [ ] `item/ItemEditDialog.tsx` - 物品编辑对话框
- [ ] `faction/FactionDetail.tsx` - 势力详情
- [ ] `faction/FactionDeleteDialog.tsx` - 势力删除确认
- [ ] `setting/SettingDetail.tsx` - 场景详情
- [ ] `setting/SettingDeleteDialog.tsx` - 场景删除确认

## 第二阶段：大纲和编辑器增强 (优先级: 高)

### 2.1 大纲子组件 (6个)
- [ ] `outline/OutlineConfigPanel.tsx` - 大纲配置面板
- [ ] `outline/OutlineItem.tsx` - 大纲条目
- [ ] `outline/OutlineListPanel.tsx` - 大纲列表面板
- [ ] `outline/SortableOutlineItem.tsx` - 可排序大纲条目
- [ ] `outline/StyleConfigPanel.tsx` - 文风配置面板
- [ ] `outline/MiniOutlineView.tsx` - 迷你大纲视图

### 2.2 编辑器增强组件 (5个)
- [ ] `editor/ChapterInfoCard.tsx` - 章节信息卡片
- [ ] `common/MentionList.tsx` - 提及列表
- [ ] `common/HistorySheet.tsx` - 历史表面板
- [ ] `common/CommandPalette.tsx` - 命令面板
- [ ] `common/GlobalModalRenderer.tsx` - 全局模态框渲染器

## 第三阶段：聊天和设置 (优先级: 中)

### 3.1 聊天组件 (4个)
- [ ] `chat/ChatInterface.tsx` - 聊天界面
- [ ] `chat/ChatHeader.tsx` - 聊天头部
- [ ] `chat/ChatPage.tsx` - 聊天页面
- [ ] `chat/ChatSidebar.tsx` - 聊天侧边栏

### 3.2 设置组件 (4个)
- [ ] `settings/ProviderSettings.tsx` - 提供商设置
- [ ] `settings/ModelConfigField.tsx` - 模型配置字段
- [ ] `settings/PromptEditorForm.tsx` - 提示词编辑表单
- [ ] `settings/PromptManager.tsx` - 提示词管理器

## 第四阶段：辅助组件 (优先级: 中)

### 4.1 侧边栏组件 (5个)
- [ ] `sidebar/GenericEntitySection.tsx` - 通用实体区域
- [ ] `sidebar/RelationshipManager.tsx` - 关系管理器
- [ ] `sidebar/VirtualizedCharacterList.tsx` - 虚拟化角色列表
- [ ] `sidebar/VirtualizedSettingList.tsx` - 虚拟化场景列表
- [ ] `sidebar/FactionList.tsx` - 势力列表

### 4.2 仪表盘组件 (3个)
- [ ] `dashboard/ActivityHeatmap.tsx` - 活动热力图
- [ ] `dashboard/MarketingBanner.tsx` - 营销横幅
- [ ] `dashboard/NovelBookCard.tsx` - 小说卡片

### 4.3 时间线组件 (1个)
- [ ] `timeline/TimelineEventForm.tsx` - 时间线事件表单

### 4.4 AI 组件 (1个)
- [ ] `ai/ContextRadar.tsx` - 上下文雷达

## 第五阶段：通用组件 (优先级: 低)

### 5.1 通用 UI 组件 (12个)
- [ ] `common/EntityCard.tsx` - 实体卡片
- [ ] `common/FormDialog.tsx` - 表单对话框
- [ ] `common/MultiEntitySelector.tsx` - 多实体选择器
- [ ] `common/MiniEditor.tsx` - 迷你编辑器
- [ ] `common/EditorCommandList.tsx` - 编辑器命令列表
- [ ] `common/ImageUpload.tsx` - 图片上传
- [ ] `common/LoadingButton.tsx` - 加载按钮
- [ ] `common/LoadingOverlay.tsx` - 加载遮罩
- [ ] `common/EmptyState.tsx` - 空状态
- [ ] `common/GenerationVisualizer.tsx` - 生成可视化器
- [ ] `common/BacklinksPanel.tsx` - 反向链接面板
- [ ] `common/AppHeader.tsx` - 应用头部

## Import 路径映射规则

| novelist-ai-windows | deer-flow-main |
|---------------------|----------------|
| `../types` | `@/core/novel/schemas` |
| `../stores/useModalStore` | `@/core/novel/useModalStore` |
| `../stores/useUiStore` | `@/core/novel/useUiStore` |
| `../stores/useOutlineStore` | `@/core/novel/useOutlineStore` |
| `../stores/useStyleStore` | `@/core/novel/useStyleStore` |
| `../stores/useSettingsStore` | `@/core/novel/useSettingsStore` |
| `../hooks/useCreationModal` | `@/core/novel/useCreationModal` |
| `../services/llmService` | `@/core/novel/ai-service` (或 deer-flow-main 服务) |
| `../lib/react-query/*` | `@/core/novel/queries` |
| `../lib/storage/db` | `@/core/novel/database` |
| `@/components/ui/*` | `@/components/ui/*` (保持不变) |

## 注意事项

1. 所有组件放在 `frontend/src/components/novel/` 目录下
2. 使用 `@/` 别名引用项目内部模块
3. 数据操作统一使用 `@/core/novel/queries` 中的 mutation hooks
4. 类型定义统一使用 `@/core/novel/schemas` 中的 zod schemas
5. 组件使用 TypeScript + Tailwind CSS + shadcn/ui


----
Relevant Code Snippets
1.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/chats/chat-box.tsx:L1-L100 — 聊天界面组件，包含消息显示和输入功能
2.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/workspace-sidebar.tsx:L1-L50 — 工作区侧边栏组件，包含导航和聊天列表
3.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/settings-dialog.tsx:L1-L30 — 设置对话框组件，用于管理各种应用设置
4.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/timeline/TimelineView.tsx:L1-L40 — 时间线视图组件，展示小说创作的时间线
5.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/AiPanel.tsx:L1-L50 — AI面板组件，用于显示和管理AI相关功能
6.
d:/miaowu-os/deer-flow-main/frontend/src/components/ui/sidebar.tsx:L1-L30 — 通用侧边栏UI组件
7.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/Dashboard.tsx:L1-L30 — 小说创作仪表板组件，展示主页和主要功能入口
8.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/chats/use-thread-chat.ts:L1-L20 — 聊天线程钩子，处理聊天上下文管理
9.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/appearance-settings-page.tsx:L1-L30 — 外观设置页面组件
10.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/workspace-header.tsx:L1-L25 — 工作区头部组件，包含页面标题和导航
11.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/workspace-container.tsx:L1-L20 — 工作区容器组件，作为主布局容器
12.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/recent-chat-list.tsx:L1-L30 — 最近聊天列表组件，显示最近的聊天记录
13.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/Editor.tsx:L1-L30 — 小说编辑器组件，用于文本创作
14.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/NovelWorkspace.tsx:L1-L30 — 小说工作区组件，整合了小说创作相关功能
15.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/command-palette.tsx:L1-L25 — 命令调色板组件，提供快速命令访问
16.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/ai/AiChatView.tsx:L1-L40 — AI聊天视图组件，用于小说创作中的AI对话
17.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/artifacts/context.tsx:L1-L20 — 工件上下文组件，管理上下文相关功能
18.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/sidebar/EntitySidebar.tsx:L1-L30 — 实体侧边栏组件，用于小说实体管理
19.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/agents/agent-card.tsx:L1-L20 — 代理卡片组件，显示可用的AI代理信息
20.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/RelationshipGraph.tsx:L1-L30 — 关系图组件，用于可视化小说中的人物关系
21.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/message-list.tsx:L1-L30 — 消息列表组件，用于渲染聊天消息
22.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/markdown-content.tsx:L1-L20 — Markdown内容组件，渲染Markdown格式的消息内容
23.
d:/miaowu-os/deer-flow-main/frontend/src/components/ui/button.tsx:L1-L40 — 按钮UI组件，用于交互元素
24.
d:/miaowu-os/deer-flow-main/frontend/src/components/ui/input.tsx:L1-L30 — 输入框UI组件，用于文本输入
25.
d:/miaowu-os/deer-flow-main/frontend/src/components/ui/textarea.tsx:L1-L30 — 文本域UI组件，用于多行文本输入
26.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/message-group.tsx:L1-L20 — 消息组组件，用于组织消息显示
27.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/message-list-item.tsx:L1-L20 — 消息列表项组件，单个消息项的渲染
28.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/subtask-card.tsx:L1-L20 — 子任务卡片组件，显示任务相关的信息
29.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/skeleton.tsx:L1-L20 — 骨架屏组件，用于加载状态时的视觉占位符
30.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/context.tsx:L1-L15 — 消息上下文组件，提供消息相关的状态管理
31.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/thread-title.tsx:L1-L20 — 线程标题组件，显示聊天线程的标题
32.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/workspace-nav-chat-list.tsx:L1-L25 — 工作区聊天导航列表组件，用于聊天历史导航
33.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/workspace-nav-menu.tsx:L1-L25 — 工作区导航菜单组件，提供导航选项
34.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/agent-welcome.tsx:L1-L20 — 代理欢迎组件，用于代理创建欢迎界面
35.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/welcome.tsx:L1-L25 — 欢迎组件，用于应用启动时的欢迎界面
36.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/EditorToolbar.tsx:L1-L30 — 编辑器工具栏组件，提供编辑相关工具按钮
37.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/outline/OutlineView.tsx:L1-L30 — 大纲视图组件，展示小说的大纲结构
38.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/memory-settings-page.tsx:L1-L30 — 内存设置页面组件
39.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/skill-settings-page.tsx:L1-L30 — 技能设置页面组件
40.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/tool-settings-page.tsx:L1-L30 — 工具设置页面组件
41.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/notification-settings-page.tsx:L1-L30 — 通知设置页面组件
42.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/about-settings-page.tsx:L1-L30 — 关于设置页面组件
43.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/message-token-usage.tsx:L1-L20 — 消息令牌使用组件，显示消息的令牌消耗情况
44.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/token-usage-indicator.tsx:L1-L20 — 令牌使用指示器组件，显示整体令牌使用情况
45.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/streams/streaming-indicator.tsx:L1-L20 — 流式传输指示器组件，显示AI响应的流式处理状态
46.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/commands/command-palette.tsx:L1-L30 — 命令调色板组件，用于快速访问应用功能
47.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/AiActionToolbar.tsx:L1-L30 — AI操作工具栏组件，提供AI相关操作按钮
48.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/tooltip.tsx:L1-L20 — 工具提示组件，用于显示额外信息
49.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/copy-button.tsx:L1-L20 — 复制按钮组件，用于复制文本内容
50.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/input-box.tsx:L1-L20 — 输入框组件，提供基础输入功能
51.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/todo-list.tsx:L1-L20 — 待办事项列表组件，显示任务列表
52.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/export-trigger.tsx:L1-L20 — 导出触发组件，用于导出内容
53.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/flip-display.tsx:L1-L20 — 翻转显示组件，提供动画效果
54.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/github-icon.tsx:L1-L20 — GitHub图标组件，显示GitHub相关图标
55.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/overscroll.tsx:L1-L20 — 溢出滚动组件，处理滚动行为
56.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/mode-hover-guide.tsx:L1-L20 — 模式悬停指南组件，显示模式切换提示
57.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/settings/DataManagement.tsx:L1-L30 — 数据管理设置组件，用于数据导入导出管理
58.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/settings/PromptTemplateManager.tsx:L1-L30 — 提示模板管理组件，用于管理AI提示模板
59.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/settings/NovelSettings.tsx:L1-L30 — 小说设置组件，管理小说创作相关设置
60.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/index.ts:L1-L20 — 设置页面索引文件，导出所有设置组件
61.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/index.ts:L1-L10 — 消息组件索引文件，导出所有消息相关组件
62.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/artifacts/index.ts:L1-L10 — 工件组件索引文件，导出所有工件相关组件
63.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/forms/index.ts:L1-L10 — 表单组件索引文件，导出所有小说表单组件
64.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/agents/index.ts:L1-L10 — 代理组件索引文件，导出所有代理相关组件
65.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/chats/index.ts:L1-L10 — 聊天组件索引文件，导出所有聊天相关组件
66.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/about.md:L1-L30 — 关于页面的Markdown文档
67.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/about-content.tsx:L1-L20 — 关于内容组件，显示应用介绍和版本信息
68.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/agent-welcome.tsx:L1-L20 — 代理欢迎组件，用于代理创建时的欢迎界面
69.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/welcome.tsx:L1-L25 — 欢迎界面组件，应用启动时的欢迎展示
70.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/input-box.tsx:L1-L20 — 输入框组件，支持聊天输入和其他文本输入场景
71.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/todo-list.tsx:L1-L20 — 待办事项组件，显示和管理任务列表
72.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/export-trigger.tsx:L1-L20 — 导出触发器组件，提供导出选项
73.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/flip-display.tsx:L1-L20 — 翻转显示组件，用于动画效果展示
74.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/github-icon.tsx:L1-L20 — GitHub图标组件，显示GitHub链接相关图标
75.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/overscroll.tsx:L1-L20 — 溢出滚动组件，处理滚动超出范围的情况
76.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/mode-hover-guide.tsx:L1-L20 — 模式悬停指南组件，提供模式切换引导提示
77.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/settings/DataManagement.tsx:L1-L30 — 数据管理设置组件，处理小说创作数据的导入导出
78.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/settings/PromptTemplateManager.tsx:L1-L30 — 提示模板管理组件，用于AI提示模板的管理
79.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/settings/NovelSettings.tsx:L1-L30 — 小说设置组件，管理小说相关的配置和设置
80.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/settings/index.ts:L1-L20 — 设置组件索引文件，导出所有设置相关组件
81.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/messages/index.ts:L1-L10 — 消息组件索引文件，导出所有消息相关组件
82.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/artifacts/index.ts:L1-L10 — 工件组件索引文件，导出所有工件相关组件
83.
d:/miaowu-os/deer-flow-main/frontend/src/components/novel/forms/index.ts:L1-L10 — 表单组件索引文件，导出所有小说表单相关组件
84.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/agents/index.ts:L1-L10 — 代理组件索引文件，导出所有代理相关组件
85.
d:/miaowu-os/deer-flow-main/frontend/src/components/workspace/chats/index.ts:L1-L10 — 聊天组件索引文件，导出所有聊天相关组件