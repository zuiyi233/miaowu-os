param(
    [string]$FrontendBaseUrl = "https://xs.miaowu.bond",
    [string]$GatewayBaseUrl = "https://xs.miaowu.bond",
    [string]$NodeName = "xs",
    [switch]$Help
)

if ($Help) {
    @"
Miaowu v1 multi-region smoke check.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-miaowu-multiregion.ps1 `
    -FrontendBaseUrl https://xs.miaowu.bond `
    -GatewayBaseUrl https://xs.miaowu.bond `
    -NodeName xs

This script performs unauthenticated HTTP checks only. OIDC login, cross-user
authorization, media lifecycle, and long-running stream checks still require
manual or authenticated smoke steps from docs/MIAOWU_V1_MULTI_REGION_ROLLOUT.md.
"@
    exit 0
}

$ErrorActionPreference = "Stop"

function Normalize-BaseUrl {
    param([string]$Url)
    return $Url.Trim().TrimEnd("/")
}

function Assert-HttpOk {
    param(
        [string]$Name,
        [string]$Url,
        [int[]]$ExpectedStatus = @(200)
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 5
        $status = [int]$response.StatusCode
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $status = [int]$_.Exception.Response.StatusCode
        } else {
            throw "[$NodeName] $Name failed: $($_.Exception.Message)"
        }
    }

    if ($ExpectedStatus -notcontains $status) {
        throw "[$NodeName] $Name expected HTTP $($ExpectedStatus -join '/') but got $status at $Url"
    }

    Write-Host "[$NodeName] OK $Name -> HTTP $status"
}

$frontend = Normalize-BaseUrl $FrontendBaseUrl
$gateway = Normalize-BaseUrl $GatewayBaseUrl

Assert-HttpOk -Name "gateway health" -Url "$gateway/health"
Assert-HttpOk -Name "frontend root" -Url "$frontend/"
Assert-HttpOk -Name "auth setup status" -Url "$gateway/api/v1/auth/setup-status"

# Without cookies this endpoint should reject, which proves it is not public.
Assert-HttpOk -Name "auth me requires session" -Url "$gateway/api/v1/auth/me" -ExpectedStatus @(401)

Write-Host "[$NodeName] unauthenticated smoke passed."
Write-Host "[$NodeName] continue with authenticated OIDC, novel, media, stream, and cross-node smoke from docs/MIAOWU_V1_MULTI_REGION_ROLLOUT.md."
