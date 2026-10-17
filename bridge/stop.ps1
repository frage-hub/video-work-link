$serverPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "server.mjs"))

$matches = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -and
    $_.CommandLine.IndexOf($serverPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

if (-not $matches) {
    Write-Output "Codex desktop bridge is not running."
    exit 0
}

$matches | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Output "Stopped Codex desktop bridge."
