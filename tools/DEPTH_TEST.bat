@echo off
setlocal
title LOVEYUE - Depth Test
cd /d "%~dp0"
if not exist "%~dp0depth_test.ps1" (
  echo [ERROR] depth_test.ps1 not found. Extract the WHOLE folder first.
  goto :end
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0*.ps1' | Unblock-File" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0depth_test.ps1"
:end
echo.
pause
endlocal
