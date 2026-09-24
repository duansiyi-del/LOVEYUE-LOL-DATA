@echo off
setlocal
title LOVEYUE Match Sync
cd /d "%~dp0"

echo.
echo ============================================
echo   LOVEYUE Match Sync  -  starting...
echo ============================================
echo.
echo Folder: %~dp0
echo.

rem --- 1. are the script files actually here? ---
if not exist "%~dp0menu.ps1" (
  echo [ERROR] menu.ps1 not found next to this file.
  echo.
  echo You are probably running this from INSIDE the zip file.
  echo Please extract the whole folder first, then double-click START.bat.
  echo.
  goto :end
)
if not exist "%~dp0auto_sync.ps1" (
  echo [ERROR] auto_sync.ps1 not found. Extract the WHOLE folder, not just one file.
  goto :end
)

rem --- 2. is PowerShell available? ---
where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] powershell.exe not found in PATH.
  echo Try: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
  goto :end
)

rem --- 3. files downloaded from the internet are "blocked" by Windows; clear that ---
echo Unblocking script files ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0*.ps1' | Unblock-File" >nul 2>&1

rem --- 4. run the menu ---
echo Launching menu ...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0menu.ps1"
set RC=%ERRORLEVEL%
echo.
echo ============================================
echo   menu exited with code %RC%
echo ============================================

:end
echo.
echo (This window stays open on purpose. Screenshot it if something went wrong.)
pause
endlocal
