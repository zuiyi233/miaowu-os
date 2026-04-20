# 小说智能体模型配置功能实施计划文档

> 方案：配置驱动型（方案A）+ 预设模板型（方案B）混合模式
> 版本：v1.0
> 编制日期：2026-04-21
> 文档性质：项目实施权威依据，具备中断恢复能力

---

## 目录

1. [项目概述与目标](#一项目概述与目标)
2. [方案A与方案B融合策略](#二方案a与方案b融合策略)
3. [技术实现路径](#三技术实现路径)
4. [用户操作流程设计](#四用户操作流程设计)
5. [实施步骤与时间节点](#五实施步骤与时间节点)
6. [关键功能模块技术参数](#六关键功能模块技术参数)
7. [质量验收标准与测试方法](#七质量验收标准与测试方法)
8. [异常处理机制与应急预案](#八异常处理机制与应急预案)
9. [附录](#九附录)

---

## 一、项目概述与目标

### 1.1 项目背景

当前 miaowu-os 项目的小说创作模块存在以下设置层面的问题：
- 小说设置与主项目AI设置分离，用户需在两个界面配置
- 无模型组合搭配功能，无法配置"生成模型+审核模型"的高低搭配
- 无按智能体/场景的参数配置，temperature、max_tokens仅支持全局设置
- 供应商选择不统一，主项目前端与小说后端各自维护配置

### 1.2 项目目标

1. **统一配置入口**：将小说AI配置整合至主项目设置页面
2. **支持模型搭配**：允许为不同创作环节（生成/审核/润色/大纲）配置不同模型
3. **预设+自定义双模式**：既有一键预设，也支持逐项自定义
4. **向后兼容**：保留现有 novel_migrated API 的兼容性

### 1.3 核心原则

- **渐进式改造**：不破坏现有功能，逐步迁移
- **配置即代码**：所有模型搭配策略可配置、可扩展
- **用户分层**：普通用户用预设，高级用户自定义
- **中断恢复**：任何阶段中断后，可根据本文档精确恢复

---

## 二、方案A与方案B融合策略

### 2.1 融合架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         小说智能体配置中心（混合模式）                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │   预设层 (B)     │    │   配置层 (A)     │    │   运行时路由层   │        │
│  │                 │    │                 │    │                 │        │
│  │ • 质量优先预设   │◄──►│ • writer 配置    │───►│ • 任务类型识别   │        │
│  │ • 速度优先预设   │    │ • critic 配置    │    │ • 模型选择      │        │
│  │ • 均衡模式预设   │    │ • polish 配置    │    │ • 参数注入      │        │
│  │ • 自定义预设     │    │ • outline 配置   │    │ • 降级策略      │        │
│  │                 │    │ • 扩展任务...    │    │                 │        │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────┘        │
│           │                      │                                         │
│           └──────────────────────┘                                         │
│                      │                                                     │
│                      ▼                                                     │
│           ┌─────────────────┐                                              │
│           │   数据持久化层   │                                              │
│           │                 │                                              │
│           │ • 主项目设置DB   │  (novel_agent_configs 表)                   │
│           │ • 用户偏好缓存   │                                              │
│           │ • 预设模板定义   │  (代码内置 + 用户自定义)                      │
│           └─────────────────┘                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 融合逻辑

**核心规则：预设是配置的快捷方式，配置是预设的底层实现。**

```python
# 伪代码：预设应用逻辑
def apply_preset(user_id: str, preset_name: str):
    """应用预设 = 将预设定义的一组配置写入用户配置表"""
    preset = PRESET_DEFINITIONS[preset_name]
    for agent_type, config in preset.agent_configs.items():
        upsert_agent_config(user_id, agent_type, config)

# 伪代码：运行时路由逻辑
def resolve_model_for_task(user_id: str, task_type: str):
    """运行时根据任务类型读取用户配置"""
    config = get_agent_config(user_id, task_type)
    if not config or not config.is_enabled:
        # 降级到默认配置
        return get_default_config(task_type)
    return config
```

### 2.3 预设与配置的关系

| 维度 | 预设（B） | 配置（A） |
|------|----------|----------|
| **存储位置** | 代码内置 + 用户自定义JSON | 数据库表 |
| **修改权限** | 用户可创建/修改自定义预设 | 用户可逐项修改 |
| **生效方式** | 一键应用（批量写入配置） | 实时生效 |
| **优先级** | 应用时覆盖配置 | 运行时直接读取 |
| **适合场景** | 快速切换整体策略 | 精细调优单个环节 |

---

## 三、技术实现路径

### 3.1 数据库层变更

#### 3.1.1 新增表：`novel_agent_configs`

```sql
-- 小说智能体配置表
CREATE TABLE novel_agent_configs (
    id VARCHAR(36) PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id VARCHAR(50) NOT NULL,
    agent_type VARCHAR(50) NOT NULL,  -- writer/critic/polish/outline/summary
    provider_id VARCHAR(50),          -- 关联主项目供应商ID
    model_name VARCHAR(100),
    temperature FLOAT DEFAULT 0.7,
    max_tokens INT DEFAULT 4096,
    system_prompt TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, agent_type)
);

-- 索引
CREATE INDEX idx_novel_agent_user ON novel_agent_configs(user_id);
CREATE INDEX idx_novel_agent_type ON novel_agent_configs(agent_type);
```

#### 3.1.2 扩展表：`settings.preferences`

在现有 `preferences` JSON 字段中新增：

```json
{
  "presets": [...],
  "novel_agent": {
    "active_preset": "balanced",
    "custom_presets": [
      {
        "id": "custom-001",
        "name": "我的专属配置",
        "description": "DeepSeek生成+GPT审核",
        "agent_configs": {
          "writer": {"provider_id": "deepseek", "model_name": "deepseek-chat", "temperature": 0.7},
          "critic": {"provider_id": "openai", "model_name": "gpt-4o", "temperature": 0.3}
        }
      }
    ]
  }
}
```

### 3.2 后端API变更

#### 3.2.1 新增API端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/novel-agent/configs` | GET | 获取当前用户所有智能体配置 |
| `/api/novel-agent/configs` | PUT | 批量更新智能体配置 |
| `/api/novel-agent/configs/{agent_type}` | GET | 获取单个智能体配置 |
| `/api/novel-agent/configs/{agent_type}` | POST | 更新单个智能体配置 |
| `/api/novel-agent/presets` | GET | 获取所有预设（内置+自定义） |
| `/api/novel-agent/presets/{preset_id}/apply` | POST | 应用预设到当前配置 |
| `/api/novel-agent/presets` | POST | 创建自定义预设 |
| `/api/novel-agent/presets/{preset_id}` | DELETE | 删除自定义预设 |

#### 3.2.2 修改现有API

修改 `novel_migrated/api/settings.py`：
- `GET /settings` 响应中增加 `novel_agent_configs` 字段
- `POST /settings` 支持接收并保存 `novel_agent_configs`

修改 `novel_migrated/services/ai_service.py`：
- `generate_text_stream()` 增加 `agent_type` 参数
- 根据 `agent_type` 读取对应配置，动态选择模型和参数

### 3.3 前端变更

#### 3.3.1 新增设置页面

在 `settings-dialog.tsx` 中新增「小说智能体」标签页：

```typescript
type SettingsSection =
  | "appearance"
  | "memory"
  | "tools"
  | "skills"
  | "ai-providers"
  | "notification"
  | "about"
  | "novel-agents";  // 新增
```

#### 3.3.2 新增组件

| 组件 | 路径 | 功能 |
|------|------|------|
| `NovelAgentSettingsPage` | `settings/novel-agent-settings-page.tsx` | 主页面 |
| `AgentConfigCard` | `settings/agent-config-card.tsx` | 单个智能体配置卡片 |
| `PresetSelector` | `settings/preset-selector.tsx` | 预设选择器 |
| `ModelSelector` | `settings/model-selector.tsx` | 模型选择下拉框 |
| `AgentPresetModal` | `settings/agent-preset-modal.tsx` | 自定义预设弹窗 |

#### 3.3.3 状态管理扩展

扩展 `ai-provider-store.ts`：

```typescript
export interface NovelAgentConfig {
  agentType: string;
  providerId: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  isEnabled: boolean;
}

export interface NovelAgentPreset {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  agentConfigs: Record<string, Partial<NovelAgentConfig>>;
}

interface AiSettingsState {
  // ... 现有字段
  novelAgentConfigs: NovelAgentConfig[];
  novelAgentPresets: NovelAgentPreset[];
  activeNovelPreset: string | null;
  updateNovelAgentConfig: (config: NovelAgentConfig) => void;
  applyNovelPreset: (presetId: string) => void;
  saveCustomNovelPreset: (preset: Omit<NovelAgentPreset, 'id'>) => void;
}
```

### 3.4 运行时路由实现

#### 3.4.1 任务类型定义

```python
class NovelAgentType(str, Enum):
    WRITER = "writer"       # 章节生成
    CRITIC = "critic"       # 质量审核
    POLISH = "polish"       # 润色改写
    OUTLINE = "outline"     # 大纲设计
    SUMMARY = "summary"     # 摘要生成
    CONTINUE = "continue"   # 续写
    WORLD_BUILD = "world_build"  # 世界观构建
    CHARACTER = "character" # 角色生成
```

#### 3.4.2 模型解析逻辑

```python
async def resolve_agent_config(
    user_id: str,
    agent_type: NovelAgentType,
    db: AsyncSession,
) -> AgentConfig:
    """运行时解析智能体配置"""
    
    # 1. 查询用户自定义配置
    result = await db.execute(
        select(NovelAgentConfig)
        .where(NovelAgentConfig.user_id == user_id)
        .where(NovelAgentConfig.agent_type == agent_type.value)
    )
    config = result.scalar_one_or_none()
    
    if config and config.is_enabled:
        return config
    
    # 2. 降级到默认配置
    return get_default_config(agent_type)
```

---

## 四、用户操作流程设计

### 4.1 流程一：一键预设配置（普通用户）

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  打开设置    │────►│ 选择「小说  │────►│ 选择预设    │────►│ 点击「应用  │
│  页面       │     │  智能体」   │     │ 卡片        │     │  预设」     │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                                                                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  开始使用    │◄────│  系统提示   │◄────│  配置写入   │◄────│  确认弹窗   │
│  小说创作    │     │  「应用成功」│     │  数据库     │     │  「确定？」  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

**界面元素：**
- 页面顶部：3个预设卡片横向排列（质量优先/速度优先/均衡模式）
- 每个卡片：图标 + 名称 + 简短描述 + 模型搭配预览 + 「应用」按钮
- 底部：「自定义配置」入口链接

### 4.2 流程二：逐项自定义配置（高级用户）

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  打开设置    │────►│ 选择「小说  │────►│ 点击「自定义│────►│ 展开各智能体 │
│  页面       │     │  智能体」   │     │  配置」     │     │  配置卡片   │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                    │
                                                                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  保存成功    │◄────│  点击「保存 │◄────│  调整参数   │◄────│  选择模型   │
│  提示       │     │  配置」     │     │  (温度/Token)│     │  (供应商)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

**界面元素：**
- 左侧/顶部：当前配置的可视化概览（类似「当前搭配」仪表盘）
- 主体：4-6个可折叠配置卡片（生成/审核/润色/大纲/摘要/续写）
- 每个卡片内：
  - 开关：启用/禁用该智能体自定义配置
  - 供应商选择：下拉框（从主项目供应商列表读取）
  - 模型选择：下拉框（根据供应商动态加载）
  - 温度滑块：0.0 - 2.0，步长0.1
  - Max Tokens 输入框：512 - 16000
  - 系统提示词：文本域（可选）
- 底部：「保存配置」按钮 + 「保存为新预设」按钮

### 4.3 流程三：基于预设微调

```
用户选择「质量优先」预设
        │
        ▼
系统自动填充各智能体配置
        │
        ▼
用户修改「审核」环节的模型为更便宜的选项
        │
        ▼
点击「保存为新预设」
        │
        ▼
输入预设名称「我的质量方案（省钱版）」
        │
        ▼
新预设出现在预设列表中
```

### 4.4 界面原型描述

#### 4.4.1 预设模式界面

```
┌─────────────────────────────────────────────────────────────────┐
│  小说智能体配置                                    [自定义配置 ▼] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  选择预设方案（一键应用）                                          │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   🏆        │  │   ⚡        │  │   ⚖️        │             │
│  │  质量优先    │  │  速度优先    │  │  均衡模式    │             │
│  │             │  │             │  │             │             │
│  │ 生成: GPT-4o│  │ 生成: GPT-4o│  │ 生成: GPT-4o│             │
│  │ 审核: DS-R1 │  │ 审核: GPT-4o│  │ 审核: GPT-4o│             │
│  │ 润色: GPT-4o│  │ 润色: GPT-4o│  │ 润色: GPT-4o│             │
│  │             │  │             │  │             │             │
│  │ [应用预设]  │  │ [应用预设]  │  │ [应用预设]  │             │
│  │   (当前使用)│  │             │  │             │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
│  我的自定义预设                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 📝 我的质量方案（省钱版）                    [应用] [删除] │    │
│  │    生成: DeepSeek-V3 | 审核: GPT-4o-mini                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 4.4.2 自定义模式界面

```
┌─────────────────────────────────────────────────────────────────┐
│  小说智能体配置                                    [预设模式 ▼]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  当前搭配概览                                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  生成 📝 GPT-4o (OpenAI)  ──►  审核 🔍 DS-R1 (DeepSeek)  │    │
│  │  润色 ✨ GPT-4o (OpenAI)  ──►  大纲 📋 GPT-4o (OpenAI)   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─ 📝 章节生成 (writer) ─────────────────────────────────┐     │
│  │  [✓] 启用自定义配置                                     │     │
│  │  供应商: [OpenAI    ▼]  模型: [GPT-4o        ▼]        │     │
│  │  温度: [━━━━●━━━━] 0.7    Max Tokens: [4096   ]        │     │
│  │  系统提示词 (可选): [                                  ] │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ 🔍 质量审核 (critic) ────────────────────────────────┐     │
│  │  [✓] 启用自定义配置                                     │     │
│  │  供应商: [DeepSeek  ▼]  模型: [DeepSeek-R1   ▼]        │     │
│  │  温度: [●━━━━━━━━] 0.3    Max Tokens: [8192   ]        │     │
│  │  系统提示词 (可选): [                                  ] │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ ✨ 润色改写 (polish) ────────────────────────────────┐     │
│  │  [✓] 启用自定义配置                                     │     │
│  │  ...                                                   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ 📋 大纲设计 (outline) ───────────────────────────────┐     │
│  │  [ ] 启用自定义配置 (使用默认)                          │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│              [保存配置]  [保存为新预设]  [重置为默认]              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、实施步骤与时间节点

### 5.1 阶段划分

```
Week 1          Week 2          Week 3          Week 4
│               │               │               │
├─ 数据库 ──────┤               │               │
├─ 后端API ─────┼───────────────┤               │
│               ├─ 前端组件 ─────┼───────────────┤
│               │               ├─ 集成测试 ─────┤
│               │               │               ├─ 验收 ───────►
```

### 5.2 详细任务分解

#### 第一阶段：数据库与模型层（Week 1，第1-5天）

| 天数 | 任务 | 责任人 | 交付物 | 验收标准 |
|------|------|--------|--------|----------|
| Day 1 | 设计 `novel_agent_configs` 表结构 | 后端开发 | SQL DDL | 字段完整，索引合理 |
| Day 2 | 实现 SQLAlchemy 模型 `NovelAgentConfig` | 后端开发 | Python Model | 类型正确，关联完整 |
| Day 3 | 实现 Alembic 迁移脚本 | 后端开发 | 迁移文件 | 可升级/降级 |
| Day 4 | 扩展 `Settings.preferences` JSON Schema | 后端开发 | 更新后的Schema | 向后兼容 |
| Day 5 | 数据库层单元测试 | 后端开发 | 测试用例 | 覆盖率>80% |

#### 第二阶段：后端API开发（Week 1-2，第3-10天）

| 天数 | 任务 | 责任人 | 交付物 | 验收标准 |
|------|------|--------|--------|----------|
| Day 3-4 | 实现 `NovelAgentConfigService` CRUD | 后端开发 | Service层代码 | 所有CRUD操作正常 |
| Day 5-6 | 实现预设管理（内置+自定义） | 后端开发 | PresetService | 预设应用/创建/删除正常 |
| Day 7 | 修改 `AIService` 支持 `agent_type` 路由 | 后端开发 | 更新后的AIService | 根据agent_type选择正确模型 |
| Day 8 | 实现API端点（8个端点） | 后端开发 | Router代码 | 接口文档完整 |
| Day 9 | 集成测试（后端） | 后端开发 | 测试用例 | 所有API通过测试 |
| Day 10 | 后端代码审查 | 技术负责人 | Review记录 | 无阻塞性问题 |

#### 第三阶段：前端组件开发（Week 2-3，第8-15天）

| 天数 | 任务 | 责任人 | 交付物 | 验收标准 |
|------|------|--------|--------|----------|
| Day 8-9 | 扩展 `ai-provider-store.ts` 状态管理 | 前端开发 | 更新后的Store | 状态变更正常 |
| Day 10-11 | 实现 `PresetSelector` 组件 | 前端开发 | React组件 | UI符合设计稿 |
| Day 12-13 | 实现 `AgentConfigCard` 组件 | 前端开发 | React组件 | 表单验证完整 |
| Day 14 | 实现 `NovelAgentSettingsPage` 主页面 | 前端开发 | React组件 | 预设/自定义切换正常 |
| Day 15 | 集成到 `SettingsDialog` | 前端开发 | 更新后的Dialog | 标签页切换正常 |

#### 第四阶段：集成与测试（Week 3-4，第15-20天）

| 天数 | 任务 | 责任人 | 交付物 | 验收标准 |
|------|------|--------|--------|----------|
| Day 15-16 | 前后端联调 | 全栈开发 | 联调记录 | 端到端流程通畅 |
| Day 17 | 端到端测试 | QA | 测试报告 | 所有用户流程通过 |
| Day 18 | 性能测试（模型切换延迟） | QA | 性能报告 | 切换延迟<500ms |
| Day 19 | Bug修复与回归测试 | 全栈开发 | 修复记录 | 无P0/P1 Bug |
| Day 20 | 验收与文档更新 | 技术负责人 | 验收报告 | 符合验收标准 |

### 5.3 责任人分配

| 角色 | 职责 | 人员 |
|------|------|------|
| 项目经理 | 进度跟踪、资源协调、风险管控 | （待定） |
| 技术负责人 | 架构设计、代码审查、技术决策 | （待定） |
| 后端开发 | 数据库、API、业务逻辑 | （待定） |
| 前端开发 | UI组件、状态管理、交互逻辑 | （待定） |
| QA测试 | 测试用例、自动化测试、验收 | （待定） |

---

## 六、关键功能模块技术参数

### 6.1 内置预设定义

```python
# 代码内置的预设定义（不可删除，可覆盖）
BUILT_IN_PRESETS = {
    "quality": {
        "name": "质量优先",
        "description": "使用最强模型进行生成和审核，适合对质量要求极高的场景",
        "icon": "🏆",
        "agent_configs": {
            "writer": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.7,
                "max_tokens": 8192,
                "system_prompt": "你是一名专业长篇小说写作助手..."
            },
            "critic": {
                "provider_id": "deepseek",
                "model_name": "deepseek-reasoner",
                "temperature": 0.3,
                "max_tokens": 8192,
                "system_prompt": "你是一名严格的小说编辑..."
            },
            "polish": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.5,
                "max_tokens": 8192
            },
            "outline": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.7,
                "max_tokens": 4096
            }
        }
    },
    "speed": {
        "name": "速度优先",
        "description": "使用轻量模型快速生成，适合初稿和探索性创作",
        "icon": "⚡",
        "agent_configs": {
            "writer": {
                "provider_id": "openai",
                "model_name": "gpt-4o-mini",
                "temperature": 0.8,
                "max_tokens": 4096
            },
            "critic": {
                "provider_id": "openai",
                "model_name": "gpt-4o-mini",
                "temperature": 0.3,
                "max_tokens": 4096
            },
            "polish": {
                "provider_id": "openai",
                "model_name": "gpt-4o-mini",
                "temperature": 0.5,
                "max_tokens": 4096
            },
            "outline": {
                "provider_id": "openai",
                "model_name": "gpt-4o-mini",
                "temperature": 0.7,
                "max_tokens": 4096
            }
        }
    },
    "balanced": {
        "name": "均衡模式",
        "description": "在质量和速度之间取得平衡，适合日常创作",
        "icon": "⚖️",
        "agent_configs": {
            "writer": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.7,
                "max_tokens": 4096
            },
            "critic": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.3,
                "max_tokens": 4096
            },
            "polish": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.5,
                "max_tokens": 4096
            },
            "outline": {
                "provider_id": "openai",
                "model_name": "gpt-4o",
                "temperature": 0.7,
                "max_tokens": 4096
            }
        }
    }
}
```

### 6.2 参数约束

| 参数 | 类型 | 范围 | 默认值 | 说明 |
|------|------|------|--------|------|
| `temperature` | Float | 0.0 - 2.0 | 0.7 | 生成随机性，审核建议0.3 |
| `max_tokens` | Integer | 512 - 16000 | 4096 | 单次最大输出 |
| `provider_id` | String | 主项目供应商列表 | — | 必须从已配置供应商中选择 |
| `model_name` | String | 供应商支持的模型 | — | 动态加载 |
| `system_prompt` | String | 最大2000字符 | None | 可选的系统提示词 |
| `is_enabled` | Boolean | True/False | True | 是否启用自定义配置 |

### 6.3 降级策略

```python
# 运行时降级链
async def resolve_with_fallback(user_id, agent_type):
    # 1. 查询用户自定义配置
    config = await get_user_config(user_id, agent_type)
    if config and config.is_enabled:
        return config
    
    # 2. 查询用户默认模型配置
    default_config = await get_user_default_config(user_id)
    if default_config:
        return default_config
    
    # 3. 查询系统默认配置
    system_default = get_system_default(agent_type)
    return system_default
```

---

## 七、质量验收标准与测试方法

### 7.1 功能验收标准

| 编号 | 验收项 | 验收标准 | 测试方法 |
|------|--------|----------|----------|
| F-01 | 预设列表展示 | 页面加载时正确显示3个内置预设 | 手动测试 |
| F-02 | 预设应用 | 点击「应用」后，配置正确写入数据库 | API测试+数据库验证 |
| F-03 | 自定义配置保存 | 修改参数后点击保存，数据正确持久化 | API测试+数据库验证 |
| F-04 | 模型选择联动 | 切换供应商后，模型列表正确更新 | 前端自动化测试 |
| F-05 | 运行时路由 | 根据agent_type选择正确模型 | 集成测试 |
| F-06 | 自定义预设 | 用户可创建、应用、删除自定义预设 | 端到端测试 |
| F-07 | 向后兼容 | 现有小说API在无配置时正常工作 | 回归测试 |
| F-08 | 设置整合 | 小说智能体设置出现在主设置页面 | UI测试 |

### 7.2 性能验收标准

| 编号 | 验收项 | 标准 | 测试方法 |
|------|--------|------|----------|
| P-01 | 预设应用延迟 | < 500ms | 性能测试 |
| P-02 | 配置读取延迟 | < 100ms | 性能测试 |
| P-03 | 页面加载时间 | < 2s | Lighthouse |
| P-04 | 并发配置更新 | 支持10并发 | 压力测试 |

### 7.3 兼容性验收标准

| 编号 | 验收项 | 标准 | 测试方法 |
|------|--------|------|----------|
| C-01 | 现有API兼容 | 所有现有端点返回格式不变 | 回归测试 |
| C-02 | 数据库兼容 | 迁移脚本可回滚 | 迁移测试 |
| C-03 | 浏览器兼容 | Chrome/Firefox/Edge最新版 | 跨浏览器测试 |

### 7.4 测试用例模板

```python
# 示例：预设应用测试用例
def test_apply_preset():
    """测试应用预设功能"""
    # 前置条件
    user = create_test_user()
    
    # 操作
    response = client.post("/api/novel-agent/presets/quality/apply")
    
    # 断言
    assert response.status_code == 200
    
    # 验证数据库
    configs = db.query(NovelAgentConfig).filter_by(user_id=user.id).all()
    assert len(configs) == 4  # writer/critic/polish/outline
    
    writer_config = next(c for c in configs if c.agent_type == "writer")
    assert writer_config.model_name == "gpt-4o"
    assert writer_config.temperature == 0.7
```

---

## 八、异常处理机制与应急预案

### 8.1 异常分类与处理

| 异常类型 | 场景 | 处理策略 | 用户提示 |
|----------|------|----------|----------|
| **模型不可用** | 用户配置的模型在供应商端下架 | 降级到同供应商默认模型 | 「当前模型不可用，已自动切换至默认模型」 |
| **供应商失效** | API Key过期或额度耗尽 | 降级到系统默认供应商 | 「当前供应商连接失败，已切换至备用供应商」 |
| **配置损坏** | preferences JSON解析失败 | 重置为默认配置 | 「配置数据异常，已恢复默认设置」 |
| **并发冲突** | 多设备同时修改配置 | 乐观锁，后提交者覆盖 | 无提示（静默处理） |
| **网络中断** | 保存配置时网络断开 | 本地缓存，恢复后自动重试 | 「配置将在网络恢复后自动保存」 |

### 8.2 应急预案

#### 预案一：数据库迁移失败

**触发条件**：Alembic 迁移脚本执行失败

**应急步骤**：
1. 立即回滚迁移：`alembic downgrade -1`
2. 检查失败原因（字段冲突/数据类型不兼容）
3. 修复迁移脚本
4. 在测试环境重新验证
5. 生产环境重新执行

#### 预案二：API兼容性问题

**触发条件**：新API导致现有小说功能异常

**应急步骤**：
1. 立即启用功能开关（如有），关闭新设置功能
2. 回滚后端代码到上一版本
3. 检查日志定位问题
4. 修复后重新部署

#### 预案三：前端页面崩溃

**触发条件**：设置页面加载白屏或报错

**应急步骤**：
1. 用户可刷新页面重试
2. 如持续失败，前端自动降级到「基础设置模式」（仅显示默认配置）
3. 收集错误日志上报
4. 热修复发布后自动恢复

### 8.3 功能开关

```python
# 新增功能开关，支持紧急关闭
NOVEL_AGENT_SETTINGS_ENABLED = os.getenv("NOVEL_AGENT_SETTINGS_ENABLED", "true").lower() == "true"

# 在API层检查
@router.get("/api/novel-agent/configs")
async def get_configs(...):
    if not NOVEL_AGENT_SETTINGS_ENABLED:
        return {"enabled": False, "message": "功能维护中"}
    # ...
```

### 8.4 数据备份策略

| 备份对象 | 频率 | 保留周期 | 恢复方式 |
|----------|------|----------|----------|
| novel_agent_configs 表 | 每日 | 30天 | SQL导入 |
| settings.preferences | 每日 | 30天 | JSON恢复 |
| 自定义预设 | 实时 | 永久 | 从用户数据恢复 |

---

## 九、附录

### 9.1 术语表

| 术语 | 定义 |
|------|------|
| **智能体（Agent）** | 执行特定小说创作任务的AI实体，如writer、critic等 |
| **预设（Preset）** | 预定义的模型搭配方案，一键应用 |
| **供应商（Provider）** | AI模型服务提供商，如OpenAI、DeepSeek等 |
| **任务类型（Task Type）** | 小说创作的具体环节，如生成、审核、润色等 |
| **降级（Fallback）** | 当首选配置不可用时，自动使用备用配置 |

### 9.2 参考文档

- [Novel_Creation_Process_Assessment_Report.md](file:///d:/miaowu-os/Novel_Creation_Process_Assessment_Report.md) — 小说创作流程评估报告
- [Novel_Discussion_Summary.md](file:///d:/miaowu-os/Novel_Discussion_Summary.md) — 讨论问题汇总
- deerflow Subagent 文档：`backend/packages/harness/deerflow/subagents/`
- 现有设置API：`backend/app/gateway/novel_migrated/api/settings.py`

### 9.3 变更日志

| 版本 | 日期 | 变更内容 | 作者 |
|------|------|----------|------|
| v1.0 | 2026-04-21 | 初始版本 | AI Assistant |

### 9.4 中断恢复指南

**如项目在中断后恢复，按以下步骤继续：**

1. **确认当前进度**：检查 Git 提交记录，确认最后完成的提交
2. **对照实施计划**：找到对应阶段和任务，从下一个任务开始
3. **环境检查**：确认数据库迁移状态、API端点可用性、前端构建状态
4. **回归测试**：运行相关测试用例，确认中断前功能正常
5. **继续开发**：按实施计划继续后续任务

---

> **文档结束**
> 
> 本文档为 miaowu-os 项目小说智能体模型配置功能的权威实施依据。任何变更需经过技术负责人审批，并更新本文档。
