param(
    [switch]$SkipBridge,
    [switch]$SkipOpen,
    [switch]$SkipShortcut
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$extensionDirectory = Join-Path $root "extension"
$extensionId = "jocmfgnklggmklkphnepioajnkjafjpj"
$shortcutIcon = Join-Path $extensionDirectory "icons\icon.ico"
$bridgeInstaller = Join-Path $root "bridge\install-autostart.ps1"
$guidePath = Join-Path $root "INSTALL.md"

if (-not (Test-Path -LiteralPath $extensionDirectory)) {
    throw "The extension directory is missing from this package."
}

Write-Host ""
Write-Host "Video Work Link - one-package installer" -ForegroundColor Cyan
Write-Host "Package directory: $root"
Write-Host ""

$bridgeReady = $false
$shortcutPath = $null
if (-not $SkipBridge) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Write-Warning "Node.js was not found. Install Node.js 22 or newer to use the desktop bridge."
        try {
            Start-Process "https://nodejs.org/en/download"
        } catch {
            Write-Host "Open https://nodejs.org/en/download manually."
        }
    } else {
        $nodeVersion = [string](& $nodeCommand.Source -p "process.versions.node")
        $nodeVersion = $nodeVersion.Trim()
        $nodeMajor = 0
        [void][int]::TryParse(($nodeVersion -split "\.")[0], [ref]$nodeMajor)

        if ($nodeMajor -lt 22) {
            Write-Warning "Node.js $nodeVersion is too old. Install Node.js 22 or newer."
            try {
                Start-Process "https://nodejs.org/en/download"
            } catch {
                Write-Host "Open https://nodejs.org/en/download manually."
            }
        } elseif (-not (Test-Path -LiteralPath $bridgeInstaller)) {
            Write-Warning "The bridge installer is missing from this package."
        } else {
            try {
                & $bridgeInstaller
                $bridgeReady = $true
            } catch {
                Write-Warning "The bridge could not be installed: $($_.Exception.Message)"
            }
        }
    }
}

if (-not $SkipOpen) {
    try {
        Set-Clipboard -Value $extensionDirectory
        Write-Host "The extension directory path was copied to the clipboard."
    } catch {
        Write-Host "Extension directory: $extensionDirectory"
    }

    $browserCandidates = @(
        [pscustomobject]@{
            Path = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
            Url = "edge://extensions/"
        },
        [pscustomobject]@{
            Path = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
            Url = "edge://extensions/"
        },
        [pscustomobject]@{
            Path = Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"
            Url = "chrome://extensions/"
        },
        [pscustomobject]@{
            Path = Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"
            Url = "chrome://extensions/"
        },
        [pscustomobject]@{
            Path = Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"
            Url = "chrome://extensions/"
        }
    )

    $browser = $browserCandidates |
        Where-Object { $_.Path -and (Test-Path -LiteralPath $_.Path) } |
        Select-Object -First 1

    if ($browser) {
        Start-Process -FilePath $browser.Path -ArgumentList $browser.Url
    } else {
        Write-Warning "Edge or Chrome was not found in a standard install location."
    }

    if (-not $SkipShortcut -and $browser) {
        $desktopDirectory = [Environment]::GetFolderPath("Desktop")
        if ($desktopDirectory) {
            $shortcutPath = Join-Path $desktopDirectory "Video Work Link.lnk"
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = $browser.Path
            $shortcut.Arguments = "--app=chrome-extension://$extensionId/popup/popup.html --window-size=400,760"
            $shortcut.WorkingDirectory = Split-Path -Parent $browser.Path
            $shortcut.Description = "Video Work Link control panel"
            if (Test-Path -LiteralPath $shortcutIcon) {
                $shortcut.IconLocation = "$shortcutIcon,0"
            }
            $shortcut.Save()
            Write-Host "Desktop shortcut created: $shortcutPath"
        }
    }

    Start-Process -FilePath "explorer.exe" -ArgumentList @($extensionDirectory)
    if (Test-Path -LiteralPath $guidePath) {
        Start-Process -FilePath $guidePath
    }
}

Write-Host ""
Write-Host "Bridge installed: $bridgeReady"
if ($shortcutPath) {
    Write-Host "Desktop shortcut: $shortcutPath"
}
Write-Host "Extension directory: $extensionDirectory"
Write-Host ""
Write-Host "Finish the browser step:" -ForegroundColor Yellow
Write-Host "1. Open Developer mode."
Write-Host "2. Choose Load unpacked."
Write-Host "3. Select the extension directory shown above."
Write-Host "4. Pin the extension and choose a video mode in its popup."
Write-Host ""
