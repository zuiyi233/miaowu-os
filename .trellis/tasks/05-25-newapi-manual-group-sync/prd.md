# NewAPI 手动分组同步与密钥选择流程

## Goal

让 Miaowu-OS 的 NewAPI 模型/密钥同步从“后台尝试自动全量猜分组”改为“自动发现 + 用户可控选择 + 指定分组创建/同步密钥”的可靠流程。用户在本地或正式环境中有多个 NewAPI 分组时，可以明确选择要同步的分组，并把每个选中分组保存为独立的 managed AI provider。

## Background

用户验证发现：NewAPI 本地实际存在多个分组，但 Miaowu-OS 设置页仍只能稳定展示一个分组，自动同步无法可靠覆盖“已创建密钥但分组未被完整读取”的场景。

参考项目 `参考项目/all-api-hub-main` 的结论：

- `resolveSub2ApiQuickCreateResolution()` 会先读取上游可用分组。
- 如果只有一个分组，自动使用该分组创建 token。
- 如果有多个分组，返回 `selection_required`，前台打开分组选择 UI。
- `AddTokenDialog` 通过 `allowedGroups` 限制用户只能选择真实可用分组。
- 它不在多分组场景中后台猜测默认分组。

因此 Miaowu-OS 应采用同类产品路径：自动同步作为增强能力保留，但用户可手动选择分组并触发指定分组 token/bootstrap。

## Confirmed Facts

- 本地 Gateway 契约仍是 `http://127.0.0.1:8551`，禁止把 `8001` 当本地默认。
- NewAPI 本地服务示例为 `http://127.0.0.1:3000`。
- 当前前端已有设置页按钮“同步 NewAPI 分组/密钥”，但它主要打开 OAuth 登录窗口并等待刷新。
- 当前后端已有 NewAPI OAuth callback、Hub bootstrap、多分组 provider 持久化能力雏形。
- 当前后端已有 `/api/user/newapi-provider-groups`，但它返回的是 server/env managed group，不是“当前登录 NewAPI 用户可选择同步的 OAuth/Hub 分组目录”。
- 当前容器 `miaowu-os-gateway-novel-agent-convergence-smoke` 退出，日志显示缺少未同步的 persistence model 依赖；实现前需要恢复 8551 运行态。
- 不能泄露任何 `sk-` key、system access token、OAuth code/token、Hub token。
- 浏览器由用户自行测试，但本任务需要提供后端 health/smoke 和可验证日志。

## Requirements

1. 分组发现
   - 后端提供当前登录用户的 NewAPI 可同步分组目录。
   - 优先从 NewAPI Hub group catalog 获取分组。
   - 如果 Hub group catalog 不完整，允许用户手动输入分组名作为兜底。
   - 返回字段必须脱敏：分组名、展示名、模型数、同步状态、是否已有 provider/key、错误信息；不得返回 key/token。

2. 手动同步
   - 后端提供“按指定分组同步”的 API。
   - 输入为用户选择的分组列表或单个手动分组名。
   - 后端为每个分组调用 NewAPI Hub bootstrap 创建或复用 group token。
   - 后端用该 group token 拉 `/v1/models`，保存为独立 managed provider。
   - 0 模型分组可以保存为 `empty` 状态，但不能被误判为普通可用模型供应商。

3. 前端交互
   - AI 服务商页点击“同步 NewAPI 分组/密钥”后，打开一个可控的分组选择 UI。
   - UI 展示已发现分组、模型数、是否已同步、同步状态。
   - 如果只发现一个分组，默认选中。
   - 如果发现多个分组，用户勾选后再同步。
   - 如果发现失败或缺分组，允许用户输入分组名手动同步。
   - 同步完成后刷新 `/api/user/ai-settings`，展示多个 NewAPI managed provider。

4. 保存与运行时正确性
   - 前端保存 AI settings 时必须 round-trip `model_groups`。
   - 后端保存 managed provider 时保留 `managed_by`、`managed_group`、`model_groups`、`model_sync_status`、`model_sync_error`。
   - 已有的 env fallback 不能覆盖 OAuth/Hub 同步出来的 per-user NewAPI providers。

5. 错误与日志
   - 登录成功但 NewAPI 分组同步失败不能静默伪装成完整成功。
   - 手动分组同步失败要返回分组级错误，其他成功分组仍可保存。
   - 日志只输出 user_id、分组名、模型数、状态、has_key，不输出任何 secret。

6. 运行态恢复
   - 本地实现完成后，恢复 `127.0.0.1:8551/health`。
   - 若容器内源码不是 bind mount，需重建镜像或完整同步依赖，不能只热拷贝部分文件造成缺模块。

## Acceptance Criteria

- [ ] 用户能在 AI 服务商页看到 NewAPI 分组选择 UI。
- [ ] 用户能选择 `default`、`vip` 等分组并触发同步。
- [ ] 同步后 `/api/user/ai-settings` 返回多个 `managed_by=newapi` provider，每个 provider 对应一个 `managed_group`。
- [ ] 用户手动输入一个分组名也能触发该分组同步；失败时返回明确错误。
- [ ] 没有模型的分组显示为 `empty`，不作为普通可用默认供应商。
- [ ] `model_groups` 在 GET -> PUT -> GET 后不丢失。
- [ ] 后端日志可用于判断当前浏览器 session 对应 user_id、返回 provider 数量、NewAPI managed groups。
- [ ] 不在 API 响应、日志、测试输出、文档中暴露真实 `sk-` key 或 token。
- [ ] `http://127.0.0.1:8551/health` 本地 smoke 通过。
- [ ] 后端目标测试和 ruff 通过。
- [ ] 前端 typecheck 通过。

## Out of Scope

- 不重做 NewAPI 官方/上游权限体系。
- 不在浏览器暴露真实 NewAPI key。
- 不实现完整 NewAPI 管理后台 token 列表/删除/额度管理。
- 不调整小说 Author Control Station 主功能。
- 不把 NewAPI balance/quota 展示彻底重做为完整账单系统；本任务只避免假数据和错误同步状态。

## Open Questions

- 无阻塞问题。推荐实现策略：后端先提供分组目录与指定分组同步 API，前端再把现有“一键 OAuth 同步”按钮升级为“打开分组选择与同步面板”。

