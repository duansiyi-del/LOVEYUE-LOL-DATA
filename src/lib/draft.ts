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
  // 常用哪几个英雄去对位 (按场次降序)
  ownChampions: string[];
  // 查大盘对位胜率要用: 自己用的英雄 id + 分路 + 场次, 按场次加权算基准
  ownBreakdown: { championId: number; position: string; games: number }[];
};

const RIFT = ["单双排", "灵活组排", "匹配"];

export async function memberMatchups(filter: MatchFilter): Promise<MemberMatchup[]> {
  try {
    // 取到 (成员, 自己英雄, 分路, 对位英雄) 这一层, 再在 JS 里合并到展示需要的
    // (成员, 对位英雄) —— 保留自己英雄和分路是为了能对上 OP.GG 的大盘数据.
    const { rows } = await sql<{
      member: string;
      own_champion: string;
      own_champion_id: number | null;
      position: string;
      enemy_champion: string;
      enemy_champion_id: number | null;
      games: string;
      wins: string;
      cs_diff: string | null;
      gold_diff: string | null;
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
               mp.champion_id AS own_champion_id, mp.win, mp.cs, mp.gold
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
      SELECT o.member, o.own_champion, o.own_champion_id, o.position,
             e.champion AS enemy_champion, e.champion_id AS enemy_champion_id,
             COUNT(*)::text AS games,
             SUM(CASE WHEN o.win THEN 1 ELSE 0 END)::text AS wins,
             AVG(o.cs - e.cs)::text AS cs_diff,
             AVG(o.gold - e.gold)::text AS gold_diff
      FROM ours o
      JOIN theirs e ON e.game_id = o.game_id AND e.position = o.position
      GROUP BY o.member, o.own_champion, o.own_champion_id, o.position, e.champion, e.champion_id
      ORDER BY o.member, COUNT(*) DESC
    `;

    type Acc = MemberMatchup & { csSum: number; goldSum: number; ownGames: Map<string, number> };
    const acc = new Map<string, Acc>();
    for (const r of rows) {
      const games = Number(r.games);
      const key = `${r.member}|${r.enemy_champion}`;
      const cur =
        acc.get(key) ??
        ({
          member: r.member,
          enemyChampion: r.enemy_champion,
          enemyChampionId: Number(r.enemy_champion_id ?? 0),
          games: 0,
          wins: 0,
          csDiff: 0,
          goldDiff: 0,
          ownChampions: [],
          ownBreakdown: [],
          csSum: 0,
          goldSum: 0,
          ownGames: new Map<string, number>(),
        } as Acc);
      cur.games += games;
      cur.wins += Number(r.wins);
      cur.csSum += Number(r.cs_diff ?? 0) * games;
      cur.goldSum += Number(r.gold_diff ?? 0) * games;
      cur.ownGames.set(r.own_champion, (cur.ownGames.get(r.own_champion) ?? 0) + games);
      cur.ownBreakdown.push({
        championId: Number(r.own_champion_id ?? 0),
        position: r.position,
        games,
      });
      acc.set(key, cur);
    }

    return [...acc.values()].map((a) => ({
      member: a.member,
      enemyChampion: a.enemyChampion,
      enemyChampionId: a.enemyChampionId,
      games: a.games,
      wins: a.wins,
      csDiff: a.games ? a.csSum / a.games : 0,
      goldDiff: a.games ? a.goldSum / a.games : 0,
      ownChampions: [...a.ownGames.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n),
      ownBreakdown: a.ownBreakdown,
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

// ---- 组队归因 ------------------------------------------------------------
// 「我们仨一起打了 40 场胜率很低, 到底是谁的问题」.
//
// 主判据用 match_players.score —— rating.ts 在【同一场十个人之间】归一化、再按
// 位置加权算出来的 0~10 分. 用它而不是经济, 有两个原因:
//   1. 按位置加权, 辅助不会因为经济低就被判成打得差;
//   2. 队友之间直接可比, 「两个人打得不错、一个人明显不行」这种情况一眼能看出来,
//      而看经济只会得出"输了所以大家经济都低"这种废话.
// 经济差仍然算并展示, 但只作为旁证.
//
// 老对局如果没有 score (同步早于评分字段), 自动退回按经济的相对值判定.

export type LossBucket = "优势没转化" | "单点拖累" | "路人拖累" | "全线崩盘" | "打得胶着";

export type LaneDelta = {
  member: string; // 空串 = 路人
  position: string;
  champion: string;
  score: number | null; // 本场评分 0~10
  scoreVsTeam: number; // 本人评分 − 我方五人评分中位数
  goldDiff: number; // 本人 − 对位
  goldRelative: number; // goldDiff − 我方五条线 goldDiff 的平均
};

// 判定阈值, 单位是评分 (0~10 分制).
export const ATTRIBUTION_RULES = {
  // 某人比自己队伍的中位数低这么多 = 这一场明显是他掉队
  soloGap: 1.5,
  // 我方平均分比对面平均分低这么多 = 整体被压制
  teamGap: 1.2,
  // 没有评分时退回经济口径: 某条线相对全队每分钟落后这么多金
  fallbackLanePerMin: -100,
  fallbackTeamPerMin: -350,
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function classify(
  lanes: LaneDelta[],
  teamGoldDiff: number,
  durationMin: number,
  ourScores: number[],
  enemyScores: number[]
): LossBucket {
  if (!lanes.length) return "打得胶着";

  // 经济领先却输掉 = 运营 / 团战的问题, 和"谁打得差"是两回事, 优先判
  if (teamGoldDiff > 0) return "优势没转化";

  const hasScores = ourScores.length >= 3 && enemyScores.length >= 3;
  if (hasScores) {
    const worst = [...lanes].sort((a, b) => a.scoreVsTeam - b.scoreVsTeam)[0];
    // 先看有没有单个人明显掉队 —— 哪怕整队都不行, 掉得最狠的那个更值得说
    if (worst && worst.score !== null && worst.scoreVsTeam <= -ATTRIBUTION_RULES.soloGap) {
      return worst.member ? "单点拖累" : "路人拖累";
    }
    // 没人特别掉队, 那就看整队是不是被对面整体压住
    const ourAvg = ourScores.reduce((a, b) => a + b, 0) / ourScores.length;
    const enemyAvg = enemyScores.reduce((a, b) => a + b, 0) / enemyScores.length;
    if (ourAvg - enemyAvg <= -ATTRIBUTION_RULES.teamGap) return "全线崩盘";
    return "打得胶着";
  }

  // 没有评分的老对局: 退回经济口径
  const mins = Math.max(8, durationMin || 30);
  const worstGold = [...lanes].sort((a, b) => a.goldRelative - b.goldRelative)[0];
  if (worstGold && worstGold.goldRelative / mins <= ATTRIBUTION_RULES.fallbackLanePerMin) {
    return worstGold.member ? "单点拖累" : "路人拖累";
  }
  if (teamGoldDiff / mins <= ATTRIBUTION_RULES.fallbackTeamPerMin) return "全线崩盘";
  return "打得胶着";
}

export type TeamGame = {
  gameId: string;
  gameCreationMs: number;
  queueName: string;
  durationMin: number;
  win: boolean;
  members: string[];
  lanes: LaneDelta[];
  teamGoldDiff: number;
  ourAvgScore: number | null;
  enemyAvgScore: number | null;
  bucket: LossBucket | null; // 只对输的局给
  worstLane: LaneDelta | null;
};

/**
 * 一次把符合筛选条件的车队局连同双方十人全部取回来, 逐场算好每个人相对队友的
 * 评分差、相对全队的经济差, 并给输的局分类.
 *
 * 组合筛选和组合排行都在 JS 里从这份结果推, 不再回数据库: 一是避开数组参数
 * (这个驱动的 sql 模板只保证基本类型可用), 二是数据量本来就小 —— 一场十行,
 * 几百场也就几千行.
 */
export async function teamGames(filter: MatchFilter): Promise<TeamGame[]> {
  try {
    const { rows } = await sql<{
      game_id: string;
      game_creation_ms: string;
      queue_name: string;
      duration_min: string | null;
      our_team_id: number;
      member: string;
      position: string;
      champion: string;
      team_id: number;
      win: boolean;
      gold: number;
      score: string | null;
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
      )
      SELECT m.game_id, m.game_creation_ms::text, m.queue_name, m.duration_min::text,
             t.team_id AS our_team_id,
             mp.member, mp.position, mp.champion, mp.team_id, mp.win, mp.gold, mp.score::text
      FROM our_team t
      JOIN matches m ON m.game_id = t.game_id
      JOIN match_players mp ON mp.game_id = t.game_id
      ORDER BY m.game_creation_ms DESC
    `;

    const byGame = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byGame.get(r.game_id);
      if (list) list.push(r);
      else byGame.set(r.game_id, [r]);
    }

    const out: TeamGame[] = [];
    for (const [gameId, players] of byGame) {
      const head = players[0];
      const ours = players.filter((p) => p.team_id === head.our_team_id);
      const theirs = players.filter((p) => p.team_id !== head.our_team_id);
      if (!ours.length || !theirs.length) continue;

      const scoreOf = (p: (typeof players)[number]) => (p.score === null ? null : Number(p.score));
      const ourScores = ours.map(scoreOf).filter((x): x is number => x !== null);
      const enemyScores = theirs.map(scoreOf).filter((x): x is number => x !== null);
      const teamMedian = median(ourScores);

      const enemyAt = new Map(theirs.filter((p) => p.position).map((p) => [p.position, p]));
      const raw = ours.map((p) => ({
        member: p.member,
        position: p.position,
        champion: p.champion,
        score: scoreOf(p),
        goldDiff:
          p.position && enemyAt.has(p.position)
            ? Number(p.gold) - Number(enemyAt.get(p.position)!.gold)
            : 0,
      }));
      const withOpponent = raw.filter((l) => l.goldDiff !== 0);
      const goldAvg = withOpponent.length
        ? withOpponent.reduce((s, l) => s + l.goldDiff, 0) / withOpponent.length
        : 0;

      const lanes: LaneDelta[] = raw.map((l) => ({
        ...l,
        scoreVsTeam: l.score === null ? 0 : l.score - teamMedian,
        goldRelative: l.goldDiff - goldAvg,
      }));

      const teamGoldDiff =
        ours.reduce((s, p) => s + Number(p.gold), 0) - theirs.reduce((s, p) => s + Number(p.gold), 0);
      const win = Boolean(ours[0].win);
      const durationMin = Number(head.duration_min ?? 30);
      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

      out.push({
        gameId,
        gameCreationMs: Number(head.game_creation_ms),
        queueName: head.queue_name,
        durationMin,
        win,
        members: [...new Set(ours.map((p) => p.member).filter(Boolean))].sort(),
        lanes,
        teamGoldDiff,
        ourAvgScore: avg(ourScores),
        enemyAvgScore: avg(enemyScores),
        bucket: win ? null : classify(lanes, teamGoldDiff, durationMin, ourScores, enemyScores),
        worstLane: lanes.length ? [...lanes].sort((a, b) => a.scoreVsTeam - b.scoreVsTeam)[0] : null,
      });
    }
    return out;
  } catch (err) {
    console.error("[teamGames] failed", err);
    return [];
  }
}

export type MemberCombo = { members: string[]; games: number; wins: number };

function subsets<T>(arr: T[], k: number): T[][] {
  if (k > arr.length) return [];
  const out: T[][] = [];
  const cur: T[] = [];
  const walk = (start: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      walk(i + 1);
      cur.pop();
    }
  };
  walk(0);
  return out;
}

/**
 * 「这 size 个人同时在场」的组合排行. 统计口径是【至少】这几个人都在, 场上可以
 * 还有别的成员 —— 必须和详情页 gamesWithMembers 一致, 否则按钮上的场次和点进去
 * 看到的对不上.
 */
export function memberCombos(games: TeamGame[], size: number, limit = 12): MemberCombo[] {
  const acc = new Map<string, MemberCombo>();
  for (const g of games) {
    for (const combo of subsets(g.members, size)) {
      const key = combo.join("|");
      const cur = acc.get(key) ?? { members: combo, games: 0, wins: 0 };
      cur.games++;
      if (g.win) cur.wins++;
      acc.set(key, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.games - a.games).slice(0, limit);
}

/** 这几个成员【都】在场的对局 (可以还有别人). 传空数组 = 全部车队局. */
export function gamesWithMembers(games: TeamGame[], members: string[]): TeamGame[] {
  if (!members.length) return games;
  return games.filter((g) => members.every((m) => g.members.includes(m)));
}

export type Blame = {
  key: string;
  member: string;
  position: string;
  losses: number;
  avgScore: number | null;
  avgScoreVsTeam: number;
  avgGoldRelative: number;
  worstCount: number; // 在多少场失利里是队内最低分
};

export type Attribution = {
  games: number;
  wins: number;
  buckets: { bucket: LossBucket; count: number }[];
  blame: Blame[];
};

const POSITION_ZH_SHORT: Record<string, string> = {
  TOP: "上单",
  JUNGLE: "打野",
  MIDDLE: "中单",
  BOTTOM: "下路",
  UTILITY: "辅助",
};

export function positionZh(p: string): string {
  return POSITION_ZH_SHORT[p] ?? (p || "—");
}

export function attribute(games: TeamGame[]): Attribution {
  const losses = games.filter((g) => !g.win);
  const bucketCount = new Map<LossBucket, number>();
  for (const g of losses) {
    if (g.bucket) bucketCount.set(g.bucket, (bucketCount.get(g.bucket) ?? 0) + 1);
  }

  type Acc = {
    member: string;
    position: string;
    losses: number;
    scoreSum: number;
    scoreN: number;
    vsSum: number;
    goldSum: number;
    worst: number;
  };
  const acc = new Map<string, Acc>();
  for (const g of losses) {
    const worstKey = g.worstLane
      ? g.worstLane.member || `路人 ${positionZh(g.worstLane.position)}`
      : null;
    for (const l of g.lanes) {
      // 车队成员按人统计; 路人每场不是同一个人, 按位置合并
      const key = l.member || `路人 ${positionZh(l.position)}`;
      const cur =
        acc.get(key) ??
        ({ member: l.member, position: l.position, losses: 0, scoreSum: 0, scoreN: 0, vsSum: 0, goldSum: 0, worst: 0 } as Acc);
      cur.losses++;
      if (l.score !== null) {
        cur.scoreSum += l.score;
        cur.scoreN++;
      }
      cur.vsSum += l.scoreVsTeam;
      cur.goldSum += l.goldRelative;
      if (worstKey === key) cur.worst++;
      acc.set(key, cur);
    }
  }

  return {
    games: games.length,
    wins: games.filter((g) => g.win).length,
    buckets: [...bucketCount.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => b.count - a.count),
    blame: [...acc.entries()]
      .map(([key, v]) => ({
        key,
        member: v.member,
        position: positionZh(v.position),
        losses: v.losses,
        avgScore: v.scoreN ? v.scoreSum / v.scoreN : null,
        avgScoreVsTeam: v.losses ? v.vsSum / v.losses : 0,
        avgGoldRelative: v.losses ? v.goldSum / v.losses : 0,
        worstCount: v.worst,
      }))
      .sort((a, b) => a.avgScoreVsTeam - b.avgScoreVsTeam),
  };
}
