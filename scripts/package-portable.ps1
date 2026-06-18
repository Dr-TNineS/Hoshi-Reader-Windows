# Hoshi Reader - Portable Zip Builder
# 用法: .\scripts\package-portable.ps1
# 一键构建 + 打包 zip（不需要 NSIS）

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$binaryName = "hoshi-reader-windows.exe"
$releaseDir = "$root\src-tauri\target\release"
$outDir = "$root\release"

$config = Get-Content "$root\src-tauri\tauri.conf.json" | ConvertFrom-Json
$version = $config.version
$productName = $config.productName -replace " ", "-"
$zipName = "${productName}-v${version}-portable.zip"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hoshi Reader - Portable Zip Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build with Tauri (embeds frontend, skips bundling)
Write-Host "[1/2] Building (tauri build --no-bundle)..." -ForegroundColor Yellow
Push-Location $root
npx tauri build --no-bundle
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# Step 2: Package into zip
Write-Host "[2/2] Packaging portable zip..." -ForegroundColor Yellow
$tempDir = "$outDir\temp-portable"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

Copy-Item "$releaseDir\$binaryName" "$tempDir\Hoshi Reader.exe" -Force -ErrorAction Stop

@"
Hoshi Reader v$version (Portable)
================================
直接双击 "Hoshi Reader.exe" 即可运行，无需安装。

首次启动可能需要 WebView2 运行时（Windows 11 已自带）。
如无法启动，请从微软官网安装：
https://go.microsoft.com/fwlink/p/?LinkId=2124703
"@ | Out-File -FilePath "$tempDir\README.txt" -Encoding UTF8

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = "$outDir\$zipName"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

Remove-Item $tempDir -Recurse -Force

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Done! " -ForegroundColor Green -NoNewline
Write-Host "$zipName ($zipSize MB)" -ForegroundColor White
Write-Host "Location: $zipPath" -ForegroundColor Gray
Write-Host ""
Write-Host "发给朋友：解压后双击 Hoshi Reader.exe 即可运行。" -ForegroundColor Cyan
