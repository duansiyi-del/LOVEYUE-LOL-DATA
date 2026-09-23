# LOVEYUE LOL DATA

车队战绩站, 基于 Next.js, 部署在 Vercel, 数据存 Vercel Postgres.

## 页面

- 首页
- 选手名单 `/roster`: 成员位置与英雄池 (`src/lib/roster.ts`)
- 战绩 `/matches`: 全队车队局列表, 含评分与详情页; 顶部是同步框

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
