# probe_endpoints.ps1 —— 探测还能拿到哪些数据 (只读, 不写任何东西)
#
# 目的有三个, 都要在装了国服客户端并已登录的 Windows 上跑一次:
#   1. 把一场对局的【完整原始 JSON】存下来, 看清里面到底有哪些字段
#      (有没有段位 / MMR, 用来衡量对手水平)
#   2. 找到【时间轴】接口 —— 有它才能算 10 分钟补刀差 / 经济差,
#      现在存的是整场结束时的差值, 会被滚雪球放大
#   3. 试 LCU 本地接口的同类路径 (客户端自己就有历史和时间轴)
#
# 用法: 双击 run_probe.bat, 或
#   powershell -ExecutionPolicy Bypass -File .\probe_endpoints.ps1
#
# 产出全部放在桌面的 loveyue-probe 文件夹, 跑完把里面的文件发给我.
# 注意: 原始 JSON 里有队友和对手的 puuid / 昵称, 但【没有 token】.

$ErrorActionPreference = "Stop"

function Finish($code) { Write-Host ""; Read-Host "按回车键退出"; exit $code }

try {
  $outDir = Join-Path ([Environment]::GetFolderPath("Desktop")) "loveyue-probe"
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  Write-Host "产出目录: $outDir" -ForegroundColor Cyan

  # ---- 1. 连上客户端 ----
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" | Select-Object -First 1
  if (-not $proc) { Write-Host "客户端没开或没登录" -ForegroundColor Red; Finish 1 }

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
    if (-not $lockPath) { Write-Host "读不到命令行也找不到 lockfile, 试试以管理员身份运行" -ForegroundColor Red; Finish 1 }
    $fs = [IO.File]::Open($lockPath, 'Open', 'Read', 'ReadWrite')
    try { $lock = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
    $f = $lock.Trim() -split ':'
    $port = $f[2]; $authToken = $f[3]
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { Write-Host "没有 curl.exe" -ForegroundColor Red; Finish 1 }
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

  function Lcu($path) {
    $out = & curl.exe -s -k --fail -m 15 -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port$path" 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    if (-not $out) { return $null }
    ($out -join "") | ConvertFrom-Json
  }
  # 只看状态码, 用于批量试路径
  function LcuCode($path) {
    $code = & curl.exe -s -k -m 15 -o NUL -w "%{http_code}" -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port$path" 2>$null
    return $code
  }
  function LcuSave($path, $file) {
    $dest = Join-Path $outDir $file
    $code = & curl.exe -s -k -m 30 -o $dest -w "%{http_code}" -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port$path" 2>$null
    if ($code -ne "200") { Remove-Item $dest -Force -ErrorAction SilentlyContinue }
    return $code
  }

  $me = Lcu "/lol-summoner/v1/current-summoner"
  if (-not $me) { Write-Host "客户端还没登录完" -ForegroundColor Red; Finish 1 }
  $puuid = $me.puuid
  Write-Host "账号: $($me.gameName)#$($me.tagLine)" -ForegroundColor DarkGray

  $ent = Lcu "/entitlements/v1/token"
  $token = $ent.accessToken
  $payload = ($token -split '\.')[1].Replace('-', '+').Replace('_', '/')
  while ($payload.Length % 4) { $payload += '=' }
  $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
  $region = $claims.dat.r
  $sgpBase = "https://$region-sgp.lol.qq.com:21019"
  Write-Host "大区: $region" -ForegroundColor DarkGray

  $ua = "LeagueOfLegendsClient/14.22.632.3512 (rcp-be-lol-match-history)"
  function SgpCode($path) {
    $code = & curl.exe -s -k -m 25 -o NUL -w "%{http_code}" -H "Authorization: Bearer $token" -H "User-Agent: $ua" -H "Accept: application/json" "$sgpBase$path" 2>$null
    if ($LASTEXITCODE -ne 0) { return "conn-fail($LASTEXITCODE)" }
    return $code
  }
  function SgpSave($path, $file) {
    $dest = Join-Path $outDir $file
    $code = & curl.exe -s -k -m 40 -o $dest -w "%{http_code}" -H "Authorization: Bearer $token" -H "User-Agent: $ua" -H "Accept: application/json" "$sgpBase$path" 2>$null
    if ($code -ne "200") { Remove-Item $dest -Force -ErrorAction SilentlyContinue }
    return $code
  }

  # ---- 2. 存一场完整原始 JSON, 并取出 gameId ----
  Write-Host ""
  Write-Host "== 存原始对局 JSON ==" -ForegroundColor Cyan
  $gameId = $null

  $c = SgpSave "/match-history-query/v1/products/lol/player/$puuid/SUMMARY?startIndex=0&count=3" "sgp_summary_raw.json"
  Write-Host "SGP SUMMARY -> $c"
  if ($c -eq "200") {
    try {
      $j = Get-Content (Join-Path $outDir "sgp_summary_raw.json") -Raw -Encoding UTF8 | ConvertFrom-Json
      $g0 = $j.games[0]
      $gameId = if ($g0.json) { $g0.json.gameId } else { $g0.gameId }
      Write-Host "  拿到 gameId: $gameId" -ForegroundColor DarkGray
    } catch { Write-Host "  解析失败: $_" -ForegroundColor DarkGray }
  }

  # LCU 自己的历史 (SGP 不通时的退路)
  $c = LcuSave "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=3" "lcu_matchhistory_raw.json"
  Write-Host "LCU 历史 -> $c"
  if (-not $gameId -and $c -eq "200") {
    try {
      $j = Get-Content (Join-Path $outDir "lcu_matchhistory_raw.json") -Raw -Encoding UTF8 | ConvertFrom-Json
      $gameId = $j.games.games[0].gameId
      Write-Host "  从 LCU 拿到 gameId: $gameId" -ForegroundColor DarkGray
    } catch {}
  }

  if (-not $gameId) { Write-Host "没能拿到任何 gameId, 后面的探测跳过" -ForegroundColor Red; Finish 1 }

  # ---- 3. 时间轴 (算 10 分钟补刀差 / 经济差要靠它) ----
  Write-Host ""
  Write-Host "== 时间轴接口探测 (找能返回 200 的那条) ==" -ForegroundColor Cyan
  $timelineCandidates = @(
    "/match-history-query/v1/products/lol/matches/$gameId/timeline",
    "/match-history-query/v1/products/lol/matches/$region" + "_$gameId/timeline",
    "/match-history-query/v1/products/lol/player/$puuid/matches/$gameId/timeline",
    "/match-history-query/v2/products/lol/matches/$gameId/timeline",
    "/match-history-query/v1/products/lol/matches/$gameId",
    "/match-history-query/v1/products/lol/matches/$region" + "_$gameId"
  )
  $found = $null
  foreach ($p in $timelineCandidates) {
    $code = SgpCode $p
    Write-Host ("  {0,-8} {1}" -f $code, $p)
    if ($code -eq "200" -and -not $found) { $found = $p }
  }
  if ($found) {
    $c = SgpSave $found "sgp_timeline_raw.json"
    Write-Host "已存时间轴: $found -> $c" -ForegroundColor Green
  }

  # LCU 本地时间轴 (客户端自己就有, SGP 不通时这条更稳)
  $c = LcuSave "/lol-match-history/v1/games/$gameId/timeline" "lcu_timeline_raw.json"
  Write-Host "LCU 时间轴 /lol-match-history/v1/games/$gameId/timeline -> $c"
  $c = LcuSave "/lol-match-history/v1/games/$gameId" "lcu_game_raw.json"
  Write-Host "LCU 单局详情 /lol-match-history/v1/games/$gameId -> $c"

  # ---- 4. 段位 / 排位信息 (衡量对手水平) ----
  Write-Host ""
  Write-Host "== 段位接口探测 ==" -ForegroundColor Cyan
  foreach ($p in @(
    "/leagues-ledge/v2/rankedStats/puuid/$puuid",
    "/leagues-ledge/v1/rankedStats/puuid/$puuid",
    "/leagues-ledge/v2/signedRankedStats/puuid/$puuid",
    "/ranked-stats/v1/products/lol/player/$puuid"
  )) {
    $code = SgpCode $p
    Write-Host ("  {0,-8} {1}" -f $code, $p)
    if ($code -eq "200") { SgpSave $p "sgp_ranked_raw.json" | Out-Null }
  }
  $c = LcuSave "/lol-ranked/v1/current-ranked-stats" "lcu_ranked_raw.json"
  Write-Host "LCU 自己的排位 -> $c"

  Write-Host ""
  Write-Host "完成. 把 $outDir 里的文件打包发我." -ForegroundColor Green
  Write-Host "(里面有队友和对手的昵称 / puuid, 但没有 token)" -ForegroundColor DarkGray
  Finish 0
}
catch {
  Write-Host ""
  Write-Host "脚本出错:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
  Finish 1
}
