@echo off
rem Start both development servers in separate PowerShell windows.
start "Learnly Frontend" /D "%~dp0frontend" powershell.exe -NoLogo -NoProfile -NoExit -Command "npm.cmd run dev"
start "Learnly Backend" /D "%~dp0backend" powershell.exe -NoLogo -NoProfile -NoExit -Command "npm.cmd run dev"
