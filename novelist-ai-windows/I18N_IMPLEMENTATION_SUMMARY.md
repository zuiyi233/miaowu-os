# 小说工作室国际化(i18n)实施总结

## ✅ 已完成工作

### 1. 基础设施搭建
- [x] 安装 `i18next`, `react-i18next`, `i18next-browser-languagedetector`
- [x] 创建 i18n 配置文件: `lib/i18n/index.ts`
- [x] 创建中文语言文件: `lib/i18n/locales/zh-CN.json` (300+ 翻译键)
- [x] 创建英文语言文件: `lib/i18n/locales/en-US.json` (300+ 翻译键)
- [x] 在 `index.tsx` 中初始化 i18n 并根据用户设置切换语言

### 2. 设置系统集成
- [x] 在 `useSettingsStore.ts` 中添加 `language` 字段
- [x] 添加 `setLanguage` 方法
- [x] 升级存储版本到 v9
- [x] 添加版本迁移逻辑 (v8 → v9)

### 3. UI 组件
- [x] 创建 `LanguageSelector` 组件 (`components/LanguageSelector.tsx`)
- [x] 国际化侧边栏 `Sidebar.tsx` (章节、世界观构建、设置等)
- [x] 国际化编辑器工具栏 `EditorToolbar.tsx` (续写、润色、扩写、简写、改写、分析等按钮)

### 4. 日期本地化
- [x] 修改 `lib/utils/date.ts` 支持动态 locale 切换
- [x] 根据语言设置自动使用 `zhCN` 或 `enUS` locale

## 📋 待完成工作

### P1 - 高优先级组件 (需要国际化)

| 组件 | 文件路径 | 状态 |
|------|---------|------|
| AI 面板 | `components/AiPanel.tsx` | ❌ 待国际化 |
| 设置对话框 | `components/SettingsDialog.tsx` | ❌ 待国际化 |
| Dashboard | `components/Dashboard.tsx` | ❌ 待国际化 |
| 聊天界面 | `components/chat/ChatInterface.tsx` | ❌ 待国际化 |
| 角色表单 | `components/CharacterForm.tsx` | ❌ 待国际化 |
| 小说表单 | `components/NovelForm.tsx` | ❌ 待国际化 |
| 章节表单 | `components/ChapterForm.tsx` | ❌ 待国际化 |
| 大纲视图 | `components/outline/OutlineView.tsx` | ❌ 待国际化 |
| 时间线视图 | `components/timeline/TimelineView.tsx` | ❌ 待国际化 |

### P2 - 中优先级组件

| 组件类型 | 文件路径 | 状态 |
|---------|---------|------|
| 实体表单 | `components/SettingForm.tsx` | ❌ 待国际化 |
| 实体表单 | `components/FactionForm.tsx` | ❌ 待国际化 |
| 实体表单 | `components/ItemForm.tsx` | ❌ 待国际化 |
| 对话框 | `components/*Dialog.tsx` (多个) | ❌ 待国际化 |
| Toast 通知 | `components/AiPanel.tsx` 等 | ❌ 待国际化 |
| 错误消息 | `hooks/useApiAction.ts` | ❌ 待国际化 |

### P3 - 低优先级内容

| 内容类型 | 说明 | 状态 |
|---------|------|------|
| AI Prompt 模板 | `lib/prompts/templates/*.md` | ❌ 待国际化 |
| 常量文件 | `src/lib/constants/**/*.ts` | ❌ 待国际化 |
| 空状态提示 | `components/common/EmptyState.tsx` | ❌ 待国际化 |

## 🔧 国际化使用方法

### 在组件中使用

```tsx
import { useTranslation } from "react-i18next";

const MyComponent = () => {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t("common.settings")}</h1>
      <button>{t("common.save")}</button>
      <input placeholder={t("character.namePlaceholder")} />
    </div>
  );
};
```

### 在语言文件中添加新翻译

1. 在 `lib/i18n/locales/zh-CN.json` 中添加中文翻译
2. 在 `lib/i18n/locales/en-US.json` 中添加对应英文翻译
3. 确保两个文件的键名完全一致

### 切换语言

```tsx
import { useSettingsStore } from "../stores/useSettingsStore";
import { changeLanguage } from "../lib/i18n";

const setLanguage = useSettingsStore((state) => state.setLanguage);

// 切换为英文
setLanguage("en-US");
changeLanguage("en-US");

// 切换为中文
setLanguage("zh-CN");
changeLanguage("zh-CN");
```

## 📊 语言文件结构

```
{
  "common": { ... },          // 通用文本
  "sidebar": { ... },         // 侧边栏
  "editor": { ... },          // 编辑器
  "character": { ... },       // 角色管理
  "setting_item": { ... },    // 场景管理
  "faction": { ... },         // 势力管理
  "item": { ... },            // 物品管理
  "novel": { ... },           // 小说管理
  "chapter": { ... },         // 章节管理
  "volume": { ... },          // 卷管理
  "outline": { ... },         // 大纲管理
  "timeline": { ... },        // 时间线管理
  "chat": { ... },            // 聊天
  "aiPanel": { ... },         // AI面板
  "settings_dialog": { ... }, // 设置对话框
  "provider": { ... },        // 服务商管理
  "prompt": { ... },          // 提示词管理
  "dashboard": { ... },       // 仪表盘
  "errors": { ... },          // 错误消息
  "toast": { ... },           // Toast通知
  "relationship": { ... },    // 关系管理
  "entity": { ... }           // 实体通用
}
```

## 🎯 下一步行动建议

1. **立即测试**: 运行 `npm run dev` 测试当前国际化效果
2. **添加语言选择器**: 在设置对话框中集成 `LanguageSelector` 组件
3. **逐步国际化**: 按优先级顺序，逐个组件完成国际化
4. **完善语言文件**: 根据实际使用情况，补充缺失的翻译键
5. **AI Prompt 国际化**: 考虑为 AI prompt 模板添加多语言支持

## 🚀 技术亮点

1. **零侵入式集成**: i18n 初始化在 `index.tsx` 中完成，不影响现有代码
2. **状态持久化**: 语言设置保存在 IndexedDB，刷新后保持
3. **动态日期本地化**: `date.ts` 支持根据语言设置自动切换 locale
4. **类型安全**: 完整的 TypeScript 类型支持
5. **版本迁移**: 自动处理旧版本设置数据结构

## 📝 注意事项

1. **避免硬编码**: 新增组件时，直接使用 `t()` 函数，不要硬编码文本
2. **键名规范**: 使用 `模块.功能` 的命名规范，如 `character.name`
3. **插值支持**: i18next 支持插值语法 `{{count}}`，如 `t("entity.count", { count: 5 })`
4. **复数处理**: i18next 内置复数支持，使用 `_one`, `_other` 后缀
5. **命名空间**: 当前使用默认命名空间，复杂项目可考虑按组件拆分命名空间
