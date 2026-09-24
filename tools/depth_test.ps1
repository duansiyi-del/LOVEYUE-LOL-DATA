# depth_test.ps1 —— 只回答一个问题: 客户端到底能往回翻多少场战绩?
#
# 背景: 第一次同步只拿到 20 场. 有两种可能 ——
#   A. 客户端本地历史就只有 20 场 (硬限制, 那这个数据源不够用)
#   B. 只是我用的那种接口写法一次只给 20 条, 换个写法能翻更深
# 这个脚本把几种写法都试一遍, 每种都往回翻, 直接把结果列出来.
#
# 不写任何东西, 不上传任何东西, 只读客户端本地接口.
# 跑完结果存在桌面 loveyue-depth.txt, 把它发回来即可.

$ErrorActionPreference = "Stop"
function Finish($c) { Write-Host ""; Read-Host "按回车键退出"; exit $c }

try {
  $outFile = Join-Path ([Environment]::GetFolderPath("Desktop")) "loveyue-depth.txt"
  $lines = New-Object System.Collections.ArrayList
  function Say($t) { Write-Host $t; [void]$lines.Add($t) }

  # ---- 连客户端 ----
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" | Select-Object -First 1
  if (-not $proc) { Write-Host "客户端没开或没登录" -ForegroundColor Red; Finish 1 }

  $port = $null; $authToken = $null
  $cmd = $proc.CommandLine
  if ($cmd -match '--app-port=(\d+)') {
    $port = $Matches[1]
    if ($cmd -match '--remoting-auth-token=([\w-]+)') { $authToken = $Matches[1] }
  }
  if (-not $port -or -not $authToken) {
    $cands = @()
    $exe = $proc.ExecutablePath
    if (-not $exe) { try { $exe = (Get-Process -Id $proc.ProcessId -ErrorAction Stop).Path } catch {} }
    if ($exe) { $cands += (Join-Path (Split-Path $exe -Parent) "lockfile") }
    foreach ($d in (Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root)) {
      foreach ($s in @("英雄联盟\LeagueClient\lockfile","WeGameApps\英雄联盟\LeagueClient\lockfile",
                       "Program Files\WeGameApps\英雄联盟\LeagueClient\lockfile",
                       "Program Files (x86)\WeGameApps\英雄联盟\LeagueClient\lockfile",
                       "Tencent\英雄联盟\LeagueClient\lockfile","Riot Games\League of Legends\lockfile",
                       "腾讯游戏\英雄联盟\LeagueClient\lockfile","Games\英雄联盟\LeagueClient\lockfile")) {
        $cands += (Join-Path $d $s)
      }
    }
    $lock = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $lock) { Write-Host "读不到命令行也找不到 lockfile, 试试以管理员身份运行" -ForegroundColor Red; Finish 1 }
    $fs = [IO.File]::Open($lock,'Open','Read','ReadWrite')
    try { $txt = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
    $f = $txt.Trim() -split ':'; $port = $f[2]; $authToken = $f[3]
  }

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { Write-Host "没有 curl.exe" -ForegroundColor Red; Finish 1 }
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

  $tmp = Join-Path $env:TEMP "loveyue_depth.json"
  function Get-Page($path) {
    $code = & curl.exe -s -k -m 30 -o $tmp -w "%{http_code}" -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port$path" 2>$null
    if ($code -ne "200") { return @{ code = $code; count = -1; oldest = $null } }
    try { $j = Get-Content $tmp -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return @{ code = "parse-fail"; count = -1; oldest = $null } }
    $games = $j.games.games
    if (-not $games) { $games = $j.games }
    $arr = @($games)
    $oldest = $null
    if ($arr.Count -gt 0) {
      $ms = ($arr | ForEach-Object { [double]$_.gameCreation } | Where-Object { $_ -gt 0 } | Measure-Object -Minimum).Minimum
      if ($ms -gt 0) { $oldest = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms)).LocalDateTime.ToString("yyyy-MM-dd") }
    }
    return @{ code = $code; count = $arr.Count; oldest = $oldest }
  }

  $me = $null
  $c = & curl.exe -s -k --fail -m 15 -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port/lol-summoner/v1/current-summoner" 2>$null
  if ($c) { $me = ($c -join "") | ConvertFrom-Json }
  if (-not $me) { Write-Host "客户端还没登录完" -ForegroundColor Red; Finish 1 }
  $puuid = $me.puuid

  Say "LOVEYUE 战绩深度测试"
  Say ("时间: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  Say ("账号: " + $me.gameName + "#" + $me.tagLine)
  Say ""

  # 几种接口写法, {0}=begIndex {1}=endIndex
  $forms = @(
    @{ name = "current-summoner"; path = "/lol-match-history/v1/products/lol/current-summoner/matches?begIndex={0}&endIndex={1}" },
    @{ name = "按 puuid";         path = "/lol-match-history/v1/products/lol/$puuid/matches?begIndex={0}&endIndex={1}" },
    @{ name = "matchlist 旧写法"; path = "/lol-match-history/v1/matchlist/account/$($me.accountId)?begIndex={0}&endIndex={1}" }
  )

  foreach ($f in $forms) {
    Say "===== $($f.name) ====="
    Say $f.path.Replace("{0}","N").Replace("{1}","M")
    $total = 0
    $deepest = 0
    for ($beg = 0; $beg -lt 400; $beg += 20) {
      $end = $beg + 19
      $r = Get-Page ([string]::Format($f.path, $beg, $end))
      if ($r.count -lt 0) { Say ("  begIndex={0,-4} http {1}  <- 停在这里" -f $beg, $r.code); break }
      Say ("  begIndex={0,-4} 拿到 {1,3} 场   最早 {2}" -f $beg, $r.count, $r.oldest)
      $total += $r.count
      if ($r.count -gt 0) { $deepest = $beg + $r.count }
      if ($r.count -eq 0) { Say "  (返回空, 到头了)"; break }
      if ($r.count -lt 20) { Say "  (不足一页, 到头了)"; break }
      Start-Sleep -Milliseconds 300
    }
    Say ("  -> 这种写法总共能拿 {0} 场" -f $total)
    Say ""
  }

  # 一次要大范围, 看会不会直接给更多
  Say "===== 一次要 100 条会怎样 ====="
  foreach ($f in $forms) {
    $r = Get-Page ([string]::Format($f.path, 0, 99))
    Say ("  {0,-18} http {1}  拿到 {2} 场" -f $f.name, $r.code, $r.count)
  }

  $lines | Set-Content -Path $outFile -Encoding UTF8
  Write-Host ""
  Write-Host "结果已存到: $outFile" -ForegroundColor Green
  Write-Host "把这个文件发回来即可 (里面只有场次和日期, 没有 token)." -ForegroundColor DarkGray
  Finish 0
}
catch {
  Write-Host ""
  Write-Host "出错:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
  Finish 1
}
