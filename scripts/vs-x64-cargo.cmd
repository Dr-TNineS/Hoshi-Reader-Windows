@echo off
setlocal

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul || exit /b 1
set "ROOT=%CD%"
popd >nul

set "VSDEVCMD="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find Common7\Tools\VsDevCmd.bat`) do (
    if not defined VSDEVCMD set "VSDEVCMD=%%I"
  )
)

if not defined VSDEVCMD if exist "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" set "VSDEVCMD=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if not defined VSDEVCMD if exist "%ProgramFiles%\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" set "VSDEVCMD=%ProgramFiles%\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat"

if not defined VSDEVCMD (
  echo Could not find VsDevCmd.bat. Install Visual Studio Build Tools with the x64 C++ workload, or run cargo from an equivalent MSVC/CMake/Ninja environment.
  exit /b 1
)

call "%VSDEVCMD%" -arch=x64 -host_arch=x64 || exit /b 1

set "HSW_HOSHIDICTS_DIR=%ROOT%\third_party\hoshidicts"
cd /d "%ROOT%\src-tauri" || exit /b 1

if "%~1"=="" (
  cargo check
) else (
  cargo %*
)
