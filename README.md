# LOVEYUE LOL DATA

车队战绩站, 基于 Next.js, 部署在 Vercel, 数据存 Vercel Postgres.

## 页面

- 首页
- 选手名单 `/roster`: 成员位置与英雄池 (`src/lib/roster.ts`)
- 战绩 `/matches`: 全队车队局列表, 含评分与详情页; 顶部是同步框
- 阵容分析 `/draft`: 我方常用英雄组合表现、最难打的对手英雄、五人阵容体检
- 对位分析 `/matchups`: 每个人在同一分路上对过的敌方英雄、双方 ban 位习惯
- 组队归因 `/attribution`: 某几个人一起打胜率低时, 把失利分成优势没转化 / 单点
  拖累 / 路人拖累 / 全线崩盘 / 打得胶着, 并指出谁最常掉队

## 数据从哪来

战绩来自腾讯国服 LoL 客户端内部的 SGP 接口 (`src/lib/sgp.ts`), 不是公开 API.
需要一个登录中客户端签发的短期 token (约 10 分钟有效):

1. 在装了国服客户端并已登录的 Windows 上运行 `tools/get_sgp_token.ps1`
   (双击 `tools/run_get_token.bat`), 它会打印大区、名单 puuid 和 token.
2. 把 token 粘到 `/matches` 页顶部的同步框, 点同步.

token 只在那一次请求里用, 不落库不打日志.

大区、成员 puuid 在 `src/lib/matchesRoster.ts`. 拉取端尽量全存 (同一方 1 人起、2026-01-01 起);
「几人算车队局」「从哪天看」是网页上的筛选参数 (`?min=3&since=2026-09-01`),
默认值在 `src/lib/filters.ts`, 改参数只是重查库, 不动数据.

## 阵容分析怎么算的

全部基于自己库里的对局, 不接第三方胜率数据:

- **英雄档案** (伤害构成 / 承伤占比 / 控制时长) 取【双方十个人】的行, 同样的对局
  数样本是我方的十倍; 只按时间过滤, 不按「同一方几名成员」过滤.
- **组合增益** = 两个英雄一起上的胜率 − 各自单独出场胜率的平均. 场次少于 5 场的
  不参与排名 (三五场的胜率是噪音).
- **阵容体检** 的阈值在 `src/lib/draftRules.ts` 的 `STRUCTURE_RULES` 一处, 判前排
  看承伤占比, 判控制看每场控制秒数, 判伤害单一看物理 / 法术加权占比.
- **对位** 按「同一分路 + 对面那边」配对, 只计召唤师峡谷. 补刀差 / 经济差是整场
  结束时的差值, 不是对线期的 -- 我们只拉了对局汇总, 没有时间轴数据, 一场滚雪球
  会放大差值. 排序用向 50% 收缩后的胜率, 少于 3 场不进排名.
- **大盘对位胜率** 来自 OP.GG 官方 MCP 接口 (`https://mcp-api.op.gg/mcp`, 不需要
  密钥, 见 `src/lib/opgg.ts`). 关键点: `lol_get_lane_matchup_guide` 返回的
  `data.counters` 是该英雄在该分路对上【所有】英雄的完整列表, 一次调用就够, 不用
  逐对去问. 英雄名要用显示名转大写下划线 (Wukong 的 Data Dragon key 是
  MonkeyKing, 用 key 查不到). 在对位页点「刷新大盘对位数据」触发, 或
  `curl -X POST <站点>/api/opgg/refresh`. 版本更新后刷一次即可.
  ⚠ 那是全球大盘、不分段位, 只能当参照系, 结论要以我们自己的数据为准.
- **ban 位** 从 `matches.team_stats` 的 JSON 里解析, 区分「对面 ban 的」和
  「我们 ban 的」.
- **归因** 主判据是 `match_players.score` (rating.ts 在同一场十人之间归一化、按位置
  加权的 0~10 分), 不是经济: 输的一方每个人经济都低, 只看经济永远得出「大家都差」.
  阈值在 `ATTRIBUTION_RULES`. 没有 score 的老对局自动退回经济口径.

## 还没做 / 受限于数据

- **10 分钟补刀差 / 经济差**: 现在存的是整场结束时的差值, 一场滚雪球会放大它.
  真正的对线期指标要时间轴数据, 接口还没找到 —— 跑一次 `tools/run_probe.bat`
  会自动探测并把结果存到桌面.
- **对手段位 / MMR**: 现在库里没有任何段位字段, 所以「这个组合胜率高是不是因为
  对手分低」暂时答不了. 同一个探测脚本会把一场对局的完整原始 JSON 存下来, 看看
  返回里到底有没有段位, 以及有没有单独的排位接口可用.

## 加成员

1. 在 `tools/get_sgp_token.ps1` 的 `$RosterIds` 里加一行 `名字#编号`, 跑一次.
2. 把打印出的 `{ name, riotId, puuid }` 行贴进 `src/lib/matchesRoster.ts`.
3. 在 `src/lib/roster.ts` 里补一条展示信息 (位置 / 英雄池 / 头像).

## 本地开发

```bash
npm install
npm run dev
```

没有数据库时页面能打开但战绩为空. 有本地 Postgres 时把连接串填进
`.env.local` 的 `POSTGRES_URL`, 跑一次 `db/schema.sql`, 然后 `npm run dev:local`.

## 部署

Vercel 导入本仓库, Storage 接一个 Postgres 并 Connect 到项目, 然后在
Storage 的 Query 里执行一次 `db/schema.sql`. 没有其他环境变量.
