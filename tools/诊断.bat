@echo off
setlocal
title LOVEYUE - Diagnose
cd /d "%~dp0"
set OUT=%~dp0diagnose.txt

echo LOVEYUE diagnose > "%OUT%"
echo ---------------------------------- >> "%OUT%"
echo Date: %DATE% %TIME% >> "%OUT%"
echo Folder: %~dp0 >> "%OUT%"
echo. >> "%OUT%"

echo [files here] >> "%OUT%"
dir /b "%~dp0" >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [windows version] >> "%OUT%"
ver >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [powershell in PATH?] >> "%OUT%"
where powershell >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [powershell version] >> "%OUT%"
powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()" >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [execution policy] >> "%OUT%"
powershell -NoProfile -Command "Get-ExecutionPolicy -List | Out-String" >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [is menu.ps1 blocked by Windows?] >> "%OUT%"
powershell -NoProfile -Command "Get-Item -Path '%~dp0menu.ps1' -Stream * 2>$null | Select-Object Stream | Out-String" >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [can menu.ps1 even be parsed?] >> "%OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('%~dp0menu.ps1',[ref]$null,[ref]$e); if($e -and $e.Count){$e | ForEach-Object { $_.ToString() }} else {'parse OK'}" >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [LoL client running?] >> "%OUT%"
tasklist /fi "imagename eq LeagueClientUx.exe" >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo [can reach the site?] >> "%OUT%"
curl -s -m 20 -o NUL -w "http %%{http_code}" https://www.loveyue.xyz/ >> "%OUT%" 2>&1
echo. >> "%OUT%"

echo.
echo ============================================
echo   Done. Report saved to:
echo   %OUT%
echo   Please send that file back.
echo ============================================
echo.
notepad "%OUT%"
pause
endlocal
