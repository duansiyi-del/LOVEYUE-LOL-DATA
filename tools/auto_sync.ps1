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
# 覆盖范围: 脚本会从网站取车队名单, 然后【逐个查每个成员的战绩】, 不是只查本机
# 登录的账号 —— 客户端接口支持传任意 puuid, 所以一台机器就能覆盖全队.
# 查不到别人时 (接口拒绝) 会自动退回只同步本机账号, 并在日志里写明.
#
# 日志: %LOCALAPPDATA%\loveyue-sync\sync.log
# 手动调试: powershell -ExecutionPolicy Bypass -File .\auto_sync.ps1 -Verbose

param(
  # 网站地址. 绑了自定义域名后改这里, 或者在计划任务参数里加 -SiteUrl
  [string]$SiteUrl = "https://www.loveyue.xyz",
  # vercel.app 国内直连不通时填本机代理, 例如 "http://127.0.0.1:7890"; 绑了域名后留空
  [string]$Proxy = "",
  # 每个成员往回翻多少场. 客户端本地历史有上限, 翻到头会自动停, 填大了不会出错.
  # ⚠ 这是【场数】上限不是时间上限: 打得多的时候 60 场可能只覆盖两周.
  # 想把历史拉全, 用菜单里的「首次全量回填」(等于 -MaxScan 1000).
  [int]$MaxScan = 200,
  # 忽略「网站已有」, 所有对局重新拉一遍并覆盖 (加了新字段时用)
  [switch]$RefreshAll,
  # 首次回填往回补历史: 不在"撞到已入库的对局"时提前停止, 但仍然只写新的.
  # 平时同步不要带这个 —— 带了每次都要把整个窗口重翻一遍, 慢且没收益.
  [switch]$Deep
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $env:LOCALAPPDATA "loveyue-sync"

# 没显式传参时读启动器保存的配置 (菜单里设的网站地址 / 代理), 这样计划任务
# 不用带参数, 改了配置也不用重设任务.
$cfgFile = Join-Path $logDir "config.json"
if (Test-Path $cfgFile) {
  try {
    $cfg = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $PSBoundParameters.ContainsKey('SiteUrl') -and $cfg.SiteUrl) { $SiteUrl = $cfg.SiteUrl }
    if (-not $PSBoundParameters.ContainsKey('Proxy') -and $cfg.Proxy) { $Proxy = $cfg.Proxy }
  } catch {}
}
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

  # ---- 3.4 网站已有哪些对局 (两条路都要用: 已有的就不必再拉再传) ----
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

  # ---- 3.5 先试 SGP: 本机直接拉腾讯服务端的战绩 ----
  # 为什么要有这一段: 客户端本地那个战绩接口【每人只给最近 20 场, 而且忽略翻页
  # 参数】—— 2026-09-24 八个成员挨个试过, 全是 20 场, 换写法、一次要 100 条都一样.
  # SGP 是腾讯服务端的完整战绩, 同一天在这台机器上实测: 一次要 100 条就给 100 条.
  #
  # ⚠ 为什么是【这台机器】去请求, 而不是把 token 发给网站让网站去拉:
  # 网站跑在 Vercel (美国). 实测通过的是客户端所在这台机器发的请求; 境外 IP 能不能
  # 用没有把握, 而且跨境绕一圈还受函数 300 秒上限约束. 先前那版就是让网站去拉的,
  # 一直失败. 这里改成本地拉好、再把对局原样发给网站入库.
  #
  # ⚠ token: 这个账号十分钟有效的凭证. 只放在内存里当请求头用, 每个成员开始前重新
  # 取一次 (本机调用很便宜), 免得翻久了过期. 不写日志、不落盘、不发给网站.
  function Get-SgpToken {
    $raw = & curl.exe -s -k --fail -m 15 -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port/entitlements/v1/token" 2>$null
    if (-not $raw) { return $null }
    $o = $null
    try { $o = ($raw -join "") | ConvertFrom-Json } catch { return $null }
    if (-not $o.accessToken) { return $null }
    return [string]$o.accessToken
  }

  # 大区在 token 的 dat.r 里 (current-summoner 给的 platformId 是 TENCENT, 拼不出域名).
  # ⚠ 主机名必须小写: 网关对 Host 做精确匹配, 大写会导致任何路径都返回 400.
  function Get-SgpBase($tk) {
    try {
      $seg = ($tk -split '\.')[1].Replace('-','+').Replace('_','/')
      while ($seg.Length % 4) { $seg += '=' }
      $rso = [string](([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($seg))) | ConvertFrom-Json).dat.r
    } catch { return $null }
    if (-not $rso) { return $null }
    $map = @{
      "HN1"="https://hn1-k8s-sgp.lol.qq.com:21019"; "HN10"="https://hn10-k8s-sgp.lol.qq.com:21019"
      "TJ100"="https://tj100-sgp.lol.qq.com:21019"; "TJ101"="https://tj101-sgp.lol.qq.com:21019"
      "NJ100"="https://nj100-sgp.lol.qq.com:21019"; "GZ100"="https://gz100-sgp.lol.qq.com:21019"
      "CQ100"="https://cq100-sgp.lol.qq.com:21019"; "BGP2"="https://bgp2-k8s-sgp.lol.qq.com:21019"
    }
    $b = $map[$rso.ToUpper()]
    if (-not $b) { $b = "https://" + $rso.ToLower() + "-sgp.lol.qq.com:21019" }
    return $b
  }

  $sgpDone = $false
  $tk0 = Get-SgpToken
  $sgpBase = $null
  if ($tk0) { $sgpBase = Get-SgpBase $tk0 }

  if (-not $tk0) {
    Log "取不到 SGP token, 走客户端本地接口"
  } elseif (-not $sgpBase) {
    Log "SGP: 解不出大区, 走客户端本地接口"
  } else {
    Log "SGP 本机直连: $sgpBase (每人最多往回翻 $MaxScan 场)"

    $sgpMembers = @()
    $rf0 = Join-Path $tmpDir "roster0.json"
    if ((& curl.exe -s -m 60 -o $rf0 -w "%{http_code}" @proxyArgs "$SiteUrl/api/roster" 2>$null) -eq "200") {
      try { $sgpMembers = @((Get-Content $rf0 -Raw -Encoding UTF8 | ConvertFrom-Json).members) } catch {}
    }

    if ($sgpMembers.Count -eq 0) {
      Log "SGP: 取不到车队名单, 走客户端本地接口"
    } else {
      $sgpUa = "LeagueOfLegendsClient/14.13.596.7996 (rcp-be-lol-match-history)"
      $sgpPage = 100
      $sgpNew = 0
      $sgpSeen = 0
      $sgpUp = 0
      $sgpPartial = 0
      $sgpBad = ""
      $sentIds = @{}

      # 分批发给网站: 一次发太多会超过函数的请求体上限, 20 场一批是稳的.
      $upBatch = New-Object System.Collections.ArrayList
      function Send-Sgp {
        if ($script:upBatch.Count -eq 0) { return $true }
        $pf = Join-Path $script:tmpDir "sgpup.json"
        $payload = @{ source = "sgp"; games = $script:upBatch.ToArray() } | ConvertTo-Json -Depth 30 -Compress
        [IO.File]::WriteAllText($pf, $payload, (New-Object Text.UTF8Encoding($false)))
        $rr = Join-Path $script:tmpDir "sgpupresp.json"
        $cc = & curl.exe -s -m 240 -o $rr -w "%{http_code}" @script:proxyArgs -X POST -H "Content-Type: application/json" --data-binary "@$pf" "$script:SiteUrl/api/matches/import" 2>$null
        Remove-Item $pf -Force -ErrorAction SilentlyContinue
        $script:upBatch.Clear()
        if ($cc -ne "200") {
          $d = ""
          if (Test-Path $rr) { $d = (Get-Content $rr -Raw -Encoding UTF8).Trim() }
          if ($d.Length -gt 200) { $d = $d.Substring(0, 200) }
          $script:sgpBad = "上传失败 http $cc $d"
          return $false
        }
        try {
          $j = Get-Content $rr -Raw -Encoding UTF8 | ConvertFrom-Json
          $script:sgpNew += [int]$j.newGames
          # 解析不了的数量要盯着: SGP 的字段和客户端那套不一样, 如果转换有问题,
          # 表现就是"传上去了但一场都没入库", 有这个数就不用猜了.
          $script:sgpUnparsed += [int]$j.skippedUnparsed
        } catch {}
        return $true
      }
      $script:upBatch = $upBatch
      $script:tmpDir = $tmpDir
      $script:proxyArgs = $proxyArgs
      $script:SiteUrl = $SiteUrl
      $script:sgpNew = 0
      $script:sgpUnparsed = 0
      $script:sgpBad = ""

      # ⚠ SGP 只认"token 是谁的就查谁": 拿本机登录这个账号的 token 去查队友的 puuid
      # 会直接 401 (2026-09-24 实测). 客户端本地接口没有这个限制, 查谁都行 ——
      # 两条路在这件事上不一样, 别按本地接口的经验去想 SGP.
      # 所以: 自己排最前面 (这一个失败才算真失败), 别人 401 就跳过继续.
      # 车队局是十个人一起存的, 所以自己那份完整历史已经覆盖了所有有自己在场的局;
      # 想补别人单独打的, 让他在自己机器上跑一次.
      $selfPuuid = [string]$me.puuid
      $ordered = @($sgpMembers | Where-Object { [string]$_.puuid -eq $selfPuuid })
      $ordered += @($sgpMembers | Where-Object { [string]$_.puuid -ne $selfPuuid })

      foreach ($m in $ordered) {
        $tk = Get-SgpToken
        if (-not $tk) { $script:sgpBad = "token 取不到了"; break }
        $mp = [string]$m.puuid
        $mSeen = 0
        $mUp = 0
        $startIdx = 0
        $skipMember = $false
        $memberBad = ""
        while ($startIdx -lt $MaxScan) {
          $u = "$sgpBase/match-history-query/v1/products/lol/player/$mp/SUMMARY?startIndex=$startIdx&count=$sgpPage"
          $pf2 = Join-Path $tmpDir "sgppage.json"
          $c4 = & curl.exe -s -k -m 60 -o $pf2 -w "%{http_code}" -H "Authorization: Bearer $tk" -H "User-Agent: $sgpUa" -H "Accept: application/json" $u 2>$null

          # 中途冒出来的 401 要重试, 不能当成失败.
          # 实测: 同一轮里前面几页正常拿到 200 场, 后面才 401 —— 说明既不是"查不了
          # 别人", 也不是 token 一开始就不对. 十分钟有效期是客户端那边的, 我们每个
          # 成员重取一次拿到的往往还是同一个缓存 token, 跑久了照样会在某一页上过期;
          # 腾讯的风控也可能临时拒一下. 两种都是等一下、换张新 token 再来就好.
          $tries = 0
          while (($c4 -ne "200") -and ($tries -lt 2)) {
            $tries++
            Start-Sleep -Seconds (3 * $tries)
            $fresh = Get-SgpToken
            if ($fresh) { $tk = $fresh }
            $c4 = & curl.exe -s -k -m 60 -o $pf2 -w "%{http_code}" -H "Authorization: Bearer $tk" -H "User-Agent: $sgpUa" -H "Accept: application/json" $u 2>$null
          }
          if (($c4 -eq "200") -and ($tries -gt 0)) { Log ("    (第 $startIdx 条起重试 $tries 次后成功)") }

          if ($c4 -ne "200") {
            # 重试完还是不行: 记下这个人停在哪儿, 换下一个人继续.
            # 不要中断整轮 —— 前面已经拉到的都是白拉, 而且退回本地接口只能拿 20 场.
            $shape = "段数 $(($tk -split '\.').Count) 长度 $($tk.Length)"
            $memberBad = "http $c4 (第 $startIdx 条起, token $shape)"
            $skipMember = $true
            break
          }
          $pg = $null
          try { $pg = Get-Content $pf2 -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
          $gs = @()
          if ($pg -and $pg.games) { $gs = @($pg.games) }
          if ($gs.Count -eq 0) { break }
          foreach ($gw in $gs) {
            $one = $gw
            if ($gw.json) { $one = $gw.json }
            $mSeen++
            # 同一场车队局在八个人的历史里都会出现, 网站上已有的也会年年重复出现.
            # 不在这里去重的话, 一场要上传八遍、每次跑都重传一遍, 慢到没法用.
            $gidS = [string]$one.gameId
            if (-not $gidS) { $gidS = [string]$one.matchId }
            if (-not $gidS) { continue }
            if ($sentIds.ContainsKey($gidS)) { continue }
            $sentIds[$gidS] = $true
            if ((-not $RefreshAll) -and $known.ContainsKey($gidS)) { continue }
            [void]$script:upBatch.Add($one)
            $mUp++
            if ($script:upBatch.Count -ge 20) { if (-not (Send-Sgp)) { break } }
          }
          if ($script:sgpBad) { break }
          if ($gs.Count -lt $sgpPage) { break }
          $startIdx += $sgpPage
          Start-Sleep -Milliseconds 1500
        }
        # 把这个人剩下不满 20 场的尾巴发出去; 失败的原因在 $script:sgpBad 里, 下面查
        $null = Send-Sgp
        $sgpSeen += $mSeen
        $sgpUp += $mUp
        if ($skipMember) {
          $sgpPartial++
          Log ("  {0}: 翻了 {1} 场后中断 ({2}), 已传 {3} 场" -f $m.name, $mSeen, $memberBad, $mUp)
        } else {
          Log ("  {0}: 翻了 {1} 场, 其中 {2} 场要传" -f $m.name, $mSeen, $mUp)
        }
        # 上传失败是另一回事 (网站那边的问题), 那个才值得中断
        if ($script:sgpBad) { break }
      }

      if ($script:sgpBad) {
        Log ("SGP: $($script:sgpBad), 退回客户端本地接口")
      } else {
        Log ("ok: SGP 翻了 {0} 场 (去重后传了 {1} 场), 新增 {2} 场, 解析不了 {3} 场" -f $sgpSeen, $sgpUp, $script:sgpNew, $script:sgpUnparsed)
        if ($sgpPartial -gt 0) { Log ("  其中 $sgpPartial 人没翻完, 再跑一次可以接着补") }
        $sgpDone = $true
      }
    }
  }

  # SGP 成功也【继续】走下面本地接口那条路, 不要在这里退出.
  # 原因: SGP 只能拿到本机这个账号自己的历史 (查别人 401), 而他不在场的车队局
  # 只能从别人的战绩里看到 —— 本地接口虽然每人只给 20 场, 但恰好补的是这一块.
  # 代价很小: 已经入库的对局不会重新拉详情.
  if ($sgpDone) { Log "SGP 那一轮完成, 继续用客户端本地接口补别人的最近对局" }

  # ---- 5. 取车队名单, 逐个翻战绩, 挑出新的 gameId ----
  # 客户端历史接口一次最多给 20 条; 部分国服客户端还会忽略翻页参数, 只给第一页.
  # 拿到 id 之后还要逐局调详情才有十个人的数据.
  $members = @()
  $rf2 = Join-Path $tmpDir "roster.json"
  $code = & curl.exe -s -m 60 -o $rf2 -w "%{http_code}" @proxyArgs "$SiteUrl/api/roster" 2>$null
  if ($code -eq "200") {
    try {
      $rj = Get-Content $rf2 -Raw -Encoding UTF8 | ConvertFrom-Json
      $members = @($rj.members)
    } catch {}
  }
  if (-not $members -or $members.Count -eq 0) {
    Log "warn: 取不到车队名单, 退回只同步本机账号"
    $members = @([pscustomobject]@{ name = "$($me.gameName)"; puuid = [string]$me.puuid })
  } else {
    Log "车队名单 $($members.Count) 人"
  }

  $newIds = New-Object System.Collections.ArrayList
  $seen = 0
  $oldestMs = 0
  $pageSize = 20
  $okMembers = 0

  foreach ($mem in $members) {
    $mp = [string]$mem.puuid
    if (-not $mp) { continue }
    $isSelf = ($mp -eq [string]$me.puuid)
    $beg = 0
    $lastSig = ""
    $gotForThis = 0
    while ($beg -lt $MaxScan) {
      $end = [Math]::Min($beg + $pageSize - 1, $MaxScan - 1)
      $lf = Join-Path $tmpDir "list.json"
      $code = LcuRaw "/lol-match-history/v1/products/lol/$mp/matches?begIndex=$beg&endIndex=$end" $lf
      if ($code -ne "200") {
        if ($beg -eq 0) {
          Log ("  {0}: 查不到 (http {1})" -f $mem.name, $code)
          if (-not $isSelf) { Log "    (客户端可能不允许查别人的战绩)" }
        }
        break
      }
      try { $list = Get-Content $lf -Raw -Encoding UTF8 | ConvertFrom-Json } catch { break }
      $games = $list.games.games
      $got = if ($games) { @($games).Count } else { 0 }
      if ($got -eq 0) { break }

      # 部分国服客户端忽略 begIndex/endIndex, 每页都返回同样的第一页
      $sig = (@($games) | ForEach-Object { [string]$_.gameId }) -join ","
      if ($sig -eq $lastSig) { break }
      $lastSig = $sig

      foreach ($g in $games) {
        $gid = [string]$g.gameId
        $seen++
        $gotForThis++
        $ms = [double]$g.gameCreation
        if ($ms -gt 0 -and ($oldestMs -eq 0 -or $ms -lt $oldestMs)) { $oldestMs = $ms }
        if ($gid -and -not $known.ContainsKey($gid)) { [void]$newIds.Add($gid) }
      }
      if ($got -lt ($end - $beg + 1)) { break }
      $beg = $end + 1
      Start-Sleep -Milliseconds 200
    }
    if ($gotForThis -gt 0) {
      $okMembers++
      # 说明这一轮为什么停: 是客户端没有更早的了, 还是撞了 MaxScan.
      # 不写清楚的话, 看到的现象就只是"只有最近两周", 会误以为是时间限制.
      $why = " (客户端没有更早的了)"
      if ($beg -ge $MaxScan) { $why = " (到 -MaxScan $MaxScan 上限, 还能更深)" }
      elseif ($gotForThis -le $pageSize) { $why = " (客户端只给了第一页, 它忽略翻页参数)" }
      Log ("  {0}: 翻到 {1} 场{2}" -f $mem.name, $gotForThis, $why)
    }
  }

  $newIds = $newIds | Select-Object -Unique
  $oldestTxt = if ($oldestMs -gt 0) {
    ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$oldestMs)).LocalDateTime.ToString("yyyy-MM-dd")
  } else { "?" }
  Log "共翻到 $seen 场 (覆盖 $okMembers 人), 最早到 $oldestTxt"
  if (-not $newIds -or $newIds.Count -eq 0) { Log "ok: 没有新对局"; exit 0 }
  Log "其中 $($newIds.Count) 场待同步"

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
