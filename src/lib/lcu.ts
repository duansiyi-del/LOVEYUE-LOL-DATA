import "server-only";

import championMap from "@/data/championTitles.json";
import { scoreGame } from "@/lib/rating";
import type { GameRecord, PlayerRow, TeamStats } from "@/lib/sgp";
import { rosterNameByPuuid, rosterPuuidSet } from "@/lib/matchesRoster";

// 客户端本地接口 (LCU) 返回的对局格式 -> 我们自己的 GameRecord.
//
// 为什么走这条路: SGP 那边 token 鉴权能过, 但之后任何路径都返回 400 (连不存在
// 的路径也是 400 而不是 404), 两台机器分别验证过, 请求在路由前就被网关挡掉了.
// LCU 是客户端自己的本地接口, 只要客户端开着就能用, 没有 token 过期问题.
//
// 和 SGP 格式的差别 (都是对着真实返回核过的, 见 tools/probe_endpoints.ps1 存下来
// 的原始 JSON):
//   1. 每项数据在 participant.stats 里, 不是摊平在 participant 上
//   2. 没有 challenges 对象, 所以评分要用的占比类指标得自己按全队合计算
//   3. 没有 teamPosition, 分路要从 timeline.lane + timeline.role 推
//   4. 玩家身份 (puuid / 昵称) 在 participantIdentities 里, 按 participantId 关联
//   5. teams 里字段名不一样, 而且有个拼写错误: firstDargon (不是 firstDragon)
//   6. 这三个字段 LCU 没有, 一律记 0: objectivesStolen / totalHealsOnTeammates /
//      totalTimeSpentDead
//   7. timeline 里的 csDiffPerMinDeltas 等增量字段【全是空的】, 所以拿不到
//      10 分钟补刀差 —— 这是 Riot 早就废弃的字段, 不是我们取数的问题

export type LcuGame = {
  gameId?: number | string;
  gameCreation?: number;
  gameDuration?: number; // 秒
  gameMode?: string;
  gameVersion?: string;
  queueId?: number;
  participants?: LcuParticipant[];
  participantIdentities?: { participantId?: number; player?: { puuid?: string; gameName?: string; tagLine?: string; summonerName?: string } }[];
  teams?: LcuTeam[];
};

type LcuParticipant = {
  participantId?: number;
  championId?: number;
  spell1Id?: number;
  spell2Id?: number;
  teamId?: number;
  stats?: Record<string, unknown>;
  timeline?: { lane?: string; role?: string };
};

type LcuTeam = Record<string, unknown> & {
  teamId?: number;
  bans?: { championId?: number }[];
};

const GAME_QUEUES: Record<number, string> = {
  420: "单双排",
  440: "灵活组排",
  450: "大乱斗",
  2400: "海克斯大乱斗",
  400: "匹配",
  490: "匹配",
};

function num(x: unknown): number {
  const n = typeof x === "number" ? x : parseFloat(String(x ?? 0));
  return Number.isFinite(n) ? n : 0;
}

/**
 * LCU 用 lane + role 两个字段表示分路, 拼成我们统一的五个值.
 *
 * 必须先看 lane: 大乱斗和自定义局的 lane 是 NONE, role 却可能是 SUPPORT,
 * 如果先判 role 就会把一整局的人全标成辅助 (实测一场 2v2 自定义踩到过).
 * lane 不是正经分路时一律返回空串, 上层查询本来就只认这五个值.
 */
export function derivePosition(lane?: string, role?: string): string {
  const l = (lane ?? "").toUpperCase();
  const r = (role ?? "").toUpperCase();
  if (l === "JUNGLE") return "JUNGLE";
  if (l === "TOP") return "TOP";
  if (l === "MIDDLE" || l === "MID") return "MIDDLE";
  if (l === "BOTTOM") return r.includes("SUPPORT") ? "UTILITY" : "BOTTOM";
  return "";
}

const champNameMap = championMap as Record<string, string>;

function buildTeamStats(g: LcuGame): Record<string, TeamStats> | null {
  const teams = g.teams ?? [];
  if (!teams.length) return null;
  const out: Record<string, TeamStats> = {};
  for (const t of teams) {
    const teamId = String(t.teamId ?? "");
    if (!teamId) continue;
    const bans = (t.bans ?? [])
      .map((b) => Number(b?.championId))
      .filter((id) => Number.isFinite(id) && id > 0);
    out[teamId] = {
      bans,
      dragon: num(t.dragonKills),
      baron: num(t.baronKills),
      tower: num(t.towerKills),
      inhibitor: num(t.inhibitorKills),
      riftHerald: num(t.riftHeraldKills),
      atakhan: num(t.atakhanKills),
      horde: num(t.hordeKills),
      firstBlood: Boolean(t.firstBlood),
      firstTower: Boolean(t.firstTower),
      // ⚠ 客户端这个字段就是拼错的: firstDargon. 两个都读, 以防哪天他们修好.
      firstDragon: Boolean(t.firstDragon ?? t.firstDargon),
      firstBaron: Boolean(t.firstBaron),
      firstInhibitor: Boolean(t.firstInhibitor),
      firstRiftHerald: Boolean(t.firstRiftHerald),
      firstAtakhan: Boolean(t.firstAtakhan),
      firstHorde: Boolean(t.firstHorde),
    };
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 把 LCU 的 participant 摊平成 rating.ts 认识的形状.
 * rating.ts 原本是对着 SGP 格式写的, 会读 p.challenges 里的占比类指标; LCU 没有
 * 这个对象, 所以这里按全队合计自己算出来, 保证两种数据源算出的评分口径一致.
 */
function toRatingParticipant(
  p: LcuParticipant,
  puuid: string,
  teamDamage: number,
  teamDamageTaken: number,
  teamKills: number,
  durationSec: number
): Record<string, unknown> {
  const s = p.stats ?? {};
  const kills = num(s.kills);
  const assists = num(s.assists);
  const dmg = num(s.totalDamageDealtToChampions);
  const taken = num(s.totalDamageTaken);
  return {
    ...s,
    puuid,
    teamPosition: derivePosition(p.timeline?.lane, p.timeline?.role),
    timePlayed: durationSec,
    win: Boolean(s.win),
    wasAfk: false,
    challenges: {
      teamDamagePercentage: teamDamage > 0 ? dmg / teamDamage : 0,
      killParticipation: teamKills > 0 ? (kills + assists) / teamKills : 0,
      damageTakenOnTeamPercentage: teamDamageTaken > 0 ? taken / teamDamageTaken : 0,
      // LCU 没有单杀统计, 只能记 0 —— 这一项在评分里权重不高 (上单/中单 0.08)
      soloKills: 0,
    },
  };
}

/** 一场 LCU 对局 -> GameRecord. 认不出的模式返回 null. */
export function buildGameRecordFromLcu(g: LcuGame): GameRecord | null {
  const participants = g.participants ?? [];
  const identities = g.participantIdentities ?? [];
  if (!participants.length) return null;

  const puuidOf = new Map<number, { puuid: string; name: string }>();
  for (const id of identities) {
    const pid = Number(id.participantId);
    const player = id.player ?? {};
    const tag = player.tagLine;
    const gameName = player.gameName ?? player.summonerName ?? "";
    if (pid) {
      puuidOf.set(pid, {
        puuid: String(player.puuid ?? ""),
        name: tag ? `${gameName}#${tag}` : gameName,
      });
    }
  }

  const durationSec = num(g.gameDuration);
  // 按队伍合计, 用来算占比类指标
  const teamAgg = new Map<number, { dmg: number; taken: number; kills: number }>();
  for (const p of participants) {
    const t = Number(p.teamId ?? 0);
    const cur = teamAgg.get(t) ?? { dmg: 0, taken: 0, kills: 0 };
    cur.dmg += num(p.stats?.totalDamageDealtToChampions);
    cur.taken += num(p.stats?.totalDamageTaken);
    cur.kills += num(p.stats?.kills);
    teamAgg.set(t, cur);
  }

  const ratingInput = participants.map((p) => {
    const ident = puuidOf.get(Number(p.participantId)) ?? { puuid: "", name: "" };
    const agg = teamAgg.get(Number(p.teamId ?? 0)) ?? { dmg: 0, taken: 0, kills: 0 };
    return toRatingParticipant(p, ident.puuid, agg.dmg, agg.taken, agg.kills, durationSec);
  });
  const ratings = scoreGame(ratingInput);

  const gameId = String(g.gameId ?? "");
  if (!gameId) return null;

  const players: PlayerRow[] = participants.map((p) => {
    const s = p.stats ?? {};
    const ident = puuidOf.get(Number(p.participantId)) ?? { puuid: "", name: "" };
    const rating = ratings[ident.puuid] ?? { score: null as unknown as number, award: "" };
    const kills = num(s.kills);
    const deaths = num(s.deaths);
    const assists = num(s.assists);
    const kda =
      deaths > 0 || kills + assists > 0
        ? Math.round(((kills + assists) / Math.max(deaths, 1)) * 100) / 100
        : null;
    const champId = String(p.championId ?? "");
    const multiKill =
      num(s.pentaKills) > 0
        ? "五杀"
        : num(s.quadraKills) > 0
          ? "四杀"
          : num(s.tripleKills) > 0
            ? "三杀"
            : num(s.doubleKills) > 0
              ? "双杀"
              : "";
    return {
      gameId,
      puuid: ident.puuid,
      member: rosterNameByPuuid[ident.puuid] ?? "",
      playerName: ident.name,
      teamId: Number(p.teamId ?? 0),
      position: derivePosition(p.timeline?.lane, p.timeline?.role),
      champion: champNameMap[champId] ?? champId,
      championId: Number(champId) || 0,
      spell1Id: num(p.spell1Id),
      spell2Id: num(p.spell2Id),
      win: Boolean(s.win),
      score: rating.score,
      award: rating.award,
      kills,
      deaths,
      assists,
      kda,
      multiKill,
      firstBlood: Boolean(s.firstBloodKill),
      gold: num(s.goldEarned),
      damageToChampions: num(s.totalDamageDealtToChampions),
      physicalDamage: num(s.physicalDamageDealtToChampions),
      magicDamage: num(s.magicDamageDealtToChampions),
      trueDamage: num(s.trueDamageDealtToChampions),
      damageTaken: num(s.totalDamageTaken),
      heal: num(s.totalHeal),
      turretDamage: num(s.damageDealtToTurrets),
      ccTime: num(s.timeCCingOthers),
      cs: num(s.totalMinionsKilled) + num(s.neutralMinionsKilled),
      visionScore: num(s.visionScore),
      wardsPlaced: num(s.wardsPlaced),
      wardsKilled: num(s.wardsKilled),
      champLevel: num(s.champLevel),
      items: Array.from({ length: 7 }, (_, i) => String(num(s[`item${i}`]))).join(","),
      damageSelfMitigated: num(s.damageSelfMitigated),
      killingSprees: num(s.killingSprees),
      largestKillingSpree: num(s.largestKillingSpree),
      // 以下三项 LCU 不提供
      objectivesStolen: 0,
      healsOnTeammates: 0,
      goldSpent: num(s.goldSpent),
      timeSpentDead: 0,
    };
  });

  // 同一边最多有几名车队成员
  const counts: Record<number, number> = {};
  for (const p of players) {
    if (rosterPuuidSet.has(p.puuid)) counts[p.teamId] = (counts[p.teamId] ?? 0) + 1;
  }
  const rosterCount = Object.values(counts).length ? Math.max(...Object.values(counts)) : 0;

  const queueId = num(g.queueId);
  return {
    gameId,
    gameCreationMs: num(g.gameCreation),
    durationMin: Math.round((durationSec / 60) * 10) / 10,
    queueId,
    queueName: GAME_QUEUES[queueId] ?? "",
    gameMode: String(g.gameMode ?? ""),
    gameVersion: String(g.gameVersion ?? ""),
    rosterCount,
    players,
    teamStats: buildTeamStats(g),
  };
}
