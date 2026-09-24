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
    if ($code -ne "200") { return @{ code = $code; count = -1; oldest = $null; sig = "" } }
    try { $j = Get-Content $tmp -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return @{ code = "parse-fail"; count = -1; oldest = $null; sig = "" } }
    $games = $j.games.games
    if (-not $games) { $games = $j.games }
    $arr = @($games)
    $oldest = $null
    if ($arr.Count -gt 0) {
      $ms = ($arr | ForEach-Object { [double]$_.gameCreation } | Where-Object { $_ -gt 0 } | Measure-Object -Minimum).Minimum
      if ($ms -gt 0) { $oldest = ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$ms)).LocalDateTime.ToString("yyyy-MM-dd") }
    }
    $sig = (@($arr) | ForEach-Object { [string]$_.gameId }) -join ","
    return @{ code = $code; count = $arr.Count; oldest = $oldest; sig = $sig }
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
    $lastSig = ""
    for ($beg = 0; $beg -lt 400; $beg += 20) {
      $end = $beg + 19
      $r = Get-Page ([string]::Format($f.path, $beg, $end))
      if ($r.count -lt 0) { Say ("  begIndex={0,-4} http {1}  <- 停在这里" -f $beg, $r.code); break }
      Say ("  begIndex={0,-4} 拿到 {1,3} 场   最早 {2}" -f $beg, $r.count, $r.oldest)
      # 部分国服客户端忽略 begIndex/endIndex, 每页都返回同样的第一页
      if ($r.sig -ne "" -and $r.sig -eq $lastSig) {
        Say "  <- 和上一页完全相同: 客户端忽略了翻页参数, 只能拿第一页"
        break
      }
      $lastSig = $r.sig
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

  # ===== 第二部分: 用修正后的写法重试 SGP =====
  # 之前直连 SGP 一直 400. 对比一个真实可用的开源实现 (cridyy/lol-stats) 后发现
  # 我们的主机名用了大写 GZ100-sgp...., 而它用的是【小写】gz100-sgp....
  # 网关对 Host 做精确匹配时, 大小写就会导致"任何路径都 400"这种表现.
  # 另外不同大区主机名规则不一样, 有的带 -k8s-, 这里按那份实现的映射表来.
  Say ""
  Say "===== SGP 直连重试 (修正大小写) ====="
  $ent = $null
  $c2 = & curl.exe -s -k --fail -m 15 -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port/entitlements/v1/token" 2>$null
  if ($c2) { $ent = ($c2 -join "") | ConvertFrom-Json }
  $lst = $null
  $c3 = & curl.exe -s -k --fail -m 15 -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port/lol-league-session/v1/league-session-token" 2>$null
  if ($c3) { $lst = ($c3 -join "").Trim('"') }

  if (-not $ent -or -not $ent.accessToken) {
    Say "  取不到 accessToken, 跳过"
  } else {
    # 真实大区在 token 的 dat.r 里 (platformId 返回的 TENCENT 不能用来拼域名)
    $payload = ($ent.accessToken -split '\.')[1].Replace('-','+').Replace('_','/')
    while ($payload.Length % 4) { $payload += '=' }
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    $rso = [string]$claims.dat.r
    Say "  大区 (token 里的 dat.r): $rso"

    $map = @{
      "HN1"="https://hn1-k8s-sgp.lol.qq.com:21019"; "HN10"="https://hn10-k8s-sgp.lol.qq.com:21019"
      "TJ100"="https://tj100-sgp.lol.qq.com:21019"; "TJ101"="https://tj101-sgp.lol.qq.com:21019"
      "NJ100"="https://nj100-sgp.lol.qq.com:21019"; "GZ100"="https://gz100-sgp.lol.qq.com:21019"
      "CQ100"="https://cq100-sgp.lol.qq.com:21019"; "BGP2"="https://bgp2-k8s-sgp.lol.qq.com:21019"
    }
    $base = $map[$rso.ToUpper()]
    if (-not $base) { $base = "https://" + $rso.ToLower() + "-sgp.lol.qq.com:21019" }
    Say "  基址: $base"

    $ua2 = "LeagueOfLegendsClient/14.13.596.7996 (rcp-be-lol-match-history)"
    $tmp2 = Join-Path $env:TEMP "loveyue_sgp.json"
    foreach ($pair in @(@("accessToken", $ent.accessToken), @("leagueSessionToken", $lst))) {
      $lbl = $pair[0]; $tk = $pair[1]
      if (-not $tk) { continue }
      $u = "$base/match-history-query/v1/products/lol/player/$puuid/SUMMARY?startIndex=0&count=5"
      $code = & curl.exe -s -k -m 25 -o $tmp2 -w "%{http_code}" -H "Authorization: Bearer $tk" -H "User-Agent: $ua2" -H "Accept: application/json" $u 2>$null
      $n = -1
      if ($code -eq "200") {
        try { $j2 = Get-Content $tmp2 -Raw -Encoding UTF8 | ConvertFrom-Json; $n = @($j2.games).Count } catch {}
      }
      Say ("  {0,-20} http {1}   拿到 {2} 场" -f $lbl, $code, $(if ($n -ge 0) { $n } else { "-" }))
      if ($code -eq "200") {
        # 通了就试深翻: 一次要 100 条
        $u2 = "$base/match-history-query/v1/products/lol/player/$puuid/SUMMARY?startIndex=0&count=100"
        $code2 = & curl.exe -s -k -m 40 -o $tmp2 -w "%{http_code}" -H "Authorization: Bearer $tk" -H "User-Agent: $ua2" -H "Accept: application/json" $u2 2>$null
        $n2 = -1
        if ($code2 -eq "200") { try { $j3 = Get-Content $tmp2 -Raw -Encoding UTF8 | ConvertFrom-Json; $n2 = @($j3.games).Count } catch {} }
        Say ("  {0,-20} 一次要 100 条 -> http {1}  拿到 {2} 场" -f "", $code2, $(if ($n2 -ge 0) { $n2 } else { "-" }))
        break
      }
    }
  }

  # ===== 第三部分: 从客户端日志里挖出它自己是怎么调 SGP 的 =====
  # 直接调 SGP 一直返回 400 (任何路径都 400, 连不存在的路径也是), 说明请求在网关
  # 层就被拒了, 缺了真实客户端才带的东西. 客户端自己调用时会在日志里留下 URL,
  # 有时还有请求头, 挖出来就知道差在哪.
  Say ""
  Say "===== 客户端日志里的 SGP 痕迹 ====="
  $logDirs = @()
  $exe2 = $proc.ExecutablePath
  if (-not $exe2) { try { $exe2 = (Get-Process -Id $proc.ProcessId -ErrorAction Stop).Path } catch {} }
  if ($exe2) {
    $root = Split-Path $exe2 -Parent
    $logDirs += (Join-Path $root "Logs")
    $logDirs += (Join-Path (Split-Path $root -Parent) "Logs")
  }
  $logFiles = @()
  foreach ($d in $logDirs) {
    if (Test-Path $d) {
      $logFiles += Get-ChildItem -Path $d -Recurse -Include *.log, *.txt -ErrorAction SilentlyContinue |
                   Sort-Object LastWriteTime -Descending | Select-Object -First 12
    }
  }
  if (-not $logFiles) {
    Say "  没找到日志目录 (试过: $($logDirs -join ' | '))"
  } else {
    Say ("  扫描 {0} 个日志文件" -f $logFiles.Count)
    $hits = 0
    foreach ($lf in $logFiles) {
      $matched = Select-String -Path $lf.FullName -Pattern "sgp\.lol\.qq\.com|match-history-query" -ErrorAction SilentlyContinue |
                 Select-Object -First 6
      foreach ($m in $matched) {
        $t = $m.Line
        # 把长串 base64 / JWT 打码, 别把 token 写进报告
        $t = [regex]::Replace($t, "[A-Za-z0-9_\-]{40,}", "<已打码>")
        if ($t.Length -gt 400) { $t = $t.Substring(0, 400) + " ..." }
        Say ("  [{0}] {1}" -f $lf.Name, $t.Trim())
        $hits++
      }
      if ($hits -ge 25) { break }
    }
    if ($hits -eq 0) { Say "  日志里没有 SGP 相关的行" }
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
