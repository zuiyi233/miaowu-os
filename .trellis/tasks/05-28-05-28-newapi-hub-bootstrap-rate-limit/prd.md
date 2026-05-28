# NewAPI Hub bootstrap 用户级限流与 Miaowu 分组同步退避

## Requirement

Windows Electron 客户端与网页端都通过集中式 Miaowu 后端访问 NewAPI。当前 NewAPI `/api/hub/session/bootstrap` 使用 IP 级 `CriticalRateLimit`，导致多个用户或单个多分组同步共享同一出口 IP 配额并触发 HTTP 429。

## Acceptance Criteria

- NewAPI `/api/hub/session/bootstrap` 使用专用 Hub bootstrap 限流，不再占用 OAuth、支付、重置密码等 critical 限流桶。
- Hub bootstrap 限流优先按 NewAPI 用户 ID 计数；Authorization 无效或无法解析用户时回退到客户端 IP。
- Hub bootstrap 429 保持 HTTP 429，并尽量带 `Retry-After` 供调用方提示。
- Miaowu 分组同步按组串行退避；遇到 NewAPI 429 后停止继续撞限流，保留已成功分组，后续分组返回明确限流错误。
- 前端同步弹窗能显示明确限流文案，不泄露 NewAPI system token、Hub token、OIDC token 或 `sk-`。
- 相关 NewAPI 单测与 Miaowu 后端契约测试通过；无法完成的运行态部署验证必须明确说明。

## Constraints

- 不清 Redis，不绕过现有限流状态。
- 不放宽 NewAPI 全局 `CRITICAL_RATE_LIMIT`。
- 不打印或持久化任何密钥、token、OAuth code。
- 修改 Miaowu 时遵守 local-dev 后端 `8551`、前端 `4560` 的约定。
