# Miaowu-OS 小说 SaaS 改造剩余任务清单

更新时间：2026-05-23

本文档只记录当前尚未完成的工作，用于后续继续推进“统一 Miaowu-OS 主项目与小说二开数据源：后端全包 SaaS 改造”。

当前已完成的第一阶段基础改造包括：

- 已存在本地 baseline commit：`8444e2a chore: establish local baseline`
- `novel_migrated` 数据库入口已改接主项目 `deerflow.persistence.engine` / `deerflow.persistence.base.Base`
- 小说 API 缺少认证用户时改为 401
- 小说自建 `users` / `user_passwords` 不再作为 ORM schema 真源注册
- legacy novel admin router 已阻断
- 章节、人物、大纲的主要按 ID 访问路径已增加 owner-scoped 查询
- 2026-05-23 继续补齐：项目、职业、伏笔、关系创建、MCP 插件、写作风格、组织/成员、记忆清理、卷管理、小说流式生成章节入口、批量生成任务状态、重写任务状态的 owner-scoped 查询
- 已补齐 `Organization` ORM 与组织 API 已使用字段的一致性，避免组织生成/更新因 `name/project_id/organization_type/purpose/hierarchy` 字段不匹配失败
- 已新增 SeaweedFS / S3-compatible 对象存储配置基础和 `media_assets` 元数据模型
- 已新增 `media_assets` 上传/元数据/下载/删除 API；上传走后端对象存储服务，响应不暴露裸 object key
- 已通过定向测试：`62 passed`

以下是仍需完成的全部任务。

---

## P0：补齐全量账户级隔离

目标：任何小说资源都必须通过当前主项目登录用户隔离。不能只按资源 ID 查询；必须通过 `project.user_id == current_user_id` 或资源自身 `user_id == current_user_id` 过滤。

### P0.1 全量扫描直接按资源 ID 查询

需要继续处理这些模式：

```bash
rg "select\\(Chapter\\)|select\\(Character\\)|select\\(Outline\\)|select\\(Career\\)|select\\(Foreshadow\\)|select\\(Relationship\\)|\\.where\\(.*\\.id ==" deer-flow-main/backend/app/gateway/novel_migrated/api -n
```

已部分处理：

- `chapters.py`
- `characters.py`
- `outlines.py`
- `projects.py`
- `careers.py`（职业详情/更新/删除、角色职业关联主要路径）
- `foreshadows.py`（按伏笔 ID 的详情/更新/删除/状态修改入口）
- `relationships.py`（创建关系时校验双方角色归属）
- `mcp_plugins.py`
- `writing_styles.py`
- `organizations.py`（组织详情/更新/成员增改删入口）
- `memories.py`（章节重分析清理按 project_id + chapter_id 过滤）
- `volumes.py`（卷文件真值入口按当前用户项目集合查找）
- `novel_stream.py`（章节流式入口、写作风格、大纲关联、批量任务状态热路径）
- `prompt_templates.py`（已核对模板读写按 user_id 过滤）
- `prompt_workshop.py`（公开条目入口按 active 状态过滤；用户提交按 submitter_id 过滤；管理入口走 admin 检查）

仍需重点处理：

- `deer-flow-main/backend/app/gateway/novel_migrated/api/book_import.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/api/import_export.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/api/project_covers.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/api/workspace_documents.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/api/wizard_stream.py`

2026-05-23 追加处理：

- `services/import_export_service.py` 的导出服务层已从 `project_id` 单条件查询改为 `project_id + user_id` 查询，避免绕过路由前置校验时跨用户导出。
- `services/book_import_service.py` 的内存任务跨用户查询从 403 收敛为 404，避免 task ID 枚举泄露存在性。
- `api/project_covers.py` / `api/media_assets.py` / `api/import_export.py` 的下载响应已统一使用安全 `Content-Disposition` 构造，避免用户可控标题 CRLF / 引号注入。

验收标准：

- 用户 A 创建的资源，用户 B 用直接 ID 访问返回 404 或 403，推荐 404。
- 子资源不能先查出对象再泄露存在性；推荐通过 join `Project` 或先验证项目 ownership。
- 新增测试覆盖至少：career、foreshadow、relationship、generation task、prompt workshop item、media asset。

### P0.2 任务类资源隔离

必须覆盖：

- `BatchGenerationTask`（状态查询入口已按 `task_id + user_id` 收敛）
- `RegenerationTask`（状态查询入口已按 `task_id + user_id` 收敛）
- `AnalysisTask`
- book import task
- consistency / generation history
- document indexing tasks

要求：

- task 查询必须带 `user_id == current_user_id` 或通过 `project_id -> Project.user_id` 校验。
- 不能只按 `task_id` 查询。
- 任务恢复、轮询、取消、重试接口都必须隔离。

验收标准：

- 用户 B 不能查看用户 A 的生成任务状态。
- 用户 B 不能取消、重试、恢复用户 A 的任务。
- 用户 B 猜测 task ID 时返回 404 或 403。

### P0.3 内部工具调用显式用户上下文

当前 `packages/harness/deerflow/tools/builtins/novel_internal.py` 已不再回退默认用户，并会读取主项目 runtime user context。

仍需继续处理直接调用点：

```bash
rg "resolve_user_id\\(None\\)" deer-flow-main/backend/packages/harness/deerflow/tools/builtins -n
```

涉及文件：

- `novel_creation_tools.py`
- `novel_analysis_tools.py`
- `novel_extended_tools.py`
- `novel_file_truth_bridge.py`

2026-05-23 追加处理：以上文件已不再直接散落调用 `resolve_user_id(None)`；统一改为 `novel_internal.get_authenticated_user_id()`，该 helper 仍只从主项目 runtime user context / 已注册 backend 解析用户，缺用户时失败，不回退默认用户。

要求：

- 能从主项目 runtime context 读取用户时，正常写入该用户数据。
- 无用户上下文时不能写数据库，必须明确失败或走需要认证的 HTTP 路径。
- 不允许重新引入 `local_single_user`。

验收标准：

- 无认证上下文调用内部 novel 写入工具时失败。
- 有认证上下文调用内部 novel 写入工具时，所有数据落到当前用户。
- 测试覆盖至少一个创建工具、一个分析工具、一个扩展工具。

---

## P0：PostgreSQL 真实主库验证

目标：生产目标是 PostgreSQL。SQLite 只作为本地开发/单机验证模式。

### P0.4 PostgreSQL 启动验证

要求：

- 使用 `database.backend=postgres` 启动后端。
- 确认主项目用户表、线程表、运行记录表、小说表、媒体资产表都进入同一个 PostgreSQL。
- 确认不会创建或写入新的 `backend/.deer-flow/novel_migrated.db` 作为小说数据真源。

验收标准：

- 创建用户、登录、创建小说项目、创建章节、创建人物成功。
- PostgreSQL 中能看到同一库内的主项目表和小说表。
- `novel_migrated.db` 不再作为新数据写入真源。
- 记录实际连接串来源、启动命令和验证 SQL。

2026-05-23 31 测试栈真实 smoke：

- 31 测试栈 `/opt/stacks/miaowu-os-test-20260522` 已新增 PostgreSQL 容器 `miaowu-os-test-postgres-20260523`，数据库 `miaowu_os_test`；密码仅保存在远端 secret 文件，未写入文档。
- 后端镜像 `miaowu-os-gateway:test-20260523-saas-smoke` 使用 `database.backend=postgres`、`postgres_url=$DATABASE_URL` 启动，日志显示 `Persistence engine initialized: backend=postgres`。
- `smoke_novel_postgres_unified.py` 在 31 gateway 容器内通过：`users / runs / projects / chapters / characters / media_assets` 共用同一 PostgreSQL，并验证 owner 查询隔离。
- PostgreSQL 实际表确认存在：`chapters`、`characters`、`media_assets`、`projects`、`runs`、`users`。
- gateway 容器内 `/app/backend/.deer-flow/novel_migrated.db` 为 `not_present`。

### P0.5 PostgreSQL 跨用户隔离验证

必须验证：

- 用户 A 创建项目、章节、人物、任务、媒体资产。
- 用户 B 访问用户 A 的 project ID 返回 404 或 403。
- 用户 B 访问用户 A 的 chapter / character / task / media asset ID 返回 404 或 403。
- 用户 A 可以正常访问自己的资源。
- 未登录访问小说 API 返回 401。

验收标准：

- 至少有一组自动化测试或可重复 smoke script。
- 验证结果写入任务文档或测试说明。

---

## P0：对象存储服务层

目标：大文件不进数据库，进入 SeaweedFS / S3-compatible 对象存储；数据库只保存 metadata 和 object key。

当前只完成：

- `core/object_storage.py`
- `models/media_asset.py`
- `services/object_storage_service.py`
- `api/media_assets.py`

尚未完成：

### P0.6 S3-compatible 客户端封装

建议文件：

- `deer-flow-main/backend/app/gateway/novel_migrated/services/object_storage_service.py`
- `deer-flow-main/backend/app/gateway/novel_migrated/core/object_storage.py`

要求：

- 使用通用 S3-compatible 语义。
- 默认 endpoint：`http://172.22.22.170:18334`
- 默认 provider：`s3`
- 默认 bucket：`miaowu-novel-assets`
- 不出现 MinIO 默认配置。
- 支持 path-style 访问 SeaweedFS S3-compatible。
- access key / secret key 从环境变量读取，不写入代码。

验收标准：

- [代码已完成，真实服务未验] 可以上传一个测试对象到 SeaweedFS。
- [代码已完成，真实服务未验] 可以读取对象 metadata。
- [代码已完成，真实服务未验] 可以删除或标记删除对象。
- 日志不输出 secret key。

### P0.7 媒体资产 API

建议文件：

- `deer-flow-main/backend/app/gateway/novel_migrated/api/media_assets.py`
- `deer-flow-main/backend/app/gateway/routers/novel_migrated.py`

接口建议：

- `POST /media-assets/upload`
- `GET /media-assets/{asset_id}`
- `GET /media-assets/{asset_id}/download`
- `DELETE /media-assets/{asset_id}`

要求：

- 上传必须写对象存储。
- PostgreSQL 只保存 metadata 和 object key。
- 下载必须经过后端权限校验。
- 不把裸 object key 直接暴露给前端作为可猜测访问地址。
- 删除项目时相关资产按策略删除或标记删除。

验收标准：

- [自动化已覆盖元数据权限] 用户 A 上传文件，用户 B 不能下载。
- [自动化已覆盖 metadata 写入] 数据库只保存 metadata，不保存大文件内容。
- [真实服务未验] SeaweedFS 中实际出现对象。
- [代码已完成，真实服务未验] 删除或标记删除后，下载不可用。
- [自动化已覆盖补偿] 上传对象成功但 DB 提交失败时会尝试删除刚上传的对象，降低孤儿对象风险。
- [自动化已覆盖项目删除] 删除项目时会对当前用户该项目的 active `media_assets` 尝试删除对象并标记 `deleted`；对象存储删除失败时标记 `delete_failed` 以便后续清理。

### P0.8 封面、导入原文、导出包接入对象存储

必须逐步接入：

- 封面图（2026-05-23 已接入：新生成封面写入 SeaweedFS/S3-compatible 对象存储并创建 `media_assets` 元数据，项目只保存后端下载入口；旧本地封面路径仅保留只读下载兼容，不作为新写入路径；DB 提交失败时会补偿删除已上传对象）
- 导入原文（2026-05-23 已接入：拆书 TXT 上传后先写 `media_assets` / SeaweedFS S3-compatible，再创建内存解析任务；task 记录保留 `source_asset_id`，浏览器不拿裸 object key）
- 附件
- 媒体草稿
- 导出包（2026-05-23 已接入：项目导出 ZIP 写对象存储并创建 `project_export` 资产；兼容旧接口继续返回 ZIP，同时响应头给出后端授权下载入口）
- 项目导入包（2026-05-23 已接入：项目 ZIP 导入源写对象存储并创建 `project_import_source` 资产，导入成功后回填 project_id；DB 提交失败时补偿删除对象）
- 图片素材
- 生成结果文件

验收标准：

- 这些文件不再进入数据库正文。
- 文件访问统一经过 `media_assets` / `storage_objects` 权限模型。
- 前端拿到的是后端授权下载入口，不是可猜测 object key。

---

## P1：后端真源与前端收敛

目标：浏览器只作为 UI 和短期缓存，后端数据库和对象存储是小说数据真源。

### P1.1 小说项目和详情后端真源

范围：

- `deer-flow-main/frontend`
- 小说 project store
- 项目列表页
- 项目详情页

要求：

- 小说项目列表从后端读取。
- 小说详情从后端读取。
- 保存后以后端返回数据为准。
- 本地 Dexie / IndexedDB 只能作为缓存或草稿。

验收标准：

- 清空浏览器 localStorage / IndexedDB 后重新登录，项目列表仍存在。
- 浏览器 1 创建小说后，浏览器 2 同账号登录可见。

### P1.2 章节、人物、世界观、设定后端真源

范围：

- 章节编辑
- 人物管理
- 世界观 / 大纲 / 关系 / 职业
- 生成任务状态

要求：

- 页面初始化从后端 API 读。
- 保存写后端。
- 保存成功后以前端收到的后端返回值刷新状态。
- 本地缓存损坏不能影响后端读取。

验收标准：

- 清空浏览器缓存后，章节和人物仍能恢复。
- 跨设备同账号可见同一套章节和人物。

### P1.3 API Key 和 AI Provider 设置后端保存

范围：

- 前端 AI provider 设置页
- `Settings`
- `preferences`
- `ai_provider_settings`
- `api_key_encrypted`
- `safe_encrypt` / `safe_decrypt`

要求：

- API Key 和模型配置保存到后端数据库。
- 敏感字段加密存储。
- 前端不长期保存明文 API Key。
- 2026-05-23 已移除浏览器侧 `NEXT_PUBLIC_AI_ENCRYPTION_KEY` / localStorage 加密密钥生成脚本和旧 API Key 自动迁移路径；前端只在表单草稿内短暂持有新输入的 key，保存后以后端 `has_api_key` 状态为准。
- AI 调用时使用当前用户的后端配置。
- 用户 A 不能读取或使用用户 B 的 API Key。
- 日志不能输出明文 API Key。

验收标准：

- 用户 A/B 分别配置不同 key，调用时互不串用。
- 数据库中不出现明文 key。
- 清空浏览器缓存后，设置仍可从后端恢复。

### P1.4 前端依赖与验证限制

项目要求：

- 前端依赖只用 Windows 单平台方案。
- 严禁 WSL 操作前端依赖。

验收标准：

- 前端 typecheck 使用 Windows / PowerShell 路径执行。
- 不引入双平台共享 `node_modules`。

---

## P1：旧数据策略与兼容边界

第一阶段不迁移旧数据，但必须防止旧路径继续写新数据。

### P1.5 旧库写入路径封堵

必须确认这些来源不再作为新数据真源：

- `backend/.deer-flow/novel_migrated.db`
- 旧 JSON store
- 浏览器 IndexedDB
- 浏览器 localStorage

要求：

- 旧接口如必须保留，只能只读兼容或返回迁移提示。
- 不能继续向旧库写入。
- 旧数据导入工具以后单独做，不纳入当前阶段。
- 2026-05-23 前端 `core/novel/database.ts` 仍作为阅读器/快照/离线草稿兼容层保留，但已标注不是 SaaS canonical store；运行域服务仍按 remote-first 访问后端。

验收标准：

- 搜索不到新的 `novel_migrated.db` 写入路径。
- 旧 JSON store 不再作为保存目标。
- IndexedDB / localStorage 不再作为最终主存储。

### P1.6 手动旧项目导入工具规划

不在当前第一期实现，但需要单独规划：

- 从旧 SQLite 导入
- 从旧 JSON store 导入
- 从浏览器导出的项目包导入

验收标准：

- 有独立 PRD / design，不混入当前统一主库改造。

---

## P1：测试体系补齐

### P1.7 后端单元测试

必须新增或更新：

- 数据库统一测试
- 严格认证测试
- 子资源跨用户隔离测试
- 对象存储 metadata 测试
- 对象存储服务层测试
- 任务资源隔离测试
- API Key 加密保存测试

建议命令：

```bash
cd deer-flow-main/backend
uv run pytest tests/test_novel_unified_persistence.py
uv run pytest tests/test_novel_internal_contracts.py
uv run pytest tests/test_novel_p2_fix.py
```

验收标准：

- 目标测试全部通过。
- 旧测试不再要求 `resolve_user_id(None) -> local_single_user`。
- 旧测试不再要求小说私有 SQLite WAL 初始化。

### P1.8 集成 smoke test

必须覆盖：

- 登录
- 账号设置
- AI Provider 设置
- 普通聊天线程
- 小说项目创建
- 章节创建 / 编辑
- 人物创建 / 编辑
- 小说生成流
- 书籍导入
- 封面生成
- 对象上传 / 下载

验收标准：

- 有可重复执行步骤。
- 记录实际端口和后端基址。
- 本地开发后端基址使用 `http://127.0.0.1:8551`，前端使用 `4560`，禁止把 `8001` 当默认值。
- 2026-05-23 已新增可重复脚本：
  - `deer-flow-main/backend/scripts/smoke_novel_postgres_unified.py`：验证 users / runs / projects / chapters / characters / media_assets 在同一 PostgreSQL，且不修改 `backend/.deer-flow/novel_migrated.db`。
  - `deer-flow-main/backend/scripts/smoke_seaweedfs_media_asset.py`：用环境变量对 SeaweedFS S3-compatible 做上传、下载、DB metadata 校验和删除。
  - `deer-flow-main/backend/scripts/ensure_object_storage_bucket.py`：使用同一套 `MIAOWU_OBJECT_STORAGE_*` 配置准备 S3-compatible bucket。
  - 本机未配置 PostgreSQL / SeaweedFS 凭据；真实 smoke 已迁移到 31 测试栈执行。
  - 2026-05-23 31 结果：PostgreSQL smoke 通过；SeaweedFS 默认 bucket `miaowu-novel-assets` 上传/下载/删除通过，DB 只保存 metadata。

仍未完成：

- 浏览器真实登录、账号设置、普通聊天线程、小说生成流、书籍导入、封面生成、章节编辑、前端全链路 smoke 尚未跑完。
- 前端镜像仍是 2026-05-22 测试镜像，未基于本轮前端改动重建。

---

## P2：运维、配置与文档

### P2.1 环境变量文档

需要补充：

```text
MIAOWU_OBJECT_STORAGE_PROVIDER=s3
MIAOWU_OBJECT_STORAGE_ENDPOINT=http://172.22.22.170:18334
MIAOWU_OBJECT_STORAGE_BUCKET=miaowu-novel-assets
MIAOWU_OBJECT_STORAGE_REGION=us-east-1
MIAOWU_OBJECT_STORAGE_ACCESS_KEY=...
MIAOWU_OBJECT_STORAGE_SECRET_KEY=...
MIAOWU_OBJECT_STORAGE_PRIVATE=true
```

要求：

- 文档明确 SeaweedFS / S3-compatible 是当前 active backend。
- MinIO 只能作为历史背景，不能写成默认 provider、默认 endpoint 或当前 active backend。

验收标准：

- `.env.example` / docs 中没有误导性的 MinIO 默认项。
- 新部署者按文档能配置 SeaweedFS S3-compatible。

### P2.2 配额与资产清理策略

后续可加入：

- 用户初始免费空间，例如 100MB。
- 超额付费或拒绝上传。
- 项目删除时对象删除 / 标记删除策略。
- orphan object 清理任务。

验收标准：

- 有明确策略文档。
- 删除项目不会留下不可追踪大文件。

### P2.3 Trellis 工具缺口修复

当前问题：

```text
python ./.trellis/scripts/task.py current --source
ModuleNotFoundError: No module named 'common.safe_commit'
```

影响：

- Trellis `task.py current/start/archive` 等命令不可用。
- 任务状态只能通过文件和对话上下文维护。

验收标准：

- 恢复 `.trellis/scripts/common/safe_commit.py` 或修正 Trellis 脚本引用。
- `python ./.trellis/scripts/task.py current --source` 可正常执行。

---

## 建议下一轮执行顺序

1. 先修 P0.1 / P0.2：全量 owner-scoped 查询，覆盖所有小说资源和任务资源。
2. 再修 P0.6 / P0.7：对象存储 service + media assets API。
3. 跑 P0.4 / P0.5：PostgreSQL 真实启动和跨用户隔离验证。
4. 进入 P1.1-P1.3：前端后端真源收敛和 API Key 后端保存。
5. 最后补 P1.8 / P2：完整 smoke test、配置文档、配额和清理策略。

---

## 不允许回退的旧行为

- 不要恢复 `local_single_user`。
- 不要恢复 `NOVEL_MIGRATED_DEFAULT_USER_ID` 作为小说数据默认用户。
- 不要让小说模块重新注册自己的 `users` / `user_passwords` ORM 表。
- 不要为了旧测试恢复 `novel_migrated.db` 私有 SQLite 写入路径。
- 不要把 MinIO 写成当前默认对象存储。
- 不要让前端直接使用可猜测裸 object key。
- 不要把 IndexedDB / localStorage 当小说数据真源。
- 不要自动迁移旧数据，旧数据导入必须单独规划。
- 不要使用 WSL 操作前端依赖。

## 2026-05-23 AI Provider 后端真源与 31 测试栈验证补充

本轮新增/验证：

- `deer-flow-main/backend/tests/test_user_ai_settings_contract.py` 补充后端契约：
  - 测试请求不能通过 `api_key_encrypted` 注入后端专用密文字段。
  - 测试 `resolve_user_ai_runtime_config()` 按不同 `Settings.user_id` 解析不同 provider/base_url/model/key，避免跨用户串用 key。
  - 测试 app 显式注入登录态，符合缺用户 401 的新契约。
- 新增 `deer-flow-main/backend/scripts/smoke_ai_provider_backend_truth.py`：
  - 从环境变量读取 OpenAI-compatible `base_url` / key / model。
  - 写入 `/api/user/ai-settings` 同一后端真源对应的 Settings/preferences 结构。
  - 验证公开返回不包含明文 key / `api_key_encrypted`，只返回 `has_api_key=true`。
  - 验证运行时能解析当前用户的 key/base_url/model。
  - 可选执行 `/chat/completions` 真实上游调用。
- 31 测试栈验证：
  - 使用用户给定第三方 OpenAI-compatible base URL `https://token-plan-cn.xiaomimimo.com/v1` 与真实 key 做 smoke，key 只进入远端临时 env 文件/容器临时文件，未写入仓库或文档明文。
  - 使用用户给定模型名 `MiMo-V2.5` 调用上游失败：上游返回 `HTTP 400`，错误为不支持该模型名。
  - 查询 `/v1/models` 后确认供应商实际模型 ID 为小写 `mimo-v2.5`；改用 `mimo-v2.5` 后真实调用 `HTTP 200`。
  - `backend_truth=ok`：PostgreSQL 中 AI provider 设置以后端为真源，公开响应不泄露 key，运行时配置解析成功。
- NewAPI 登录创建 Miaowu 账号验证：
  - 31 verify NewAPI 测试用户 `miaowu31test` 存在但测试密码文件与 DB hash 漂移；已只在 31 verify 隔离库重置该测试用户密码，不触碰 31 生产、161 主入口或公网流量。
  - 脚本化走通：Miaowu `/api/v1/auth/login/newapi` -> NewAPI `/oauth/authorize` -> NewAPI `/api/user/login` -> NewAPI 授权回调 -> Miaowu `/api/v1/auth/callback/newapi`。
  - `GET /api/v1/auth/me` 返回 `HTTP 200`，顶层包含 `newapi_account`，其中 `newapi_sub=932521`、`username=miaowu31test`、quota/balance 快照存在。
- 前端 AI Provider 真源收敛补充：
  - `feature-routing.ts` 不再把模型路由写入 `localStorage`，`saveFeatureRoutingState()` 保留为兼容 no-op。
  - AI Provider 设置页保存模型路由只调用后端 `saveFeatureRoutingToServer()`。
  - `.env.example` 已移除浏览器侧 API key 加密 key 文案。

本轮验证：

```text
cd deer-flow-main/backend
uv run pytest tests/test_user_ai_settings_contract.py -q
# 18 passed
uv run ruff check tests/test_user_ai_settings_contract.py scripts/smoke_ai_provider_backend_truth.py app/gateway/novel_migrated/services/ai_settings_service.py app/gateway/novel_migrated/api/user_settings.py
# All checks passed
uv run python -m compileall scripts/smoke_ai_provider_backend_truth.py
# passed

cd deer-flow-main/frontend
pnpm typecheck
# passed
pnpm vitest run tests/unit/core/ai/ai-provider-store.test.ts
# 1 passed
```

2026-05-23 晚间追加收口：

- 前端小说创建、项目列表/详情、章节、人物、Prompt Template、Dashboard stats 默认走后端 API；写操作远端失败时不再静默落 Dexie 当真源。
- `RecommendationPanel` / `AnnotationThreadPanel` 的生成、接受、忽略、创建、更新、删除改为后端写入成功后才刷新本地缓存；远端失败不再写本地缓存伪成功。
- `/api/novels` 兼容路由的核心项目/章节/人物 CRUD 已改为统一 persistence + current user scope；`timeline/graph/recommendations/interactions/quality-report/audits` 等兼容入口也先校验 `Project.user_id == current_user_id`。
- `NovelStore._persist_locked()` 已禁用旧 JSON 落盘，旧 store 只保留为进程内兼容缓存，不再继续写 `novel_store.json` 作为真源。
- 前端生产构建默认内部网关从 `127.0.0.1:8551` 改为容器服务名 `http://gateway:8551`；本地开发仍默认 `127.0.0.1:8551`。31 前端同源 `/api/v1/auth/setup-status` 已从 500 修到 200。

31 测试栈当前运行态：

- 后端镜像：`miaowu-os-gateway:test-20260523-194213`。
- 前端镜像：`miaowu-os-frontend:test-20260523-201720`。
- Postgres：`miaowu-os-test-postgres-20260523`。
- NewAPI verify：`newapi-verify-app-20260518-224155`，端口 `13282->3000`。
- 只改 31 测试栈 `/opt/stacks/miaowu-os-test-20260522`，未触碰 31 生产 `new-api-31`、161 `new-api-master`、公网 `api.miaowu.bond`、FRP、Cloudflare 或 EdgeOne。

31 已验证：

```text
GET http://127.0.0.1:18551/health
# 200 {"status":"healthy", ...}

GET http://127.0.0.1:14560/
# 200 text/html

GET http://127.0.0.1:14560/api/v1/auth/setup-status
# 200 {"needs_setup":true}

scripts/smoke_novel_postgres_unified.py
# OK unified PostgreSQL smoke passed: users/runs/novel/media tables share one PostgreSQL database.

scripts/smoke_seaweedfs_media_asset.py
# OK SeaweedFS media asset smoke passed: upload/download/delete succeeded and DB stored metadata only.

scripts/smoke_ai_provider_backend_truth.py
# backend_truth=ok
# upstream_call=ok status=200 model=mimo-v2.5

NewAPI OIDC smoke
# Miaowu login -> NewAPI authorize -> NewAPI user login -> callback -> /workspace
# /api/v1/auth/me 200, newapi_sub=932521, username=miaowu31test
```

本地验证追加：

```text
cd deer-flow-main/backend
uv run pytest tests/test_gateway_novel_router_medium_low_fixes.py tests/test_user_ai_settings_contract.py tests/test_novel_unified_persistence.py tests/test_novel_internal_contracts.py tests/test_novel_p2_fix.py tests/test_novel_file_truth_read_paths.py tests/test_novel_chapters_idempotency.py tests/test_novel_router_regressions.py tests/test_characters_relationships_alias.py tests/test_book_import_service_ai_overrides.py -q
# 102 passed, 1 warning

uv run ruff check app/gateway/routers/novel.py app/gateway/novel_migrated/api/projects.py app/gateway/novel_migrated/api/import_export.py app/gateway/novel_migrated/api/book_import.py app/gateway/novel_migrated/api/media_assets.py app/gateway/novel_migrated/api/project_covers.py app/gateway/novel_migrated/api/prompt_workshop.py app/gateway/novel_migrated/services/import_export_service.py app/gateway/novel_migrated/services/media_asset_service.py app/gateway/novel_migrated/services/cover_generation_service.py tests/test_gateway_novel_router_medium_low_fixes.py tests/test_user_ai_settings_contract.py tests/test_novel_unified_persistence.py
# All checks passed

uv run python -m compileall app/gateway/routers/novel.py app/gateway/novel_migrated/api/media_assets.py app/gateway/novel_migrated/api/prompt_workshop.py app/gateway/novel_migrated/services/media_asset_service.py app/gateway/novel_migrated/utils/http_headers.py scripts/smoke_ai_provider_backend_truth.py scripts/smoke_novel_postgres_unified.py scripts/smoke_seaweedfs_media_asset.py
# passed

cd deer-flow-main/frontend
pnpm typecheck
# passed

pnpm vitest run tests/unit/core/ai/ai-provider-store.test.ts tests/unit/core/config/next-rewrites.test.ts tests/unit/core/auth/gateway-config.test.ts
# passed
```

全后端测试现状：

```text
cd deer-flow-main/backend
uv run pytest -q
# 3679 passed, 62 failed, 21 skipped, 17 warnings
```

失败主要类别：

- 旧/未更新测试仍直接调用 `init_db_schema()`，但未先初始化主 persistence engine，触发统一库新契约错误：`Main persistence engine is not initialized. Novel schema cannot be created outside DeerFlow persistence.`
- `tests/e2e/novel_phase3/ws_d/test_lifecycle_e2e_flow.py` 仍缺失，`test_ws_d_required_suite_files_exist` 失败。
- Docker E2E 需要拉 `busybox:latest`，本机 Docker 直连 Docker Hub 超时。
- 多个 AI Provider / suggestions 单测当前仍返回 503，测试依赖覆盖方式与后端真源/当前用户 AI 设置新契约不一致，需要更新测试夹具，不应恢复浏览器或默认配置真源。
- 少量旧小说契约测试仍要求私有 SQLite/WAL、legacy admin router、旧工具上下文等行为，需要按 SaaS 新契约改测试，而不是恢复旧行为。

仍未完成/仍有缺口：

- Dexie `src/core/novel/database.ts` 仍保留为本地缓存/草稿/阅读辅助层；已避免核心写入静默当真源，但尚未删除全部本地缓存 API。
- 小说相关 localStorage 仍存在阅读设置、灵感缓存、关系图布局、AI 项目生成草稿等路径；这些看起来属于 UI 缓存/草稿，但尚未逐项写测试证明“清空缓存后后端数据仍完整”。
- 导入原文、导出包、生成结果文件等对象存储热路径已部分接入和 smoke，但仍需要继续业务级全链路 UI 回归。
- 普通聊天线程、小说生成流、书籍导入、封面生成、章节编辑只完成服务/接口层与 31 基础 smoke，未做完整人工浏览器业务回归。
