# Draws the app icons into ../icons. Run with: powershell -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\icons'

function New-Icon($size, $scale, $name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#0b0d0c'))
  # Design is laid out on a 100-unit grid, then scaled into the icon's safe area.
  $u = $size * $scale / 100.0
  $o = ($size - $size * $scale) / 2.0
  $bars = @(
    @(17, 16, 3, 28, '#ffd25a'), @(24, 16, 52, 9, '#4a554e'), @(24, 35, 58, 9, '#f2efe4'),
    @(17, 55, 3, 28, '#7fd4ff'), @(24, 55, 42, 9, '#3f7f9c'), @(24, 74, 50, 9, '#4a554e'),
    @(8, 39, 84, 1.4, '#ffd25a')
  )
  foreach ($b in $bars) {
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($b[4]))
    $g.FillRectangle($brush, [single]($o + $b[0] * $u), [single]($o + $b[1] * $u), [single]($b[2] * $u), [single]($b[3] * $u))
  }
  $yellow = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#ffd25a'))
  $tris = @(@(@(4, 33), @(13, 39.7), @(4, 46.4)), @(@(96, 33), @(87, 39.7), @(96, 46.4)))
  foreach ($t in $tris) {
    $pts = $t | ForEach-Object { New-Object System.Drawing.PointF ([single]($o + $_[0] * $u)), ([single]($o + $_[1] * $u)) }
    $g.FillPolygon($yellow, [System.Drawing.PointF[]]$pts)
  }
  $g.Dispose()
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

New-Icon 192 0.84 'icon-192.png'
New-Icon 512 0.84 'icon-512.png'
New-Icon 180 0.84 'apple-touch-icon.png'
New-Icon 512 0.62 'icon-maskable-512.png'
