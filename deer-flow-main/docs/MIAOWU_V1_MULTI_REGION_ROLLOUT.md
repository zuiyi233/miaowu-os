# Miaowu v1 正式多地部署 Runbook

更新时间：2026-05-23

## 结论

Miaowu v1 可以进入正式多地部署准备，但第一版只部署为：

```text
多入口 + 多无状态 frontend/gateway + 单 PostgreSQL 主库 + 单 S3-compatible 对象存储真源 + NewAPI OIDC
```

不要把第一版做成 NewAPI 式多主 active-active。Miaowu 的小说项目、章节、导入任务、生成任务、媒体资产、运行记录、聊天线程和流式任务都比 NewAPI 状态更重，多主冲突处理不在 v1 范围内。

## 域名和节点角色

| 名称 | v1 角色 | 约束 |
|---|---|---|
| `xs.miaowu.bond` | Miaowu 正式公网入口 | NewAPI OIDC callback 和 frontend public URL 都使用此域名 |
| `xg.miaowu.bond` | 现有 NewAPI 入口 | 不得改动、挪用、覆盖或重路由 |
| 31 | PostgreSQL 候选主库 + verify/candidate 栈 | 不默认承载公网生产主入口 |
| 161 | 第一生产 frontend/gateway | 通过 health/smoke 后接正式入口 |
| 162 | standby frontend/gateway | 161 异常时切换 |
| 东京 | 海外 frontend/gateway 副本 | 只连同一 DB/object storage |
| 美西 | 海外备用 frontend/gateway 副本 | 只连同一 DB/object storage |

## 生产环境合同

所有正式 gateway 节点必须共享同一套数据和密钥配置。节点之间只允许实例名、日志标识、发布端口、health 暴露方式不同。

核心变量：

```env
DATABASE_URL=postgresql://miaowu:<password>@<31-postgres-host>:5432/miaowu
AUTH_JWT_SECRET=<same-secret-on-all-gateways>
CRYPTO_SECRET=<same-secret-on-all-gateways>

NEWAPI_OAUTH_ENABLED=true
NEWAPI_OAUTH_ISSUER=https://<existing-newapi-domain>
NEWAPI_OAUTH_CLIENT_ID=<newapi-oidc-client-id>
NEWAPI_OAUTH_CLIENT_SECRET=<newapi-oidc-client-secret>
NEWAPI_OAUTH_REDIRECT_URI=https://xs.miaowu.bond/api/v1/auth/callback/newapi
NEWAPI_OAUTH_SCOPES=openid profile email
MIAOWU_PUBLIC_FRONTEND_URL=https://xs.miaowu.bond

CORS_ORIGINS=https://xs.miaowu.bond
GATEWAY_CORS_ORIGINS=https://xs.miaowu.bond
DEER_FLOW_TRUSTED_ORIGINS=https://xs.miaowu.bond

MIAOWU_NEWAPI_GROUPS_JSON=[{"id":"default","name":"默认分组","base_url":"https://<newapi-domain>/v1","api_key":"sk-..."}]

MIAOWU_OBJECT_STORAGE_PROVIDER=s3
MIAOWU_OBJECT_STORAGE_ENDPOINT=http://172.22.22.170:18334
MIAOWU_OBJECT_STORAGE_BUCKET=miaowu-novel-assets
MIAOWU_OBJECT_STORAGE_REGION=us-east-1
MIAOWU_OBJECT_STORAGE_ACCESS_KEY=<seaweedfs-ak>
MIAOWU_OBJECT_STORAGE_SECRET_KEY=<seaweedfs-sk>
MIAOWU_OBJECT_STORAGE_PRIVATE=true
```

对象存储也支持通用 S3 别名，方便运维复用现有 secret 命名：

```env
STORAGE_BACKEND=s3
S3_ENDPOINT=http://172.22.22.170:18334
S3_BUCKET_NAME=miaowu-novel-assets
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<seaweedfs-ak>
S3_SECRET_ACCESS_KEY=<seaweedfs-sk>
S3_PATH_STYLE=true
S3_PUBLIC_DOMAIN=
```

如果 `MIAOWU_OBJECT_STORAGE_*` 和 `S3_*` 同时存在，Miaowu 专用变量优先生效。

仓库内模板文件是 `docker/env.production.miaowu-v1.example`。部署时复制为 `docker/.env.production`；`.env.production` 本身包含真实密钥，不应提交。

单节点启动命令：

```powershell
cd N:\miaowu-os-merge-upstream-main\deer-flow-main\docker
Copy-Item env.production.miaowu-v1.example .env.production
# 编辑 .env.production，填入真实密钥、31 PostgreSQL 地址、NewAPI OIDC 和对象存储 AK/SK。
docker compose --env-file .env.production -f docker-compose.production.miaowu-v1.yaml up -d
docker compose --env-file .env.production -f docker-compose.production.miaowu-v1.yaml ps
```

`--env-file .env.production` 必须保留；它用于 compose 变量插值。`env_file` 用于把同一批变量注入容器运行时。

## 发布顺序

1. 在 31 启动 verify/candidate 栈，连接 31 PostgreSQL 候选主库和 161/162 VIP-backed SeaweedFS。
2. 对 31 跑基础 smoke、业务 smoke、对象存储 smoke、NewAPI OIDC smoke。
3. 用同一个镜像 tag 发布 161 frontend/gateway，仍连 31 PostgreSQL 和统一对象存储。
4. 161 smoke 全部通过后，将 `xs.miaowu.bond` 指到 Miaowu 入口。不要碰 `xg.miaowu.bond`。
5. 发布 162 standby，验证 161 写入后 162 可读，162 写入后 161 可读。
6. 发布东京和美西副本，验证 token、AI settings、media asset、小说数据跨节点一致。

镜像 tag 规则：

```text
miaowu-os-frontend:<git-sha>-<yyyymmdd>
miaowu-os-gateway:<git-sha>-<yyyymmdd>
```

frontend/gateway 是不同镜像，但必须来自同一个源码 SHA。

## 本地磁盘状态审计

上线前必须把本地写路径分为三类：

| 类别 | 处理要求 |
|---|---|
| `canonical` | 必须迁入 PostgreSQL 或对象存储，未迁前阻塞生产 |
| `cache/draft/runtime` | 可保留，但节点丢失后必须能恢复或重新生成 |
| `legacy/read-only` | 可保留，但不得接收新生产写入 |

第一轮必须审计这些路径：

| 路径/模块 | 初始分类 | 上线要求 |
|---|---|---|
| `app/gateway/routers/novel.py` legacy `novel_store.json` | `legacy/read-only` | 新生产写入不得依赖此 JSON |
| `novel_migrated/services/workspace_document_service.py` | 待定，倾向 `canonical` 或 `draft/cache` | 明确哪些文档是最终真源；canonical 内容必须迁 DB/object storage |
| `routers/uploads.py` / thread uploads | 待定 | 用户上传若属于业务资产，必须进对象存储或有可恢复策略 |
| `deerflow/media/draft_media.py` | `draft/runtime` | 允许丢失的草稿才可留本地；正式资产必须走 media assets |
| `app/channels/store.py` 和 IM channel state | 待定 | 若生产启用 IM 渠道，状态不能只在某单节点本地 |
| LangGraph checkpointer/store | 待定 | 长任务和运行记录必须可跨节点查询 |
| sandbox user-data / workspace | `runtime/cache` | 节点丢失不能导致 canonical 小说数据丢失 |
| `.jwt_secret` / initial credential files | `runtime/bootstrap` | 生产必须显式配置 `AUTH_JWT_SECRET`，不能依赖自动本地文件 |

任何 `canonical` 路径仍写容器本地磁盘时，不切正式公网。

## Smoke 清单

基础：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-miaowu-multiregion.ps1 `
  -FrontendBaseUrl https://xs.miaowu.bond `
  -GatewayBaseUrl https://xs.miaowu.bond `
  -NodeName xs
```

必须人工或自动验证：

- `/health` 返回 200。
- frontend 首页返回 200。
- NewAPI OIDC：`xs.miaowu.bond` -> NewAPI authorize -> callback -> `/workspace`。
- `/api/v1/auth/me` 返回当前 Miaowu 用户和 NewAPI account link/snapshot。
- PostgreSQL smoke：users、runs、novel、media metadata 在同一 DB。
- SeaweedFS smoke：上传、下载、删除成功，DB 不保存裸 object key 到前端响应。
- AI Provider 设置保存、刷新恢复，key 不回显明文。
- 聊天线程创建、继续对话、历史恢复。
- 小说项目、章节、人物、世界观、大纲创建和刷新恢复。
- 小说生成流、导入任务、封面生成、项目导出/导入。
- 用户 A/B 交叉访问项目、章节、任务、媒体资产返回 403/404。
- 161 写入后 162/东京/美西可读；162 写入后 161 可读。
- 任意节点保存的 AI settings / encrypted key 可被其他节点读取解密。

## 回滚

每个节点发布前保存：

- 当前 compose 文件。
- 当前 `.env.production`。
- 当前 frontend/gateway 镜像 tag。
- 当前反代 upstream 配置。

回滚顺序：

1. 停止新容器。
2. 恢复上一版 compose/env。
3. 启动上一版镜像。
4. 跑 `/health`、frontend 首页、登录、小说列表、媒体下载 smoke。
5. 仅当回滚 smoke 通过后，恢复或保持入口流量。

## 禁止项

- 不做多地多主 PostgreSQL。
- 不让不同地区写不同对象存储后再异步合并。
- 不把 31 SeaweedFS POC 热并入生产 quorum。
- 不让 `xg.miaowu.bond` 从 NewAPI 变成 Miaowu。
- 不在没有本地磁盘状态审计的情况下宣称 gateway 完全无状态。
- 不把全量旧测试失败当作可忽略事实；只能说明旧契约失败不阻塞本阶段，新增部署 smoke 必须通过。
