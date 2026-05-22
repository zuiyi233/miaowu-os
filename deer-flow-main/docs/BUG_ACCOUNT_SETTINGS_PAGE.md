# 账号管理页空白 / 登录后看起来没有跳转 - BUG 复盘

## 文档目标

记录一次账号管理功能失效的排查结果，避免后续在上游同步或前端重构时再次把账户页“挂入口、漏内容”。

更新时间：2026-05-02

---

## 影响范围

- `deer-flow-main/frontend/src/components/workspace/settings/settings-dialog.tsx`
- `deer-flow-main/frontend/tests/unit/components/workspace/settings/settings-dialog.test.ts`
- 账号管理入口：Workspace Settings -> Account

---

## 用户可见症状

- 点击设置弹窗里的 **Account / 账户** 后，左侧导航会切换，但右侧内容区是空的。
- 用户会感觉“登录后没有跳转”“点了账号管理没反应”。
- 账号信息、改密码、退出登录入口都不可用。

> 说明：这次排查里，登录表单本身没有发现新的提交异常；用户看到的“没跳转”更接近于 **账号页内容没有被渲染**，而不是登录接口失败。

---

## 根因分析

### 根因：SettingsDialog 漏掉了 AccountSettingsPage 的渲染分支

对比原版项目 `D:\deer-flow-main` 后发现：

- 原版 `settings-dialog.tsx` 中有：
  - `import { AccountSettingsPage } from "@/components/workspace/settings/account-settings-page";`
  - `activeSection === "account" && <AccountSettingsPage />`
- 当前二开版本在合并/重构 settings dialog 时：
  - 仍保留了 `account` 侧边栏入口
  - 但把 `AccountSettingsPage` 的导入和渲染分支漏掉了

因此，点击 Account 只会改变左侧选中态，右侧页面没有任何内容。

---

## 修复内容

### 1) 恢复账户页渲染

文件：

- `deer-flow-main/frontend/src/components/workspace/settings/settings-dialog.tsx`

修复点：

- 补回 `AccountSettingsPage` 导入
- 在内容区补回：
  - `activeSection === "account" && <AccountSettingsPage />`

### 2) 增加回归测试

文件：

- `deer-flow-main/frontend/tests/unit/components/workspace/settings/settings-dialog.test.ts`

测试内容：

- 打开 `SettingsDialog`
- 指定 `defaultSection="account"`
- 断言渲染结果中包含：
  - `Profile`
  - `Change Password`
  - `Sign Out`

这样可以防止以后再次把“入口还在、内容没挂上”的问题带回去。

---

## 验证结果

已执行并通过：

```bash
pnpm vitest run tests/unit/components/workspace/settings/settings-dialog.test.ts tests/unit/components/workspace/settings/ai-provider-settings-page.test.ts
pnpm eslint src/components/workspace/settings/settings-dialog.tsx tests/unit/components/workspace/settings/settings-dialog.test.ts
pnpm typecheck
```

结果：

- 单元测试通过
- ESLint 通过
- TypeScript 类型检查通过

---

## 结论

这次问题的本质不是登录接口报错，而是 **账号管理页的内容组件被漏接到了 settings dialog**。

只要恢复 `AccountSettingsPage` 的渲染分支，账号管理功能就能重新进入可用状态。

---

## 相关联的登录后不跳转问题

在同一次 local-dev 排查里，还观察到一个更靠近登录链路的症状：

- 登录接口返回 `200`
- 页面仍停留在登录页
- 日志出现 `setup-status 429`
- 没有看到浏览器发出的 `/api/v1/auth/me`

### 根因

前端本地开发环境里存在两个 loopback 主机写法：

- `localhost`
- `127.0.0.1`

在浏览器里，cookie 是按 host 作用域存放的。若前端页面所在 host 和 API base URL 使用了不同的 loopback 写法，即使端口都是 `8551`，session cookie 也可能无法在后续请求里被命中，导致登录后续的 `/auth/me` 看起来“没发生”或拿不到有效会话。

### 修复

在 `frontend/src/core/config/index.ts` 的统一 API base URL 解析中加入 loopback host 归一化：

- 识别 `localhost` / `127.0.0.1` / `::1`
- 当浏览器当前 host 是 loopback 时，把后台 base URL 的 host 归一化为当前浏览器 host
- 保留端口 `8551`

这样可保证登录、`/api/v1/auth/me`、`/api/v1/auth/setup-status` 等客户端请求走同一个 loopback host，避免 cookie host 作用域错配。

### 回归测试

新增单测覆盖：

- `window.location.hostname = "localhost"`
- `NEXT_PUBLIC_BACKEND_BASE_URL = "http://127.0.0.1:8551"`
- 解析后命中 `http://localhost:8551/...`

---

## 2026-05-02 second-pass findings: cross-origin auth and preflight failures

在账号页空白问题修复后，本地又暴露出一组与 local-dev 直接相关的网络错误：

- 前端 `http://localhost:4560` 访问后端 `http://127.0.0.1:8551` 时出现 CORS 拦截，浏览器看不到 `Access-Control-Allow-Origin`
- `GET /api/models` 返回 `401`
- `POST /api/threads/search` 预检失败，前端报 `TypeError: Failed to fetch`

### Root cause

1. 后端 gateway 的 middleware 顺序不对
   - 当前树里 `AuthMiddleware` 先于 `CORSMiddleware`
   - 结果是 `OPTIONS` 预检请求先被 auth 拦成 401，浏览器拿不到 CORS 响应头
   - 这就是 `POST /api/threads/search` 的预检失败根因

2. 前端直连后端时有一处 raw fetch 漏了 cookie 语义
   - `frontend/src/core/models/api.ts` 的 `loadModels()` 直接调用 `/api/models`
   - 之前没有显式 `credentials: "include"`
   - 在 local-dev 的 4560 -> 8551 跨 origin 场景里，这会让认证 cookie 不稳定地缺失，从而触发 401

3. LangGraph SDK 客户端需要统一的 cookie 语义
   - `frontend/src/core/api/api-client.ts` 创建 `LangGraphClient` 时，原来没有统一注入带 credentials 的 fetch
   - `threads.search` 走的是 SDK 客户端；它也需要和 direct fetch 一样携带 cookie

### Fixes in this round

- Backend: moved `CORSMiddleware` outside `AuthMiddleware` in `backend/app/gateway/app.py`
- Frontend: added `credentials: "include"` to `loadModels()`
- Frontend: injected a shared `callerOptions.fetch` into `LangGraphClient` so SDK requests also include cookies
- Tests:
  - backend preflight regression for `OPTIONS /api/threads/search`
  - frontend regression for `loadModels()`
  - frontend regression for `getAPIClient()` cookie injection

### 2026-05-02 follow-up: remaining `POST /api/threads/search` 401

After the above fixes, the last observed failure was:

- `POST http://127.0.0.1:8551/api/threads/search 401 Unauthorized`

Call chain:

- `frontend/src/core/threads/hooks.ts` calls `getAPIClient().threads.search(...)`
- `frontend/src/core/api/api-client.ts` wraps `LangGraphClient`
- `frontend/src/core/config/index.ts` resolves the LangGraph base URL

Root cause of the remaining 401:

- `getBackendBaseURL()` already normalized loopback hosts so browser-origin cookies stayed aligned
- `getLangGraphBaseURL()` still returned the raw `NEXT_PUBLIC_LANGGRAPH_BASE_URL`
- In local-dev, that let the browser sit on `localhost:4560` while the LangGraph client targeted `127.0.0.1:8551`
- Because cookies are host-scoped, that host mismatch was enough to lose the authenticated cookie on `threads.search`

Fix:

- normalize `NEXT_PUBLIC_LANGGRAPH_BASE_URL` through the same loopback-host alignment logic used by `getBackendBaseURL()`
- keep `credentials: "include"` in the LangGraph client fetch wrapper

Regression coverage added:

- `frontend/tests/unit/core/api/api-client.test.ts`
  - verifies `threads.search` still uses `credentials: "include"`
  - verifies loopback LangGraph base URLs are normalized to the browser host

### Verification

Pending in this workspace:

- targeted backend test(s)
- targeted frontend unit test(s)
- frontend eslint
- frontend typecheck

If any of these fail, treat the result as incomplete and do not claim the cross-origin issue is fully fixed.

---

## 2026-05-02 third-pass: backend `NameError: store is not defined` (hard blocker)

在完成 CORS / cookie 对齐后，出现了新的后端阻断（这次是 500，而不是 401）：

- `POST /api/threads/search`
- traceback 位置：`backend/app/gateway/routers/threads.py`
- 关键异常：`NameError: name 'store' is not defined`

### Root cause

`threads.py` 在一次上游同步 + 二开合并后进入了“混合状态”：

- 文件内已经改成了 Store + checkpointer 的双阶段搜索逻辑；
- 但关键变量与常量未完整接线（`store` / `checkpointer` / `THREADS_NS`）；
- 同时还丢了 `sanitize_log_param` import；
- `patch_thread` 返回段误用了不存在的 `updated` / `now` 变量。

结果是：`/api/threads/search` 命中函数体后直接抛 `NameError`，前端看到的就是 500。

### Fixes applied

文件：

- `deer-flow-main/backend/app/gateway/routers/threads.py`

修复点（最小修复，保持当前二开逻辑不回退）：

1. 补回缺失依赖与常量
   - `from __future__ import annotations`
   - `from app.gateway.utils import sanitize_log_param`
   - `THREADS_NS = ("threads",)`
2. 在 `create_thread` 中显式初始化 `store = get_store(request)`
3. 在 `search_threads` 中显式初始化：
   - `store = get_store(request)`
   - `checkpointer = get_checkpointer(request)`
4. 修正 `patch_thread` 返回数据来源：
   - 从不存在的 `updated/now` 改为 `record`（更新后重新读取）
5. 清理未使用局部变量（`get_thread_state` 内多余 `values`）

### Regression coverage

新增回归用例：

- `deer-flow-main/backend/tests/test_threads_router.py::test_search_threads_no_store_records_returns_empty_list`

该用例覆盖“store 为空 + checkpointer 可迭代”场景，验证：

- `POST /api/threads/search` 不再抛 `NameError`
- 返回 `200` 与空数组（而非 500）

### Verification results (this workspace)

已通过：

```bash
python -m ruff check app/gateway/routers/threads.py tests/test_threads_router.py
python -m pytest tests/test_threads_router.py::test_search_threads_no_store_records_returns_empty_list -q
python -m pytest tests/test_auth_middleware.py::test_cors_preflight_is_handled_before_auth tests/test_auth_middleware.py::test_protected_path_no_cookie_returns_401 -q
```

结果：

- `threads.py` 静态检查通过
- 新增 `threads/search` 回归用例通过
- 关键 auth/cors 回归用例通过

验证缺口（如需补全）：

- 当前仓库里 `tests/test_threads_router.py` 的其他旧用例与 `Paths` 的 user-scoped 签名不一致，会单独失败（与本次 `store` NameError 修复无直接因果）。
- 若要做“端到端最终确认”，需要重启本地后端进程并在浏览器再次验证 `POST /api/threads/search` 已从 500 变为 200/401（取决于是否带有效登录态）。

---

## 后续建议

- 以后做 settings dialog 这类“左侧菜单 + 右侧内容”的页面时，最好为每个 section 保留一个回归测试。
- 上游同步后，优先检查“入口是否存在但内容组件是否还在渲染树里”，这类问题很容易被 UI 视觉掩盖。
