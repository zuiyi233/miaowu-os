[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceFile = Join-Path $ScriptDir "dev-local-gui-launcher.cs"
$OutputFile = Join-Path $ScriptDir "dev-local-gui.exe"
$Compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (-not (Test-Path -LiteralPath $Compiler)) {
    throw "csc compiler not found: $Compiler"
}

if (-not (Test-Path -LiteralPath $SourceFile)) {
    throw "source file not found: $SourceFile"
}

& $Compiler `
    /nologo `
    /target:winexe `
    /out:$OutputFile `
    /reference:System.Windows.Forms.dll `
    /reference:System.Drawing.dll `
    $SourceFile

if ($LASTEXITCODE -ne 0) {
    throw "csc build failed with exit code $LASTEXITCODE"
}

Write-Host "Built executable: $OutputFile"
