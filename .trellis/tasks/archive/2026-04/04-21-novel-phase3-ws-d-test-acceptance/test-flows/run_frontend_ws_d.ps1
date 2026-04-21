param(
  [switch]
  $Execute
)

$ErrorActionPreference = "Stop"
$WsTag = "WS-D"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\.."))
$FrontendDir = Join-Path $RepoRoot "deer-flow-main\frontend"

Write-Host "[$WsTag] 前端测试流程脚本（仅 Windows PowerShell，禁止在 WSL 操作前端依赖）"

$Commands = @(
  "Set-Location -LiteralPath \"$FrontendDir\"",
  "pnpm run lint",
  "pnpm run typecheck",
  "pnpm exec vitest run --passWithNoTests novel-phase3-ws_d"
)

if (-not $Execute) {
  Write-Host "[$WsTag] DRY-RUN 模式（默认）：仅展示命令，不执行。"
  $Commands | ForEach-Object { Write-Host "[DRY-RUN][$WsTag] $_" }
  exit 0
}

foreach ($Command in $Commands) {
  Write-Host "[EXEC][$WsTag] $Command"
  Invoke-Expression $Command
}

Write-Host "[$WsTag] 前端流程执行完成。"
