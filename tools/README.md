# tools

在装了国服 LoL 客户端的 Windows 上用.

## 最省事的用法

把整个 `tools` 文件夹放到一个固定位置, 双击 **`战绩同步.bat`**, 出一个菜单:
立即同步、首次全量回填、开关自动同步、设网站地址和代理、看日志、排查工具.
路径和参数都不用记, 设过的网站地址和代理会存下来, 计划任务也读同一份配置.

开关自动同步那一项要管理员权限 —— 右键 `战绩同步.bat` 选「以管理员身份运行」.

## 文件说明

| 文件 | 用途 |
|---|---|
| `战绩同步.bat` / `menu.ps1` | 启动器菜单, 平时只用这个 |
| `get_sgp_token.ps1` / `run_get_token.bat` | 手动跑一次: 打印大区、8 人 puuid、token, 并验证 SGP 接口. 加人 / 排查时用 |
| `auto_sync.ps1` | 静默自动同步, 给计划任务跑. 不弹窗, 结果写日志 |
| `probe_endpoints.ps1` / `run_probe.bat` | 排查用: 探接口、存一份原始对局 JSON |

## 自动同步怎么设 (只做一次)

前提: 这台机器上客户端登录着的时候才会同步, 没开客户端就静默跳过.

数据来自【客户端本地接口】, 不是 SGP —— SGP 那边 token 鉴权能过但任何路径都返回
400, 两台机器分别验证过, 请求在路由前就被网关挡掉了.

覆盖范围: 脚本会先从网站取车队名单, 然后【逐个查每个成员的战绩】—— 客户端接口支持
传任意 puuid (在客户端里点开别人主页看战绩就是走这条), 所以一台机器就能覆盖全队,
不用每人都装. 如果客户端拒绝查某个人, 日志里会写明, 并退回只同步本机账号; 那种情况
下就在多个成员的机器上各跑一份, 都往同一个网站推, 重复对局会自动去重.

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

   `-MaxScan` 是【每人往回翻多少场】的上限, 默认 200 —— 注意是场数不是时间,
   打得多的话 200 场可能也只有一两个月. 想把历史拉全用菜单 [2] (等于 -MaxScan 1000).
   日志里每个人后面会写清楚这一轮是翻到头了还是撞了上限. 加了新字段想重刷旧对局
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
