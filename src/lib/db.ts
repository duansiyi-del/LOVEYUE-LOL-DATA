import "server-only";

import { sql, db } from "@vercel/postgres";
import type { VercelPoolClient } from "@vercel/postgres";
import type { GameRecord, TeamStats } from "@/lib/sgp";

export type { TeamStats };

// Requires a Vercel Postgres store connected to this project (Storage tab
// in the Vercel dashboard -- it wires up POSTGRES_URL etc. automatically).
// Run db/schema.sql once against it before the first sync.
// Neon 通过 Vercel Marketplace 接入时, 有的版本只注入 DATABASE_URL 而没有
// POSTGRES_URL; @vercel/postgres 只认后者, 这里补一个别名.
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
}

export async function getKnownGameIds(): Promise<Set<string>> {
  const { rows } = await sql<{ game_id: string }>`SELECT game_id FROM matches`;
  return new Set(rows.map((r) => r.game_id));
}

// Every queue this app syncs (see GAME_QUEUES in sgp.ts) is a standard 5v5
// mode -- 10 participants, always. A match already in `matches` but with
// fewer than 10 rows in match_players is the corrupted state a mid-sync
// timeout used to be able to leave behind (see insertGames's comment):
// this finds those so the sync route can quietly re-fetch and repair them
// on the next normal (non-refreshAll) auto-sync run, with no manual
// "刷新旧对局" click needed.
const EXPECTED_PLAYERS_PER_GAME = 10;

export async function getIncompleteGameIds(): Promise<Set<string>> {
  const { rows } = await sql<{ game_id: string }>`
    SELECT m.game_id
    FROM matches m
    LEFT JOIN match_players mp ON mp.game_id = m.game_id
    GROUP BY m.game_id
    HAVING COUNT(mp.puuid) < ${EXPECTED_PLAYERS_PER_GAME}
  `;
  return new Set(rows.map((r) => r.game_id));
}

// One player row's column list, in the exact order both the multi-row
// INSERT and its ON CONFLICT UPDATE below rely on.
const MATCH_PLAYER_COLUMNS = [
  "game_id", "puuid", "member", "player_name", "team_id", "position", "champion", "champion_id",
  "spell1_id", "spell2_id", "win", "score", "award", "kills", "deaths", "assists", "kda", "multi_kill",
  "first_blood", "gold", "damage_to_champions", "physical_damage", "magic_damage", "true_damage",
  "damage_taken", "heal", "turret_damage", "cc_time", "cs", "vision_score", "wards_placed",
  "wards_killed", "champ_level", "items", "damage_self_mitigated", "killing_sprees",
  "largest_killing_spree", "objectives_stolen", "heals_on_teammates", "gold_spent", "time_spent_dead",
  "damage_to_objectives", "total_damage_dealt", "physical_damage_taken", "magic_damage_taken", "true_damage_taken", "jungle_enemy", "jungle_own", "turret_kills", "inhibitor_kills", "units_healed", "total_cc_dealt", "longest_time_living",
] as const;

function playerRowValues(gameId: string, p: GameRecord["players"][number]): unknown[] {
  return [
    gameId, p.puuid, p.member, p.playerName, p.teamId, p.position, p.champion, p.championId,
    p.spell1Id, p.spell2Id, p.win, p.score, p.award, p.kills, p.deaths, p.assists, p.kda, p.multiKill,
    p.firstBlood, p.gold, p.damageToChampions, p.physicalDamage, p.magicDamage, p.trueDamage,
    p.damageTaken, p.heal, p.turretDamage, p.ccTime, p.cs, p.visionScore, p.wardsPlaced,
    p.wardsKilled, p.champLevel, p.items, p.damageSelfMitigated, p.killingSprees,
    p.largestKillingSpree, p.objectivesStolen, p.healsOnTeammates, p.goldSpent, p.timeSpentDead,
    p.damageToObjectives, p.totalDamageDealt, p.physicalDamageTaken, p.magicDamageTaken, p.trueDamageTaken, p.jungleEnemy, p.jungleOwn, p.turretKills, p.inhibitorKills, p.unitsHealed, p.totalCcDealt, p.longestTimeSpentLiving,
  ];
}

// One multi-row INSERT for every player in a game, instead of one round
// trip per player. This is not just a speed-up -- it's the fix for a real
// data-corruption bug: with the old one-`await sql` per-player loop, if
// Vercel killed this route mid-request (maxDuration = 60s, and a big
// backlog sync can have 8 roster members x dozens of games x 10 players
// each to write), whichever game was mid-loop at that exact moment ended
// up with only SOME of its 10 players ever written -- e.g. only 1 of 5
// opponents stored, permanently, because that game's id was already in
// `matches` so later incremental syncs treat it as "already known" and
// never touch it again. Confirmed against the live site: a match whose
// page showed only 1 red-side player also summed its team totals (总击杀
// etc, computed server-side from all stored rows) to exactly that one
// player's own numbers -- proof the other 4 rows were never in the
// database at all, not just hidden by a display bug.
async function insertGamePlayers(
  client: VercelPoolClient,
  gameId: string,
  players: GameRecord["players"]
): Promise<void> {
  if (!players.length) return;
  const cols = MATCH_PLAYER_COLUMNS;
  const valuesSql: string[] = [];
  const params: unknown[] = [];
  players.forEach((p, i) => {
    const rowValues = playerRowValues(gameId, p);
    const placeholders = rowValues.map((_, j) => `$${i * cols.length + j + 1}`);
    valuesSql.push(`(${placeholders.join(", ")})`);
    params.push(...rowValues);
  });
  const updateSet = cols
    .slice(2) // skip game_id/puuid -- those are the conflict key, never updated
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  await client.query(
    `INSERT INTO match_players (${cols.join(", ")}) VALUES ${valuesSql.join(", ")}
     ON CONFLICT (game_id, puuid) DO UPDATE SET ${updateSet}`,
    params
  );
}

// Upserts on every sync (not just insert-if-new) so that a schema/rating
// change picks up existing games automatically the next time someone syncs
// -- there's no separate backfill step to remember to run.
//
// Each game's matches-row + all-its-players write is one DB transaction
// (BEGIN...COMMIT on a single checked-out connection) so a game is either
// fully stored or not stored at all -- never half-written. If the whole
// request gets killed mid-sync (see insertGamePlayers's comment above),
// Postgres rolls back whatever game's transaction was still open, and
// every game committed before that stays fully intact. A single game's
// insert failing (a genuinely malformed record) is logged and skipped
// rather than aborting the rest of the batch.
let schemaPatched = false;

/**
 * 补齐后加的列. 幂等 (全是 IF NOT EXISTS), 每个进程只真正跑一次.
 *
 * ⚠ 这个一定要在【读】的路径上也调一次, 不能只在写入时补.
 * 踩过的坑: 这些列是先加到代码里、后来才有人同步战绩的. 在那之前线上库还没有这
 * 几列, 分位置榜单的查询每次都报 "column ... does not exist", 被 catch 成空数组,
 * 页面于是显示"还没有对局数据" —— 明明库里有对局, 排查了半天才发现是列不存在.
 */
export async function ensureSchema(): Promise<void> {
  if (schemaPatched) return;
  const client = await db.connect();
  try {
    await client.query("ALTER TABLE matches ADD COLUMN IF NOT EXISTS game_version TEXT");
    // 分位置榜单用的细分数据; 老对局要等一次 refreshAll 才有值
    await client.query(`ALTER TABLE match_players
      ADD COLUMN IF NOT EXISTS damage_to_objectives  INTEGER,
      ADD COLUMN IF NOT EXISTS total_damage_dealt    BIGINT,
      ADD COLUMN IF NOT EXISTS physical_damage_taken INTEGER,
      ADD COLUMN IF NOT EXISTS magic_damage_taken    INTEGER,
      ADD COLUMN IF NOT EXISTS true_damage_taken     INTEGER,
      ADD COLUMN IF NOT EXISTS jungle_enemy          INTEGER,
      ADD COLUMN IF NOT EXISTS jungle_own            INTEGER,
      ADD COLUMN IF NOT EXISTS turret_kills          INTEGER,
      ADD COLUMN IF NOT EXISTS inhibitor_kills       INTEGER,
      ADD COLUMN IF NOT EXISTS units_healed          INTEGER,
      ADD COLUMN IF NOT EXISTS total_cc_dealt        INTEGER,
      ADD COLUMN IF NOT EXISTS longest_time_living   INTEGER`);
    schemaPatched = true;
  } finally {
    client.release();
  }
}

export async function insertGames(games: GameRecord[]): Promise<void> {
  await ensureSchema();
  const client = await db.connect();
  try {
    for (const g of games) {
      try {
        await client.query("BEGIN");
        const teamStatsJson = g.teamStats ? JSON.stringify(g.teamStats) : null;
        await client.query(
          `INSERT INTO matches (
            game_id, game_creation_ms, duration_min, queue_id, queue_name, game_mode, game_version, roster_count, team_stats
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (game_id) DO UPDATE SET
            game_creation_ms = EXCLUDED.game_creation_ms,
            duration_min = EXCLUDED.duration_min,
            queue_id = EXCLUDED.queue_id,
            queue_name = EXCLUDED.queue_name,
            game_mode = EXCLUDED.game_mode,
            game_version = EXCLUDED.game_version,
            roster_count = EXCLUDED.roster_count,
            team_stats = EXCLUDED.team_stats`,
          [g.gameId, g.gameCreationMs, g.durationMin, g.queueId, g.queueName, g.gameMode, g.gameVersion, g.rosterCount, teamStatsJson]
        );
        await insertGamePlayers(client, g.gameId, g.players);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[insertGames] failed to store game ${g.gameId}, skipping`, err);
      }
    }
  } finally {
    client.release();
  }
}

export type StoredPlayer = {
  member: string;
  playerName: string;
  teamId: number;
  position: string;
  champion: string;
  championId: number;
  spell1Id: number;
  spell2Id: number;
  win: boolean;
  score: number | null;
  award: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: number | null;
  multiKill: string;
  firstBlood: boolean;
  gold: number;
  damageToChampions: number;
  physicalDamage: number;
  magicDamage: number;
  trueDamage: number;
  damageTaken: number;
  heal: number;
  turretDamage: number;
  ccTime: number;
  cs: number;
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  champLevel: number;
  items: string;
  damageSelfMitigated: number;
  killingSprees: number;
  largestKillingSpree: number;
  objectivesStolen: number;
  healsOnTeammates: number;
  goldSpent: number;
  timeSpentDead: number;
};

export type StoredMatch = {
  gameId: string;
  gameCreationMs: number;
  durationMin: number;
  queueName: string;
  rosterCount: number;
  players: StoredPlayer[];
  // Keyed by teamId string ("100"/"200"). Null for matches synced before
  // db/schema_team_stats.sql, until the next re-sync refreshes them.
  teamStats: Record<string, TeamStats> | null;
};

type PlayerRow = {
  member: string;
  player_name: string;
  team_id: number;
  position: string;
  champion: string;
  champion_id: number | null;
  spell1_id: number | null;
  spell2_id: number | null;
  win: boolean;
  score: number | null;
  award: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: number | null;
  multi_kill: string | null;
  first_blood: boolean | null;
  gold: number;
  damage_to_champions: number;
  physical_damage: number | null;
  magic_damage: number | null;
  true_damage: number | null;
  damage_taken: number;
  heal: number;
  turret_damage: number | null;
  cc_time: number | null;
  cs: number;
  vision_score: number;
  wards_placed: number | null;
  wards_killed: number | null;
  champ_level: number;
  items: string;
  damage_self_mitigated: number | null;
  killing_sprees: number | null;
  largest_killing_spree: number | null;
  objectives_stolen: number | null;
  heals_on_teammates: number | null;
  gold_spent: number | null;
  time_spent_dead: number | null;
};

type MatchRow = {
  game_id: string;
  game_creation_ms: number;
  duration_min: number;
  queue_name: string;
  roster_count: number;
  team_stats: string | null;
} & PlayerRow;

// Old rows synced before db/schema_matches_detail.sql was added come back
// with NULLs for all the new columns -- default them out rather than
// showing "undefined"/NaN on older matches.
function toPlayer(r: PlayerRow): StoredPlayer {
  return {
    member: r.member,
    playerName: r.player_name,
    teamId: r.team_id,
    position: r.position,
    champion: r.champion,
    championId: Number(r.champion_id ?? 0),
    spell1Id: Number(r.spell1_id ?? 0),
    spell2Id: Number(r.spell2_id ?? 0),
    win: r.win,
    score: r.score === null ? null : Number(r.score),
    award: r.award,
    kills: r.kills,
    deaths: r.deaths,
    assists: r.assists,
    kda: r.kda === null ? null : Number(r.kda),
    multiKill: r.multi_kill ?? "",
    firstBlood: Boolean(r.first_blood),
    gold: Number(r.gold),
    damageToChampions: Number(r.damage_to_champions),
    physicalDamage: Number(r.physical_damage ?? 0),
    magicDamage: Number(r.magic_damage ?? 0),
    trueDamage: Number(r.true_damage ?? 0),
    damageTaken: Number(r.damage_taken),
    heal: Number(r.heal),
    turretDamage: Number(r.turret_damage ?? 0),
    ccTime: Number(r.cc_time ?? 0),
    cs: r.cs,
    visionScore: r.vision_score,
    wardsPlaced: Number(r.wards_placed ?? 0),
    wardsKilled: Number(r.wards_killed ?? 0),
    champLevel: r.champ_level,
    items: r.items,
    damageSelfMitigated: Number(r.damage_self_mitigated ?? 0),
    killingSprees: Number(r.killing_sprees ?? 0),
    largestKillingSpree: Number(r.largest_killing_spree ?? 0),
    objectivesStolen: Number(r.objectives_stolen ?? 0),
    healsOnTeammates: Number(r.heals_on_teammates ?? 0),
    goldSpent: Number(r.gold_spent ?? 0),
    timeSpentDead: Number(r.time_spent_dead ?? 0),
  };
}

function parseTeamStats(raw: string | null): Record<string, TeamStats> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, TeamStats>;
  } catch {
    return null;
  }
}

function groupMatches(rows: MatchRow[]): StoredMatch[] {
  const byGame = new Map<string, StoredMatch>();
  const order: string[] = [];
  for (const r of rows) {
    if (!byGame.has(r.game_id)) {
      byGame.set(r.game_id, {
        gameId: r.game_id,
        gameCreationMs: Number(r.game_creation_ms),
        durationMin: Number(r.duration_min),
        queueName: r.queue_name,
        rosterCount: r.roster_count,
        players: [],
        teamStats: parseTeamStats(r.team_stats),
      });
      order.push(r.game_id);
    }
    byGame.get(r.game_id)!.players.push(toPlayer(r));
  }
  return order.map((id) => byGame.get(id)!);
}

// 展示层筛选: 同一方车队人数 >= min, 开局时间 >= sinceMs. 拉取端存得更全
// (见 matchesRoster.ts), 这里按前端传来的参数过滤 (见 filters.ts).
// untilMs 为不含上界 (截止日次日 00:00), null 表示不限.
// queues 是展开后的 queue_name 列表, 空数组 = 不限模式.
//
// ⚠ 这个驱动的 sql 模板只保证基本类型可用, 传数组不可靠. 所以统一用三个定长
// 参数装前三个模式, 不足的补 null —— 目前最多的分组 (排位) 也只有两个,
// 三个位置够用且留了余量. 全部为 null 就表示不限.
export type MatchFilter = {
  min: number;
  sinceMs: number;
  untilMs: number | null;
  queues: string[];
};

/** 把 queues 摊成三个定长参数, 供 SQL 里的 queueClause 使用. */
export function queueSlots(f: MatchFilter): [string | null, string | null, string | null] {
  const q = f.queues ?? [];
  return [q[0] ?? null, q[1] ?? null, q[2] ?? null];
}

export async function listMatches(
  filter: MatchFilter,
  limit = 20,
  offset = 0
): Promise<StoredMatch[]> {
  const [qa, qb, qc] = queueSlots(filter);
  // One round trip: join match_players onto one page of matches (most
  // recent first, LIMIT/OFFSET below), optionally narrowed to one queue.
  // (Avoids passing an array param -- @vercel/postgres's `sql` tag only
  // accepts primitive values, so the column list is spelled out below
  // rather than shared via a helper.)
  const { rows } = await sql<MatchRow>`
    SELECT m.game_id, m.game_creation_ms, m.duration_min, m.queue_name, m.roster_count, m.team_stats,
           mp.member, mp.player_name, mp.team_id, mp.position, mp.champion, mp.champion_id,
           mp.spell1_id, mp.spell2_id, mp.win, mp.score, mp.award, mp.kills, mp.deaths, mp.assists,
           mp.kda, mp.multi_kill, mp.first_blood, mp.gold, mp.damage_to_champions, mp.physical_damage,
           mp.magic_damage, mp.true_damage, mp.damage_taken, mp.heal, mp.turret_damage, mp.cc_time,
           mp.cs, mp.vision_score, mp.wards_placed, mp.wards_killed, mp.champ_level, mp.items,
           mp.damage_self_mitigated, mp.killing_sprees, mp.largest_killing_spree, mp.objectives_stolen,
           mp.heals_on_teammates, mp.gold_spent, mp.time_spent_dead
    FROM (
      SELECT game_id, game_creation_ms, duration_min, queue_name, roster_count, team_stats
      FROM matches
      WHERE roster_count >= ${filter.min}
        AND (
          (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
          OR queue_name = ${qa}::text OR queue_name = ${qb}::text OR queue_name = ${qc}::text
        )
        AND game_creation_ms >= ${filter.sinceMs}
        AND (${filter.untilMs}::bigint IS NULL OR game_creation_ms < ${filter.untilMs}::bigint)
      ORDER BY game_creation_ms DESC
      LIMIT ${limit} OFFSET ${offset}
    ) m
    JOIN match_players mp ON mp.game_id = m.game_id
    ORDER BY m.game_creation_ms DESC, mp.team_id ASC
  `;
  return groupMatches(rows);
}

// Total match count for the same optional queue filter, so the page knows
// how many pages to render without pulling every row down first.
export async function countMatches(filter: MatchFilter): Promise<number> {
  const [qa, qb, qc] = queueSlots(filter);
  const { rows } = await sql<{ count: string }>`
    SELECT COUNT(*)::text AS count
    FROM matches
    WHERE roster_count >= ${filter.min}
      AND (
        (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
        OR queue_name = ${qa}::text OR queue_name = ${qb}::text OR queue_name = ${qc}::text
      )
      AND game_creation_ms >= ${filter.sinceMs}
        AND (${filter.untilMs}::bigint IS NULL OR game_creation_ms < ${filter.untilMs}::bigint)
  `;
  return Number(rows[0]?.count ?? 0);
}

// ---- 名单页: 从战绩自动统计每个成员的分路 / 英雄池 -----------------------
// 分路只看召唤师峡谷模式 (单双排/灵活/匹配), 大乱斗没有分路.
// 英雄池看全部模式.

export type MemberProfile = {
  member: string;
  games: number;
  wins: number;
  // 按场次降序, 已翻成中文 (上单/打野/中单/下路/辅助)
  positions: { name: string; games: number }[];
  // 按场次降序
  champions: { name: string; games: number; wins: number }[];
};

const POSITION_ZH: Record<string, string> = {
  TOP: "上单",
  JUNGLE: "打野",
  MIDDLE: "中单",
  BOTTOM: "下路",
  UTILITY: "辅助",
};

const RIFT_QUEUES = ["单双排", "灵活组排", "匹配"];

export async function getMemberProfiles(filter: MatchFilter): Promise<Map<string, MemberProfile>> {
  const out = new Map<string, MemberProfile>();
  const [qa, qb, qc] = queueSlots(filter);
  try {
    const [totals, positions, champions] = await Promise.all([
      sql<{ member: string; games: string; wins: string }>`
        SELECT mp.member, COUNT(*)::text AS games, SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.roster_count >= ${filter.min} AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        GROUP BY mp.member
      `,
      sql<{ member: string; position: string; games: string }>`
        SELECT mp.member, mp.position, COUNT(*)::text AS games
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> ''
          AND m.roster_count >= ${filter.min} AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
          AND (
            (${qa}::text IS NULL AND ${qb}::text IS NULL AND ${qc}::text IS NULL)
            OR m.queue_name = ${qa}::text OR m.queue_name = ${qb}::text OR m.queue_name = ${qc}::text
          )
          AND mp.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
        GROUP BY mp.member, mp.position
        ORDER BY mp.member, COUNT(*) DESC
      `,
      sql<{ member: string; champion: string; games: string; wins: string }>`
        SELECT mp.member, mp.champion, COUNT(*)::text AS games, SUM(CASE WHEN mp.win THEN 1 ELSE 0 END)::text AS wins
        FROM match_players mp
        JOIN matches m ON m.game_id = mp.game_id
        WHERE mp.member <> '' AND mp.champion <> ''
          AND m.roster_count >= ${filter.min} AND m.game_creation_ms >= ${filter.sinceMs}
          AND (${filter.untilMs}::bigint IS NULL OR m.game_creation_ms < ${filter.untilMs}::bigint)
        GROUP BY mp.member, mp.champion
        ORDER BY mp.member, COUNT(*) DESC
      `,
    ]);
    for (const r of totals.rows) {
      out.set(r.member, { member: r.member, games: Number(r.games), wins: Number(r.wins), positions: [], champions: [] });
    }
    for (const r of positions.rows) {
      out.get(r.member)?.positions.push({ name: POSITION_ZH[r.position] ?? r.position, games: Number(r.games) });
    }
    for (const r of champions.rows) {
      out.get(r.member)?.champions.push({ name: r.champion, games: Number(r.games), wins: Number(r.wins) });
    }
  } catch (err) {
    // 表还没建 / 库没连: 名单页照常渲染, 只是没有统计
    console.error("[getMemberProfiles] failed", err);
  }
  return out;
}

export async function getMatch(gameId: string): Promise<StoredMatch | null> {
  const { rows } = await sql<MatchRow>`
    SELECT m.game_id, m.game_creation_ms, m.duration_min, m.queue_name, m.roster_count, m.team_stats,
           mp.member, mp.player_name, mp.team_id, mp.position, mp.champion, mp.champion_id,
           mp.spell1_id, mp.spell2_id, mp.win, mp.score, mp.award, mp.kills, mp.deaths, mp.assists,
           mp.kda, mp.multi_kill, mp.first_blood, mp.gold, mp.damage_to_champions, mp.physical_damage,
           mp.magic_damage, mp.true_damage, mp.damage_taken, mp.heal, mp.turret_damage, mp.cc_time,
           mp.cs, mp.vision_score, mp.wards_placed, mp.wards_killed, mp.champ_level, mp.items,
           mp.damage_self_mitigated, mp.killing_sprees, mp.largest_killing_spree, mp.objectives_stolen,
           mp.heals_on_teammates, mp.gold_spent, mp.time_spent_dead
    FROM matches m
    JOIN match_players mp ON mp.game_id = m.game_id
    WHERE m.game_id = ${gameId}
    ORDER BY mp.team_id ASC
  `;
  const matches = groupMatches(rows);
  return matches[0] ?? null;
}
