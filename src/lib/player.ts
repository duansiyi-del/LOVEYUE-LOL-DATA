import "server-only";

import { sql } from "@vercel/postgres";
import { ensureSchema, queueSlots, type MatchFilter } from "@/lib/db";
import type { LossBucket, TeamGame } from "@/lib/draft";

// 个人页的数据层.
//
// 大部分内容不在这里查库 —— 六维指标走 leaderboard, 对位走 memberMatchups,
// 队友搭配和失利归因都是从 teamGames 那一份结果里筛出来再算的 (量很小, 一场十行,
// 没必要为一个人再跑一趟 SQL). 只有分位置 / 分英雄战绩是这里自己查的, 原因见下.

export type PlayerSplit = { key: string; championId: number | null; games: number; wins: number };

/**
 * 一个人的分位置 / 分英雄战绩.
 *
 * 为什么不复用名单页的 getMemberProfiles: 那边的英雄池【故意】不分模式 (名单页要
 * 的是"他平时玩什么"), 而个人页跟着全站的模式筛选走 —— 排位和大乱斗的英雄池完全
 * 是两回事, 混在一起看没意义.
 */
async function splitBy(
  filter: MatchFilter,
  member: string,
  column: "position" | "champion"
): Promise<PlayerSplit[]> {
  const [qa, qb, qc] = queueSlots(filter);
  const toSplits = (rows: { key: string; champion_id: number | null; games: string; wins: string }[]) =>
    rows.map((r) => ({
      key: r.key,
      championId: r.champion_id,
      games: Number(r.games),
      wins: Number(r.wins),
    }));
  try {
    // 两个分支只差分组列. 列名不能当参数传 (会被当成字符串常量), 所以写两遍.
    const { rows } =
      column === "position"
        ? await sql<{ key: string; champion_id: number | null; games: string; wins: string }>`
            SELECT mp.position AS key, NULL::int AS champion_id,
                   COUNT(*)::text AS games,
                   SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
            FROM match_players mp
            JOIN matches m ON m.game_id = mp.game_id
            WHERE mp.member = ${member}
              AND mp.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
              AND m.roster_count >= ${filter.min}
              AND m.game_creation_ms >= ${filter.sinceMs}
              AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
              AND (
                (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
                OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
              )
            GROUP BY mp.position
            ORDER BY COUNT(*) DESC
          `
        : await sql<{ key: string; champion_id: number | null; games: string; wins: string }>`
            SELECT mp.champion AS key, MAX(mp.champion_id)::int AS champion_id,
                   COUNT(*)::text AS games,
                   SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
            FROM match_players mp
            JOIN matches m ON m.game_id = mp.game_id
            WHERE mp.member = ${member}
              AND mp.champion <> ''
              AND m.roster_count >= ${filter.min}
              AND m.game_creation_ms >= ${filter.sinceMs}
              AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
              AND (
                (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
                OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
              )
            GROUP BY mp.champion
            ORDER BY COUNT(*) DESC
          `;
    return toSplits(rows);
  } catch (err) {
    console.error("[splitBy] failed", column, err);
    return [];
  }
}

export function playerPositions(filter: MatchFilter, member: string) {
  return splitBy(filter, member, "position");
}

export function playerChampions(filter: MatchFilter, member: string) {
  return splitBy(filter, member, "champion");
}

export type TeammateSynergy = {
  teammate: string;
  /** 两个人同时在场 */
  together: number;
  togetherWins: number;
  /** 本人在场、这个队友不在 */
  apart: number;
  apartWins: number;
  /** 一起打的胜率 − 分开打的胜率 */
  delta: number;
};

/**
 * 队友红黑榜: 和谁一起打赢得多.
 *
 * 对照组用的是【本人在场但这个队友不在】的那些局, 不是全队平均 —— 否则算出来的
 * 只是"这个人自己强不强", 和搭配没关系.
 *
 * ⚠ 这是相关不是因果. 两个人一起上的局通常车队人数更多、时间段也不同, 样本还常常
 * 很小, 所以展示层必须连置信区间一起看, 区间重叠就当没差异.
 */
export function teammateSynergy(games: TeamGame[], member: string): TeammateSynergy[] {
  const mine = games.filter((g) => g.members.includes(member));
  const acc = new Map<string, TeammateSynergy>();
  const touch = (t: string) =>
    acc.get(t) ??
    (acc.set(t, { teammate: t, together: 0, togetherWins: 0, apart: 0, apartWins: 0, delta: 0 }),
    acc.get(t)!);

  // 先把出现过的队友收集齐, 再逐场记同场/不同场 —— 只在同场时才 touch 的话,
  // 从没同场过的人会缺行, 而"分开打"的分母也会算错.
  const others = new Set<string>();
  for (const g of mine) for (const m of g.members) if (m !== member) others.add(m);

  for (const g of mine) {
    for (const t of others) {
      const row = touch(t);
      if (g.members.includes(t)) {
        row.together++;
        if (g.win) row.togetherWins++;
      } else {
        row.apart++;
        if (g.win) row.apartWins++;
      }
    }
  }

  return [...acc.values()]
    .map((r) => ({
      ...r,
      delta: (r.together ? r.togetherWins / r.together : 0) - (r.apart ? r.apartWins / r.apart : 0),
    }))
    .filter((r) => r.together > 0)
    .sort((a, b) => b.together - a.together);
}

export type PlayerLossBreakdown = {
  losses: number;
  buckets: { bucket: LossBucket; count: number }[];
  /** 在多少场失利里, 本人是我方评分最低的那个 */
  worstCount: number;
};

/** 本人在场的失利局是怎么输的, 以及其中有多少场自己是队内最低分. */
export function playerLosses(games: TeamGame[], member: string): PlayerLossBreakdown {
  const mine = games.filter((g) => g.members.includes(member) && !g.win);
  const counts = new Map<LossBucket, number>();
  let worst = 0;
  for (const g of mine) {
    if (g.bucket) counts.set(g.bucket, (counts.get(g.bucket) ?? 0) + 1);
    if (g.worstLane && g.worstLane.member === member) worst++;
  }
  return {
    losses: mine.length,
    buckets: [...counts.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => b.count - a.count),
    worstCount: worst,
  };
}

export type RecentGame = {
  gameId: string;
  gameCreationMs: number;
  queueName: string;
  win: boolean;
  champion: string;
  position: string;
  score: number | null;
};

/** 本人最近的几场, 取自己那一行. */
export function recentGames(games: TeamGame[], member: string, limit = 10): RecentGame[] {
  return games
    .filter((g) => g.members.includes(member))
    .sort((a, b) => b.gameCreationMs - a.gameCreationMs)
    .slice(0, limit)
    .map((g) => {
      const lane = g.lanes.find((l) => l.member === member);
      return {
        gameId: g.gameId,
        gameCreationMs: g.gameCreationMs,
        queueName: g.queueName,
        win: g.win,
        champion: lane?.champion ?? "",
        position: lane?.position ?? "",
        score: lane?.score ?? null,
      };
    });
}

// ---- 成长趋势 / 英雄熟练度 --------------------------------------------

export type MonthPoint = { month: string; games: number; wins: number; avgScore: number | null };

/**
 * 按月的场次 / 胜率 / 平均评分 —— 回答"他在进步还是退步".
 *
 * 月份按【北京时间】切: 库里存的是 UTC 毫秒, 直接按 UTC 分组会把凌晨那几局算到
 * 上个月去, 而开黑恰恰经常打到凌晨. to_timestamp 之后转成 Asia/Shanghai 再截断.
 *
 * 场次太少的月份照样返回, 由展示层灰显 —— 这里不替页面决定什么算"够".
 */
export async function monthlyTrend(filter: MatchFilter, member: string): Promise<MonthPoint[]> {
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const { rows } = await sql<{ month: string; games: string; wins: string; avg_score: string | null }>`
      SELECT to_char(
               date_trunc('month', to_timestamp(m.game_creation_ms / 1000.0) AT TIME ZONE 'Asia/Shanghai'),
               'YYYY-MM'
             ) AS month,
             COUNT(*)::text AS games,
             SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins,
             AVG(mp.score)::text AS avg_score
      FROM match_players mp
      JOIN matches m ON m.game_id = mp.game_id
      WHERE mp.member = ${member}
        AND m.roster_count >= ${filter.min}
        AND m.game_creation_ms >= ${filter.sinceMs}
        AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        AND m.duration_min >= 5
        AND (
          (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
          OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
        )
      GROUP BY 1
      ORDER BY 1
    `;
    return rows.map((r) => ({
      month: r.month,
      games: Number(r.games),
      wins: Number(r.wins),
      avgScore: r.avg_score === null ? null : Number(r.avg_score),
    }));
  } catch (err) {
    console.error("[monthlyTrend] failed", err);
    return [];
  }
}

export type LearningPoint = { label: string; games: number; wins: number };

/**
 * 英雄熟练度曲线: 把每个英雄按时间排序, 看"第几次玩这个英雄"时的胜率, 再把所有
 * 英雄叠在一起.
 *
 * 回答的是"还在学 vs 已经练成了": 如果前 5 场和 20 场以后没差别, 那说明练不练
 * 没区别 (可能是英雄本身简单, 也可能是他根本没在练); 如果差很多, 那生手期的
 * 代价是真的, 排位里别拿新英雄试.
 *
 * ⚠ 叠在一起看会混进"他本来就擅长的英雄玩得多"这个偏差 —— 玩到 20 场以上的
 * 英雄本来就是他打得好的那几个. 所以这里只当粗看, 页面上要写明.
 */
export async function championLearning(filter: MatchFilter, member: string): Promise<LearningPoint[]> {
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const { rows } = await sql<{ champion: string; win: boolean; ms: string }>`
      SELECT mp.champion, mp.win, m.game_creation_ms::text AS ms
      FROM match_players mp
      JOIN matches m ON m.game_id = mp.game_id
      WHERE mp.member = ${member}
        AND mp.champion <> ''
        AND m.roster_count >= ${filter.min}
        AND m.game_creation_ms >= ${filter.sinceMs}
        AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        AND m.duration_min >= 5
        AND (
          (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
          OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
        )
      ORDER BY m.game_creation_ms ASC
    `;
    // 「第几次玩」在 JS 里数: SQL 的窗口函数也行, 但这一层数据量很小 (一个人一年
    // 几百行), 放 JS 里改起来方便, 也和其他派生统计的做法一致.
    const seen = new Map<string, number>();
    const defs = [
      { label: "前 5 场", lo: 1, hi: 5 },
      { label: "第 6~10 场", lo: 6, hi: 10 },
      { label: "第 11~20 场", lo: 11, hi: 20 },
      { label: "第 21 场以后", lo: 21, hi: Infinity },
    ];
    const acc = defs.map((d) => ({ label: d.label, games: 0, wins: 0 }));
    for (const r of rows) {
      const n = (seen.get(r.champion) ?? 0) + 1;
      seen.set(r.champion, n);
      const i = defs.findIndex((d) => n >= d.lo && n <= d.hi);
      if (i < 0) continue;
      acc[i].games++;
      if (r.win) acc[i].wins++;
    }
    return acc.filter((a) => a.games > 0);
  } catch (err) {
    console.error("[championLearning] failed", err);
    return [];
  }
}

// ---- 单英雄专项: 值不值得练 + 有没有进步 ----------------------------------

export type GameRow = {
  gameId: string;
  ms: number;
  win: boolean;
  position: string;
  champion: string;
  championId: number;
  score: number | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
  durationMin: number;
  /** 我方五人总击杀, 算参团率的分母 */
  teamKills: number;
  /** 我方五人总死亡, 算死亡占比的分母 */
  teamDeaths: number;
  /** 对位 (同局对面同位置) 的经济 / 补刀; 没有分路的局是 null */
  oppGold: number | null;
  oppCs: number | null;
  champLevel: number;
  oppLevel: number | null;
  firstBlood: boolean;
  // ---- 对线期 (Riot challenges). 客户端本地接口来的局全是 null ----
  laneMinions10: number | null;
  oppLaneMinions10: number | null;
  laningGoldExpAdv: number | null;
  earlyLaningGoldExpAdv: number | null;
  maxCsAdvLaneOpp: number | null;
  maxLevelLeadLaneOpp: number | null;
  turretPlates: number | null;
  soloKills: number | null;
};

/**
 * 一个人的逐场行, 带参团率分母和对位数据. 单英雄分析全从这份结果在 JS 里算.
 *
 * 为什么一次取全部而不是只取那个英雄: "同期对照" 要他同一时间窗口内用【其他】
 * 英雄的表现, 反正都要取; 一个人一年几百行, 一次取完比分两趟查省事也省连接.
 *
 * ⚠ team_kills 必须在【未过滤】的全表上算 (和 leaderboard 里参团率 278% 那个坑
 * 是同一个): 分母是我方五个人的击杀, 不是只有车队成员的.
 */
export async function playerGameRows(filter: MatchFilter, member: string): Promise<GameRow[]> {
  const [qa, qb, qc] = queueSlots(filter);
  try {
    // 对线期那几列是后加的, 老库没有时整条查询会报错被吞成空数组 —— 读之前先补列
    await ensureSchema();
    const { rows } = await sql<{
      game_id: string;
      ms: string;
      win: boolean;
      position: string;
      champion: string;
      champion_id: number | null;
      score: string | null;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
      gold: number;
      duration_min: string | null;
      team_kills: string | null;
      team_deaths: string | null;
      opp_gold: number | null;
      opp_cs: number | null;
      champ_level: number;
      opp_level: number | null;
      first_blood: boolean;
      lane_minions_10: number | null;
      opp_lane_minions_10: number | null;
      laning_gold_exp_adv: string | null;
      early_laning_gold_exp_adv: string | null;
      max_cs_adv_lane_opp: string | null;
      max_level_lead_lane_opp: number | null;
      turret_plates: number | null;
      solo_kills: number | null;
    }>`
      WITH team_kills AS (
        SELECT game_id, team_id, SUM(kills) AS tk, SUM(deaths) AS td
        FROM match_players
        GROUP BY game_id, team_id
      ),
      mine AS (
        SELECT mp.game_id, mp.team_id, mp.position, mp.champion, mp.champion_id, mp.win, mp.score,
               mp.kills, mp.deaths, mp.assists, mp.cs, mp.gold, mp.champ_level, mp.first_blood,
               mp.lane_minions_10, mp.laning_gold_exp_adv, mp.early_laning_gold_exp_adv,
               mp.max_cs_adv_lane_opp, mp.max_level_lead_lane_opp, mp.turret_plates, mp.solo_kills,
               m.duration_min, m.game_creation_ms
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member = ${member}
          AND mp.champion <> ''
          AND m.roster_count >= ${filter.min}
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
          AND m.duration_min >= 5
          AND (
            (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
            OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
          )
      )
      SELECT mine.game_id, mine.game_creation_ms::text AS ms, mine.win, mine.position, mine.champion,
             mine.champion_id, mine.score::text AS score, mine.kills, mine.deaths, mine.assists,
             mine.cs, mine.gold, mine.duration_min::text AS duration_min,
             tk.tk::text AS team_kills, tk.td::text AS team_deaths,
             o.gold AS opp_gold, o.cs AS opp_cs, o.champ_level AS opp_level,
             o.lane_minions_10 AS opp_lane_minions_10,
             mine.champ_level, mine.first_blood, mine.lane_minions_10,
             mine.laning_gold_exp_adv::text AS laning_gold_exp_adv,
             mine.early_laning_gold_exp_adv::text AS early_laning_gold_exp_adv,
             mine.max_cs_adv_lane_opp::text AS max_cs_adv_lane_opp,
             mine.max_level_lead_lane_opp, mine.turret_plates, mine.solo_kills
      FROM mine
      LEFT JOIN team_kills tk ON tk.game_id = mine.game_id AND tk.team_id = mine.team_id
      LEFT JOIN match_players o
        ON o.game_id = mine.game_id
       AND o.team_id <> mine.team_id
       AND o.position = mine.position
       AND mine.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      ORDER BY mine.game_creation_ms ASC
    `;
    return rows.map((r) => ({
      gameId: r.game_id,
      ms: Number(r.ms),
      win: r.win,
      position: r.position,
      champion: r.champion,
      championId: Number(r.champion_id ?? 0),
      score: r.score === null ? null : Number(r.score),
      kills: Number(r.kills),
      deaths: Number(r.deaths),
      assists: Number(r.assists),
      cs: Number(r.cs),
      gold: Number(r.gold),
      durationMin: Number(r.duration_min ?? 0),
      teamKills: Number(r.team_kills ?? 0),
      teamDeaths: Number(r.team_deaths ?? 0),
      oppGold: r.opp_gold === null ? null : Number(r.opp_gold),
      oppCs: r.opp_cs === null ? null : Number(r.opp_cs),
      champLevel: Number(r.champ_level ?? 0),
      oppLevel: r.opp_level === null ? null : Number(r.opp_level),
      firstBlood: Boolean(r.first_blood),
      laneMinions10: r.lane_minions_10 === null ? null : Number(r.lane_minions_10),
      oppLaneMinions10: r.opp_lane_minions_10 === null ? null : Number(r.opp_lane_minions_10),
      laningGoldExpAdv: r.laning_gold_exp_adv === null ? null : Number(r.laning_gold_exp_adv),
      earlyLaningGoldExpAdv: r.early_laning_gold_exp_adv === null ? null : Number(r.early_laning_gold_exp_adv),
      maxCsAdvLaneOpp: r.max_cs_adv_lane_opp === null ? null : Number(r.max_cs_adv_lane_opp),
      maxLevelLeadLaneOpp: r.max_level_lead_lane_opp === null ? null : Number(r.max_level_lead_lane_opp),
      turretPlates: r.turret_plates === null ? null : Number(r.turret_plates),
      soloKills: r.solo_kills === null ? null : Number(r.solo_kills),
    }));
  } catch (err) {
    console.error("[playerGameRows] failed", err);
    return [];
  }
}

export type MetricStat = { mean: number; se: number; n: number };

export type MetricCompare = {
  key: string;
  label: string;
  lowerIsBetter: boolean;
  format: (v: number) => string;
  a: MetricStat;
  b: MetricStat;
  /** b − a */
  diff: number;
  /** 两个均值之差能不能当结论: |diff| > 1.96 × 合并标准误 */
  significant: boolean;
};

const METRICS: {
  key: string;
  label: string;
  lowerIsBetter: boolean;
  format: (v: number) => string;
  of: (r: GameRow) => number | null;
}[] = [
  { key: "score", label: "评分", lowerIsBetter: false, format: (v) => v.toFixed(2), of: (r) => r.score },
  { key: "deaths", label: "场均死亡", lowerIsBetter: true, format: (v) => v.toFixed(1), of: (r) => r.deaths },
  // 我的死亡占全队死亡的比例, 五人均摊 20%. 用来和对位经济差对照: 对面领先但我
  // 死亡占比低 → 对面是从队友身上吃饱的, 不是我送的 (用户原话: "很多时候死的不是我").
  {
    key: "deathShare",
    label: "死亡占比",
    lowerIsBetter: true,
    format: (v) => `${Math.round(v * 100)}%`,
    of: (r) => (r.teamDeaths > 0 ? r.deaths / r.teamDeaths : null),
  },
  {
    key: "csPerMin",
    label: "补刀/分",
    lowerIsBetter: false,
    format: (v) => v.toFixed(1),
    of: (r) => (r.durationMin > 0 ? r.cs / r.durationMin : null),
  },
  {
    key: "kp",
    label: "参团率",
    lowerIsBetter: false,
    format: (v) => `${Math.round(v * 100)}%`,
    of: (r) => (r.teamKills > 0 ? (r.kills + r.assists) / r.teamKills : null),
  },
  {
    key: "goldDiff",
    label: "对位经济差",
    lowerIsBetter: false,
    format: (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`,
    of: (r) => (r.oppGold === null ? null : r.gold - r.oppGold),
  },
  {
    key: "csDiff",
    label: "对位补刀差",
    lowerIsBetter: false,
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`,
    of: (r) => (r.oppCs === null ? null : r.cs - r.oppCs),
  },
  // 下面四个来自 Riot 的对线期统计; 客户端本地接口来的局是 null, compare() 会自动跳过
  {
    key: "cs10Diff",
    label: "10 分钟补刀差",
    lowerIsBetter: false,
    format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`,
    of: (r) => (r.laneMinions10 === null || r.oppLaneMinions10 === null ? null : r.laneMinions10 - r.oppLaneMinions10),
  },
  {
    key: "laningAdv",
    label: "对线期经济经验优势",
    lowerIsBetter: false,
    format: (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`,
    of: (r) => r.laningGoldExpAdv,
  },
  { key: "soloKills", label: "单杀/场", lowerIsBetter: false, format: (v) => v.toFixed(2), of: (r) => r.soloKills },
  { key: "plates", label: "镀层/场", lowerIsBetter: false, format: (v) => v.toFixed(2), of: (r) => r.turretPlates },
];

function stat(values: number[]): MetricStat {
  const n = values.length;
  if (n === 0) return { mean: 0, se: Infinity, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { mean, se: Infinity, n };
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { mean, se: sd / Math.sqrt(n), n };
}

function compare(
  m: (typeof METRICS)[number],
  rowsA: GameRow[],
  rowsB: GameRow[]
): MetricCompare {
  const pick = (rows: GameRow[]) => rows.map(m.of).filter((v): v is number => v !== null && Number.isFinite(v));
  const a = stat(pick(rowsA));
  const b = stat(pick(rowsB));
  const diff = b.mean - a.mean;
  const seDiff = Math.sqrt(a.se ** 2 + b.se ** 2);
  return {
    key: m.key,
    label: m.label,
    lowerIsBetter: m.lowerIsBetter,
    format: m.format,
    a,
    b,
    diff,
    significant: Number.isFinite(seDiff) && Math.abs(diff) > 1.96 * seDiff,
  };
}

export type HalfCompare = MetricCompare & {
  /** 他同期用【其他】英雄的前后变化; 没有对照数据时 null */
  peerDiff: number | null;
  verdict: "有进步" | "在退步" | "整体状态在变" | "看不出";
};

export type ChampionReport = {
  champion: string;
  championId: number;
  games: number;
  wins: number;
  byPosition: { position: string; games: number }[];
  /** 主位置占比不到 80%: 前后对比可能混进了位置变化 */
  mixedPositions: boolean;
  mainPosition: string;
  // 值不值得练. 对照组是他用其他英雄打【同位置】的局 (有分路时)
  otherGames: number;
  otherWins: number;
  /** 对照组限定了位置 (mainPosition 是五个正经分路之一) */
  othersSamePosition: boolean;
  vsOthers: MetricCompare[];
  // 有没有进步
  learning: { label: string; games: number; wins: number }[];
  /** 场次不够 (少于 MIN_HALVES) 时为 null */
  halves: HalfCompare[] | null;
};

export const MIN_CHAMPION_REPORT = 6;
export const MIN_HALVES = 10;

/**
 * 单英雄专项分析. 全部在 JS 里从 playerGameRows 那份结果算.
 *
 * 两个问题分开答:
 *   值不值得练 = 绝对水平: 他用这英雄 vs 他用其他英雄 (全期), 40 场足够答.
 *   有没有进步 = 时间上的变化: 前半 vs 后半. 40 场只够抓住明显的跃迁, 小幅稳步
 *                进步看不出来 —— 页面上要把这个说清楚, 别让人以为"没进步".
 *
 * 为什么不拿胜率当进步指标: 一场只有 1 bit, 40 场的区间宽 30 个百分点, 切两半
 * 更宽. 评分 / 死亡 / 补刀 / 参团率 / 对位经济差是连续量, 同样样本信息量大得多;
 * 评分还是同场十人归一化的, 天然扣掉了对手强度.
 *
 * 同期对照 (peerDiff): 光看"这英雄评分涨了"不行, 可能是他整个人最近状态好.
 * 减掉他同一时间窗口内用其他英雄的变化, 剩下的才是这个英雄本身的长进.
 */
export function championReport(rows: GameRow[], champion: string): ChampionReport | null {
  const mine = rows.filter((r) => r.champion === champion);
  if (mine.length < MIN_CHAMPION_REPORT) return null;

  const posCount = new Map<string, number>();
  for (const r of mine) posCount.set(r.position || "—", (posCount.get(r.position || "—") ?? 0) + 1);
  const byPosition = [...posCount.entries()]
    .map(([position, games]) => ({ position, games }))
    .sort((a, b) => b.games - a.games);
  const mainPosition = byPosition[0]?.position ?? "";
  const mixedPositions = (byPosition[0]?.games ?? 0) / mine.length < 0.8;

  // 对照组 = 他用其他英雄打【同一个位置】的局.
  //
  // 上线后拿真数据一看就露馅了: 花哥的奥拉夫全是上单, 而他"其他英雄"里辅助占
  // 大头 —— 于是补刀/分 +2.0 "明显更好"、参团率 -7% "明显更差", 全是上单和辅助
  // 的位置差异, 和奥拉夫这个英雄毫无关系. 同期对照 (peerDiff) 也被同样污染.
  // 没有分路的局 (大乱斗等) mainPosition 是 "—", 那就退回不限位置.
  const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
  const samePos = LANES.includes(mainPosition);
  const others = rows.filter(
    (r) => r.champion !== champion && (!samePos || r.position === mainPosition)
  );

  // 熟练度: 第几次玩这个英雄
  const defs = [
    { label: "前 5 场", lo: 1, hi: 5 },
    { label: "第 6~10 场", lo: 6, hi: 10 },
    { label: "第 11~20 场", lo: 11, hi: 20 },
    { label: "第 21 场以后", lo: 21, hi: Infinity },
  ];
  const learning = defs.map((d) => ({ label: d.label, games: 0, wins: 0 }));
  mine.forEach((r, i) => {
    const n = i + 1;
    const k = defs.findIndex((d) => n >= d.lo && n <= d.hi);
    if (k < 0) return;
    learning[k].games++;
    if (r.win) learning[k].wins++;
  });

  // 前后对比 + 同期对照
  let halves: HalfCompare[] | null = null;
  if (mine.length >= MIN_HALVES) {
    const mid = Math.floor(mine.length / 2);
    const first = mine.slice(0, mid);
    const second = mine.slice(mid);
    // 同期 = 这个英雄第一场到最后一场之间; 分界点用同一个时刻, 两边才可比
    const splitMs = second[0].ms;
    const peerFirst = others.filter((r) => r.ms >= mine[0].ms && r.ms < splitMs);
    const peerSecond = others.filter((r) => r.ms >= splitMs && r.ms <= mine[mine.length - 1].ms);

    halves = METRICS.map((m) => {
      const c = compare(m, first, second);
      const peer = compare(m, peerFirst, peerSecond);
      const peerDiff = peer.a.n >= 3 && peer.b.n >= 3 ? peer.diff : null;
      const good = m.lowerIsBetter ? c.diff < 0 : c.diff > 0;
      let verdict: HalfCompare["verdict"] = "看不出";
      if (c.significant) {
        // 其他英雄同期也朝同一个方向变了差不多的量 → 是他整个人在变, 不是这个英雄
        const sameWay = peerDiff !== null && Math.sign(peerDiff) === Math.sign(c.diff);
        if (sameWay && Math.abs(peerDiff!) >= Math.abs(c.diff) / 2) verdict = "整体状态在变";
        else verdict = good ? "有进步" : "在退步";
      }
      return { ...c, peerDiff, verdict };
    });
  }

  return {
    champion,
    championId: mine[0].championId,
    games: mine.length,
    wins: mine.filter((r) => r.win).length,
    byPosition,
    mixedPositions,
    mainPosition,
    otherGames: others.length,
    otherWins: others.filter((r) => r.win).length,
    othersSamePosition: samePos,
    vsOthers: METRICS.map((m) => compare(m, others, mine)),
    learning: learning.filter((l) => l.games > 0),
    halves,
  };
}


// ---- 对线情况 (个人页一节) --------------------------------------------

export type LaneStat = {
  position: string;
  games: number;
  /** 整场经济压过对位的局数 —— "赢线率" 的分子 */
  laneWins: number;
  firstBloods: number;
  goldDiff: MetricStat;
  csDiff: MetricStat;
  levelDiff: MetricStat;
  /** 我的死亡 / 全队死亡, 五人均摊 20% */
  deathShare: MetricStat;
  // 对线期 (Riot challenges), n = 0 表示这些局里没有这份数据
  cs10Diff: MetricStat;
  laningAdv: MetricStat;
  soloKills: MetricStat;
  plates: MetricStat;
};

export const MIN_LANE_GAMES = 5;

/**
 * 每个位置的对线表现. "对位" = 同局对面同位置的人.
 *
 * 两层口径混在一张表里, 要分清:
 *   整场口径 (对位经济差 / 补刀差 / 等级差 / 赢线率): 现有数据就有, 但会被中后期团战
 *     和滚雪球放大 —— 一条线 10 分钟时打平, 团战赢了整场经济差也能到 +2000.
 *   对线期口径 (10 分钟补刀差 / 对线期经济经验优势 / 单杀 / 镀层): 才是真正的"对线",
 *     来自 Riot 的 challenges, 只有 SGP 拉的局有, 老对局要重刷一次才有.
 * 用户最初想看的就是后者 ("10 分钟补刀差"), 前者是过渡, 表头上要写明.
 */
export function laningReport(rows: GameRow[]): LaneStat[] {
  const LANES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
  const out: LaneStat[] = [];
  for (const position of LANES) {
    const mine = rows.filter((r) => r.position === position && r.oppGold !== null);
    if (mine.length < MIN_LANE_GAMES) continue;
    const pick = (f: (r: GameRow) => number | null) =>
      mine.map(f).filter((v): v is number => v !== null && Number.isFinite(v));
    out.push({
      position,
      games: mine.length,
      laneWins: mine.filter((r) => r.gold - (r.oppGold as number) > 0).length,
      firstBloods: mine.filter((r) => r.firstBlood).length,
      goldDiff: stat(pick((r) => r.gold - (r.oppGold as number))),
      csDiff: stat(pick((r) => (r.oppCs === null ? null : r.cs - r.oppCs))),
      levelDiff: stat(pick((r) => (r.oppLevel === null ? null : r.champLevel - r.oppLevel))),
      deathShare: stat(pick((r) => (r.teamDeaths > 0 ? r.deaths / r.teamDeaths : null))),
      cs10Diff: stat(
        pick((r) => (r.laneMinions10 === null || r.oppLaneMinions10 === null ? null : r.laneMinions10 - r.oppLaneMinions10))
      ),
      laningAdv: stat(pick((r) => r.laningGoldExpAdv)),
      soloKills: stat(pick((r) => r.soloKills)),
      plates: stat(pick((r) => r.turretPlates)),
    });
  }
  return out.sort((a, b) => b.games - a.games);
}
