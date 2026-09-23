import "server-only";

import { sql } from "@vercel/postgres";
import type { MatchFilter } from "@/lib/db";
import type { ChampionProfile } from "@/lib/draftRules";

export type { ChampionProfile };

// 阵容分析的数据层. 两类东西, 样本来源不同:
//
// 1. 英雄档案 (championProfiles): 伤害构成 / 承伤占比 / 控制时长, 全部从真实
//    对局算, 而且取【双方十个人】的行, 不只我方 -- 同样的对局数, 样本是我方
//    的十倍. 只按时间过滤 (版本会改英雄), 不按「同一方几名成员」过滤.
//
// 2. 我方组合 (championPairs / enemyChampions): 只看我方 (车队成员最多的那一
//    边), 按完整筛选条件过滤.
//
// 所有"胜率"都带场次. 场次少的组合胜率是噪音, 页面上按场次门槛灰显, 这里不
// 做隐藏, 交给展示层决定.

export async function championProfiles(filter: MatchFilter): Promise<ChampionProfile[]> {
  try {
    const { rows } = await sql<{
      champion: string;
      champion_id: number | null;
      games: string;
      phys: string | null;
      magic: string | null;
      tru: string | null;
      dmg_share: string | null;
      tank_share: string | null;
      cc: string | null;
    }>`
      WITH per AS (
        SELECT
          mp.champion,
          mp.champion_id,
          COALESCE(mp.physical_damage, 0) AS phys,
          COALESCE(mp.magic_damage, 0) AS magic,
          COALESCE(mp.true_damage, 0) AS tru,
          COALESCE(mp.cc_time, 0) AS cc,
          mp.damage_to_champions::numeric
            / NULLIF(SUM(mp.damage_to_champions) OVER (PARTITION BY mp.game_id, mp.team_id), 0) AS dmg_share,
          mp.damage_taken::numeric
            / NULLIF(SUM(mp.damage_taken) OVER (PARTITION BY mp.game_id, mp.team_id), 0) AS tank_share
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.champion <> ''
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
      )
      SELECT champion, champion_id,
             COUNT(*)::text AS games,
             SUM(phys)::text AS phys, SUM(magic)::text AS magic, SUM(tru)::text AS tru,
             AVG(dmg_share)::text AS dmg_share, AVG(tank_share)::text AS tank_share,
             AVG(cc)::text AS cc
      FROM per
      GROUP BY champion, champion_id
      ORDER BY COUNT(*) DESC
    `;
    return rows.map((r) => {
      const phys = Number(r.phys ?? 0);
      const magic = Number(r.magic ?? 0);
      const tru = Number(r.tru ?? 0);
      const total = phys + magic + tru;
      return {
        champion: r.champion,
        championId: Number(r.champion_id ?? 0),
        games: Number(r.games),
        physicalShare: total > 0 ? phys / total : 0,
        magicShare: total > 0 ? magic / total : 0,
        trueShare: total > 0 ? tru / total : 0,
        damageShare: Number(r.dmg_share ?? 0),
        tankShare: Number(r.tank_share ?? 0),
        ccSeconds: Number(r.cc ?? 0),
      };
    });
  } catch (err) {
    console.error("[championProfiles] failed", err);
    return [];
  }
}

export type ChampionPair = {
  a: string;
  b: string;
  games: number;
  wins: number;
};

/** 我方同时出场的英雄两人组, 按场次降序. */
export async function championPairs(filter: MatchFilter, limit = 40): Promise<ChampionPair[]> {
  try {
    const { rows } = await sql<{ a: string; b: string; games: string; wins: string }>`
      WITH our_team AS (
        SELECT mp.game_id, mp.team_id
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        GROUP BY mp.game_id, mp.team_id
        HAVING COUNT(*) >= ${filter.min}
      ),
      ours AS (
        SELECT mp.game_id, mp.champion, mp.win
        FROM match_players mp
        JOIN our_team t ON t.game_id = mp.game_id AND t.team_id = mp.team_id
        WHERE mp.champion <> ''
      )
      SELECT x.champion AS a, y.champion AS b,
             COUNT(*)::text AS games,
             SUM(CASE WHEN x.win THEN 1 ELSE 0 END)::text AS wins
      FROM ours x
      JOIN ours y ON y.game_id = x.game_id AND x.champion < y.champion
      GROUP BY x.champion, y.champion
      ORDER BY COUNT(*) DESC, x.champion
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ a: r.a, b: r.b, games: Number(r.games), wins: Number(r.wins) }));
  } catch (err) {
    console.error("[championPairs] failed", err);
    return [];
  }
}

export type ChampionRecord = {
  champion: string;
  championId: number;
  games: number;
  wins: number;
};

/** 我方单个英雄的战绩, 用来算「组合比各自单独表现好多少」的基线. */
export async function ourChampionRecords(filter: MatchFilter): Promise<ChampionRecord[]> {
  try {
    const { rows } = await sql<{ champion: string; champion_id: number | null; games: string; wins: string }>`
      WITH our_team AS (
        SELECT mp.game_id, mp.team_id
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        GROUP BY mp.game_id, mp.team_id
        HAVING COUNT(*) >= ${filter.min}
      )
      SELECT mp.champion, mp.champion_id,
             COUNT(*)::text AS games,
             SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
      FROM match_players mp
      JOIN our_team t ON t.game_id = mp.game_id AND t.team_id = mp.team_id
      WHERE mp.champion <> ''
      GROUP BY mp.champion, mp.champion_id
      ORDER BY COUNT(*) DESC
    `;
    return rows.map((r) => ({
      champion: r.champion,
      championId: Number(r.champion_id ?? 0),
      games: Number(r.games),
      wins: Number(r.wins),
    }));
  } catch (err) {
    console.error("[ourChampionRecords] failed", err);
    return [];
  }
}

/** 对面拿过的英雄, wins 是【对面】赢的场次 -- 越高说明我们越吃这个英雄的亏. */
export async function enemyChampions(filter: MatchFilter): Promise<ChampionRecord[]> {
  try {
    const { rows } = await sql<{ champion: string; champion_id: number | null; games: string; wins: string }>`
      WITH our_team AS (
        SELECT mp.game_id, mp.team_id
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        GROUP BY mp.game_id, mp.team_id
        HAVING COUNT(*) >= ${filter.min}
      )
      SELECT mp.champion, mp.champion_id,
             COUNT(*)::text AS games,
             SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
      FROM match_players mp
      JOIN our_team t ON t.game_id = mp.game_id AND t.team_id <> mp.team_id
      WHERE mp.champion <> ''
      GROUP BY mp.champion, mp.champion_id
      ORDER BY COUNT(*) DESC
    `;
    return rows.map((r) => ({
      champion: r.champion,
      championId: Number(r.champion_id ?? 0),
      games: Number(r.games),
      wins: Number(r.wins),
    }));
  } catch (err) {
    console.error("[enemyChampions] failed", err);
    return [];
  }
}
