import "server-only";

import { sql } from "@vercel/postgres";
import { queueSlots, type MatchFilter } from "@/lib/db";

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
  /** 展示用的名字: 成员维度是成员昵称, 英雄维度是英雄名 */
  key: string;
  /** 英雄维度才有, 用来查官方标签 */
  championId: number | null;
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

export type Dimension = "member" | "champion";

/**
 * 出一份全指标表, 页面按维度挑其中几列展示.
 *   by = "member"   按车队成员分组
 *   by = "champion" 按英雄分组 (再配合官方标签筛选)
 * position 传空字符串 = 不分位置.
 *
 * 实现上只查一次, 取 (成员, 英雄) 这个最细粒度的【合计值】, 再在 JS 里按维度
 * 折叠. 两个原因:
 *   1. 一开始想用 CASE WHEN <布尔参数> 在 SQL 里切分组键, 但 sql 模板会把同一个
 *      布尔插成三个不同的参数 ($1/$2/$3), Postgres 认不出 SELECT 和 GROUP BY 里
 *      是同一个表达式, 直接报 "must appear in the GROUP BY clause".
 *   2. 返回合计值而不是平均值, 折叠时才能算对 —— 平均值再平均一次是错的.
 */
export async function leaderboard(
  filter: MatchFilter,
  position: string,
  by: Dimension = "member"
): Promise<LeaderRow[]> {
  const [qa, qb, qc] = queueSlots(filter);
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
          AND (
            (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
            OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
          )
          AND m.duration_min >= 5
      ),
      base AS (
        SELECT * FROM all_rows
        WHERE member <> ''
          AND (${pos}::text IS NULL OR position = ${pos}::text)
      )
      SELECT member, champion,
             MAX(champion_id)::text AS champion_id,
             COUNT(*)::text AS games,
             SUM(CASE WHEN win THEN 1 ELSE 0 END)::text AS wins,
             SUM(duration_min)::text AS mins,
             SUM(damage_to_champions)::text AS s_dmg,
             SUM(damage_taken)::text AS s_taken,
             SUM(COALESCE(damage_self_mitigated,0))::text AS s_mit,
             SUM(gold)::text AS s_gold,
             SUM(cs)::text AS s_cs,
             SUM(vision_score)::text AS s_vis,
             SUM(COALESCE(damage_to_objectives,0))::text AS s_obj,
             SUM(COALESCE(turret_damage,0))::text AS s_turret,
             SUM(COALESCE(cc_time,0))::text AS s_cc,
             SUM(COALESCE(wards_placed,0))::text AS s_wards,
             SUM(COALESCE(wards_killed,0))::text AS s_wardk,
             SUM(COALESCE(jungle_enemy,0))::text AS s_jg,
             SUM(COALESCE(units_healed,0))::text AS s_healed,
             SUM(COALESCE(turret_kills,0))::text AS s_tk,
             SUM(damage_to_champions::numeric / NULLIF(team_dmg,0))::text AS sum_dmg_share,
             SUM(damage_taken::numeric / NULLIF(team_taken,0))::text AS sum_taken_share,
             SUM((kills + assists)::numeric / NULLIF(team_kills,0))::text AS sum_kp,
             SUM(score)::text AS sum_score,
             COUNT(score)::text AS n_score,
             SUM(kills)::text AS k, SUM(deaths)::text AS d, SUM(assists)::text AS a,
             MAX(COALESCE(longest_time_living,0))::text AS longest
      FROM base
      GROUP BY member, champion
    `;

    const n = (x: string | null) => Number(x ?? 0) || 0;

    // 按维度折叠. 合计值直接相加, 比例类先加再除, 保证和一次性算出来一致.
    type Acc = {
      key: string;
      championId: number | null;
      games: number; wins: number; mins: number;
      dmg: number; taken: number; mit: number; gold: number; cs: number; vis: number;
      obj: number; turret: number; cc: number; wards: number; wardk: number; jg: number;
      healed: number; tk: number;
      dmgShare: number; takenShare: number; kp: number;
      score: number; nScore: number;
      k: number; d: number; a: number; longest: number;
    };
    const acc = new Map<string, Acc>();
    for (const r of rows) {
      const isChampion = by === "champion";
      const key = isChampion ? String(r.champion ?? "") : String(r.member ?? "");
      if (!key) continue;
      const cur =
        acc.get(key) ??
        ({
          key, championId: isChampion ? n(r.champion_id) || null : null,
          games: 0, wins: 0, mins: 0, dmg: 0, taken: 0, mit: 0, gold: 0, cs: 0, vis: 0,
          obj: 0, turret: 0, cc: 0, wards: 0, wardk: 0, jg: 0, healed: 0, tk: 0,
          dmgShare: 0, takenShare: 0, kp: 0, score: 0, nScore: 0, k: 0, d: 0, a: 0, longest: 0,
        } as Acc);
      cur.games += n(r.games); cur.wins += n(r.wins); cur.mins += n(r.mins);
      cur.dmg += n(r.s_dmg); cur.taken += n(r.s_taken); cur.mit += n(r.s_mit);
      cur.gold += n(r.s_gold); cur.cs += n(r.s_cs); cur.vis += n(r.s_vis);
      cur.obj += n(r.s_obj); cur.turret += n(r.s_turret); cur.cc += n(r.s_cc);
      cur.wards += n(r.s_wards); cur.wardk += n(r.s_wardk); cur.jg += n(r.s_jg);
      cur.healed += n(r.s_healed); cur.tk += n(r.s_tk);
      cur.dmgShare += n(r.sum_dmg_share); cur.takenShare += n(r.sum_taken_share); cur.kp += n(r.sum_kp);
      cur.score += n(r.sum_score); cur.nScore += n(r.n_score);
      cur.k += n(r.k); cur.d += n(r.d); cur.a += n(r.a);
      cur.longest = Math.max(cur.longest, n(r.longest));
      acc.set(key, cur);
    }

    const perMin = (v: number, m: number) => (m > 0 ? v / m : 0);
    const perGame = (v: number, g: number) => (g > 0 ? v / g : 0);

    return [...acc.values()]
      .map((c) => ({
        key: c.key,
        championId: c.championId,
        games: c.games,
        wins: c.wins,
        damagePerMin: perMin(c.dmg, c.mins),
        takenPerMin: perMin(c.taken, c.mins),
        mitigatedPerMin: perMin(c.mit, c.mins),
        goldPerMin: perMin(c.gold, c.mins),
        csPerMin: perMin(c.cs, c.mins),
        visionPerMin: perMin(c.vis, c.mins),
        objectiveDmgPerMin: perMin(c.obj, c.mins),
        turretDmgPerMin: perMin(c.turret, c.mins),
        ccPerGame: perGame(c.cc, c.games),
        wardsPerGame: perGame(c.wards, c.games),
        wardsKilledPerGame: perGame(c.wardk, c.games),
        jungleEnemyPerGame: perGame(c.jg, c.games),
        healedPerGame: perGame(c.healed, c.games),
        soloKillsPerGame: perGame(c.tk, c.games),
        damageShare: perGame(c.dmgShare, c.games),
        takenShare: perGame(c.takenShare, c.games),
        killParticipation: perGame(c.kp, c.games),
        avgScore: c.nScore > 0 ? c.score / c.nScore : null,
        kda: c.d > 0 || c.k + c.a > 0 ? (c.k + c.a) / Math.max(c.d, 1) : null,
        deathsPerGame: perGame(c.d, c.games),
        longestLivingSec: c.longest,
      }))
      .sort((x, y) => y.games - x.games);
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
export function formatMetric(v: number | null, f: MetricDef["format"]): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (f === "pct") return `${Math.round(v * 100)}%`;
  if (f === "int") return String(Math.round(v));
  if (f === "one") return v.toFixed(1);
  return v.toFixed(2);
}

// ---- 英雄标签 ----------------------------------------------------------
// 标签来自 Data Dragon 的 champion.json, 是 Riot 官方分类, 一个英雄通常一到两个.
// 有了标签就能按"这类英雄该看什么"来选指标 —— 辅助不该拿输出排名, 坦克不该拿补刀
// 排名, 这和分位置是同一个道理, 只是换了一个切法.

export const TAG_ZH: Record<string, string> = {
  Tank: "坦克",
  Fighter: "战士",
  Mage: "法师",
  Assassin: "刺客",
  Marksman: "射手",
  Support: "辅助",
};

export const TAG_ORDER = ["Tank", "Fighter", "Assassin", "Mage", "Marksman", "Support"];

const M = {
  dmgPm: { key: "damagePerMin", label: "伤害/分", hint: "每分钟对英雄的伤害", higherIsBetter: true, format: "int" },
  dmgShare: { key: "damageShare", label: "伤害占比", hint: "占全队伤害的比例，五人均分是 20%", higherIsBetter: true, format: "pct" },
  takenPm: { key: "takenPerMin", label: "承伤/分", hint: "每分钟承受的伤害", higherIsBetter: true, format: "int" },
  takenShare: { key: "takenShare", label: "承伤占比", hint: "占全队承伤的比例", higherIsBetter: true, format: "pct" },
  mitPm: { key: "mitigatedPerMin", label: "减伤/分", hint: "护甲魔抗护盾挡掉的伤害", higherIsBetter: true, format: "int" },
  csPm: { key: "csPerMin", label: "补刀/分", hint: "发育效率", higherIsBetter: true, format: "one" },
  goldPm: { key: "goldPerMin", label: "经济/分", hint: "每分钟经济", higherIsBetter: true, format: "int" },
  visPm: { key: "visionPerMin", label: "视野/分", hint: "每分钟视野得分", higherIsBetter: true, format: "two" },
  wards: { key: "wardsPerGame", label: "场均插眼", hint: "视野投入", higherIsBetter: true, format: "one" },
  wardsK: { key: "wardsKilledPerGame", label: "场均排眼", hint: "反视野", higherIsBetter: true, format: "one" },
  cc: { key: "ccPerGame", label: "场均控制", hint: "对敌方施加的控制时长（秒）", higherIsBetter: true, format: "one" },
  kp: { key: "killParticipation", label: "参团率", hint: "全队击杀里参与了多少", higherIsBetter: true, format: "pct" },
  kda: { key: "kda", label: "KDA", hint: "(击杀+助攻)/死亡", higherIsBetter: true, format: "two" },
  deaths: { key: "deathsPerGame", label: "场均死亡", hint: "越低越好", higherIsBetter: false, format: "one" },
  turretPm: { key: "turretDmgPerMin", label: "拆塔伤害/分", hint: "推进能力", higherIsBetter: true, format: "int" },
  objPm: { key: "objectiveDmgPerMin", label: "目标物伤害/分", hint: "打小龙大龙先锋的伤害", higherIsBetter: true, format: "int" },
  healed: { key: "healedPerGame", label: "场均治疗单位", hint: "治疗和护盾覆盖到多少人次", higherIsBetter: true, format: "one" },
  score: { key: "avgScore", label: "平均评分", hint: "场内归一化、按位置加权的 0~10 分", higherIsBetter: true, format: "two" },
} as const satisfies Record<string, MetricDef>;

/**
 * 每个位置该看什么. 分工和 rating.ts 的位置权重一致:
 * 上单扛伤推塔, 打野抓目标物和反野, 中下拼输出和发育, 辅助拼视野控制.
 */
export const METRICS_BY_POSITION: Record<string, MetricDef[]> = {
  TOP: [M.takenPm, M.mitPm, M.dmgPm, M.turretPm, M.csPm, M.deaths],
  JUNGLE: [M.objPm, { key: "jungleEnemyPerGame", label: "场均反野", hint: "在对方野区打掉的野怪", higherIsBetter: true, format: "one" }, M.kp, M.cc, M.visPm, M.deaths],
  MIDDLE: [M.dmgShare, M.dmgPm, M.csPm, M.kp, M.goldPm, M.deaths],
  BOTTOM: [M.dmgShare, M.dmgPm, M.csPm, M.goldPm, M.turretPm, M.deaths],
  UTILITY: [M.visPm, M.wards, M.wardsK, M.cc, M.kp, M.healed],
  "": [M.score, M.dmgShare, M.takenShare, M.kp, M.kda, M.visPm],
};

/** 每类英雄该看什么 —— 和分位置是同一个思路, 只是换了个切法. */
export const METRICS_BY_TAG: Record<string, MetricDef[]> = {
  Tank: [M.takenShare, M.takenPm, M.mitPm, M.cc, M.kp, M.deaths],
  Fighter: [M.dmgPm, M.takenPm, M.mitPm, M.turretPm, M.csPm, M.deaths],
  Assassin: [M.dmgPm, M.dmgShare, M.kp, M.kda, M.deaths, M.goldPm],
  Mage: [M.dmgShare, M.dmgPm, M.csPm, M.kp, M.goldPm, M.deaths],
  Marksman: [M.dmgShare, M.dmgPm, M.csPm, M.goldPm, M.turretPm, M.deaths],
  Support: [M.visPm, M.wards, M.wardsK, M.cc, M.kp, M.healed],
  "": [M.score, M.dmgShare, M.takenShare, M.kp, M.kda, M.visPm],
};
