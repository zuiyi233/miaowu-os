param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path,
    [string]$ListenHost = "127.0.0.1",
    [int]$Port = 8001,
    [int]$HealthTimeoutSeconds = 30,
    [int]$ProbeIntervalMilliseconds = 1000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host "[desktop-backend] $Message"
}

function Stop-ProcessTreeSafe {
    param([Parameter(Mandatory = $true)][int]$TargetPid)

    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        return
    }

    try {
        Stop-Process -Id $TargetPid -Force -ErrorAction Stop
    }
    catch {
        Write-Warning "Failed to stop process ${TargetPid}: $($_.Exception.Message)"
    }
}

$projectRootResolved = (Resolve-Path -LiteralPath $ProjectRoot).Path
$backendRoot = Join-Path $projectRootResolved "backend"
$specPath = Join-Path $backendRoot "desktop/pyinstaller.spec"
$distRoot = Join-Path $projectRootResolved ".desktop-runtime/backend"
$exePath = Join-Path $distRoot "deerflow-gateway/deerflow-gateway.exe"
$exportScript = Join-Path $projectRootResolved "scripts/export-desktop-runtime.ps1"

if (-not (Test-Path -LiteralPath $backendRoot)) {
    throw "Backend directory not found: $backendRoot"
}
if (-not (Test-Path -LiteralPath $specPath)) {
    throw "PyInstaller spec file not found: $specPath"
}
if ($HealthTimeoutSeconds -lt 1) {
    throw "HealthTimeoutSeconds must be >= 1"
}

Write-Info "ProjectRoot: $projectRootResolved"
Write-Info "Running pyinstaller build ..."
Push-Location $backendRoot
try {
    & uv run pyinstaller --noconfirm --clean $specPath
    if ($LASTEXITCODE -ne 0) {
        throw "pyinstaller build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Expected executable not found: $exePath"
}

Write-Info "Build output: $exePath"
Write-Info "Starting gateway executable for smoke check ..."
$proc = Start-Process -FilePath $exePath -PassThru

$deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
$healthUrl = "http://${ListenHost}:$Port/health"
$healthy = $false
$lastError = $null

try {
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            throw "Gateway process exited unexpectedly with code $($proc.ExitCode)."
        }

        try {
            $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                $healthy = $true
                break
            }
            $lastError = "Unexpected status code: $($response.StatusCode)"
        }
        catch {
            $lastError = $_.Exception.Message
        }

        Start-Sleep -Milliseconds $ProbeIntervalMilliseconds
    }

    if (-not $healthy) {
        throw "Health check timed out after ${HealthTimeoutSeconds}s. Last error: $lastError"
    }

    Write-Info "Smoke check passed: $healthUrl"
}
finally {
    if ($null -ne $proc) {
        Stop-ProcessTreeSafe -TargetPid $proc.Id
    }
}

if (Test-Path -LiteralPath $exportScript) {
    Write-Info "Refreshing desktop runtime manifest ..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File $exportScript -ProjectRoot $projectRootResolved -SkipFrontendCopy
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "export-desktop-runtime.ps1 exited with code $LASTEXITCODE"
    }
}
