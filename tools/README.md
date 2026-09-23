# tools

在装了国服 LoL 客户端的 Windows 上用. 三个文件:

| 文件 | 用途 |
|---|---|
| `get_sgp_token.ps1` / `run_get_token.bat` | 手动跑一次: 打印大区、8 人 puuid、token, 并验证 SGP 接口. 加人 / 排查时用 |
| `auto_sync.ps1` | 静默自动同步, 给计划任务跑. 不弹窗, 结果写日志 |
| `probe_endpoints.ps1` / `run_probe.bat` | 排查用: 探接口、存一份原始对局 JSON |

## 自动同步怎么设 (只做一次)

前提: 这台机器上客户端登录着的时候才会同步, 没开客户端就静默跳过.

数据来自【客户端本地接口】, 不是 SGP —— SGP 那边 token 鉴权能过但任何路径都返回
400, 两台机器分别验证过, 请求在路由前就被网关挡掉了.

⚠ 覆盖范围: 只能拿到这台机器登录的这个账号打过的对局. 但车队局只要有一个人在场,
那一局十个人的数据都在. 想覆盖更全, 就在多个成员的机器上各跑一份, 都往同一个网站
推, 重复对局会自动去重.

1. 把 `tools` 整个文件夹放到一个固定位置, 例如 `D:\loveyue\tools`.
2. 先手动跑一次看通不通 (PowerShell 里):

   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\loveyue\tools\auto_sync.ps1 -Verbose
   ```

   国内直连 vercel.app 不通的话加代理参数, 端口按你的代理软件填:

   ```powershell
   powershell -ExecutionPolicy Bypass -File D:\loveyue\tools\auto_sync.ps1 -Verbose -Proxy http://127.0.0.1:7890
   ```

   看到 `ok: 新增 N 场` 就通了.

   第一次回填想多翻一些就加 `-MaxScan 200` (默认 60 场). 加了新字段想重刷旧对局
   用 `-RefreshAll`.

3. 设计划任务 (管理员 PowerShell 里执行, 每 30 分钟一次, 登录后开始):

   ```powershell
   $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\loveyue\tools\auto_sync.ps1"'
   $trg = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30)
   $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
   Register-ScheduledTask -TaskName "LOVEYUE-LOL-Sync" -Action $act -Trigger $trg -Settings $set -RunLevel Highest -Force
   ```

   需要代理的话把 `-Argument` 里的 `.ps1"` 后面加上 ` -Proxy http://127.0.0.1:7890`.

4. 看日志: `%LOCALAPPDATA%\loveyue-sync\sync.log`. 每行一条, `ok` / `skip` / `fail`.

改网址 (比如绑了自定义域名): 改 `auto_sync.ps1` 顶部 `$SiteUrl` 的默认值, 或在计划任务参数里加 `-SiteUrl https://新域名`.

删任务: `Unregister-ScheduledTask -TaskName "LOVEYUE-LOL-Sync" -Confirm:$false`
