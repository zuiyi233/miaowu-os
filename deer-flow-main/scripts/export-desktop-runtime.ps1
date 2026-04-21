param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [switch]$SkipFrontendCopy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host "[desktop-runtime] $Message"
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Hint
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Missing required path: $Path`n$Hint"
    }
}

$projectRootResolved = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontendRoot = Join-Path $projectRootResolved "frontend"
$backendRoot = Join-Path $projectRootResolved "backend"
$runtimeRoot = Join-Path $projectRootResolved ".desktop-runtime"
$frontendRuntimeRoot = Join-Path $runtimeRoot "frontend"
$manifestPath = Join-Path $runtimeRoot "manifest.json"

$standaloneSource = Join-Path $frontendRoot ".next/standalone"
$staticSource = Join-Path $frontendRoot ".next/static"
$publicSource = Join-Path $frontendRoot "public"
$frontendPackageJson = Join-Path $frontendRoot "package.json"
$backendExecutable = Join-Path $runtimeRoot "backend/deerflow-gateway/deerflow-gateway.exe"
$backendMakefile = Join-Path $backendRoot "Makefile"

Assert-PathExists -Path $frontendRoot -Hint "Frontend directory was not found under ProjectRoot."
if (-not (Test-Path -LiteralPath $runtimeRoot)) {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
}

if (-not $SkipFrontendCopy) {
    Assert-PathExists -Path $standaloneSource -Hint "Standalone build is missing. Please run 'pnpm --dir frontend run build:desktop' first."
    Assert-PathExists -Path $staticSource -Hint "Static assets are missing. Please run 'pnpm --dir frontend run build:desktop' first."
    Assert-PathExists -Path $publicSource -Hint "Public assets directory is missing."
    Assert-PathExists -Path $frontendPackageJson -Hint "Frontend package.json is missing."

    Write-Info "Exporting frontend desktop runtime to: $frontendRuntimeRoot"
    if (Test-Path -LiteralPath $frontendRuntimeRoot) {
        Remove-Item -LiteralPath $frontendRuntimeRoot -Recurse -Force
    }

    New-Item -ItemType Directory -Path (Join-Path $frontendRuntimeRoot ".next") -Force | Out-Null
    Copy-Item -LiteralPath $standaloneSource -Destination (Join-Path $frontendRuntimeRoot ".next") -Recurse -Force
    Copy-Item -LiteralPath $staticSource -Destination (Join-Path $frontendRuntimeRoot ".next") -Recurse -Force
    Copy-Item -LiteralPath $publicSource -Destination $frontendRuntimeRoot -Recurse -Force
    Copy-Item -LiteralPath $frontendPackageJson -Destination $frontendRuntimeRoot -Force

    Write-Info "Frontend export finished."
    Write-Info " - frontend/.next/standalone"
    Write-Info " - frontend/.next/static"
    Write-Info " - frontend/public"
    Write-Info " - frontend/package.json"
}

if (-not (Test-Path -LiteralPath $backendExecutable)) {
    Assert-PathExists -Path $backendMakefile -Hint "Backend Makefile is missing; cannot build source-mode runtime manifest fallback."
}

$gatewayService = if (Test-Path -LiteralPath $backendExecutable) {
    Write-Info "Gateway runtime mode: packaged executable"
    @{
        cwd = "."
        primary = @{
            program = "backend/deerflow-gateway/deerflow-gateway.exe"
            args = @()
        }
        health = @{
            host = "127.0.0.1"
            port = 8001
            timeout_sec = 60
        }
    }
}
else {
    Write-Info "Gateway runtime mode: source fallback (make gateway / uvicorn)"
    @{
        cwd = "../backend"
        primary = @{
            program = "make"
            args = @("gateway")
        }
        fallback = @{
            program = "uv"
            args = @(
                "run",
                "uvicorn",
                "app.gateway.app:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8001"
            )
        }
        health = @{
            host = "127.0.0.1"
            port = 8001
            timeout_sec = 60
        }
    }
}

$manifest = @{
    window_url = "http://127.0.0.1:3000"
    services = @{
        gateway = $gatewayService
        frontend = @{
            cwd = "."
            primary = @{
                program = "node"
                args = @("frontend/.next/standalone/server.js")
            }
            health = @{
                host = "127.0.0.1"
                port = 3000
                timeout_sec = 60
            }
        }
    }
}

$manifestJson = $manifest | ConvertTo-Json -Depth 10
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
Write-Info "Manifest updated: $manifestPath"
