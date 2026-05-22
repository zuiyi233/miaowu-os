# codex-continue-novel.ps1
# powershell -ExecutionPolicy Bypass -File .\codex-continue-novel.ps1

$followUp = "使用novel-control-station技能继续小说的疯狂创作。如果整本小说已经完成，而不是当前章节完成，请直接回复AllNovelDone"
$logFile = ".\codex-continue.log"
$projectRoot = "__PROJECT_ROOT__"

function Log($msg) {
    $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$time] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

function Write-CommandOutput($lines) {
    foreach ($line in @($lines)) {
        if ($null -eq $line) {
            continue
        }

        $text = [string]$line
        Write-Host $text
        Add-Content -Path $logFile -Value $text
    }
}

function Test-AllNovelDone($lines) {
    foreach ($line in @($lines)) {
        if ([string]$line -match '^\s*AllNovelDone\s*$') {
            return $true
        }
    }

    return $false
}

Log "开始恢复最后一次会话"

while ($true) {
    Set-Location -LiteralPath $projectRoot
    $output = & codex exec resume --last $followUp --skip-git-repo-check 2>&1
    $code = $LASTEXITCODE
    Write-CommandOutput $output

    if (Test-AllNovelDone $output) {
        Log "收到 AllNovelDone，整本小说已完成，停止脚本"
        break
    }

    if ($code -eq 0) {
        Log "会话正常结束"
        continue
    }

    Log "检测到异常退出，退出码: $code，准备自动继续"
    Start-Sleep -Seconds 2
}
