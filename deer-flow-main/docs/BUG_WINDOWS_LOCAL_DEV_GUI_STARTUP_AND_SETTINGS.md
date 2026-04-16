# Windows 本地开发 GUI 启动与设置页异常 - BUG 复盘

## 文档目标

记录一次完整的 Windows 本地开发链路故障排查，覆盖：

- `dev-local-gui.exe` 双击无响应 / 按钮执行异常
- 前端与后端启动后接口不通（`ECONNREFUSED` / `404`）
- 设置页「工具」空白

本文件用于后续 AI/开发者快速定位同类问题，减少重复排查时间。

更新时间：2026-04-17

---

## 影响范围

- 操作系统：Windows（本地开发模式，非 Docker）
- 启动方式：
  - `scripts\dev-local.bat start -View single`
  - `scripts\dev-local.bat start -View split`
  - `scripts\dev-local-gui.exe`（WinForms + PowerShell）
- 端口约定：
  - 后端 `8551`
  - 前端 `4560`

---

## 症状汇总

### 症状 1：GUI 双击无响应或立即退出

- 双击 `dev-local-gui.exe` 后看起来“没有任何反应”。
- 部分环境下会秒退，缺少明确错误信息。

### 症状 2：GUI 按钮执行报 Runspace 错误

- 日志出现：
  - `此线程中没有可用于运行脚本的运行空间`
  - 伴随 `param(...` 片段
- 触发场景：点击 GUI 内 `start/restart/status` 等按钮。

### 症状 3：前端请求错误路由/端口

- 典型报错：
  - `connect ECONNREFUSED 127.0.0.1:2024`
  - `POST /api/langgraph/threads/search 404`
- 表现：工作区会打开，但线程搜索、会话相关功能异常。

### 症状 4：设置页「工具」空白

- 设置 -> 工具页只有标题与说明，无 MCP 工具条目。
- 不显示“空状态提示”，看起来像“加载失败”。

---

## 根因分析

### 根因 A：GUI 执行模型在 WinPS 下不稳定

- GUI 脚本中曾采用对线程/事件回调较敏感的执行方式，触发 Runspace 上下文问题。
- `exe` 早期版本对“秒退”场景缺少诊断提示。

### 根因 B：本地前端到网关的 LangGraph 基址配置错误

- `dev-local.ps1` 曾把 `DEER_FLOW_INTERNAL_LANGGRAPH_BASE_URL` 指向：
  - `http://127.0.0.1:8551/api/langgraph-compat`
- 但当前本地链路并无对应前缀路由，导致 `/threads/search` 等请求 404。

### 根因 C：前端跨域直连网关时缺少 CORS 支持

- 本地模式下前端从 `4560` 直连 `8551`。
- 网关未启用 CORS 中间件时，浏览器会拦截接口请求（即使后端接口本身存在）。

### 根因 D：缺失 `extensions_config.json` 导致 MCP 配置为空

- `/api/mcp/config` 返回 `{"mcp_servers":{}}`。
- 工具页没有空状态文案，表现为空白，易被误判为加载失败。

### 根因 E：后端启动命令可靠性不足

- 直接 `uv run uvicorn ...` 在个别环境会触发额外同步路径，影响首启稳定性。
- 已存在虚拟环境时，优先直接使用 `.venv/Scripts/uvicorn.exe` 更稳。

---

## 修复措施（已落地）

### 1) GUI 稳定性修复

涉及文件：

- `scripts/dev-local-gui.ps1`
- `scripts/dev-local-gui-launcher.cs`
- `scripts/build-dev-local-gui-exe.ps1`

措施：

- GUI 动作改为显式调用 `powershell.exe -File dev-local.ps1 ...`。
- 对异常输出进行聚合显示，避免“无响应”错觉。
- launcher 增加“快速退出诊断”提示。

### 2) 本地启动环境变量修正

涉及文件：

- `scripts/dev-local.ps1`

关键点：

- 前端显式走网关：
  - `NEXT_PUBLIC_BACKEND_BASE_URL=http://127.0.0.1:8551`
  - `NEXT_PUBLIC_LANGGRAPH_BASE_URL=http://127.0.0.1:8551/api`
- 保留内部变量并对齐到 `/api`，避免 `langgraph-compat` 路径错配。

### 3) 网关增加 CORS 中间件

涉及文件：

- `backend/app/gateway/app.py`

关键点：

- 启用 `CORSMiddleware`。
- 来源使用 `CORS_ORIGINS`（`dev-local.ps1` 已传入 `http://localhost:4560,http://127.0.0.1:4560`）。

### 4) 自动初始化 MCP 配置文件

涉及文件：

- `scripts/dev-local.ps1`

关键点：

- 启动时若缺少 `extensions_config.json`，自动从 `extensions_config.example.json` 复制。
- 使 `/api/mcp/config` 默认返回非空模板配置，工具页可正常展示。

### 5) 工具页可观测性增强

涉及文件：

- `frontend/src/components/workspace/settings/tool-settings-page.tsx`
- `frontend/src/core/mcp/api.ts`
- `frontend/src/core/i18n/locales/types.ts`
- `frontend/src/core/i18n/locales/zh-CN.ts`
- `frontend/src/core/i18n/locales/en-US.ts`

关键点：

- 空配置时显示明确提示，而不是空白区域。
- MCP 接口解析兼容 `mcp_servers` / `mcpServers`。
- 补充请求失败错误抛出，减少静默失败。

---

## 快速验证步骤（Windows）

### A. 重启服务

```powershell
scripts\dev-local.bat restart -View single
```

预期：

- 后端启动在 `8551`
- 前端启动在 `4560`
- `status` 可看到两个服务均存活

### B. 基础接口验证

```powershell
Invoke-WebRequest http://127.0.0.1:8551/api/models
Invoke-WebRequest http://127.0.0.1:8551/api/skills
Invoke-WebRequest http://127.0.0.1:8551/api/mcp/config
Invoke-WebRequest http://127.0.0.1:8551/api/threads/search -Method Post -ContentType "application/json" -Body '{"limit":10,"offset":0}'
```

预期：

- HTTP 状态均为 `200`

### C. 页面验证

1. 打开 `http://127.0.0.1:4560/workspace/chats/new`
2. 进入 `设置 -> 工具`
3. 预期可见 MCP 列表（如 `filesystem/github/postgres`）
4. 切换任一工具开关，预期触发：
   - `PUT /api/mcp/config`（200）
   - 后续 `GET /api/mcp/config`（200）

---

## 回归检查清单

- [ ] `dev-local-gui.exe` 双击能正常弹窗
- [ ] GUI 内 `start/status/stop/restart` 四类动作均可执行
- [ ] 不再出现 Runspace 错误
- [ ] 工作区打开后不再出现 `127.0.0.1:2024 ECONNREFUSED`
- [ ] `/api/langgraph/threads/search` 不再 404（应通过网关兼容路径正常工作）
- [ ] 设置页「记忆」「工具」「技能」均可加载
- [ ] 「工具」页在空配置时也能显示可读提示，不再“空白”

---

## 常用日志位置

- 状态文件：`.deer-flow/local-dev/state.json`
- 前端日志：`logs/local-dev/frontend-*.log`
- 后端日志：`logs/local-dev/backend-*.log`

可通过状态文件中的当前日志路径，避免误读旧日志。

---

## 后续维护建议

1. `dev-local.ps1` 与 `next.config.js` 的代理策略要保持一致，避免再次出现路径漂移。
2. 网关若继续支持本地跨域直连，CORS 配置不要回退。
3. `extensions_config.json` 作为“工具页可见性”的前置条件，建议在 README/SETUP 中明确。
4. GUI 的异常日志应保持“可见 + 可复制”，避免用户只能描述“没反应”。

