import { NextRequest, NextResponse } from "next/server";

import { getKnownGameIds, insertGames, isDbConfigured } from "@/lib/db";
import { buildGameRecordFromLcu, type LcuGame } from "@/lib/lcu";
import { buildGameRecord as buildGameRecordFromSgp } from "@/lib/sgp";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { games: [ <LCU 原始对局 JSON>, ... ] }
//
// 由 tools/auto_sync.ps1 在那台开着客户端的 Windows 上调用: 脚本从客户端本地
// 接口读对局, 原样发过来, 这边转换并入库.
//
// 为什么不是网站自己去拉: SGP 那条路被网关挡着 (见 src/lib/lcu.ts 顶部说明),
// 而客户端本地接口只有那台机器能访问.
//
// 只保留同一边至少有一名车队成员的对局 —— 拉取端尽量全存, 「几个人才算车队局」
// 是展示层的筛选参数.
export async function POST(req: NextRequest) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "数据库还没配置好" }, { status: 503 });
  }

  // source: "lcu" (默认) = 客户端本地接口那套字段; "sgp" = 腾讯服务端那套.
  //
  // 为什么 SGP 的对局也从这个口进来, 而不是让网站自己去拉 (/api/matches/sync):
  // 那条路是【Vercel 的机器】去请求腾讯网关, 跑在美国. 而实测通的是【客户端所在
  // 那台机器】发的请求 (2026-09-24 用户机器上 200, 一次 100 场). 境外 IP 能不能用
  // 没有把握, 而且跨境还要绕一圈、受函数 300 秒上限约束.
  // 改成脚本在本地拉好再原样发过来: 这个配置有实测证据, 也没有时限问题.
  let body: { games?: unknown[]; source?: string };
  try {
    body = (await req.json()) as { games?: unknown[]; source?: string };
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const raw = body.games;
  const fromSgp = body.source === "sgp";
  if (!Array.isArray(raw) || !raw.length) {
    return NextResponse.json({ error: "没有对局数据" }, { status: 400 });
  }

  try {
    const known = await getKnownGameIds();
    let noRoster = 0;
    let unparsed = 0;
    const records = [];
    for (const g of raw) {
      // LCU 那个转换函数认不出来时返回 null; SGP 那个是直接抛. 包一层, 让单独一条
      // 畸形数据只算作"解析不了", 而不是把整批都带崩.
      let rec = null;
      try {
        rec = fromSgp
          ? buildGameRecordFromSgp(g as Record<string, unknown>)
          : buildGameRecordFromLcu(g as LcuGame);
      } catch (e) {
        console.error("[matches/import] 单条解析失败", e);
      }
      if (!rec) {
        unparsed++;
        continue;
      }
      if (rec.rosterCount < 1) {
        noRoster++;
        continue;
      }
      records.push(rec);
    }

    const newOnes = records.filter((r) => !known.has(r.gameId));
    if (records.length) await insertGames(records);

    return NextResponse.json({
      received: raw.length,
      stored: records.length,
      newGames: newOnes.length,
      skippedNoRoster: noRoster,
      skippedUnparsed: unparsed,
      totalGames: known.size + newOnes.length,
    });
  } catch (err) {
    console.error("[matches/import] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "入库失败" },
      { status: 502 }
    );
  }
}

// GET -> 已入库的 gameId 列表. 同步脚本先拿这个, 已经有的就不用再去客户端调
// 详情接口了 (列表接口只返回登录者自己一行, 十个人的数据要逐局调详情).
export async function GET() {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "数据库还没配置好" }, { status: 503 });
  }
  try {
    const known = await getKnownGameIds();
    return NextResponse.json({ gameIds: [...known] });
  } catch (err) {
    console.error("[matches/import] GET failed", err);
    return NextResponse.json({ error: "读取失败" }, { status: 502 });
  }
}
