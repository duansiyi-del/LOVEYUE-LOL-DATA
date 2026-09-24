import "server-only";

import { sql } from "@vercel/postgres";
import { queueSlots, type MatchFilter } from "@/lib/db";
import type { TeamGame } from "@/lib/draft";

// 战队体检页的数据层. 思路照搬了之前那份《战队排位分析报告》的克制做法:
// 每个胜率都带 95% 置信区间, 区间跨过总体均值就说明差异说不清, 页面上直接标出来,
// 不拿几场的波动当结论.

/**
 * Wilson 置信区间. 比常见的正态近似稳, 小样本和极端胜率下不会算出负数或超过 1,
 * 这正是我们的场景 (一个组合经常只有几场).
 */
export function wilson(wins: number, games: number, z = 1.96): { lo: number; hi: number } {
  if (games <= 0) return { lo: 0, hi: 1 };
  const p = wins / games;
  const z2 = z * z;
  const denom = 1 + z2 / games;
  const center = (p + z2 / (2 * games)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / games + z2 / (4 * games * games))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** 两个比例的区间是否重叠 —— 重叠就说明差异不能当结论. */
export function overlaps(a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

export type SquadSplit = { size: number; games: number; wins: number };

/** 按车队规模 (同时在场几人) 分组的胜率. 之前那份报告里满 5 人反而最低, 值得一直盯着. */
export function squadSplits(games: TeamGame[]): SquadSplit[] {
  const acc = new Map<number, SquadSplit>();
  for (const g of games) {
    const size = g.members.length;
    const cur = acc.get(size) ?? { size, games: 0, wins: 0 };
    cur.games++;
    if (g.win) cur.wins++;
    acc.set(size, cur);
  }
  return [...acc.values()].sort((a, b) => b.size - a.size);
}

export type PresenceEffect = {
  member: string;
  inGames: number;
  inWins: number;
  outGames: number;
  outWins: number;
  delta: number; // 在场胜率 − 缺席胜率 (百分点)
};

/**
 * 某人在场 vs 缺席时全队的胜率.
 * ⚠ 这是相关不是因果: 缺席的那些局往往人更少、对手池也不同, 样本还常常很小.
 * 页面上必须连置信区间一起看.
 */
export function presenceEffects(games: TeamGame[], roster: string[]): PresenceEffect[] {
  return roster
    .map((m) => {
      let inG = 0,
        inW = 0,
        outG = 0,
        outW = 0;
      for (const g of games) {
        const here = g.members.includes(m);
        if (here) {
          inG++;
          if (g.win) inW++;
        } else {
          outG++;
          if (g.win) outW++;
        }
      }
      const delta = (inG ? inW / inG : 0) - (outG ? outW / outG : 0);
      return { member: m, inGames: inG, inWins: inW, outGames: outG, outWins: outW, delta };
    })
    .filter((x) => x.inGames > 0)
    .sort((a, b) => b.delta - a.delta);
}

export type MemberRating = {
  member: string;
  games: number;
  avgScore: number | null;
  mvp: number;
  svp: number;
  damagePerMin: number;
  kda: number | null;
};

/** 成员的评分 / MVP / SVP / 每分钟伤害. 只算正式模式且打满五分钟的局. */
export async function memberRatings(filter: MatchFilter): Promise<MemberRating[]> {
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const { rows } = await sql<{
      member: string;
      games: string;
      avg_score: string | null;
      mvp: string;
      svp: string;
      dmg_per_min: string | null;
      kills: string;
      deaths: string;
      assists: string;
    }>`
      SELECT mp.member,
             COUNT(*)::text AS games,
             AVG(mp.score)::text AS avg_score,
             SUM(CASE WHEN mp.award = 'MVP' THEN 1 ELSE 0 END)::text AS mvp,
             SUM(CASE WHEN mp.award = 'SVP' THEN 1 ELSE 0 END)::text AS svp,
             (SUM(mp.damage_to_champions)::numeric / NULLIF(SUM(m.duration_min), 0))::text AS dmg_per_min,
             SUM(mp.kills)::text AS kills,
             SUM(mp.deaths)::text AS deaths,
             SUM(mp.assists)::text AS assists
      FROM match_players mp
      JOIN matches m ON m.game_id = mp.game_id
      WHERE mp.member <> ''
        AND m.game_creation_ms >= ${filter.sinceMs}
        AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        AND m.roster_count >= ${filter.min}
        AND m.duration_min >= 5
        AND (
          (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
          OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
        )
      GROUP BY mp.member
      ORDER BY COUNT(*) DESC
    `;
    return rows.map((r) => {
      const d = Number(r.deaths);
      const ka = Number(r.kills) + Number(r.assists);
      return {
        member: r.member,
        games: Number(r.games),
        avgScore: r.avg_score === null ? null : Number(r.avg_score),
        mvp: Number(r.mvp),
        svp: Number(r.svp),
        damagePerMin: Number(r.dmg_per_min ?? 0),
        kda: d > 0 || ka > 0 ? ka / Math.max(d, 1) : null,
      };
    });
  } catch (err) {
    console.error("[memberRatings] failed", err);
    return [];
  }
}

export type MemberPosition = {
  member: string;
  position: string;
  games: number;
  wins: number;
};

/** 每个人在各个位置的场次和胜率 —— 主位置未必是打得最好的位置. */
export async function memberPositions(filter: MatchFilter): Promise<MemberPosition[]> {
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const { rows } = await sql<{ member: string; position: string; games: string; wins: string }>`
      SELECT mp.member, mp.position,
             COUNT(*)::text AS games,
             SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
      FROM match_players mp
      JOIN matches m ON m.game_id = mp.game_id
      WHERE mp.member <> ''
        AND mp.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
        AND m.game_creation_ms >= ${filter.sinceMs}
        AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        AND m.roster_count >= ${filter.min}
      GROUP BY mp.member, mp.position
      ORDER BY mp.member, COUNT(*) DESC
    `;
    return rows.map((r) => ({
      member: r.member,
      position: r.position,
      games: Number(r.games),
      wins: Number(r.wins),
    }));
  } catch (err) {
    console.error("[memberPositions] failed", err);
    return [];
  }
}

export type ObjectiveSplit = {
  label: string;
  withGames: number;
  withWins: number;
  withoutGames: number;
  withoutWins: number;
};

/**
 * 局势特征对照: 拿到一血 / 首条小龙 / 首个大龙 时的胜率, 对比没拿到时.
 * 数据来自 matches.team_stats 那坨 JSON, 在 JS 里解析 (一场一行, 量很小).
 * ⚠ 这是相关不是因果 —— 赢的队伍本来就更容易拿到这些.
 */
export async function objectiveSplits(filter: MatchFilter): Promise<ObjectiveSplit[]> {
  const defs: { key: keyof TeamStatsLite; label: string }[] = [
    { key: "firstBlood", label: "拿到一血" },
    { key: "firstDragon", label: "拿到首条小龙" },
    { key: "firstBaron", label: "拿到首个大龙" },
    { key: "firstTower", label: "拿到第一座塔" },
  ];
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const { rows } = await sql<{ team_stats: string | null; our_team_id: number; win: boolean }>`
      WITH our_team AS (
        SELECT mp.game_id, mp.team_id, BOOL_OR(mp.win) AS win
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
          AND (
            (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
            OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
          )
        GROUP BY mp.game_id, mp.team_id
        HAVING COUNT(*) >= ${filter.min}
      )
      SELECT m.team_stats, t.team_id AS our_team_id, t.win
      FROM matches m
      JOIN our_team t ON t.game_id = m.game_id
      WHERE m.team_stats IS NOT NULL
    `;
    const acc = defs.map((d) => ({
      label: d.label,
      withGames: 0,
      withWins: 0,
      withoutGames: 0,
      withoutWins: 0,
    }));
    for (const r of rows) {
      if (!r.team_stats) continue;
      let parsed: Record<string, TeamStatsLite>;
      try {
        parsed = JSON.parse(r.team_stats);
      } catch {
        continue;
      }
      const ours = parsed[String(r.our_team_id)];
      if (!ours) continue;
      defs.forEach((d, i) => {
        if (ours[d.key]) {
          acc[i].withGames++;
          if (r.win) acc[i].withWins++;
        } else {
          acc[i].withoutGames++;
          if (r.win) acc[i].withoutWins++;
        }
      });
    }
    // 一次都没拿到过的项直接不展示: 多半是这批对局里根本没有这个字段
    // (不同版本的目标物不一样), 而不是真的一次都没拿到, 摆出来只会误导.
    return acc.filter((a) => a.withGames > 0 && a.withoutGames > 0);
  } catch (err) {
    console.error("[objectiveSplits] failed", err);
    return [];
  }
}

type TeamStatsLite = {
  firstBlood?: boolean;
  firstDragon?: boolean;
  firstBaron?: boolean;
  firstTower?: boolean;
};

/**
 * 评分口径自检: 一场里全场最高分出现在胜方的比例.
 * 之前那份报告用的是同一个指标 (他们那边是 84%). 明显低于 80% 就说明评分和胜负
 * 关系太弱, 拿它做归因要打折扣.
 */
export async function ratingSanity(filter: MatchFilter): Promise<{ games: number; topOnWinner: number }> {
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const { rows } = await sql<{ games: string; hit: string }>`
      WITH ranked AS (
        SELECT mp.game_id, mp.win,
               ROW_NUMBER() OVER (PARTITION BY mp.game_id ORDER BY mp.score DESC NULLS LAST) AS rn
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.score IS NOT NULL
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
          AND (
            (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
            OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
          )
          AND m.duration_min >= 5
      )
      SELECT COUNT(*)::text AS games,
             SUM(CASE WHEN win THEN 1 ELSE 0 END)::text AS hit
      FROM ranked WHERE rn = 1
    `;
    return { games: Number(rows[0]?.games ?? 0), topOnWinner: Number(rows[0]?.hit ?? 0) };
  } catch (err) {
    console.error("[ratingSanity] failed", err);
    return { games: 0, topOnWinner: 0 };
  }
}
