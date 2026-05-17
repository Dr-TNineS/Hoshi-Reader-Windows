# ============================================================
#  安装"用搜索器搜索..."右键菜单
#  右键点击任意文件夹即可启动搜索器
#  需要以管理员身份运行
# ============================================================

$ErrorActionPreference = "Stop"

# ---- 检测 Python ----
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "ERROR: 未找到 Python，请先安装 Python 3.8+" -ForegroundColor Red
    pause
    exit 1
}

# ---- 项目根目录 ----
$projectRoot = Split-Path -Parent $PSScriptRoot

# ---- 注册表路径 ----
$menuKey   = "HKCU:\Software\Classes\Directory\shell\SearchKeywords"
$commandKey = "$menuKey\command"

# ---- 菜单名称 ----
New-Item -Path $menuKey -Force | Out-Null
Set-ItemProperty -Path $menuKey -Name "(Default)" -Value "用搜索器搜索..."
Set-ItemProperty -Path $menuKey -Name "Icon"       -Value "imageres.dll,177"

# ---- 命令 ----
$cmd = "cmd /c `"cd /d `"`"$projectRoot`"`" && start `"`" pythonw -m search_keywords.main --folder `"`"%V`"`"`""

New-Item -Path $commandKey -Force | Out-Null
Set-ItemProperty -Path $commandKey -Name "(Default)" -Value $cmd

Write-Host ""
Write-Host "SUCCESS  右键菜单已安装！" -ForegroundColor Green
Write-Host "         在任意文件夹上右键 > '用搜索器搜索...'"
Write-Host ""
pause
