' Launches auto_sync.ps1 with NO console window, ever.
'
' Why this file exists: the scheduled task used to run powershell.exe directly with
' -WindowStyle Hidden. That flag is applied by PowerShell AFTER its console window
' has already been created, so a window still flashes for a moment -- and that flash
' is enough to knock a fullscreen game out of focus every 30 minutes.
' wscript's Run with window style 0 creates the process hidden from the very start.
'
' Keep this file ASCII-only: wscript reads it as ANSI, and a stray multibyte
' character in the wrong place can corrupt a quote.
Option Explicit
Dim sh, fso, here, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & here & "\auto_sync.ps1"""
' 0 = hidden window, True = wait for it so the task's time limit still applies
sh.Run cmd, 0, True
