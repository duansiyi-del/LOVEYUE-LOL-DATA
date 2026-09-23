# auto_sync.ps1  —  静默自动同步战绩
#
# 在装了国服 LoL 客户端的 Windows 上由计划任务定时运行 (见 tools/README.md).
# 每次: 读客户端 token -> POST 给网站 /api/matches/sync -> 网站去拉全队新对局.
# 客户端没开 / 没登录时静默退出, 下次再试. 全程不弹窗, 结果写日志.
#
# 日志: %LOCALAPPDATA%\loveyue-sync\sync.log
# 手动调试: powershell -ExecutionPolicy Bypass -File .\auto_sync.ps1 -Verbose

param(
  # 网站地址. 绑了自定义域名后改成新域名.
  [string]$SiteUrl = "https://loveyue-lol-data-1x4k.vercel.app",
  # vercel.app 国内直连不通时填本机代理, 例如 "http://127.0.0.1:7890"; 绑了域名后留空.
  [string]$Proxy = "",
  # 勾上等于网页里的「同时刷新已同步过的旧对局」, 平时不用.
  [switch]$RefreshAll
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $env:LOCALAPPDATA "loveyue-sync"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "sync.log"

function Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Verbose $line
}

# 日志超过 1MB 就截掉前半
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
  $tail = Get-Content $logFile -Tail 500
  Set-Content -Path $logFile -Value $tail -Encoding UTF8
}

try {
  # ---- 1. 客户端在不在 ----
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { Log "skip: 客户端未运行"; exit 0 }

  # ---- 2. 端口 + 密码: 命令行 -> lockfile ----
  $port = $null; $authToken = $null
  $cmd = $proc.CommandLine
  if ($cmd -match '--app-port=(\d+)') {
    $port = $Matches[1]
    if ($cmd -match '--remoting-auth-token=([\w-]+)') { $authToken = $Matches[1] }
  }
  if (-not $port -or -not $authToken) {
    $candidates = @()
    $exe = $proc.ExecutablePath
    if (-not $exe) { try { $exe = (Get-Process -Id $proc.ProcessId -ErrorAction Stop).Path } catch {} }
    if ($exe) { $candidates += (Join-Path (Split-Path $exe -Parent) "lockfile") }
    $drives = Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root
    $suffixes = @(
      "英雄联盟\LeagueClient\lockfile", "WeGameApps\英雄联盟\LeagueClient\lockfile",
      "Program Files\WeGameApps\英雄联盟\LeagueClient\lockfile",
      "Program Files (x86)\WeGameApps\英雄联盟\LeagueClient\lockfile",
      "Tencent\英雄联盟\LeagueClient\lockfile", "Riot Games\League of Legends\lockfile",
      "腾讯游戏\英雄联盟\LeagueClient\lockfile", "Games\英雄联盟\LeagueClient\lockfile"
    )
    foreach ($d in $drives) { foreach ($s in $suffixes) { $candidates += (Join-Path $d $s) } }
    $lockPath = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $lockPath) { Log "fail: 读不到命令行也找不到 lockfile"; exit 1 }
    $fs = [IO.File]::Open($lockPath, 'Open', 'Read', 'ReadWrite')
    try { $lock = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
    $f = $lock.Trim() -split ':'
    if ($f.Count -lt 4) { Log "fail: lockfile 格式不对"; exit 1 }
    $port = $f[2]; $authToken = $f[3]
  }

  # ---- 3. 取 token (curl.exe, -k 忽略本地自签证书) ----
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { Log "fail: 没有 curl.exe"; exit 1 }
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

  $entRaw = & curl.exe -s -k --fail -m 10 -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port/entitlements/v1/token" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $entRaw) { Log "skip: 客户端未登录 (entitlements 取不到)"; exit 0 }
  $token = (($entRaw -join "") | ConvertFrom-Json).accessToken
  if (-not $token) { Log "skip: accessToken 为空, 大概还没登录完"; exit 0 }

  # ---- 4. POST 给网站 ----
  $body = @{ token = $token; refreshAll = [bool]$RefreshAll } | ConvertTo-Json -Compress
  $bodyFile = Join-Path $logDir "body.json"
  [IO.File]::WriteAllText($bodyFile, $body, (New-Object Text.UTF8Encoding($false)))
  $respFile = Join-Path $logDir "resp.json"
  $proxyArgs = @()
  if ($Proxy) { $proxyArgs = @("-x", $Proxy) }
  $code = & curl.exe -s -m 120 -o $respFile -w "%{http_code}" @proxyArgs -X POST -H "Content-Type: application/json" --data-binary "@$bodyFile" "$SiteUrl/api/matches/sync" 2>$null
  $exit = $LASTEXITCODE
  Remove-Item $bodyFile -Force -ErrorAction SilentlyContinue   # token 不落盘

  $resp = ""
  if (Test-Path $respFile) { $resp = (Get-Content $respFile -Raw -Encoding UTF8).Trim() }
  if ($exit -ne 0) { Log "fail: 网站连不上 (curl exit $exit). 国内直连 vercel.app 不通时给脚本传 -Proxy"; exit 1 }
  if ($code -eq "200") {
    try {
      $r = $resp | ConvertFrom-Json
      Log ("ok: 新增 {0} 场, 修复 {1} 场, 累计 {2} 场, 扫描 {3} 场" -f $r.newGames, $r.repairedGames, $r.totalGames, $r.scannedGames)
    } catch { Log "ok: $resp" }
    exit 0
  }
  Log "fail: http $code $resp"
  exit 1
}
catch {
  Log ("error: " + $_.Exception.Message)
  exit 1
}
