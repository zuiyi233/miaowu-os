[CmdletBinding()]
param(
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "start",

    [ValidateSet("single", "split")]
    [string]$View = "single"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$RunDir = Join-Path $RepoRoot ".deer-flow/local-dev"
$StateFile = Join-Path $RunDir "state.json"
$LogDir = Join-Path $RepoRoot "logs/local-dev"

$FrontendDir = Join-Path $RepoRoot "frontend"
$BackendDir = Join-Path $RepoRoot "backend"

$FrontendPort = 4560
$BackendPort = 8551

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[ OK ] $Message" -ForegroundColor Green
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrLine {
    param([string]$Message)
    Write-Host "[ERR ] $Message" -ForegroundColor Red
}

function Ensure-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Escape-SingleQuote {
    param([Parameter(Mandatory = $true)][string]$Text)
    return $Text.Replace("'", "''")
}

function Get-PortOwnerPid {
    param([Parameter(Mandatory = $true)][int]$Port)

    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $conn) {
            return [int]$conn.OwningProcess
        }
    } catch {
        # fall back to netstat
    }

    try {
        $lines = netstat -ano -p tcp
        foreach ($line in $lines) {
            $trimmed = ($line -replace "^\s+", "") -replace "\s+", " "
            $parts = $trimmed.Split(" ")
            if ($parts.Length -lt 5) {
                continue
            }

            $localAddress = $parts[1]
            $state = $parts[3]
            $pidValue = $parts[4]

            if ($state -ne "LISTENING") {
                continue
            }

            if ($localAddress -notmatch "[:\.]$Port$") {
                continue
            }

            if ($pidValue -match "^\d+$") {
                return [int]$pidValue
            }
        }
    } catch {
        return $null
    }

    return $null
}

function Wait-PortReady {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$LogFile
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $owner = Get-PortOwnerPid -Port $Port
        if ($null -ne $owner) {
            return $true
        }

        if ($Process.HasExited) {
            Write-ErrLine "$ServiceName exited before listening on port $Port."
            Show-LogTail -ServiceName $ServiceName -LogFile $LogFile
            return $false
        }

        Start-Sleep -Seconds 1
    }

    Write-ErrLine "$ServiceName did not become ready within $TimeoutSeconds seconds (port $Port)."
    Show-LogTail -ServiceName $ServiceName -LogFile $LogFile
    return $false
}

function Assert-ServiceHealthy {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$LogFile
    )

    if ($Process.HasExited) {
        Write-ErrLine "$ServiceName process exited unexpectedly."
        Show-LogTail -ServiceName $ServiceName -LogFile $LogFile
        return $false
    }

    $owner = Get-PortOwnerPid -Port $Port
    if ($null -eq $owner) {
        Write-ErrLine "$ServiceName is not listening on required port $Port."
        Show-LogTail -ServiceName $ServiceName -LogFile $LogFile
        return $false
    }

    return $true
}

function Show-LogTail {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$LogFile
    )

    if (Test-Path -LiteralPath $LogFile) {
        Write-WarnLine "Last lines from $ServiceName log: $LogFile"
        Get-Content -LiteralPath $LogFile -Tail 30 | ForEach-Object {
            Write-Host $_
        }
    } else {
        Write-WarnLine "No log file found for ${ServiceName}: $LogFile"
    }
}

function Read-State {
    if (-not (Test-Path -LiteralPath $StateFile)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Write-WarnLine "State file exists but is invalid JSON: $StateFile"
        return $null
    }
}

function Save-State {
    param([Parameter(Mandatory = $true)]$StateObject)

    Ensure-Directory -Path $RunDir
    $json = $StateObject | ConvertTo-Json -Depth 8
    Set-Content -LiteralPath $StateFile -Value $json -Encoding UTF8
}

function Remove-State {
    if (Test-Path -LiteralPath $StateFile) {
        Remove-Item -LiteralPath $StateFile -Force
    }
}

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory = $true)][int]$TargetPid,
        [switch]$Force
    )

    $args = @("/PID", "$TargetPid", "/T")
    if ($Force.IsPresent) {
        $args += "/F"
    }

    & taskkill.exe @args *> $null
}

function Stop-PidIfRunning {
    param([Parameter(Mandatory = $true)][int]$TargetPid)

    $proc = Get-Process -Id $TargetPid -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        return
    }

    Write-Info "Stopping PID $TargetPid ($($proc.ProcessName))"
    try {
        Stop-ProcessTree -TargetPid $TargetPid
    } catch {
        # try forceful termination as fallback
    }

    Start-Sleep -Milliseconds 600
    if (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) {
        Write-WarnLine "PID $TargetPid still alive, forcing termination."
        try {
            Stop-ProcessTree -TargetPid $TargetPid -Force
        } catch {
            Write-WarnLine "Failed to force stop PID ${TargetPid}: $($_.Exception.Message)"
        }
    }
}

function Stop-AllServices {
    $state = Read-State

    if ($null -ne $state -and $null -ne $state.services) {
        foreach ($svc in $state.services) {
            $svcPid = [int]$svc.pid
            Stop-PidIfRunning -TargetPid $svcPid
        }
    }

    foreach ($port in @($BackendPort, $FrontendPort)) {
        $owner = Get-PortOwnerPid -Port $port
        if ($null -ne $owner) {
            Write-WarnLine "Port $port still occupied by PID $owner. Attempting cleanup."
            Stop-PidIfRunning -TargetPid $owner
        }
    }

    Remove-State
    Write-Ok "All managed local-dev services are stopped."
}

function Assert-CommandExists {
    param([Parameter(Mandatory = $true)][string]$CommandName)

    $cmd = Get-Command -Name $CommandName -ErrorAction SilentlyContinue
    if ($null -eq $cmd) {
        throw "Required command '$CommandName' was not found in PATH."
    }
}

function New-RunnerScript {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string[]]$SetupLines,
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][string]$LogFile,
        [Parameter(Mandatory = $true)][bool]$UseTee
    )

    $runnerPath = Join-Path $RunDir "$Name-runner.ps1"
    $wdEscaped = Escape-SingleQuote -Text $WorkingDirectory
    $logEscaped = Escape-SingleQuote -Text $LogFile

    $setupBlock = ""
    if ($SetupLines.Count -gt 0) {
        $setupBlock = ($SetupLines -join [Environment]::NewLine) + [Environment]::NewLine
    }

    $execLine = if ($UseTee) {
        "$CommandLine 2>&1 | Tee-Object -FilePath '$logEscaped' -Append"
    } else {
        "$CommandLine *>> '$logEscaped'"
    }

$content = @"
Set-StrictMode -Version Latest
`$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath '$wdEscaped'
$setupBlock$execLine
exit `$LASTEXITCODE
"@

    Set-Content -LiteralPath $runnerPath -Value $content -Encoding UTF8
    return $runnerPath
}

function Start-RunnerProcess {
    param(
        [Parameter(Mandatory = $true)][string]$RunnerPath,
        [Parameter(Mandatory = $true)][bool]$SplitWindow
    )

    $args = @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass")
    if ($SplitWindow) {
        $args += "-NoExit"
    }
    $args += @("-File", $RunnerPath)

    if ($SplitWindow) {
        return Start-Process -FilePath "powershell.exe" -ArgumentList $args -PassThru
    }
    return Start-Process -FilePath "powershell.exe" -ArgumentList $args -WindowStyle Hidden -PassThru
}

function Assert-PortsFree {
    $busy = @()
    foreach ($port in @($BackendPort, $FrontendPort)) {
        $owner = Get-PortOwnerPid -Port $port
        if ($null -ne $owner) {
            $busy += [PSCustomObject]@{
                Port = $port
                Pid  = $owner
            }
        }
    }

    if ($busy.Count -gt 0) {
        Write-ErrLine "Required ports are currently occupied:"
        foreach ($entry in $busy) {
            Write-Host "  - port $($entry.Port): PID $($entry.Pid)"
        }
        throw "Cannot start services until ports are released. Run: scripts\dev-local.bat stop"
    }
}

function Print-Status {
    $state = Read-State

    Write-Host ""
    Write-Host "Local Dev Status"
    Write-Host "----------------"
    Write-Host "Backend  (port $BackendPort): PID $(Get-PortOwnerPid -Port $BackendPort)"
    Write-Host "Frontend (port $FrontendPort): PID $(Get-PortOwnerPid -Port $FrontendPort)"

    if ($null -eq $state) {
        Write-WarnLine "No state file found: $StateFile"
        return
    }

    Write-Host ""
    Write-Host "Managed state:"
    Write-Host "  started_at: $($state.started_at)"
    Write-Host "  view:       $($state.view)"
    Write-Host "  logs:       $($state.log_dir)"
    if ($null -ne $state.services) {
        foreach ($svc in $state.services) {
            $svcPid = [int]$svc.pid
            $alive = [bool](Get-Process -Id $svcPid -ErrorAction SilentlyContinue)
            Write-Host "  - $($svc.name): pid=$svcPid, alive=$alive, port=$($svc.port), log=$($svc.log)"
        }
    }
}

function Start-AllServices {
    Assert-CommandExists -CommandName "pnpm"
    Assert-CommandExists -CommandName "uv"

    if (-not (Test-Path -LiteralPath $FrontendDir)) {
        throw "Frontend directory not found: $FrontendDir"
    }
    if (-not (Test-Path -LiteralPath $BackendDir)) {
        throw "Backend directory not found: $BackendDir"
    }

    Ensure-Directory -Path $RunDir
    Ensure-Directory -Path $LogDir
    Assert-PortsFree

    $splitWindow = $View -eq "split"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backendLog = Join-Path $LogDir "backend-$timestamp.log"
    $frontendLog = Join-Path $LogDir "frontend-$timestamp.log"

    Write-Info "Starting backend (Gateway API) on port $BackendPort ..."
    $backendRunner = New-RunnerScript `
        -Name "backend" `
        -WorkingDirectory $BackendDir `
        -SetupLines @(
            '$env:PYTHONPATH = "."',
            '$env:GATEWAY_PORT = "8551"',
            '$env:CORS_ORIGINS = "http://localhost:4560,http://127.0.0.1:4560"'
        ) `
        -CommandLine "& uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8551 --reload --reload-include '*.yaml' --reload-include '.env'" `
        -LogFile $backendLog `
        -UseTee $splitWindow
    $backendProc = Start-RunnerProcess -RunnerPath $backendRunner -SplitWindow $splitWindow

    if (-not (Wait-PortReady -Port $BackendPort -TimeoutSeconds 45 -Process $backendProc -ServiceName "Backend" -LogFile $backendLog)) {
        Stop-PidIfRunning -TargetPid $backendProc.Id
        throw "Backend startup failed."
    }
    Write-Ok "Backend started successfully at http://localhost:$BackendPort"

    Write-Info "Starting frontend on port $FrontendPort ..."
    $frontendRunner = New-RunnerScript `
        -Name "frontend" `
        -WorkingDirectory $FrontendDir `
        -SetupLines @(
            '$env:NEXT_PUBLIC_BACKEND_BASE_URL = "http://localhost:8551"',
            '$env:DEER_FLOW_INTERNAL_GATEWAY_BASE_URL = "http://127.0.0.1:8551"'
        ) `
        -CommandLine "& pnpm run dev -- --port 4560" `
        -LogFile $frontendLog `
        -UseTee $splitWindow
    $frontendProc = Start-RunnerProcess -RunnerPath $frontendRunner -SplitWindow $splitWindow

    if (-not (Wait-PortReady -Port $FrontendPort -TimeoutSeconds 120 -Process $frontendProc -ServiceName "Frontend" -LogFile $frontendLog)) {
        Stop-PidIfRunning -TargetPid $frontendProc.Id
        Stop-PidIfRunning -TargetPid $backendProc.Id
        throw "Frontend startup failed."
    }
    Write-Ok "Frontend started successfully at http://localhost:$FrontendPort"

    # Ensure both processes remain healthy after initial readiness.
    Start-Sleep -Seconds 2
    if (-not (Assert-ServiceHealthy -Process $backendProc -Port $BackendPort -ServiceName "Backend" -LogFile $backendLog)) {
        Stop-PidIfRunning -TargetPid $frontendProc.Id
        Stop-PidIfRunning -TargetPid $backendProc.Id
        throw "Backend became unhealthy shortly after startup."
    }
    if (-not (Assert-ServiceHealthy -Process $frontendProc -Port $FrontendPort -ServiceName "Frontend" -LogFile $frontendLog)) {
        Stop-PidIfRunning -TargetPid $frontendProc.Id
        Stop-PidIfRunning -TargetPid $backendProc.Id
        throw "Frontend became unhealthy shortly after startup."
    }

    $state = [ordered]@{
        version    = 1
        started_at = (Get-Date).ToString("o")
        view       = $View
        log_dir    = $LogDir
        services   = @(
            [ordered]@{
                name   = "backend"
                pid    = $backendProc.Id
                port   = $BackendPort
                runner = $backendRunner
                log    = $backendLog
            },
            [ordered]@{
                name   = "frontend"
                pid    = $frontendProc.Id
                port   = $FrontendPort
                runner = $frontendRunner
                log    = $frontendLog
            }
        )
    }
    Save-State -StateObject $state

    Write-Host ""
    Write-Ok "Local development services are up."
    Write-Host "  Frontend: http://localhost:$FrontendPort"
    Write-Host "  Backend : http://localhost:$BackendPort"
    Write-Host "  Logs    : $LogDir"
    Write-Host "  Status  : scripts\dev-local.bat status"
    Write-Host "  Stop    : scripts\dev-local.bat stop"
    if ($splitWindow) {
        Write-Host "  View    : running in split PowerShell windows"
    } else {
        Write-Host "  View    : running in background (single terminal mode)"
    }
}

try {
    switch ($Action) {
        "stop" {
            Stop-AllServices
            exit 0
        }
        "status" {
            Print-Status
            exit 0
        }
        "restart" {
            Stop-AllServices
            Start-AllServices
            exit 0
        }
        "start" {
            Start-AllServices
            exit 0
        }
        default {
            throw "Unsupported action: $Action"
        }
    }
} catch {
    Write-ErrLine $_.Exception.Message
    exit 1
}
