$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionSource = Join-Path $repoRoot "extension"
$bridgeSource = Join-Path $repoRoot "bridge"
$readmeSource = Join-Path $repoRoot "README.md"
$licenseSource = Join-Path $repoRoot "LICENSE"
$installCmdSource = Join-Path $repoRoot "INSTALL.cmd"
$installScriptSource = Join-Path $repoRoot "INSTALL.ps1"
$installGuideSource = Join-Path $repoRoot "INSTALL.md"
$researchSource = Join-Path $repoRoot "docs\github-research.md"
$customAiGuideSource = Join-Path $repoRoot "docs\custom-ai-integration.md"
$releaseRoot = Join-Path $repoRoot "release"
$manifestPath = Join-Path $extensionSource "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Extension manifest was not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$manifest.version
$stagingRoot = Join-Path $releaseRoot ".staging-$version-$PID"
$fullStage = Join-Path $stagingRoot "full"

$resolvedRelease = [IO.Path]::GetFullPath($releaseRoot)
$resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)
$releasePrefix = $resolvedRelease.TrimEnd(
    [IO.Path]::DirectorySeparatorChar,
    [IO.Path]::AltDirectorySeparatorChar
) + [IO.Path]::DirectorySeparatorChar

if (-not $resolvedStaging.StartsWith(
    $releasePrefix,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "Refusing to use a staging path outside the release directory."
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $fullStage -Force | Out-Null

try {
    Copy-Item -LiteralPath $extensionSource -Destination $fullStage -Recurse
    Copy-Item -LiteralPath $bridgeSource -Destination $fullStage -Recurse
    Copy-Item -LiteralPath $readmeSource -Destination $fullStage
    Copy-Item -LiteralPath $licenseSource -Destination $fullStage
    Copy-Item -LiteralPath $installCmdSource -Destination $fullStage
    Copy-Item -LiteralPath $installScriptSource -Destination $fullStage
    Copy-Item -LiteralPath $installGuideSource -Destination $fullStage
    $docsStage = Join-Path $fullStage "docs"
    New-Item -ItemType Directory -Path $docsStage -Force | Out-Null
    Copy-Item -LiteralPath $researchSource -Destination $docsStage
    Copy-Item -LiteralPath $customAiGuideSource -Destination $docsStage

    $fullZip = Join-Path $releaseRoot "video-work-link-v$version.zip"
    $legacyExtensionZip = Join-Path $releaseRoot "video-work-link-extension-v$version.zip"
    $legacyBridgeZip = Join-Path $releaseRoot "video-work-link-bridge-v$version.zip"

    Compress-Archive -Path (Join-Path $fullStage "*") -DestinationPath $fullZip -Force

    foreach ($legacyZip in @($legacyExtensionZip, $legacyBridgeZip)) {
        if (Test-Path -LiteralPath $legacyZip) {
            Remove-Item -LiteralPath $legacyZip -Force
        }
    }

    Write-Output "Created single-file installer package:"
    Write-Output $fullZip
} finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}
