import "server-only";

import { sql } from "@vercel/postgres";
import type { MatchFilter } from "@/lib/db";

// 分位置数据榜单.
//
// 两条原则:
//   1. 一律用【每分钟】或【占全队比例】, 不用总量. 总量只反映谁的局更长,
//      拉出来的排名没有意义.
//   2. 每个位置只看这个位置真正吃的指标 —— 辅助拼输出没意义, 打野拼补刀也一样.
//      这套分工和 rating.ts 里的位置权重是同一套思路.
//
// 只统计正式模式、打满五分钟的局; 场次太少的人由展示层灰显.

export type LeaderRow = {
  member: string;
  games: number;
  wins: number;
  // 每分钟口径
  damagePerMin: number;
  takenPerMin: number;
  mitigatedPerMin: number;
  goldPerMin: number;
  csPerMin: number;
  visionPerMin: number;
  objectiveDmgPerMin: number;
  turretDmgPerMin: number;
  // 每场口径
  ccPerGame: number;
  wardsPerGame: number;
  wardsKilledPerGame: number;
  jungleEnemyPerGame: number;
  healedPerGame: number;
  soloKillsPerGame: number; // 用 turretKills 代替不了单杀, 这里放推塔数
  // 占全队比例 (0~1)
  damageShare: number;
  takenShare: number;
  killParticipation: number;
  // 其他
  avgScore: number | null;
  kda: number | null;
  deathsPerGame: number;
  longestLivingSec: number;
};

const RIFT = ["单双排", "灵活组排", "匹配"];

/**
 * 按 (成员, 位置) 出一份全指标表. position 传空字符串 = 不分位置, 汇总全部.
 * 页面按位置挑其中几列展示.
 */
export async function leaderboard(
  filter: MatchFilter,
  position: string
): Promise<LeaderRow[]> {
  try {
    const pos = position || null;
    const { rows } = await sql<Record<string, string | null>>`
      -- ⚠ 「占全队比例」这类指标的分母必须在【全队五个人】上算, 所以窗口函数要先
      -- 在未过滤的行上求和, 再筛出车队成员. 一开始把 member <> '' 写进了窗口那层,
      -- 分母只剩车队成员, 参团率直接算出 278% 这种不可能的数.
      WITH all_rows AS (
        SELECT mp.*, m.duration_min,
               SUM(mp.damage_to_champions) OVER (PARTITION BY mp.game_id, mp.team_id) AS team_dmg,
               SUM(mp.damage_taken) OVER (PARTITION BY mp.game_id, mp.team_id) AS team_taken,
               SUM(mp.kills) OVER (PARTITION BY mp.game_id, mp.team_id) AS team_kills
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
          AND m.roster_count >= ${filter.min}
          AND m.queue_name IN (${RIFT[0]}, ${RIFT[1]}, ${RIFT[2]})
          AND m.duration_min >= 5
      ),
      base AS (
        SELECT * FROM all_rows
        WHERE member <> ''
          AND (${pos}::text IS NULL OR position = ${pos}::text)
      )
      SELECT member,
             COUNT(*)::text AS games,
             SUM(CASE WHEN win THEN 1 ELSE 0 END)::text AS wins,
             (SUM(damage_to_champions)::numeric / NULLIF(SUM(duration_min),0))::text AS dmg_pm,
             (SUM(damage_taken)::numeric / NULLIF(SUM(duration_min),0))::text AS taken_pm,
             (SUM(COALESCE(damage_self_mitigated,0))::numeric / NULLIF(SUM(duration_min),0))::text AS mit_pm,
             (SUM(gold)::numeric / NULLIF(SUM(duration_min),0))::text AS gold_pm,
             (SUM(cs)::numeric / NULLIF(SUM(duration_min),0))::text AS cs_pm,
             (SUM(vision_score)::numeric / NULLIF(SUM(duration_min),0))::text AS vis_pm,
             (SUM(COALESCE(damage_to_objectives,0))::numeric / NULLIF(SUM(duration_min),0))::text AS obj_pm,
             (SUM(COALESCE(turret_damage,0))::numeric / NULLIF(SUM(duration_min),0))::text AS turret_pm,
             AVG(COALESCE(cc_time,0))::text AS cc_pg,
             AVG(COALESCE(wards_placed,0))::text AS wards_pg,
             AVG(COALESCE(wards_killed,0))::text AS wardk_pg,
             AVG(COALESCE(jungle_enemy,0))::text AS jgenemy_pg,
             AVG(COALESCE(units_healed,0))::text AS healed_pg,
             AVG(COALESCE(turret_kills,0))::text AS turretkill_pg,
             AVG(damage_to_champions::numeric / NULLIF(team_dmg,0))::text AS dmg_share,
             AVG(damage_taken::numeric / NULLIF(team_taken,0))::text AS taken_share,
             AVG((kills + assists)::numeric / NULLIF(team_kills,0))::text AS kp,
             AVG(score)::text AS avg_score,
             SUM(kills)::text AS k, SUM(deaths)::text AS d, SUM(assists)::text AS a,
             MAX(COALESCE(longest_time_living,0))::text AS longest
      FROM base
      GROUP BY member
      ORDER BY COUNT(*) DESC
    `;
    const n = (x: string | null) => Number(x ?? 0) || 0;
    return rows.map((r) => {
      const d = n(r.d);
      const ka = n(r.k) + n(r.a);
      const games = n(r.games);
      return {
        member: String(r.member),
        games,
        wins: n(r.wins),
        damagePerMin: n(r.dmg_pm),
        takenPerMin: n(r.taken_pm),
        mitigatedPerMin: n(r.mit_pm),
        goldPerMin: n(r.gold_pm),
        csPerMin: n(r.cs_pm),
        visionPerMin: n(r.vis_pm),
        objectiveDmgPerMin: n(r.obj_pm),
        turretDmgPerMin: n(r.turret_pm),
        ccPerGame: n(r.cc_pg),
        wardsPerGame: n(r.wards_pg),
        wardsKilledPerGame: n(r.wardk_pg),
        jungleEnemyPerGame: n(r.jgenemy_pg),
        healedPerGame: n(r.healed_pg),
        soloKillsPerGame: n(r.turretkill_pg),
        damageShare: n(r.dmg_share),
        takenShare: n(r.taken_share),
        killParticipation: n(r.kp),
        avgScore: r.avg_score === null ? null : Number(r.avg_score),
        kda: d > 0 || ka > 0 ? ka / Math.max(d, 1) : null,
        deathsPerGame: games ? d / games : 0,
        longestLivingSec: n(r.longest),
      };
    });
  } catch (err) {
    console.error("[leaderboard] failed", err);
    return [];
  }
}

export type MetricDef = {
  key: keyof LeaderRow;
  label: string;
  hint: string;
  /** 越大越好还是越小越好 */
  higherIsBetter: boolean;
  format: "int" | "one" | "two" | "pct";
};

/**
 * 每个位置展示哪几个指标. 分工思路和 rating.ts 的位置权重一致:
 * 上单扛伤推塔, 打野抓目标物和反野, 中下拼输出和发育, 辅助拼视野控制.
 */
export const METRICS_BY_POSITION: Record<string, MetricDef[]> = {
  TOP: [
    { key: "takenPerMin", label: "承伤/分", hint: "每分钟承受的伤害，扛不扛得住", higherIsBetter: true, format: "int" },
    { key: "mitigatedPerMin", label: "减伤/分", hint: "护甲魔抗护盾挡掉的伤害", higherIsBetter: true, format: "int" },
    { key: "damagePerMin", label: "伤害/分", hint: "每分钟对英雄的伤害", higherIsBetter: true, format: "int" },
    { key: "turretDmgPerMin", label: "拆塔伤害/分", hint: "上单的带线压力", higherIsBetter: true, format: "int" },
    { key: "csPerMin", label: "补刀/分", hint: "发育效率", higherIsBetter: true, format: "one" },
    { key: "deathsPerGame", label: "场均死亡", hint: "越低越好", higherIsBetter: false, format: "one" },
  ],
  JUNGLE: [
    { key: "objectiveDmgPerMin", label: "目标物伤害/分", hint: "打小龙大龙先锋的伤害", higherIsBetter: true, format: "int" },
    { key: "jungleEnemyPerGame", label: "场均反野", hint: "在对方野区打掉的野怪", higherIsBetter: true, format: "one" },
    { key: "killParticipation", label: "参团率", hint: "全队击杀里参与了多少", higherIsBetter: true, format: "pct" },
    { key: "ccPerGame", label: "场均控制", hint: "对敌方施加的控制时长（秒）", higherIsBetter: true, format: "one" },
    { key: "visionPerMin", label: "视野/分", hint: "打野也要做视野", higherIsBetter: true, format: "two" },
    { key: "deathsPerGame", label: "场均死亡", hint: "越低越好", higherIsBetter: false, format: "one" },
  ],
  MIDDLE: [
    { key: "damageShare", label: "伤害占比", hint: "占全队伤害的比例，五人均分是 20%", higherIsBetter: true, format: "pct" },
    { key: "damagePerMin", label: "伤害/分", hint: "每分钟对英雄的伤害", higherIsBetter: true, format: "int" },
    { key: "csPerMin", label: "补刀/分", hint: "发育效率", higherIsBetter: true, format: "one" },
    { key: "killParticipation", label: "参团率", hint: "中单要能支援", higherIsBetter: true, format: "pct" },
    { key: "goldPerMin", label: "经济/分", hint: "每分钟经济", higherIsBetter: true, format: "int" },
    { key: "deathsPerGame", label: "场均死亡", hint: "越低越好", higherIsBetter: false, format: "one" },
  ],
  BOTTOM: [
    { key: "damageShare", label: "伤害占比", hint: "下路通常该是全队最高", higherIsBetter: true, format: "pct" },
    { key: "damagePerMin", label: "伤害/分", hint: "每分钟对英雄的伤害", higherIsBetter: true, format: "int" },
    { key: "csPerMin", label: "补刀/分", hint: "下路的发育是硬指标", higherIsBetter: true, format: "one" },
    { key: "goldPerMin", label: "经济/分", hint: "每分钟经济", higherIsBetter: true, format: "int" },
    { key: "turretDmgPerMin", label: "拆塔伤害/分", hint: "推进能力", higherIsBetter: true, format: "int" },
    { key: "deathsPerGame", label: "场均死亡", hint: "越低越好", higherIsBetter: false, format: "one" },
  ],
  UTILITY: [
    { key: "visionPerMin", label: "视野/分", hint: "辅助的核心指标", higherIsBetter: true, format: "two" },
    { key: "wardsPerGame", label: "场均插眼", hint: "视野投入", higherIsBetter: true, format: "one" },
    { key: "wardsKilledPerGame", label: "场均排眼", hint: "反视野", higherIsBetter: true, format: "one" },
    { key: "ccPerGame", label: "场均控制", hint: "对敌方施加的控制时长（秒）", higherIsBetter: true, format: "one" },
    { key: "killParticipation", label: "参团率", hint: "辅助该在场", higherIsBetter: true, format: "pct" },
    { key: "healedPerGame", label: "场均治疗单位", hint: "治疗和护盾覆盖到多少人次", higherIsBetter: true, format: "one" },
  ],
  "": [
    { key: "avgScore", label: "平均评分", hint: "场内归一化、按位置加权的 0~10 分", higherIsBetter: true, format: "two" },
    { key: "damageShare", label: "伤害占比", hint: "占全队伤害的比例", higherIsBetter: true, format: "pct" },
    { key: "takenShare", label: "承伤占比", hint: "占全队承伤的比例", higherIsBetter: true, format: "pct" },
    { key: "killParticipation", label: "参团率", hint: "全队击杀里参与了多少", higherIsBetter: true, format: "pct" },
    { key: "kda", label: "KDA", hint: "(击杀+助攻)/死亡", higherIsBetter: true, format: "two" },
    { key: "visionPerMin", label: "视野/分", hint: "每分钟视野得分", higherIsBetter: true, format: "two" },
  ],
};

export function formatMetric(v: number | null, f: MetricDef["format"]): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (f === "pct") return `${Math.round(v * 100)}%`;
  if (f === "int") return String(Math.round(v));
  if (f === "one") return v.toFixed(1);
  return v.toFixed(2);
}
