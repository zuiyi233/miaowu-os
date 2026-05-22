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
    $envBackup = @{
        DEERFLOW_DESKTOP_BUILD = [Environment]::GetEnvironmentVariable("DEERFLOW_DESKTOP_BUILD", "Process")
        BETTER_AUTH_SECRET = [Environment]::GetEnvironmentVariable("BETTER_AUTH_SECRET", "Process")
        BETTER_AUTH_BASE_URL = [Environment]::GetEnvironmentVariable("BETTER_AUTH_BASE_URL", "Process")
        NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD", "Process")
        NEXT_PUBLIC_BACKEND_BASE_URL = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_BACKEND_BASE_URL", "Process")
        NEXT_PUBLIC_LANGGRAPH_BASE_URL = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_LANGGRAPH_BASE_URL", "Process")
        NEXT_PUBLIC_AI_ENCRYPTION_KEY = [Environment]::GetEnvironmentVariable("NEXT_PUBLIC_AI_ENCRYPTION_KEY", "Process")
        DEER_FLOW_INTERNAL_GATEWAY_BASE_URL = [Environment]::GetEnvironmentVariable("DEER_FLOW_INTERNAL_GATEWAY_BASE_URL", "Process")
        DEER_FLOW_INTERNAL_LANGGRAPH_BASE_URL = [Environment]::GetEnvironmentVariable("DEER_FLOW_INTERNAL_LANGGRAPH_BASE_URL", "Process")
    }
    $envExists = @{
        DEERFLOW_DESKTOP_BUILD = Test-Path Env:\DEERFLOW_DESKTOP_BUILD
        BETTER_AUTH_SECRET = Test-Path Env:\BETTER_AUTH_SECRET
        BETTER_AUTH_BASE_URL = Test-Path Env:\BETTER_AUTH_BASE_URL
        NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD = Test-Path Env:\NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD
        NEXT_PUBLIC_BACKEND_BASE_URL = Test-Path Env:\NEXT_PUBLIC_BACKEND_BASE_URL
        NEXT_PUBLIC_LANGGRAPH_BASE_URL = Test-Path Env:\NEXT_PUBLIC_LANGGRAPH_BASE_URL
        NEXT_PUBLIC_AI_ENCRYPTION_KEY = Test-Path Env:\NEXT_PUBLIC_AI_ENCRYPTION_KEY
        DEER_FLOW_INTERNAL_GATEWAY_BASE_URL = Test-Path Env:\DEER_FLOW_INTERNAL_GATEWAY_BASE_URL
        DEER_FLOW_INTERNAL_LANGGRAPH_BASE_URL = Test-Path Env:\DEER_FLOW_INTERNAL_LANGGRAPH_BASE_URL
    }

    try {
        $env:DEERFLOW_DESKTOP_BUILD = "1"
        $env:NEXT_PUBLIC_DEERFLOW_DESKTOP_BUILD = "1"
        $env:BETTER_AUTH_SECRET = "deerflow-desktop-local-secret"
        $env:BETTER_AUTH_BASE_URL = "http://127.0.0.1:3000"
        # Desktop runtime should proxy all /api* calls through the local frontend origin.
        # Keep NEXT_PUBLIC_* empty so Next.js rewrite rules stay active in standalone mode.
        $env:NEXT_PUBLIC_BACKEND_BASE_URL = ""
        $env:NEXT_PUBLIC_LANGGRAPH_BASE_URL = ""
        # NEXT_PUBLIC_* variables are bundled into client chunks at build time.
        # Desktop build must set this explicitly, otherwise production bundle throws
        # "[Security Error] Production environment requires NEXT_PUBLIC_AI_ENCRYPTION_KEY".
        $env:NEXT_PUBLIC_AI_ENCRYPTION_KEY = "deerflow-desktop-local-ai-encryption-key-2026"
        # Force LangGraph-compatible routes to gateway runtime in managed desktop mode.
        $env:DEER_FLOW_INTERNAL_GATEWAY_BASE_URL = "http://127.0.0.1:8001"
        $env:DEER_FLOW_INTERNAL_LANGGRAPH_BASE_URL = "http://127.0.0.1:8001/api"

        & pnpm run build
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm run build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        foreach ($envKey in $envExists.Keys) {
            if ($envExists[$envKey]) {
                [Environment]::SetEnvironmentVariable($envKey, $envBackup[$envKey], "Process")
            }
            else {
                Remove-Item "Env:$envKey" -ErrorAction SilentlyContinue
            }
        }
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
