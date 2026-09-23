import { NextRequest, NextResponse } from "next/server";

import { getKnownGameIds, insertGames, isDbConfigured } from "@/lib/db";
import { buildGameRecordFromLcu, type LcuGame } from "@/lib/lcu";

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

  let body: { games?: LcuGame[] };
  try {
    body = (await req.json()) as { games?: LcuGame[] };
  } catch {
    return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  }
  const raw = body.games;
  if (!Array.isArray(raw) || !raw.length) {
    return NextResponse.json({ error: "没有对局数据" }, { status: 400 });
  }

  try {
    const known = await getKnownGameIds();
    let noRoster = 0;
    let unparsed = 0;
    const records = [];
    for (const g of raw) {
      const rec = buildGameRecordFromLcu(g);
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
