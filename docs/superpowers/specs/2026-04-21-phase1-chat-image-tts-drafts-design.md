# Phase 1: 主聊天多模态草稿（Image + TTS）方案讨论稿

日期：2026-04-21  
范围：仅第一阶段（Phase 1），不参考 `Miaowu_OS_Next_Phase_Strategy_Report_2026.md` 的任何结论/结构。

## 0. 一句话结论

**可行**。当前代码库已经具备 deer-flow 的“统一 agent/runtime + model config + 工具调用 + artifacts 展示”底座；miaowu-os 现阶段更像“小说业务桥接层”。Phase 1 只需要在 **lead_agent 工具层** 增加“图片草稿生成 + TTS 草稿生成 + 草稿确认挂载”的业务工具/接口，并提供前端“草稿卡片 + 过期策略设置 + 确认挂载”即可。

## 1. 目标与非目标

### 1.1 Phase 1 目标

1. **主聊天自由生成（方案 B 入口形态）**  
   用户在主聊天直接说：  
   “给这个角色生成立绘并试听一句台词”，系统能够在一次交互中产出：  
   - `image draft`（立绘草稿）  
   - `tts draft`（台词试听草稿）

2. **产物先作为聊天草稿**  
   生成结果默认不立即写入项目资产。用户需要在前端点击 **确认** 才会挂载到：`项目 / 角色 / 场景`（若缺少上下文，则先补齐再生成或确认）。

3. **OpenAI-compatible 中转（NEWAPI）**  
   所有生成调用走现有 OpenAI-compatible relay，不采用外部“他们提供的方案”。

4. **草稿自动过期清理 + 前端可配置**  
   前端提供保留时间：`24 小时 / 7 天 / 永不过期`，默认 `7 天`。  
   过期后草稿应不可访问且被清理（元数据 + 文件）。

### 1.2 非目标（Phase 1 不做）

- 视频生成、多模态平台化、完整资产管理后台、复杂版权水印流程
- 对“所有历史 artifacts/文件”做通用过期治理（仅治理新引入的“草稿媒体”）
- Midjourney 之类非标准 API 依赖（Phase 1 不应建立在其可用性之上）

## 2. 仓库事实核验（交叉验证）

### 2.1 deer-flow 底座能力已经存在

1. **主聊天是 deer-flow 的 lead_agent / runtime / tool calling 能力层**  
   - lead_agent 入口：`deer-flow-main/backend/packages/harness/deerflow/agents/lead_agent/agent.py`
   - 工具加载与注册：`deer-flow-main/backend/packages/harness/deerflow/tools/tools.py`

2. **可向用户展示文件（artifacts）**  
   - 工具：`present_files`（将 `/mnt/user-data/outputs/*` 加入 thread.values.artifacts）  
     `deer-flow-main/backend/packages/harness/deerflow/tools/builtins/present_file_tool.py`
   - 文件读取接口：`GET /api/threads/{thread_id}/artifacts/{path}`  
     `deer-flow-main/backend/app/gateway/routers/artifacts.py`
   - 前端 artifacts 面板：  
     `deer-flow-main/frontend/src/components/workspace/artifacts/*`  
     `deer-flow-main/frontend/src/components/workspace/chats/chat-box.tsx`

### 2.2 miaowu-os 的“业务桥接层”与配置基础已经存在

1. **OpenAI-compatible relay（NEWAPI）已落在配置层**  
   - deer-flow 模型配置中心：`deer-flow-main/config.yaml`（`base_url` 指向 relay）  
   注意：文档不得写入真实 `api_key` 值，只引用环境变量名（`OPENAI_API_KEY`）。

2. **小说模块设置已有 preferences 可扩展字段**  
   - Settings.preferences：`deer-flow-main/backend/app/gateway/novel_migrated/models/settings.py`  
   - preferences 读写工具：`deer-flow-main/backend/app/gateway/novel_migrated/api/settings.py`（`_load_preferences/_save_preferences`）

3. **角色已有可挂载的 image 字段**  
   - `Character.avatar_url`：`deer-flow-main/backend/app/gateway/novel_migrated/models/character.py`

### 2.3 “同时做 Image + TTS”需要新增能力点

当前仓库存在 **image_search**（检索参考图）但没有 **image generation / TTS generation** 的通用工具：  
需要新增工具或服务调用（建议作为 deer-flow tools 的新 built-in 工具）。

### 2.4 中转站契约假设（Phase 1）

你方中转站（NEWAPI）负责把“任意内部模型标识”转换为标准 OpenAI API 语义，本项目在 Phase 1 只做以下约束：

- **只调用标准 OpenAI 路径与 payload 形状**：Image 用 `POST /v1/images/generations`；TTS 用 `POST /v1/audio/speech`。
- **model / voice 等参数按“透传字符串”处理**：本项目不内置模型列表、不做可用性探测，也不对具体模型做分支适配；中转站保证这些字符串最终能映射到可用通道。
- 本项目只负责：请求组装、错误回传（含 request_id）、草稿存储、过期清理、确认挂载。

## 3. 用户体验与流程（Phase 1）

### 3.1 入口与上下文策略

- 用户在主聊天自由表达需求（无专门入口按钮）。  
- 若用户语句依赖“这个角色/当前场景”但系统无法解析到足够信息：  
  先澄清（ask_clarification），不直接生成。

> 说明：这里的“上下文”可以来自两处：  
> 1) 当前 thread 的对话内容（用户已描述角色设定），或  
> 2) 显式的项目/角色/场景 ID（来自业务工作区上下文或用户选择）。

### 3.2 草稿生成 → 确认挂载（关键）

1. 用户发起请求：生成立绘 + 台词试听  
2. Agent（lead_agent）决定调用：  
   - `generate_image_draft(...)`  
   - `generate_tts_draft(...)`  
3. 后端返回草稿对象（draft），前端在消息流中渲染“草稿卡片”：  
   - 预览图  
   - 音频播放器（或下载链接）  
   - “确认挂载”按钮  
   - “丢弃”按钮  
   - “过期时间/保留策略”提示
4. 用户点确认：选择挂载目标（若未明确） → 后端挂载 → UI 提示成功并把草稿状态改为 attached

## 4. 方案对比（2-3 个可行路径）

### 方案 A（推荐）：lead_agent 工具调用 + Draft Media 服务（带过期与确认挂载）

**核心思想**：把“图片/TTS生成”作为 deer-flow 工具，保持 deer-flow 的运行时与 tool calling 机制不变；新增一层“草稿媒体服务”负责存储、过期、挂载。

优点：
- 贴合 deer-flow 的能力层设计：模型负责“决定做什么”，工具负责“真的做出来”
- 支持“主聊天自由生成”最自然（LLM + tools）
- 过期与确认挂载属于业务层，可独立演进

缺点：
- 需要新增：草稿元数据结构 + 前端草稿卡片 + 后端挂载接口

### 方案 B：在 `/api/ai/chat` 的 IntentRecognitionMiddleware 内编排多模态

优点：
- 对小说模块内部对话（非 lead_agent）可能复用更直接

缺点：
- 主聊天（lead_agent thread runtime）不走 `/api/ai/chat`，覆盖不完整
- 逻辑容易变成“硬编码意图路由”，不利于自由表达与扩展

### 方案 C：仅用 artifacts（present_files）作为草稿展示，过期时删除文件

优点：
- 最快接入：生成文件丢到 thread outputs + present_files

缺点（关键）：
- `thread.values.artifacts` 是“只增不减”的 reducer 语义，过期删除后 UI 仍会显示旧条目（点击 404）
- 不适合做“可管理的草稿生命周期”

**结论**：Phase 1 推荐走 **方案 A**。

## 5. 推荐设计（方案 A 细化）

### 5.1 草稿数据结构（DraftMedia）

建议最小字段集（无论 DB 还是文件索引都能表达）：

- `id`: string（draft_id）
- `kind`: `"image" | "audio"`
- `status`: `"draft" | "attached" | "discarded" | "expired"`
- `created_at`: ISO string
- `expires_at`: ISO string | null（null 表示永不过期）
- `source`:
  - `thread_id`: string
  - `message_id`: string | null
  - `tool_call_id`: string | null
- `generation`:
  - `prompt`: string（image prompt 或 tts text）
  - `model`: string
  - `provider`: string（可选，便于诊断）
- `file`:
  - `mime_type`: string
  - `size_bytes`: number
  - `sha256`: string（可选）
  - `storage_path`: string（服务端真实路径）
  - `public_url`: string（前端预览/下载用）
- `attach_target`（确认挂载时填写）：
  - `type`: `"project" | "character" | "scene"`
  - `id`: string

### 5.2 草稿存储：两种实现选项

1. **文件索引（Phase 1 更轻）**  
   - 文件：`backend/.deer-flow/drafts/<draft_id>.<ext>`  
   - 元数据：`backend/.deer-flow/drafts/<draft_id>.json`  
   - 优点：无 DB migration，落地快；清理只需扫目录  
   - 缺点：多实例/并发下需要额外锁与一致性策略

2. **DB 表（更规范）**  
   - 表：`draft_media` 或统一为 `media_assets`（带 status/expires_at）  
   - 优点：可查询、可审计、易扩展、并发一致性更强  
   - 缺点：需要 migration 与更多接口维护

建议：Phase 1 先用 **文件索引**，Phase 2 再视情况上 DB 表（或直接一开始上 DB，取决于你们对迭代速度的偏好）。

### 5.3 后端接口（最小集合）

以“文件索引实现”为例，仍建议提供清晰 API（方便前端与工具复用）：

1. `POST /api/media/drafts/image`  
   入参：`prompt, model, expires_in_seconds, context(optional)`  
   出参：DraftMedia（kind=image）

2. `POST /api/media/drafts/tts`  
   入参：`text, voice(optional), model, format(optional), expires_in_seconds, context(optional)`  
   出参：DraftMedia（kind=audio）

3. `POST /api/media/drafts/{draft_id}/attach`  
   入参：`target_type, target_id`  
   行为：复制/移动到最终存储 + 更新角色/avatar 或写入项目资产表（若存在）  
   出参：挂载后的资产信息（或更新后的 entity）

4. `DELETE /api/media/drafts/{draft_id}`  
   行为：删除草稿文件与元数据

5. `GET /api/media/drafts/{draft_id}/content`  
   行为：返回文件 bytes；若已过期，返回 410 或 404

### 5.4 deer-flow 工具层（lead_agent）

新增 built-in tools（示例命名）：

- `generate_image_draft(prompt, model?, expires_in?, context?) -> DraftMedia`
- `generate_tts_draft(text, voice?, model?, format?, expires_in?, context?) -> DraftMedia`

工具实现要点：
- 直接读取 deer-flow model config 中的 `base_url/api_key`（避免维护第二套配置）  
- 通过 httpx 调用 OpenAI-compatible relay 的图片与语音接口（标准 `POST /v1/images/generations` + `POST /v1/audio/speech`）  
- 把 DraftMedia 写入 thread.values（例如 `draft_media` 字段），以便前端渲染草稿卡片

#### 5.4.1 模型/音色参数透传（不关心具体模型）

- `model` / `voice` / `format` 等字段均作为字符串透传给 NEWAPI，不在项目内做白名单或能力判断。
- 默认值来源（Phase 1）：环境变量 `DEERFLOW_MEDIA_IMAGE_MODEL` / `DEERFLOW_MEDIA_TTS_MODEL` / `DEERFLOW_MEDIA_TTS_VOICE`（可选）。
- 前端请求若显式传入 `model/voice/format`，则覆盖环境变量默认值。
- 若项目侧未给出默认值：后端要么不发送该字段，要么发送空字符串，具体按 NEWAPI 约定选择一种固定策略（并保持一致）。

### 5.5 前端 UI

1. **草稿卡片（Chat 内联渲染）**  
   - 基于 `thread.values.draft_media`（新增字段）渲染，不复用 artifacts 列表（避免“只增不减”问题）
   - 支持：预览、确认挂载、丢弃、显示过期信息

2. **保留策略设置**  
   - 在工作区 SettingsDialog 增加一个设置项：`草稿保留时间`（24h/7d/never，默认 7d）  
   - 前端将该值在调用生成工具/接口时传给后端（作为 `expires_in_seconds`）  
   - 可选：同时写入 `Settings.preferences` 做服务端默认值（便于多端一致）

## 6. 自动过期清理（满足“自动”与“可验证”）

建议双保险（避免仅靠后台定时器）：

1. **访问时强校验**：任何 `GET content / attach / list` 都先判断 `expires_at`  
   - 已过期：立刻标记 expired 并删除文件（幂等），返回 410/404

2. **惰性清理**：在 `POST generate` 时触发一次 `cleanup_expired()`（带节流）  
   - 保证系统即便无 cron 也会持续清理

可选增强：
- 服务启动后每 N 分钟跑一次（单实例即可；多实例需 leader 选举或允许重复删除的幂等实现）

## 7. 风险与验证清单（Phase 1 交付前必须做）

1. **NEWAPI relay 真实支持 image + tts**  
   - 最小集成验证：  
     - `POST /v1/images/generations`  
     - `POST /v1/audio/speech`（或兼容路径）  
   - 若某一路不支持：必须在 Phase 1 设计里明确 fallback（例如换到另一条可用的 OpenAI-compatible endpoint / provider）

2. **工具调用稳定性**  
   - 对不支持 tool calling 的模型：需要 graceful fallback（例如让模型输出“我需要你点击生成按钮/或改用支持工具调用的模型”）

3. **清理幂等**  
   - 同一个 draft 多次删除/过期处理不会报错或产生脏状态

4. **安全**  
   - 不允许通过 draft_id/path 做路径穿越  
   - content 接口不返回可执行内容（图片/音频 OK，HTML/SVG 需按 artifacts 的策略强制下载）

## 8. Phase 1 产出定义（可验收）

1. 主聊天输入一句自然语言，可生成 image+tts 两个草稿并可预览  
2. 草稿有“确认挂载/丢弃”  
3. 前端可配置保留时间（24h/7d/never），默认 7d  
4. 过期后不可访问且会被清理（可通过接口/文件系统观察到）  
