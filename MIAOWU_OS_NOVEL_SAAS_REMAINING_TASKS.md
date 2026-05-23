# Miaowu-OS 小说 SaaS 改造完成状态与人工回归入口

更新时间：2026-05-23

本文档记录“统一 Miaowu-OS 主项目与小说二开数据源：后端全包 SaaS 改造”的当前验收状态。历史文档中把部分已完成项列为剩余任务，已在本次清理为当前事实。

## 当前结论

小说 SaaS 改造的架构主线已经完成：

- PostgreSQL 作为生产主库，小说表复用主项目 `deerflow.persistence.engine` 与统一 metadata。
- 小说模块不再把私有 `novel_migrated.db` 当新数据真源；SQLite 仅保留本地开发/单机验证边界。
- 小说模块不再维护自己的认证用户真源；缺少主项目登录用户时返回 401。
- 项目、章节、人物、世界观、生成任务、导入任务、媒体资产等核心资源按当前用户隔离。
- legacy novel admin router 已阻断，管理员能力应走主项目权限体系。
- 大文件走 SeaweedFS / S3-compatible 对象存储，数据库只保存 metadata 与 object key。
- 前端小说核心读写默认走后端 API，Dexie / localStorage 只作为缓存、草稿或兼容层，不作为最终真源。
- API Key 与 AI Provider 设置以后端数据库为真源，前端不长期保存明文 key。

当前剩余事项不是架构实现缺口，而是完整人工浏览器回归：登录、账号设置、普通聊天线程、小说生成流、书籍导入、封面生成、章节编辑等页面级业务流程需要用户在 31 测试栈上最终确认。

## 已完成范围

### 数据库统一

- `novel_migrated` 数据库入口已改接主项目 `deerflow.persistence.engine` / `deerflow.persistence.base.Base`。
- 主项目 `database.backend=postgres` 时，主项目用户表、线程/运行记录表、小说表、媒体资产表进入同一个 PostgreSQL。
- `backend/.deer-flow/novel_migrated.db` 不再作为改造后新数据写入真源。
- 小说自建 `users` / `user_passwords` 仅保留必要兼容 DTO 边界，不再作为 ORM schema 真源注册。

### 统一认证与账户级隔离

- 小说 API 缺少认证用户时返回 401，不再回退默认单机用户。
- 项目资源按 `Project.user_id == current_user_id` 校验。
- 章节、人物、大纲、职业、伏笔、关系、组织、卷、写作风格、Prompt Template、Prompt Workshop、MCP 插件、记忆清理、小说流式生成、批量生成任务、重写任务等热路径已补 owner-scoped 查询。
- book import task、generation task、media asset 等任务/资产入口按用户或项目归属隔离。
- 内部 novel 工具不再散落调用 `resolve_user_id(None)`，统一从主项目 runtime user context 获取用户；无用户上下文时失败。

### 对象存储

- 已新增统一对象存储配置与服务封装，当前 active backend 为 SeaweedFS / S3-compatible。
- 已新增 `media_assets` 元数据模型与上传、元数据、授权下载、删除 API。
- 响应不暴露裸 object key。
- 上传对象成功但 DB 提交失败时会尝试补偿删除对象，降低孤儿对象风险。
- 删除项目时会对当前用户该项目 active `media_assets` 尝试删除对象并标记状态。
- 封面图、拆书导入原文、项目导入包、项目导出 ZIP 已接入对象存储路径。

### 前端后端真源收敛

- 小说创建、项目列表/详情、章节、人物、Prompt Template、Dashboard stats 默认走后端 API。
- 写操作远端失败时不再静默落 Dexie 当真源。
- Recommendation / Annotation 相关写操作改为后端成功后再刷新本地缓存。
- `NovelStore._persist_locked()` 已禁用旧 JSON 落盘，旧 store 只保留进程内兼容缓存。
- AI Provider 设置页保存模型路由与 key 配置走后端；前端只短暂持有表单草稿中的新输入 key。
- `.env.example` 已移除浏览器侧 API key 加密 key 文案。

### 旧数据边界

- 第一阶段不自动迁移旧 `novel_migrated.db`、旧 JSON store、浏览器 IndexedDB。
- 旧数据导入工具后续单独规划，不混入当前统一主库改造。
- 保留的本地存储路径只作为缓存、草稿、阅读辅助或兼容层，不作为 SaaS canonical store。

## 验证证据

### 本地定向测试

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest tests/test_novel_unified_persistence.py tests/test_novel_gateway_config_regressions.py tests/test_user_ai_settings_contract.py -q
# 47 passed, 1 warning

uv run pytest tests/test_workspace_document_service.py tests/test_novel_tools.py tests/test_novel_internal_contracts.py -q
# 22 passed, 1 warning
```

追加回归：

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest tests/test_gateway_novel_router_medium_low_fixes.py tests/test_user_ai_settings_contract.py tests/test_novel_unified_persistence.py tests/test_novel_internal_contracts.py tests/test_novel_p2_fix.py tests/test_novel_file_truth_read_paths.py tests/test_novel_chapters_idempotency.py tests/test_novel_router_regressions.py tests/test_characters_relationships_alias.py tests/test_book_import_service_ai_overrides.py -q
# 102 passed, 1 warning

uv run ruff check app/gateway/routers/novel.py app/gateway/novel_migrated/api/projects.py app/gateway/novel_migrated/api/import_export.py app/gateway/novel_migrated/api/book_import.py app/gateway/novel_migrated/api/media_assets.py app/gateway/novel_migrated/api/project_covers.py app/gateway/novel_migrated/api/prompt_workshop.py app/gateway/novel_migrated/services/import_export_service.py app/gateway/novel_migrated/services/media_asset_service.py app/gateway/novel_migrated/services/cover_generation_service.py tests/test_gateway_novel_router_medium_low_fixes.py tests/test_user_ai_settings_contract.py tests/test_novel_unified_persistence.py
# All checks passed

cd N:\miaowu-os-merge-upstream-main\deer-flow-main\frontend
pnpm typecheck
# passed

pnpm vitest run tests/unit/core/ai/ai-provider-store.test.ts tests/unit/core/config/next-rewrites.test.ts tests/unit/core/auth/gateway-config.test.ts
# passed
```

### 31 测试栈 smoke

31 测试栈路径：

```text
/opt/stacks/miaowu-os-test-20260522
```

当前基础服务：

- backend container: `miaowu-os-test-gateway-20260522`
- frontend container: `miaowu-os-test-frontend-20260522`
- postgres container: `miaowu-os-test-postgres-20260523`
- backend host port: `18551 -> 8551`
- frontend host port: `14560 -> 3000`

已验证：

```text
GET http://127.0.0.1:18551/health
# 200

GET http://127.0.0.1:14560/
# 200 text/html

GET http://127.0.0.1:14560/api/v1/auth/setup-status
# 200

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

## 需要人工浏览器回归确认

下面是当前仍需由人工完整点击确认的业务页面，不代表后端架构未完成：

- 登录 / 退出 / 当前用户信息。
- 账号设置。
- AI Provider 设置保存与重新打开恢复。
- 普通聊天线程创建、继续对话、历史恢复。
- 小说项目创建、列表、详情。
- 章节创建、编辑、保存后刷新恢复。
- 人物创建、编辑、保存后刷新恢复。
- 小说生成流。
- 书籍导入。
- 封面生成。
- 项目导出 / 导入。
- 媒体资产上传、下载、删除。
- 清空浏览器 localStorage / IndexedDB 后重新登录，确认后端数据仍存在。
- 用户 A/B 交叉访问项目、章节、人物、任务、媒体资产，确认返回 404/403。

## 当前不回退的行为

- 不恢复 `local_single_user`。
- 不恢复 `NOVEL_MIGRATED_DEFAULT_USER_ID` 作为小说默认用户。
- 不让小说模块重新注册自己的 `users` / `user_passwords` ORM 表。
- 不为了旧测试恢复 `novel_migrated.db` 私有 SQLite 写入路径。
- 不把 MinIO 写成当前默认对象存储。
- 不让前端直接使用可猜测裸 object key。
- 不把 IndexedDB / localStorage 当小说数据真源。
- 不自动迁移旧数据。
- 不使用 WSL 操作前端依赖。

## 已知测试套件状态

全量后端测试仍包含旧契约测试和外部环境依赖，不作为本阶段完成度的唯一口径：

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\backend
uv run pytest -q
# 3679 passed, 62 failed, 21 skipped, 17 warnings
```

主要失败类别：

- 旧测试仍直接调用 `init_db_schema()`，但未先初始化主 persistence engine，触发统一库新契约错误。
- 部分旧小说契约测试仍要求私有 SQLite/WAL、legacy admin router、旧工具上下文等历史行为。
- Docker E2E 需要外部镜像拉取，本机 Docker Hub 直连超时。
- 少量 AI Provider / suggestions 单测测试夹具尚未按后端真源与当前用户 AI 设置新契约更新。

这些失败应通过更新测试夹具或隔离外部依赖解决，不应恢复旧数据真源或旧认证路径。
