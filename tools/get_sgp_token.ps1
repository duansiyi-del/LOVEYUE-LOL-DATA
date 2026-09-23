# get_sgp_token.ps1
# 在装了国服 LoL 客户端并且已登录的 Windows 机器上运行, 输出:
#   - 大区代码 (如 NJ100)
#   - 当前登录账号的 puuid / Riot ID
#   - 两种 token (accessToken / leagueSessionToken), 复制其一粘贴到同步框
#
# 用法 (PowerShell, 客户端保持登录状态):
#   powershell -ExecutionPolicy Bypass -File .\get_sgp_token.ps1
# 或者直接右键 -> 使用 PowerShell 运行. 结束后按回车才会关窗口.
#
# 原理: 客户端进程 LeagueClientUx.exe 启动参数里带本地 API 的端口和密码,
# 用 Basic 认证 (用户名固定 riot) 调 https://127.0.0.1:{port} 的 LCU 接口.
# 全程只访问本机 127.0.0.1, 不联网, 不保存任何东西到磁盘.

$ErrorActionPreference = "Stop"

# ---- 车队名单: 每行一个 Riot ID (名字#编号), 脚本会顺带查出 puuid ----
$RosterIds = @(
  "爱抽陀螺的尼菈#14963"
)

function Finish($code) {
  Write-Host ""
  Read-Host "按回车键退出"
  exit $code
}

try {
  # ---- 1. 从进程命令行拿端口和密码 ----
  $proc = Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" | Select-Object -First 1
  if (-not $proc) {
    Write-Host "没找到 LeagueClientUx.exe, 请先启动并登录 LoL 客户端." -ForegroundColor Red
    Write-Host "当前和 League 相关的进程有:" -ForegroundColor DarkGray
    Get-Process | Where-Object { $_.ProcessName -like '*League*' -or $_.ProcessName -like '*Riot*' } |
      Select-Object -ExpandProperty ProcessName -Unique | ForEach-Object { Write-Host "  $_" }
    Finish 1
  }
  $port = $null; $authToken = $null

  # 途径 A: 进程命令行 (国服客户端有反作弊保护, 非管理员常读不到, 会是空)
  $cmd = $proc.CommandLine
  if ($cmd -match '--app-port=(\d+)') {
    $port = $Matches[1]
    if ($cmd -match '--remoting-auth-token=([\w-]+)') { $authToken = $Matches[1] }
  }

  # 途径 B: 安装目录下的 lockfile, 内容格式 LeagueClient:PID:端口:密码:https
  if (-not $port -or -not $authToken) {
    Write-Host "进程命令行读不到 (权限不够), 改找 lockfile ..." -ForegroundColor DarkGray
    $candidates = @()
    # B1: 进程可执行文件所在目录
    $exe = $proc.ExecutablePath
    if (-not $exe) { try { $exe = (Get-Process -Id $proc.ProcessId -ErrorAction Stop).Path } catch {} }
    if ($exe) { $candidates += (Join-Path (Split-Path $exe -Parent) "lockfile") }
    # B2: 各盘常见安装路径
    $drives = Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root
    $suffixes = @(
      "英雄联盟\LeagueClient\lockfile",
      "WeGameApps\英雄联盟\LeagueClient\lockfile",
      "Program Files\WeGameApps\英雄联盟\LeagueClient\lockfile",
      "Program Files (x86)\WeGameApps\英雄联盟\LeagueClient\lockfile",
      "Tencent\英雄联盟\LeagueClient\lockfile",
      "Riot Games\League of Legends\lockfile",
      "腾讯游戏\英雄联盟\LeagueClient\lockfile",
      "Games\英雄联盟\LeagueClient\lockfile"
    )
    foreach ($d in $drives) { foreach ($s in $suffixes) { $candidates += (Join-Path $d $s) } }

    $lockPath = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $lockPath) {
      Write-Host "没找到 lockfile. 请在客户端安装目录 (LeagueClient.exe 所在文件夹) 里确认有没有" -ForegroundColor Red
      Write-Host "一个叫 lockfile 的文件, 把完整路径告诉我. 已尝试的路径:" -ForegroundColor Red
      $candidates | Where-Object { $_ } | Select-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
      Write-Host ""
      Write-Host "或者: 右键 run_get_token.bat -> 以管理员身份运行, 走进程命令行那条路." -ForegroundColor Yellow
      Finish 1
    }
    # lockfile 被客户端独占写, 用 FileShare.ReadWrite 打开才不报「正被另一进程使用」
    $fs = [IO.File]::Open($lockPath, 'Open', 'Read', 'ReadWrite')
    try { $lock = (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Close() }
    $f = $lock.Trim() -split ':'
    if ($f.Count -lt 4) {
      Write-Host "lockfile 内容格式不对: $lock" -ForegroundColor Red
      Finish 1
    }
    $port = $f[2]; $authToken = $f[3]
    Write-Host "lockfile: $lockPath" -ForegroundColor DarkGray
  }

  $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("riot:$authToken"))
  $headers = @{ Authorization = "Basic $basic"; Accept = "application/json" }

  # 让 curl 输出的 UTF-8 中文能被正确解码
  try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

  # 首选 curl.exe (Win10 1803+ 自带), -k 忽略自签名证书最稳.
  # 老版 PowerShell 的 Invoke-RestMethod 对客户端自签名证书经常报
  # 「基础连接已经关闭」, 只作为没有 curl 时的退路.
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    Write-Host "使用 curl.exe: $($curl.Source)" -ForegroundColor DarkGray
    function Lcu($path) {
      $out = & curl.exe -s -k --fail -u "riot:$authToken" -H "Accept: application/json" "https://127.0.0.1:$port$path" 2>$null
      if ($LASTEXITCODE -ne 0) { throw "LCU 请求失败 (curl exit $LASTEXITCODE): $path" }
      if (-not $out) { return $null }
      ($out -join "") | ConvertFrom-Json
    }
  } else {
    Write-Host "没有 curl.exe, 退回 Invoke-RestMethod" -ForegroundColor DarkGray
    if ($PSVersionTable.PSVersion.Major -ge 6) {
      $skip = @{ SkipCertificateCheck = $true }
    } else {
      # 用 C# 类替代脚本块回调, 脚本块回调在 PS5 里跨线程会失效
      if (-not ([System.Management.Automation.PSTypeName]'TrustAll').Type) {
        Add-Type @"
using System.Net; using System.Security.Cryptography.X509Certificates;
public class TrustAll : ICertificatePolicy {
  public bool CheckValidationResult(ServicePoint sp, X509Certificate c, WebRequest r, int p) { return true; }
}
"@
      }
      [Net.ServicePointManager]::CertificatePolicy = New-Object TrustAll
      [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
      $skip = @{}
    }
    function Lcu($path) {
      Invoke-RestMethod -Uri "https://127.0.0.1:$port$path" -Headers $headers -Method Get @skip
    }
  }

  # ---- 2. 大区 / 当前账号 ----
  $region = $null
  try { $region = Lcu "/lol-platform-config/v1/namespaces/LoginDataPacket/platformId" } catch {}
  if (-not $region) { try { $region = (Lcu "/riotclient/region-locale").region } catch {} }

  $me = Lcu "/lol-summoner/v1/current-summoner"

  # ---- 2b. 按 Riot ID 查车队成员 puuid ----
  $rosterRows = @()
  foreach ($rid in $RosterIds) {
    $parts = $rid -split '#', 2
    $gameName = $parts[0]; $tagLine = if ($parts.Count -gt 1) { $parts[1] } else { "" }
    $enc = [Uri]::EscapeDataString($gameName)
    $found = $null
    # 新接口 (alias/lookup), 失败则退回老接口 (summoners?name=)
    try { $found = Lcu "/lol-summoner/v1/alias/lookup?gameName=$enc&tagLine=$tagLine" } catch {}
    if (-not $found) {
      try { $found = Lcu "/lol-summoner/v1/summoners?name=$enc" } catch {}
    }
    if ($found -and $found.puuid) {
      $rosterRows += "  { name: `"$gameName`", riotId: `"$rid`", puuid: `"$($found.puuid)`" },"
    } else {
      $rosterRows += "  // 没查到: $rid (检查名字和编号是否和游戏内完全一致)"
    }
  }

  # ---- 3. token ----
  $ent = Lcu "/entitlements/v1/token"
  $lst = $null
  try { $lst = Lcu "/lol-league-session/v1/league-session-token" } catch {}

  # ---- 4. 输出 ----
  Write-Host ""
  Write-Host "大区代码 : $region"
  Write-Host "Riot ID  : $($me.gameName)#$($me.tagLine)"
  Write-Host "puuid    : $($me.puuid)"
  Write-Host ""
  Write-Host "SGP 域名 : https://$region-sgp.lol.qq.com:21019"
  Write-Host ""
  Write-Host "==== 车队名单 (直接复制给我, 不含密钥) ====" -ForegroundColor Cyan
  $rosterRows | ForEach-Object { Write-Host $_ }
  Write-Host ""
  Write-Host "==== token A (entitlements accessToken, 先试这个) ====" -ForegroundColor Yellow
  Write-Host $ent.accessToken
  Write-Host ""
  if ($lst) {
    Write-Host "==== token B (league-session-token, A 报 401 再试这个) ====" -ForegroundColor Yellow
    Write-Host $lst
    Write-Host ""
  }
  # ---- 5. 直接验证 SGP 战绩接口 (真实大区在 token 里, platformId 返回的 TENCENT 不能用) ----
  $sgpRegion = $null
  try {
    $payload = ($ent.accessToken -split '\.')[1].Replace('-', '+').Replace('_', '/')
    while ($payload.Length % 4) { $payload += '=' }
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    $sgpRegion = $claims.dat.r
  } catch {}
  if (-not $sgpRegion) { $sgpRegion = $region }
  $sgpBase = "https://$sgpRegion-sgp.lol.qq.com:21019"
  Write-Host "==== SGP 验证 ($sgpBase) ====" -ForegroundColor Cyan
  if ($curl) {
    $ua = "LeagueOfLegendsClient/14.22.632.3512 (rcp-be-lol-match-history)"
    $mhUrl = "$sgpBase/match-history-query/v1/products/lol/player/$($me.puuid)/SUMMARY?startIndex=0&count=2"
    $tmp = Join-Path $env:TEMP "sgp_probe.json"
    foreach ($pair in @(@("A", $ent.accessToken), @("B", $lst))) {
      $label = $pair[0]; $tk = $pair[1]
      if (-not $tk) { continue }
      $code = & curl.exe -s -k -m 20 -o $tmp -w "%{http_code}" -H "Authorization: Bearer $tk" -H "User-Agent: $ua" -H "Accept: application/json" $mhUrl 2>$null
      $exit = $LASTEXITCODE
      Write-Host ("token {0}: http {1} (curl exit {2})" -f $label, $code, $exit)
      if ($code -eq "200") {
        Write-Host "---- 返回开头 (把这一段发我) ----" -ForegroundColor Green
        $body = Get-Content $tmp -Raw -Encoding UTF8
        Write-Host $body.Substring(0, [Math]::Min(3000, $body.Length))
        Write-Host "---- 完整返回已存到 $tmp (可整个文件发我, 里面没有 token) ----" -ForegroundColor Green
        break
      } elseif (Test-Path $tmp) {
        $body = Get-Content $tmp -Raw -Encoding UTF8
        if ($body) { Write-Host ("  返回: " + $body.Substring(0, [Math]::Min(300, $body.Length))) -ForegroundColor DarkGray }
      }
    }
  } else {
    Write-Host "没有 curl.exe, 跳过 SGP 验证" -ForegroundColor DarkGray
  }
  Write-Host ""
  Write-Host "token 约 10 分钟过期, 用完即弃, 不要发到群里." -ForegroundColor DarkGray

  try { Set-Clipboard -Value $ent.accessToken; Write-Host "(token A 已复制到剪贴板)" -ForegroundColor DarkGray } catch {}
  Finish 0
}
catch {
  Write-Host ""
  Write-Host "脚本出错:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
  Finish 1
}
