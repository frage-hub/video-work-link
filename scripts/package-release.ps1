$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionSource = Join-Path $repoRoot "extension"
$bridgeSource = Join-Path $repoRoot "bridge"
$readmeSource = Join-Path $repoRoot "README.md"
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
$extensionStage = Join-Path $stagingRoot "extension"
$bridgeStage = Join-Path $stagingRoot "bridge"

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
New-Item -ItemType Directory -Path $extensionStage -Force | Out-Null
New-Item -ItemType Directory -Path $bridgeStage -Force | Out-Null

try {
    Copy-Item -LiteralPath $extensionSource -Destination $fullStage -Recurse
    Copy-Item -LiteralPath $bridgeSource -Destination $fullStage -Recurse
    Copy-Item -LiteralPath $readmeSource -Destination $fullStage
    $docsStage = Join-Path $fullStage "docs"
    New-Item -ItemType Directory -Path $docsStage -Force | Out-Null
    Copy-Item -LiteralPath $researchSource -Destination $docsStage
    Copy-Item -LiteralPath $customAiGuideSource -Destination $docsStage

    Copy-Item -Path (Join-Path $extensionSource "*") -Destination $extensionStage -Recurse
    Copy-Item -Path (Join-Path $bridgeSource "*") -Destination $bridgeStage -Recurse

    $fullZip = Join-Path $releaseRoot "video-work-link-v$version.zip"
    $extensionZip = Join-Path $releaseRoot "video-work-link-extension-v$version.zip"
    $bridgeZip = Join-Path $releaseRoot "video-work-link-bridge-v$version.zip"

    Compress-Archive -Path (Join-Path $fullStage "*") -DestinationPath $fullZip -Force
    Compress-Archive -Path (Join-Path $extensionStage "*") -DestinationPath $extensionZip -Force
    Compress-Archive -Path (Join-Path $bridgeStage "*") -DestinationPath $bridgeZip -Force

    Write-Output "Created:"
    Write-Output $fullZip
    Write-Output $extensionZip
    Write-Output $bridgeZip
} finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}
