$ErrorActionPreference = 'Stop'

$FrontendRoot = 'D:\miaowu-os\deer-flow-main\frontend'
Set-Location $FrontendRoot

Write-Host '[phase3][frontend] lint'
pnpm exec eslint src tests

Write-Host '[phase3][frontend] typecheck'
pnpm exec tsc --noEmit

Write-Host '[phase3][frontend] targeted unit tests'
pnpm vitest run `
  tests/unit/core/novel/phase2-status.test.ts `
  tests/unit/core/novel/novel-api-finalize-gate.test.ts `
  tests/unit/core/novel/quality-report-panel-state.test.ts

Write-Host '[phase3][frontend] dialogue-action focused tests (to be added in implementation)'
# Example placeholder:
# pnpm vitest run tests/unit/core/novel/action-router.test.ts

Write-Host '[phase3][frontend] done'
