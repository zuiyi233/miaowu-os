param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host "[desktop-frontend] $Message"
}

$projectRootResolved = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontendRoot = Join-Path $projectRootResolved "frontend"
$exportScript = Join-Path $projectRootResolved "scripts/export-desktop-runtime.ps1"

if (-not (Test-Path -LiteralPath $frontendRoot)) {
    throw "Frontend directory not found: $frontendRoot"
}
if (-not (Test-Path -LiteralPath $exportScript)) {
    throw "Export script not found: $exportScript"
}

Write-Info "ProjectRoot: $projectRootResolved"
Write-Info "Running desktop frontend build ..."
Push-Location $frontendRoot
try {
    $env:DEERFLOW_DESKTOP_BUILD = "1"
    & pnpm run build
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm run build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Info "Build completed. Exporting runtime ..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $exportScript -ProjectRoot $projectRootResolved
if ($LASTEXITCODE -ne 0) {
    throw "export-desktop-runtime.ps1 failed with exit code $LASTEXITCODE"
}

Write-Info "Desktop frontend runtime is ready under .desktop-runtime/frontend"
