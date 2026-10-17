@echo off
setlocal
set "TEVRA_DEV_ROOT=%~dp0"
rem Start both development servers in separate PowerShell windows.
start "Tevra Frontend" /D "%TEVRA_DEV_ROOT%frontend" powershell.exe -NoLogo -NoProfile -NoExit -Command "Set-Location -LiteralPath (Join-Path $env:TEVRA_DEV_ROOT 'frontend') -ErrorAction Stop; npm.cmd run dev"
start "Tevra Backend" /D "%TEVRA_DEV_ROOT%backend" powershell.exe -NoLogo -NoProfile -NoExit -Command "Set-Location -LiteralPath (Join-Path $env:TEVRA_DEV_ROOT 'backend') -ErrorAction Stop; npm.cmd run dev"
endlocal
