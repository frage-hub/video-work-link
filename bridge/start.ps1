$ErrorActionPreference = "Stop"

$existing = Get-NetTCPConnection -LocalPort 17321 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Write-Output "Codex desktop bridge is already running on port 17321."
    exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
$server = Join-Path $PSScriptRoot "server.mjs"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logRoot = Join-Path $env:LOCALAPPDATA "VideoWorkLink"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$standardOut = Join-Path $logRoot "bridge.out.log"
$standardError = Join-Path $logRoot "bridge.err.log"

Start-Process -FilePath $node -ArgumentList @("`"$server`"") -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $standardOut -RedirectStandardError $standardError

$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 150
    try {
        $status = Invoke-RestMethod -Uri "http://127.0.0.1:17321/status" -TimeoutSec 1
        $ready = $true
        break
    } catch {
        # The server may still be starting.
    }
}

if (-not $ready) {
    $detail = if (Test-Path -LiteralPath $standardError) {
        Get-Content -LiteralPath $standardError -Raw
    } else {
        "No error log was created."
    }
    throw "Codex desktop bridge did not start. $detail"
}
Write-Output "Started Codex desktop bridge on http://127.0.0.1:17321"
