# ============================================================
#  卸载"用搜索器搜索..."右键菜单
# ============================================================

$ErrorActionPreference = "SilentlyContinue"

$menuKey = "HKCU:\Software\Classes\Directory\shell\SearchKeywords"

Remove-Item -Path "$menuKey\command" -Force -Recurse
Remove-Item -Path $menuKey -Force -Recurse

Write-Host "右键菜单已卸载。" -ForegroundColor Green
pause
