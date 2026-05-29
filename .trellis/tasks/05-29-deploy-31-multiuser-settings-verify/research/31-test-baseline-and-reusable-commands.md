# Research: 31 Miaowu-OS 测试栈真实部署基线与复用命令

- Query: 整理 31 Miaowu-OS 测试栈的真实部署基线、可复用构建命令、部署顺序与验证命令。
- Scope: mixed
- Date: 2026-05-29

## Findings

### 1) 目标主机与 SSH 入口
- 31 服务器本机地址是 `172.22.22.31`，但文档明确说明它已移动到 161/162 旁边，当前不作为主访问入口；当前主访问入口是经 162 跳板的 `ssh zuiyi-server-3`，实际目标是 `root@10.200.31.1`。[N:\cloudflare\服务器登录与环境安装记录_2026-04-28.md:71-75]
- Windows 本机 SSH 别名里，`zuiyi-server-3` / `zuiyi-server-3-direct` 都指向 `root@10.200.31.1`，经 `172.22.22.162` 跳板登录。[N:\cloudflare\服务器登录与环境安装记录_2026-04-28.md:45-51]
- 31 verify 的固定内网入口不是 31 本机，而是 162 上的 `http://172.22.22.162:13282`，由 systemd socket relay 转发到 `10.200.31.1:13282`。[N:\cloudflare\DEPLOYMENT_NOTES.md:138-160]

### 2) 31 Miaowu 测试栈的实际 stack path / env / compose / 容器名 / 端口
- 测试栈目录反复写死为 `/opt/stacks/miaowu-os-test-20260522`。[N:\cloudflare\DEPLOYMENT_NOTES.md:592-603][N:\cloudflare\DEPLOYMENT_NOTES.md:2014-2025]
- 证据里能直接确认的 compose 备份都在这个目录下，但文档没有单独贴出“主 compose 文件路径”；最稳妥的表述是：主栈根目录已确认，compose 文件在该目录内，且多次通过 `docker compose up -d --force-recreate ...` 和 `docker compose ps` 操作该栈。[N:\cloudflare\DEPLOYMENT_NOTES.md:598][N:\cloudflare\DEPLOYMENT_NOTES.md:2685][N:\cloudflare\DEPLOYMENT_NOTES.md:2691]
- 运行容器名固定为：`miaowu-os-test-gateway-20260522`、`miaowu-os-test-frontend-20260522`、`miaowu-os-test-postgres-20260523`。[N:\cloudflare\DEPLOYMENT_NOTES.md:3257-3259][N:\cloudflare\DEPLOYMENT_NOTES.md:3288-3293]
- 端口固定为：gateway `18551 -> 8551`、frontend `14560 -> 3000`、NewAPI verify provider `13282 -> 3000`。[N:\cloudflare\DEPLOYMENT_NOTES.md:2018-2025][N:\cloudflare\DEPLOYMENT_NOTES.md:3257-3259][N:\cloudflare\DEPLOYMENT_NOTES.md:2237-2240][N:\cloudflare\DEPLOYMENT_NOTES.md:749-755]
- PostgreSQL 容器是 `miaowu-os-test-postgres-20260523`，镜像 `postgres:16-alpine`，状态 healthy；文档反复说明它保持原 volume，未重建。[N:\cloudflare\DEPLOYMENT_NOTES.md:1935-1936][N:\cloudflare\DEPLOYMENT_NOTES.md:2018-2025][N:\cloudflare\DEPLOYMENT_NOTES.md:3257-3259]
- `miaowu.env` 是 31 测试栈关键运行时 env 文件；文档中明确出现了 `/opt/stacks/miaowu-os-test-20260522/miaowu.env`，并记录了多个写入的关键变量。[N:\cloudflare\DEPLOYMENT_NOTES.md:1914-1915][N:\cloudflare\DEPLOYMENT_NOTES.md:2301-2303][N:\cloudflare\DEPLOYMENT_NOTES.md:2543-2544]
- 31 测试栈的关键 env 包括：`NEWAPI_OAUTH_ISSUER=http://10.200.31.1:13282`、`NEWAPI_OAUTH_PUBLIC_ISSUER=http://127.0.0.1:13282`、`MIAOWU_PUBLIC_FRONTEND_URL=http://127.0.0.1:14560`、`MIAOWU_OBJECT_STORAGE_PROVIDER=s3`、`MIAOWU_OBJECT_STORAGE_ENDPOINT=http://172.22.22.170:18334`、`MIAOWU_OBJECT_STORAGE_BUCKET=miaowu-novel-assets`、`MIAOWU_OBJECT_STORAGE_REGION=us-east-1`、`MIAOWU_OBJECT_STORAGE_PRIVATE=true`、`OPENAI_API_KEY`（来自 verify token `smoke-token`）、`SETTINGS_ENCRYPTION_KEY`。[N:\cloudflare\DEPLOYMENT_NOTES.md:1876][N:\cloudflare\DEPLOYMENT_NOTES.md:1913-1915][N:\cloudflare\DEPLOYMENT_NOTES.md:1938-1939][N:\cloudflare\DEPLOYMENT_NOTES.md:2099-2104]
- 文档还记录了 31 测试栈支持多 NewAPI 分组的逻辑：可用 `MIAOWU_NEWAPI_GROUPS_JSON` 或 `NEWAPI_PROVIDER_GROUPS_JSON`；如果没配，则沿用 `MIAOWU_NEWAPI_BASE_URL` / `NEWAPI_OPENAI_BASE_URL` / `OPENAI_BASE_URL` 与对应 API key 的默认单分组路径。[N:\cloudflare\DEPLOYMENT_NOTES.md:2180-2182][N:\cloudflare\DEPLOYMENT_NOTES.md:2194]

### 3) 已知可复用的构建方式
- 31 远端 Docker 已安装 `docker-buildx`，`docker buildx version` 返回 `github.com/docker/buildx 0.30.1 0.30.1-0ubuntu1`。[N:\cloudflare\DEPLOYMENT_NOTES.md:1897-1899]
- 后端标准构建方式是 `docker buildx build --load -f backend/Dockerfile --target dev`，并显式使用 `APT_MIRROR=mirrors.tuna.tsinghua.edu.cn`、`UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`、`UV_EXTRAS=postgres`。[N:\cloudflare\DEPLOYMENT_NOTES.md:1949-1950][N:\cloudflare\DEPLOYMENT_NOTES.md:2210-2211][N:\cloudflare\DEPLOYMENT_NOTES.md:3261-3262]
- 前端标准构建方式是 `docker buildx build --load -f frontend/Dockerfile --target prod`，并显式使用 `NPM_REGISTRY=https://registry.npmmirror.com`。[N:\cloudflare\DEPLOYMENT_NOTES.md:2210-2211][N:\cloudflare\DEPLOYMENT_NOTES.md:3261-3262]
- 构建链路里曾明确指出，首轮 gateway 发布若未带 `UV_EXTRAS=postgres` 会在生产启动时缺 `asyncpg`，需要回滚并重建；因此对 31 这类需要 postgres persistence 的 gateway，`UV_EXTRAS=postgres` 不是可选项，而是必须项。[N:\cloudflare\DEPLOYMENT_NOTES.md:3881-3883]
- 文档里还记录了前端构建警告：Better Auth 缺运行时 secret 属于 build-time warning，运行时由 `miaowu.env` 注入，不应误判为构建失败。[N:\cloudflare\DEPLOYMENT_NOTES.md:2683][N:\cloudflare\DEPLOYMENT_NOTES.md:3262]
- 31 机器本身的 Docker daemon 已配置国内 registry mirrors；在拉取 `postgres:16-alpine` 之前还补了 systemd-resolved DNS，说明在这台机器上构建/拉镜像时要先考虑镜像源和 DNS 可达性。[N:\cloudflare\DEPLOYMENT_NOTES.md:1897][N:\cloudflare\DEPLOYMENT_NOTES.md:1945-1947]

### 4) 推荐的最小变更部署顺序
- 最小变更原则在文档里体现得很清楚：优先只重建受影响的单一服务，例如只改 gateway 就只执行 `docker compose up -d --no-deps --force-recreate gateway`；只改前端就只重建 frontend。[N:\cloudflare\DEPLOYMENT_NOTES.md:3632-3636][N:\cloudflare\DEPLOYMENT_NOTES.md:3743-3746][N:\cloudflare\DEPLOYMENT_NOTES.md:3784-3787]
- 若变更同时触及前端和 gateway，常见做法是先构建两个镜像，再用 `docker compose up -d --no-deps --force-recreate gateway frontend` 一次性重建，Postgres 保持不动。[N:\cloudflare\DEPLOYMENT_NOTES.md:3893-3900]
- 对 31 测试栈，这个顺序的最小安全版本是：
  1. 先在 31 上完成后端 `buildx` 构建并确认镜像可用。
  2. 再构建前端 `buildx` 镜像。
  3. 只在 `\/opt\/stacks\/miaowu-os-test-20260522` 执行 `docker compose up -d --no-deps --force-recreate gateway frontend`，Postgres 保持原容器与 volume 不动。
  4. 只在确实涉及数据库 schema / 账号 / provider secret 的场景下再触碰 `miaowu-os-test-postgres-20260523`。
- 31 verify 与 31 测试栈是两层不同的入口：verify 只负责 `newapi-verify-app-20260518-224155` 的可达性与 OIDC/Key 证明；测试栈负责 Miaowu gateway/frontend/postgres 的集成验证，不要混在一起。[N:\cloudflare\DEPLOYMENT_NOTES.md:138-160][N:\cloudflare\DEPLOYMENT_NOTES.md:1755-1772][N:\cloudflare\DEPLOYMENT_NOTES.md:2014-2025]

### 5) 部署后的分层验证命令
- 容器层：`docker compose ps`，确认 `miaowu-os-test-gateway-20260522`、`miaowu-os-test-frontend-20260522`、`miaowu-os-test-postgres-20260523` 都在跑，Postgres healthy。[N:\cloudflare\DEPLOYMENT_NOTES.md:2691][N:\cloudflare\DEPLOYMENT_NOTES.md:3257-3259]
- 日志层：`docker compose logs --tail=100`，重点看 gateway 是否有 `Application startup complete`、`Persistence engine initialized: backend=postgres`、frontend 是否 `Next.js Ready`。[N:\cloudflare\DEPLOYMENT_NOTES.md:3637-3647][N:\cloudflare\DEPLOYMENT_NOTES.md:3896-3900]
- 本机 HTTP 层：
  - `curl http://127.0.0.1:18551/health`
  - `curl http://127.0.0.1:14560/api/v1/auth/setup-status`
  - `curl http://127.0.0.1:14560/`
  - `curl http://127.0.0.1:18551/api/v1/auth/login/newapi?next=/workspace`
  - `curl http://127.0.0.1:18551/api/v1/auth/me`
  - `curl http://127.0.0.1:18551/api/tts/config`
  - `curl http://127.0.0.1:18551/api/v1/images/jobs`
  这些命令在文档里分别用于验证 health、setup 状态、页面可达性、OIDC redirect 和未登录鉴权边界。[N:\cloudflare\DEPLOYMENT_NOTES.md:2692-2696][N:\cloudflare\DEPLOYMENT_NOTES.md:3264-3267][N:\cloudflare\DEPLOYMENT_NOTES.md:3845-3848]
- verify 层：`curl http://127.0.0.1:13282/api/status`、`curl http://127.0.0.1:13282/.well-known/openid-configuration`、`curl http://127.0.0.1:13282/v1/models`（带/不带 key 两种），以及 `POST /oauth/token` 的假 code 回归，分别验证 verify provider 健康、OIDC discovery、API key 校验与 token 流程。[N:\cloudflare\DEPLOYMENT_NOTES.md:1769-1772][N:\cloudflare\DEPLOYMENT_NOTES.md:1919-1923]
- 远端/入口层：`GET https://xs.miaowu.bond/health`、`GET https://xs.miaowu.bond/api/v1/auth/setup-status`、`GET https://xs.miaowu.bond/api/v1/auth/login/newapi?next=/workspace`，以及在需要时通过 161 host router 验证 `X-Miaowu-Upstream-Addr` 是否指向 `10.200.31.6:18551`。[N:\cloudflare\DEPLOYMENT_NOTES.md:2572-2574][N:\cloudflare\DEPLOYMENT_NOTES.md:2646-2650][N:\cloudflare\DEPLOYMENT_NOTES.md:2699-2700][N:\cloudflare\DEPLOYMENT_NOTES.md:3270][N:\cloudflare\DEPLOYMENT_NOTES.md:3316-3321]
- 如果要验证“31 verify 固定入口”，则应额外检查 162 上的 relay：`systemctl is-enabled newapi-verify-31-relay.socket`、`systemctl is-active newapi-verify-31-relay.socket`、`ss -ltnp | grep 13282`、`curl http://172.22.22.162:13282/api/status`。[N:\cloudflare\DEPLOYMENT_NOTES.md:151-160]

### 6) 文档里已知的风险或坑
- 31 verify 的 13282 入口不能直接当作客户端固定入口，因为 31 工作站通常不直接在 `10.200.31.0/30` 上；必须走 162 relay 的 `172.22.22.162:13282`。[N:\cloudflare\DEPLOYMENT_NOTES.md:142-150]
- 31 测试栈的前端构建会出现 Better Auth 缺运行时 secret 的警告，但这不等于构建失败，运行时 env 才是最终真值。[N:\cloudflare\DEPLOYMENT_NOTES.md:2683][N:\cloudflare\DEPLOYMENT_NOTES.md:3262]
- gateway 若漏带 `UV_EXTRAS=postgres`，运行时会缺 `asyncpg`，这是已真实踩过的回滚点。[N:\cloudflare\DEPLOYMENT_NOTES.md:3881-3883]
- 31 测试栈的对象存储依赖的是 `172.22.22.170:18334` 的 SeaweedFS VIP，不应误把 31 本机或 31 独立 POC 当成生产 quorum。[N:\cloudflare\DEPLOYMENT_NOTES.md:1938-1939][N:\cloudflare\DEPLOYMENT_NOTES.md:2240]
- 文档中对主 compose 文件名没有单独贴死，只反复出现根目录和备份文件名；如果后续要写自动化脚本，建议先 `Get-ChildItem /opt/stacks/miaowu-os-test-20260522` 或在远端确认真实文件名，再做假设。[N:\cloudflare\DEPLOYMENT_NOTES.md:598][N:\cloudflare\DEPLOYMENT_NOTES.md:598][N:\cloudflare\DEPLOYMENT_NOTES.md:2212]

## Caveats / Not Found
- 未在给定文档里直接找到 31 测试栈主 compose 文件的明确文件名，只能确认它位于 `/opt/stacks/miaowu-os-test-20260522` 且被多次以 `docker compose` 操作；需要时应在远端目录再做一次实机确认。
- 未直接找到 31 测试栈 PostgreSQL 的宿主机映射端口；当前可确认的是容器名、镜像和健康状态，以及它保持原 volume 未重建。
- 31 verify 与 31 测试栈是不同层级：verify 是 `newapi-verify-app-20260518-224155`，测试栈是 `miaowu-os-test-*`，不要把 verify 的 13282 端口误写成测试栈 gateway 端口。
- 这份研究只覆盖你要求的 31 test/verify 基线，不延伸到 161/162 的生产切流细节。
