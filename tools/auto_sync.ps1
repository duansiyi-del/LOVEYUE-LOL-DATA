# auto_sync.ps1  —  静默自动同步战绩 (走客户端本地接口)
#
# 在装了国服 LoL 客户端的 Windows 上由计划任务定时运行 (见 tools/README.md).
# 流程: 读客户端本地接口的战绩列表 -> 挑出网站还没有的对局 -> 逐局调详情拿到
# 十个人的数据 -> POST 给网站入库. 客户端没开 / 没登录就静默退出, 下次再试.
#
# 为什么不走 SGP: token 鉴权能过, 但之后任何路径都返回 400 (连不存在的路径也是
# 400 而不是 404), 两台机器分别验证过, 请求在路由前就被网关挡掉了. 客户端本地
# 接口没有这个问题, 也没有 token 十分钟过期的麻烦.
#
# 覆盖范围: 只能拿到【这台机器登录的这个账号】打过的对局. 但车队局只要有一个人
# 在场, 那一局十个人的数据都在. 想覆盖更全, 就在多个成员的机器上各跑一份, 都往
# 同一个网站推, 重复的对局会自动去重.
#
# 日志: %LOCALAPPDATA%\loveyue-sync\sync.log
# 手动调试: powershell -ExecutionPolicy Bypass -File .\auto_sync.ps1 -Verbose

param(
  # 网站地址. 绑了自定义域名后改这里, 或者在计划任务参数里加 -SiteUrl
  [string]$SiteUrl = "https://loveyue-lol-data-1x4k.vercel.app",
  # vercel.app 国内直连不通时填本机代理, 例如 "http://127.0.0.1:7890"; 绑了域名后留空
  [string]$Proxy = "",
  # 往回翻多少场. 首次回填可以调大, 例如 -MaxScan 200
  [int]$MaxScan = 60,
  # 忽略「网站已有」, 所有对局重新拉一遍并覆盖 (加了新字段时用)
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

if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
  Set-Content -Path $logFile -Value (Get-Content $logFile -Tail 500) -Encoding UTF8
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
    foreach ($d in $drives) {
      foreach ($s in @("英雄联盟\LeagueClient\lockfile", "WeGameApps\英雄联盟\LeagueClient\lockfile",
                       "Program Files\WeGameApps\英雄联盟\LeagueClient\lockfile",
                       "Program Files (x86)\WeGameApps\英雄联盟\LeagueClient\lockfile",
                       "Tencent\英雄联盟\LeagueClient\lockfile", "Riot Games\League of Legends\lockfile",
                       "腾讯游戏\英雄联盟\LeagueClient\lockfile", "Games\英雄联盟\LeagueClient\lockfile")) {
        $candidates += (Join-Path $d $s)
      }
    }
    $lockPath = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $lockPath) { Log "fail: 读不到命令行也找不到 lockfile"; exit 1 }
    $fs = [IO.File]::Open($lockPath, 'Open', 'Read', 'ReadWrite')
    try { $lock = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
    $f = $lock.Trim() -split ':'
    if ($f.Count -lt 4) { Log "fail: lockfile 格式不对"; exit 1 }
    $port = $f[2]; $authToken = $f[3]
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { Log "fail: 没有 curl.exe"; exit 1 }
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

  $tmpDir = Join-Path $logDir "tmp"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

  # LCU 用自签名证书, -k 忽略; 只访问本机 127.0.0.1
  function LcuRaw($path, $dest) {
    $code = & curl.exe -s -k -m 30 -o $dest -w "%{http_code}" -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port$path" 2>$null
    return $code
  }

  # ---- 3. 确认已登录 ----
  $meFile = Join-Path $tmpDir "me.json"
  if ((LcuRaw "/lol-summoner/v1/current-summoner" $meFile) -ne "200") { Log "skip: 客户端还没登录完"; exit 0 }
  $me = Get-Content $meFile -Raw -Encoding UTF8 | ConvertFrom-Json
  Log "account: $($me.gameName)#$($me.tagLine)"

  $proxyArgs = @(); if ($Proxy) { $proxyArgs = @("-x", $Proxy) }

  # ---- 4. 网站已有哪些对局 ----
  $known = @{}
  if (-not $RefreshAll) {
    $kf = Join-Path $tmpDir "known.json"
    $code = & curl.exe -s -m 60 -o $kf -w "%{http_code}" @proxyArgs "$SiteUrl/api/matches/import" 2>$null
    if ($LASTEXITCODE -ne 0) { Log "fail: 网站连不上 (curl exit $LASTEXITCODE). 国内直连 vercel.app 不通时给脚本传 -Proxy"; exit 1 }
    if ($code -eq "200") {
      $k = Get-Content $kf -Raw -Encoding UTF8 | ConvertFrom-Json
      foreach ($id in $k.gameIds) { $known[[string]$id] = $true }
      Log "网站已有 $($known.Count) 场"
    } else {
      Log "warn: 取已有列表失败 (http $code), 这次全量发送"
    }
  }

  # ---- 5. 翻战绩列表, 挑出新的 gameId ----
  # 列表接口每次最多给 20 条, 而且只返回登录者自己那一行, 所以拿到 id 之后还要
  # 逐局调详情才有十个人的数据.
  $newIds = New-Object System.Collections.ArrayList
  $beg = 0
  while ($beg -lt $MaxScan) {
    $end = [Math]::Min($beg + 19, $MaxScan - 1)
    $lf = Join-Path $tmpDir "list.json"
    if ((LcuRaw "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=$beg&endIndex=$end" $lf) -ne "200") { break }
    $list = Get-Content $lf -Raw -Encoding UTF8 | ConvertFrom-Json
    $games = $list.games.games
    if (-not $games -or $games.Count -eq 0) { break }
    foreach ($g in $games) {
      $gid = [string]$g.gameId
      if ($gid -and -not $known.ContainsKey($gid)) { [void]$newIds.Add($gid) }
    }
    if ($games.Count -lt ($end - $beg + 1)) { break }
    $beg = $end + 1
  }
  $newIds = $newIds | Select-Object -Unique
  if (-not $newIds -or $newIds.Count -eq 0) { Log "ok: 没有新对局"; exit 0 }
  Log "发现 $($newIds.Count) 场待同步"

  # ---- 6. 逐局拿详情, 分批发给网站 ----
  $batch = New-Object System.Collections.ArrayList
  $sent = 0; $storedTotal = 0; $newTotal = 0
  function Flush {
    if ($batch.Count -eq 0) { return }
    $payload = @{ games = $batch.ToArray() } | ConvertTo-Json -Depth 20 -Compress
    $pf = Join-Path $tmpDir "payload.json"
    [IO.File]::WriteAllText($pf, $payload, (New-Object Text.UTF8Encoding($false)))
    $rf = Join-Path $tmpDir "resp.json"
    $code = & curl.exe -s -m 240 -o $rf -w "%{http_code}" @script:proxyArgs -X POST -H "Content-Type: application/json" --data-binary "@$pf" "$script:SiteUrl/api/matches/import" 2>$null
    $exit = $LASTEXITCODE
    Remove-Item $pf -Force -ErrorAction SilentlyContinue
    if ($exit -ne 0) { Log "fail: 发送失败 (curl exit $exit)"; exit 1 }
    $resp = if (Test-Path $rf) { (Get-Content $rf -Raw -Encoding UTF8).Trim() } else { "" }
    if ($code -ne "200") { Log "fail: http $code $resp"; exit 1 }
    try {
      $r = $resp | ConvertFrom-Json
      $script:storedTotal += $r.stored
      $script:newTotal += $r.newGames
      Log ("  批次: 收到 {0} 存 {1} 新增 {2} (非车队局跳过 {3})" -f $r.received, $r.stored, $r.newGames, $r.skippedNoRoster)
    } catch { Log "  批次返回: $resp" }
    $batch.Clear()
  }

  $script:proxyArgs = $proxyArgs
  $script:SiteUrl = $SiteUrl
  $script:storedTotal = 0
  $script:newTotal = 0

  foreach ($gid in $newIds) {
    $gf = Join-Path $tmpDir "game.json"
    if ((LcuRaw "/lol-match-history/v1/games/$gid" $gf) -ne "200") { continue }
    $g = Get-Content $gf -Raw -Encoding UTF8 | ConvertFrom-Json
    [void]$batch.Add($g)
    $sent++
    # 一批 10 场, payload 不至于太大, 网站那边也在 300 秒预算内
    if ($batch.Count -ge 10) { Flush }
  }
  Flush

  Log ("ok: 取到 {0} 场, 入库 {1} 场, 新增 {2} 场" -f $sent, $script:storedTotal, $script:newTotal)
  exit 0
}
catch {
  Log ("error: " + $_.Exception.Message + " @ " + $_.ScriptStackTrace)
  exit 1
}
