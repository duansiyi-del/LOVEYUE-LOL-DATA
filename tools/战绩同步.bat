@echo off
title LOVEYUE Match Sync
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0menu.ps1"
if errorlevel 1 pause
