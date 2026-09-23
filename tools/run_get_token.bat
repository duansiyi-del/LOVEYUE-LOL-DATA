@echo off
cd /d "%~dp0"
echo Starting get_sgp_token.ps1 ...
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0get_sgp_token.ps1"
