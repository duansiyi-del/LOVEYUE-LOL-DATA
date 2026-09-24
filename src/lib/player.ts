import "server-only";

import { sql } from "@vercel/postgres";
import { queueSlots, type MatchFilter } from "@/lib/db";
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
