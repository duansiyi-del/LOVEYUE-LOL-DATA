# menu.ps1 —— 战绩同步启动器的菜单本体, 由「战绩同步.bat」双击启动.
#
# 目的是不用记路径也不用记参数: 所有脚本都在这个文件旁边, 用 $PSScriptRoot 定位;
# 网站地址和代理存在配置文件里, 设一次就行.
#
# 配置: %LOCALAPPDATA%\loveyue-sync\config.json
# 日志: %LOCALAPPDATA%\loveyue-sync\sync.log

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$dataDir = Join-Path $env:LOCALAPPDATA "loveyue-sync"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$cfgPath = Join-Path $dataDir "config.json"
$logPath = Join-Path $dataDir "sync.log"
$TaskName = "LOVEYUE-LOL-Sync"
# 正式地址是 www: Vercel 把主域名设成 308 跳转到 www, 直接用 www 少一跳
$DefaultSite = "https://www.loveyue.xyz"

function Load-Config {
  $site = $DefaultSite
  $proxy = ""
  if (Test-Path $cfgPath) {
    try {
      $raw = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($raw.SiteUrl) { $site = [string]$raw.SiteUrl }
      if ($raw.Proxy) { $proxy = [string]$raw.Proxy }
    } catch {}
  }
  # always rebuild the object so both properties exist even for an old config file
  return [pscustomobject]@{ SiteUrl = $site; Proxy = $proxy }
}
function Save-Config($cfg) {
  ($cfg | ConvertTo-Json) | Set-Content -Path $cfgPath -Encoding UTF8
}

function Is-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
}

function Task-Exists {
  try { $null = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop; return $true } catch { return $false }
}

function Run-Sync([string[]]$extra) {
  $cfg = Load-Config
  # 注意不要叫 $args —— 那是 PowerShell 的自动变量, 在函数里覆盖会出怪问题
  $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $here "auto_sync.ps1"),
              "-Verbose", "-SiteUrl", $cfg.SiteUrl)
  if ($cfg.Proxy) { $psArgs += @("-Proxy", $cfg.Proxy) }
  if ($extra) { $psArgs += $extra }
  Write-Host ""
  Write-Host "开始同步…（客户端要开着并且登录）" -ForegroundColor Cyan
  Write-Host ""
  & powershell.exe @psArgs
  Write-Host ""
  Write-Host "———— 最近几条日志 ————" -ForegroundColor DarkGray
  if (Test-Path $logPath) { Get-Content $logPath -Tail 6 | ForEach-Object { Write-Host "  $_" } }
}

try {

while ($true) {
  $cfg = Load-Config
  $hasTask = Task-Exists
  $lastLog = if (Test-Path $logPath) { (Get-Content $logPath -Tail 1) } else { "还没跑过" }

  Clear-Host
  Write-Host "════════════════════════════════════════════" -ForegroundColor DarkYellow
  Write-Host "   LOVEYUE 战绩同步" -ForegroundColor Yellow
  Write-Host "════════════════════════════════════════════" -ForegroundColor DarkYellow
  Write-Host ""
  Write-Host ("  网站     " + $cfg.SiteUrl) -ForegroundColor DarkGray
  Write-Host ("  代理     " + $(if ($cfg.Proxy) { $cfg.Proxy } else { "未设置（直连）" })) -ForegroundColor DarkGray
  Write-Host ("  自动同步 " + $(if ($hasTask) { "已开启（每 30 分钟）" } else { "未开启" })) -ForegroundColor DarkGray
  Write-Host ("  上次     " + $lastLog) -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  [1] 立即同步一次（只补新对局）"
  Write-Host "  [2] 首次全量回填（往回补历史，逐个成员拉，慢）"
  Write-Host "  [3] " -NoNewline; if ($hasTask) { Write-Host "关闭自动同步" } else { Write-Host "开启自动同步（每 30 分钟）" }
  Write-Host "  [4] 设置网站地址"
  Write-Host "  [5] 设置 / 清除代理"
  Write-Host "  [6] 查看完整日志"
  Write-Host "  [7] 排查工具（探测接口，出问题时用）"
  Write-Host "  [8] 重刷全部对局（把已存的旧数据用 SGP 盖一遍，修数据用，很慢）"
  Write-Host "  [0] 退出"
  Write-Host ""
  $c = Read-Host "选一个"

  switch ($c) {
    "1" { Run-Sync -extra @(); Read-Host "`n按回车回菜单" }
    "2" { Run-Sync -extra @("-MaxScan", "1000", "-Deep"); Read-Host "`n按回车回菜单" }
    "3" {
      if (-not (Is-Admin)) {
        Write-Host ""
        Write-Host "这一步要管理员权限。请关掉这个窗口，右键「战绩同步.bat」选「以管理员身份运行」，再选一次 3。" -ForegroundColor Yellow
        Read-Host "`n按回车回菜单"
        break
      }
      if ($hasTask) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "`n已关闭自动同步。" -ForegroundColor Green
      } else {
        $inner = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $here 'auto_sync.ps1')`""
        $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $inner
        $trg = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30)
        $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
        Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Settings $set -RunLevel Highest -Force | Out-Null
        Write-Host "`n已开启：每 30 分钟自动同步一次，客户端没开就自动跳过。" -ForegroundColor Green
        Write-Host "网站地址和代理取的是上面显示的配置，改了配置不用重设任务。" -ForegroundColor DarkGray
      }
      Read-Host "`n按回车回菜单"
    }
    "4" {
      Write-Host "`n当前：$($cfg.SiteUrl)"
      $v = Read-Host "输入新地址（直接回车保持不变）"
      if ($v) { $cfg.SiteUrl = $v.Trim().TrimEnd('/'); Save-Config $cfg; Write-Host "已保存。" -ForegroundColor Green }
      Read-Host "`n按回车回菜单"
    }
    "5" {
      Write-Host "`n当前：$(if ($cfg.Proxy) { $cfg.Proxy } else { '未设置' })"
      Write-Host "格式例如 http://127.0.0.1:7890 ；输入 0 表示清除。" -ForegroundColor DarkGray
      $v = Read-Host "输入代理（直接回车保持不变）"
      if ($v -eq "0") { $cfg.Proxy = ""; Save-Config $cfg; Write-Host "已清除。" -ForegroundColor Green }
      elseif ($v) { $cfg.Proxy = $v.Trim(); Save-Config $cfg; Write-Host "已保存。" -ForegroundColor Green }
      Read-Host "`n按回车回菜单"
    }
    "6" {
      if (Test-Path $logPath) { notepad $logPath } else { Write-Host "`n还没有日志。" -ForegroundColor DarkGray; Read-Host "`n按回车回菜单" }
    }
    "7" {
      $probe = Join-Path $here "probe_endpoints.ps1"
      if (Test-Path $probe) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe }
      else { Write-Host "`n找不到 probe_endpoints.ps1，它应该和这个文件放在一起。" -ForegroundColor Yellow; Read-Host "`n按回车回菜单" }
    }
    "8" {
      # -RefreshAll: 忽略"网站已有", 把 SGP 看到的对局全部重传一遍覆盖.
      # 用途是修已经写坏的历史数据 (比如早先走客户端本地接口存的那批, 分路是错的、
      # 死亡时长之类的字段是空的). 平时不要用, 它每次都要把全部对局重传.
      Write-Host ""
      Write-Host "会把已经存过的对局全部重新拉一遍并覆盖，一千多场大概十几分钟。" -ForegroundColor Yellow
      $yn = Read-Host "确定吗？(y/n)"
      if ($yn -eq "y") { Run-Sync -extra @("-MaxScan", "1000", "-RefreshAll") }
      Read-Host "`n按回车回菜单"
    }
    "0" { exit 0 }
    default { }
  }
}

}
catch {
  # 兜底: 菜单本身出错时把错误留在屏幕上, 不要一闪而过
  Write-Host ""
  Write-Host "启动器出错:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
  Write-Host ""
  Read-Host "按回车退出"
  exit 1
}
