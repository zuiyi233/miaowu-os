# 设计：官方上游增量同步候选分批策略

## 目标

把官方 `bytedance/deer-flow` 相对 `c810e9f8` 的新增更新拆成若干风险可控的增量批次，为后续真正同步提供执行顺序，而不是一次性全量合并。

## 设计原则

1. 本地二开优先，尤其是多账号/用户隔离、MCP 权限过滤、小说链路、8551 local-dev 契约。
2. 优先吸收“低交叉、低回归、强稳定性收益”的上游修复。
3. 高交叉文件只做专题批次，不与低风险批次混合。
4. 同步前必须打备份分支和 bundle 备份。
5. 每一批都需要独立测试和冲突记录。

## 分批策略

### 批次 1：低风险基础修复

- runtime persistence / JSONL I/O / cancel / reconnect
- channels manager 修复
- 前端 clipboard / think / mermaid / copy 类修复
- tools sync wrapper / task-tool timeout cleanup

特征：
- 与本地多账号改造文件重叠极少
- 可通过定向 patch 或逐提交应用完成

### 批次 2：安全与消息契约

- MCP config secret masking
- gateway `normalize_input` 保留 `additional_kwargs`
- internal gateway token worker 共享

特征：
- 安全收益高
- 会触碰 user-scoped MCP 和消息附件链路
- 必须在有回归测试前提下做

### 批次 3：线程交互修复

- `hooks.ts` 相关三项上游修复

特征：
- 用户感知强
- 但与本地小说/新线程/进度 toast/消息合并逻辑高度交错
- 必须手工三方裁决

### 批次 4：专题验证

- MCP session pooling
- ToolOutputBudgetMiddleware
- static website demo mode
- patched MiMo reasoning support

特征：
- 改动大、触达核心执行链或鉴权模型
- 更适合单独立项、单独分支验证

## 关键验证

每批同步后至少执行：

- 后端定向 `pytest`
- 前端 `pnpm tsc --noEmit`
- 与本批主题相关的最小功能回归

批次 2/3 额外需要：

- 多用户设置页面回归
- MCP 配置增删改查回归
- 附件上传/消息展示回归
- 新线程创建、侧栏切换、消息恢复回归

## 回滚设计

- 每批开始前创建独立备份分支
- 保留 bundle 级备份
- 冲突清单单独存档
- 若某批验证失败，不向下一批推进
