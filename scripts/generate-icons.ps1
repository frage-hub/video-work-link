$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot "extension\icons"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

function New-RoundedRectanglePath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-TrianglePoints {
    param([float]$Left, [float]$Top, [float]$Right, [float]$Bottom)

    return [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new($Left, $Top),
        [System.Drawing.PointF]::new($Right, ($Top + $Bottom) / 2),
        [System.Drawing.PointF]::new($Left, $Bottom)
    )
}

foreach ($size in @(16, 48, 128)) {
    $scale = $size / 128.0
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $background = New-RoundedRectanglePath -X (4 * $scale) -Y (4 * $scale) -Width (120 * $scale) -Height (120 * $scale) -Radius (30 * $scale)
    $backgroundBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#171a1c"))
    $graphics.FillPath($backgroundBrush, $background)

    $cyanBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#25d7d1"))
    $redBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#f13b5f"))
    $whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)

    $graphics.FillPolygon($cyanBrush, (New-TrianglePoints -Left (24 * $scale) -Top (28 * $scale) -Right (92 * $scale) -Bottom (100 * $scale)))
    $graphics.FillPolygon($redBrush, (New-TrianglePoints -Left (36 * $scale) -Top (28 * $scale) -Right (104 * $scale) -Bottom (100 * $scale)))
    $graphics.FillPolygon($whiteBrush, (New-TrianglePoints -Left (43 * $scale) -Top (38 * $scale) -Right (78 * $scale) -Bottom (90 * $scale)))

    $outputPath = Join-Path $outputDirectory ("icon{0}.png" -f $size)
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $whiteBrush.Dispose()
    $redBrush.Dispose()
    $cyanBrush.Dispose()
    $backgroundBrush.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Output "Generated icons in $outputDirectory"
