@echo off
cd /d "%~dp0"
echo Starting probe_endpoints.ps1 ...
powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%~dp0probe_endpoints.ps1"
