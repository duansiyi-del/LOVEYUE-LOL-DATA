import "server-only";

import { sql } from "@vercel/postgres";

// OP.GG 官方 MCP 接口 —— 拿「大盘对位胜率」当参照系, 回答「这个对位是英雄本来
// 就难打, 还是我这个人打不好」. 不爬网页, 不需要密钥.
//
// 关键发现 (实测): lol_get_lane_matchup_guide 返回的 data.counters 是
// 【my_champion 在该分路对上的所有英雄】的完整列表 (五十条上下), 每条带 play 和
// win. 也就是说一次调用就能拿到一个英雄在一条线上的全部对位, 不用逐对去问.
// opponent_champion 参数只影响文字建议部分, 不影响 counters.
//
// 两个必须记住的局限:
//   1. 这是全球大盘 (OP.GG 的口径), 不是国服, 分段也不区分. 只能当参照, 不能当
//      结论 —— 我们自己的数据才是结论.
//   2. 它随版本变, 所以存了 updated_at, 页面上显示更新时间, 过期了自己重刷.

const MCP_URL = "https://mcp-api.op.gg/mcp";
const REQUEST_GAP_MS = 800; // 别把人家打爆, 一个英雄一条线一次请求已经很省了

// 我们库里的分路 -> OP.GG 的分路
const POSITION_TO_OPGG: Record<string, string> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "mid",
  BOTTOM: "adc",
  UTILITY: "support",
};

/**
 * 英雄名转 OP.GG 要的格式. 用的是【显示名】而不是 Data Dragon 的 key:
 *   Wukong -> WUKONG        (key 是 MonkeyKing, 用 key 会失败)
 *   K'Sante -> KSANTE       (撇号直接去掉, 不是下划线)
 *   Nunu & Willump -> NUNU_WILLUMP
 *   Renata Glasc -> RENATA_GLASC
 *   Twisted Fate -> TWISTED_FATE
 * 以上五条都实测验证过.
 */
export function toOpggName(displayName: string): string {
  return displayName
    .replace(/['’.]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type JsonValue = unknown;

/** 一次会话: initialize -> initialized -> 若干次 tools/call. */
class McpSession {
  private sessionId = "";

  private async post(body: unknown, wantHeaders = false): Promise<{ json: JsonValue; sessionId?: string }> {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OP.GG MCP ${res.status} ${res.statusText}`);
    const sid = wantHeaders ? res.headers.get("mcp-session-id") ?? undefined : undefined;
    const text = await res.text();
    if (!text.trim()) return { json: null, sessionId: sid };
    // 服务端可能按 SSE 返回, 取最后一条 data:
    if (text.startsWith("event:") || text.includes("\ndata:")) {
      const lines = text.split("\n").filter((l) => l.startsWith("data:"));
      const last = lines[lines.length - 1]?.slice(5).trim();
      return { json: last ? JSON.parse(last) : null, sessionId: sid };
    }
    return { json: JSON.parse(text), sessionId: sid };
  }

  async open(): Promise<void> {
    const { sessionId } = await this.post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "loveyue-lol-data", version: "1" },
        },
      },
      true
    );
    this.sessionId = sessionId ?? "";
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { json } = await this.post({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1e6),
      method: "tools/call",
      params: { name, arguments: args },
    });
    const r = json as { error?: { message?: string }; result?: { content?: { text?: string }[] } };
    if (r?.error) throw new Error(r.error.message ?? "OP.GG MCP 调用失败");
    const text = r?.result?.content?.[0]?.text;
    if (!text) throw new Error("OP.GG MCP 返回为空");
    return JSON.parse(text);
  }
}

// ---- 建表 (第一次用时自动建, 不用手工跑 SQL) ----

let ensured = false;
async function ensureTables() {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS opgg_matchups (
      champion_id  INTEGER NOT NULL,
      position     TEXT NOT NULL,
      opponent_id  INTEGER NOT NULL,
      play         INTEGER NOT NULL,
      win          INTEGER NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (champion_id, position, opponent_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS opgg_champion_stats (
      champion_id  INTEGER NOT NULL,
      position     TEXT NOT NULL,
      play         INTEGER NOT NULL,
      win_rate     NUMERIC NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (champion_id, position)
    )
  `;
  ensured = true;
}

// ---- 刷新 ----

type GuideResponse = {
  data?: {
    counters?: { champion_id: number; play: number; win: number }[];
    summary?: { positions?: { name?: string; stats?: { play?: number; win_rate?: number } }[] };
  };
};

export type RefreshResult = {
  requested: number;
  ok: number;
  failed: { championId: number; position: string; error: string }[];
  rows: number;
};

/**
 * 把我们实际用过的 (英雄, 分路) 组合去 OP.GG 拉一遍存下来.
 * pairs 由调用方从 match_players 里挑, 一般就是我们自己人用过的英雄.
 */
export async function refreshOpggMatchups(
  pairs: { championId: number; position: string; opggName: string }[]
): Promise<RefreshResult> {
  await ensureTables();
  const session = new McpSession();
  await session.open();

  const result: RefreshResult = { requested: pairs.length, ok: 0, failed: [], rows: 0 };
  let first = true;
  for (const p of pairs) {
    const opggPos = POSITION_TO_OPGG[p.position];
    if (!opggPos) continue;
    if (!first) await sleep(REQUEST_GAP_MS);
    first = false;
    try {
      const guide = (await session.call("lol_get_lane_matchup_guide", {
        position: opggPos,
        my_champion: p.opggName,
        // 只影响文字建议, counters 不受它影响; 固定传一个合法值即可
        opponent_champion: "ANNIE",
        lang: "en_US",
      })) as GuideResponse;

      const counters = guide.data?.counters ?? [];
      for (const c of counters) {
        if (!c.champion_id || !c.play) continue;
        await sql`
          INSERT INTO opgg_matchups (champion_id, position, opponent_id, play, win, updated_at)
          VALUES (${p.championId}, ${p.position}, ${c.champion_id}, ${c.play}, ${c.win}, now())
          ON CONFLICT (champion_id, position, opponent_id)
          DO UPDATE SET play = EXCLUDED.play, win = EXCLUDED.win, updated_at = now()
        `;
        result.rows++;
      }

      const posStats = (guide.data?.summary?.positions ?? []).find(
        (x) => (x.name ?? "").toUpperCase() === p.position
      )?.stats;
      if (posStats?.play && typeof posStats.win_rate === "number") {
        await sql`
          INSERT INTO opgg_champion_stats (champion_id, position, play, win_rate, updated_at)
          VALUES (${p.championId}, ${p.position}, ${posStats.play}, ${posStats.win_rate}, now())
          ON CONFLICT (champion_id, position)
          DO UPDATE SET play = EXCLUDED.play, win_rate = EXCLUDED.win_rate, updated_at = now()
        `;
      }
      result.ok++;
    } catch (err) {
      result.failed.push({
        championId: p.championId,
        position: p.position,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/** 我们自己人用过的 (英雄, 分路), 按场次降序 —— 刷新时只拉这些, 不整个大盘都拉. */
export async function ourChampionPositions(
  limit = 60
): Promise<{ championId: number; position: string; games: number }[]> {
  const { rows } = await sql<{ champion_id: number; position: string; games: string }>`
    SELECT mp.champion_id, mp.position, COUNT(*)::text AS games
    FROM match_players mp
    WHERE mp.member <> ''
      AND mp.champion_id IS NOT NULL AND mp.champion_id > 0
      AND mp.position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
    GROUP BY mp.champion_id, mp.position
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    championId: Number(r.champion_id),
    position: r.position,
    games: Number(r.games),
  }));
}

// ---- 读取 ----

export type OpggBaseline = {
  // key: `${championId}|${position}|${opponentId}`
  matchups: Map<string, { play: number; win: number }>;
  // key: `${championId}|${position}`
  overall: Map<string, { play: number; winRate: number }>;
  updatedAt: Date | null;
};

export async function loadOpggBaseline(): Promise<OpggBaseline> {
  const empty: OpggBaseline = { matchups: new Map(), overall: new Map(), updatedAt: null };
  try {
    const [mu, st] = await Promise.all([
      sql<{ champion_id: number; position: string; opponent_id: number; play: number; win: number; updated_at: string | Date }>`
        SELECT champion_id, position, opponent_id, play, win, updated_at FROM opgg_matchups
      `,
      sql<{ champion_id: number; position: string; play: number; win_rate: string }>`
        SELECT champion_id, position, play, win_rate FROM opgg_champion_stats
      `,
    ]);
    const out: OpggBaseline = { matchups: new Map(), overall: new Map(), updatedAt: null };
    for (const r of mu.rows) {
      out.matchups.set(`${r.champion_id}|${r.position}|${r.opponent_id}`, {
        play: Number(r.play),
        win: Number(r.win),
      });
      const t = r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at);
      if (!out.updatedAt || t > out.updatedAt) out.updatedAt = t;
    }
    for (const r of st.rows) {
      out.overall.set(`${r.champion_id}|${r.position}`, {
        play: Number(r.play),
        winRate: Number(r.win_rate),
      });
    }
    return out;
  } catch (err) {
    // 表还没建 / 还没刷过: 页面照常渲染, 只是没有大盘列
    console.error("[loadOpggBaseline] failed", err);
    return empty;
  }
}
