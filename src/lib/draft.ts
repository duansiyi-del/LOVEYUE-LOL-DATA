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

// ---- 个人对位 ------------------------------------------------------------
// 把我方成员和【同一分路、对面那边】的人配成对位. 只看召唤师峡谷 (大乱斗没有
// 分路). 打野对打野、辅助对辅助也算对位.
//
// 注意 csDiff / goldDiff 是【整场结束时】的差值, 不是对线期的差值 -- 我们只拉
// 了对局汇总, 没拉时间轴数据, 所以一场顺风崩盘会把差值放大. 它衡量的是"这一路
// 整场下来吃没吃亏", 不等于"对线阶段谁赢". 胜率同理: 一路赢了但团队输了很常见.

export type MemberMatchup = {
  member: string;
  enemyChampion: string;
  enemyChampionId: number;
  games: number;
  wins: number;
  csDiff: number;
  goldDiff: number;
  // 常用哪几个英雄去对位 (按场次)
  ownChampions: string[];
};

const RIFT = ["单双排", "灵活组排", "匹配"];

export async function memberMatchups(filter: MatchFilter): Promise<MemberMatchup[]> {
  try {
    const { rows } = await sql<{
      member: string;
      enemy_champion: string;
      enemy_champion_id: number | null;
      games: string;
      wins: string;
      cs_diff: string | null;
      gold_diff: string | null;
      own_champions: string[] | null;
    }>`
      WITH our_team AS (
        SELECT mp.game_id, mp.team_id
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
          AND m.queue_name IN (${RIFT[0]}, ${RIFT[1]}, ${RIFT[2]})
        GROUP BY mp.game_id, mp.team_id
        HAVING COUNT(*) >= ${filter.min}
      ),
      ours AS (
        SELECT mp.game_id, mp.member, mp.position, mp.champion AS own_champion,
               mp.win, mp.cs, mp.gold
        FROM match_players mp
        JOIN our_team t ON t.game_id = mp.game_id AND t.team_id = mp.team_id
        WHERE mp.member <> ''
          AND mp.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
      ),
      theirs AS (
        SELECT mp.game_id, mp.position, mp.champion, mp.champion_id, mp.cs, mp.gold
        FROM match_players mp
        JOIN our_team t ON t.game_id = mp.game_id AND t.team_id <> mp.team_id
        WHERE mp.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
          AND mp.champion <> ''
      )
      SELECT o.member,
             e.champion AS enemy_champion,
             e.champion_id AS enemy_champion_id,
             COUNT(*)::text AS games,
             SUM(CASE WHEN o.win THEN 1 ELSE 0 END)::text AS wins,
             AVG(o.cs - e.cs)::text AS cs_diff,
             AVG(o.gold - e.gold)::text AS gold_diff,
             ARRAY_AGG(DISTINCT o.own_champion) AS own_champions
      FROM ours o
      JOIN theirs e ON e.game_id = o.game_id AND e.position = o.position
      GROUP BY o.member, e.champion, e.champion_id
      ORDER BY o.member, COUNT(*) DESC
    `;
    return rows.map((r) => ({
      member: r.member,
      enemyChampion: r.enemy_champion,
      enemyChampionId: Number(r.enemy_champion_id ?? 0),
      games: Number(r.games),
      wins: Number(r.wins),
      csDiff: Number(r.cs_diff ?? 0),
      goldDiff: Number(r.gold_diff ?? 0),
      ownChampions: (r.own_champions ?? []).filter(Boolean),
    }));
  } catch (err) {
    console.error("[memberMatchups] failed", err);
    return [];
  }
}

// ---- ban 位 --------------------------------------------------------------
// bans 存在 matches.team_stats 这一坨 JSON 里 (每队一个 bans 数组, 元素是英雄
// 数字 id), 所以在 JS 里解析, 不在 SQL 里. 一场一行, 量很小.

export type BanStat = { championId: number; count: number };

export async function banStats(
  filter: MatchFilter
): Promise<{ againstUs: BanStat[]; byUs: BanStat[]; matches: number }> {
  try {
    const { rows } = await sql<{ team_stats: string | null; our_team_id: number }>`
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
      SELECT m.team_stats, t.team_id AS our_team_id
      FROM matches m
      JOIN our_team t ON t.game_id = m.game_id
      WHERE m.team_stats IS NOT NULL
    `;
    const against = new Map<number, number>();
    const by = new Map<number, number>();
    let counted = 0;
    for (const r of rows) {
      if (!r.team_stats) continue;
      let parsed: Record<string, { bans?: number[] }>;
      try {
        parsed = JSON.parse(r.team_stats);
      } catch {
        continue;
      }
      counted++;
      for (const [teamId, stats] of Object.entries(parsed)) {
        // 对面 ban 掉的 = 针对我们的; 我们 ban 掉的 = 我们忌惮的
        const target = Number(teamId) === r.our_team_id ? by : against;
        for (const id of stats.bans ?? []) {
          if (id > 0) target.set(id, (target.get(id) ?? 0) + 1);
        }
      }
    }
    const toList = (m: Map<number, number>) =>
      [...m.entries()]
        .map(([championId, count]) => ({ championId, count }))
        .sort((a, b) => b.count - a.count);
    return { againstUs: toList(against), byUs: toList(by), matches: counted };
  } catch (err) {
    console.error("[banStats] failed", err);
    return { againstUs: [], byUs: [], matches: 0 };
  }
}
