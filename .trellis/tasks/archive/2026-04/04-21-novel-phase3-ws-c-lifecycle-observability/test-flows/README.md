# WS-C Test Flows（本阶段仅提供脚本，不执行）

## 说明

1. 本目录仅提供阶段三测试流程代码模板，不在当前任务中执行。
2. 前端流程必须在 Windows PowerShell 中执行，严禁在 WSL 处理前端依赖。
3. 默认均为 dry-run；需要执行时显式开启执行参数。

## 文件

1. `run_backend_ws_c.sh`：后端静态检查 + 定向测试流程。
2. `run_frontend_ws_c.ps1`：前端 Windows 测试流程。
3. `run_contract_e2e_ws_c.sh`：契约/E2E/幂等压测流程。
4. `ci_ws_c_template.yml`：CI 模板（默认手动触发）。

## 执行策略（后续阶段）

1. 先定向：仅跑本 WS 对应 case。
2. 再全量：定向通过后再扩展到全量。
3. 失败优先回滚到最近稳定基线。
