import { NextResponse } from "next/server";

import { isDbConfigured } from "@/lib/db";
import { getChampionNameMap } from "@/lib/ddragon";
import { ourChampionPositions, refreshOpggMatchups, toOpggName } from "@/lib/opgg";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/opgg/refresh —— 把我们用过的 (英雄, 分路) 的大盘对位胜率从 OP.GG
// 拉一遍存进库. 一个英雄一条线一次请求, 请求之间有间隔, 几十个组合大概一分钟.
//
// 什么时候跑: 版本更新之后, 或者名单里多了新英雄. 不用天天跑 —— 大盘数据一个
// 版本内基本不动, 页面上会显示上次更新时间.
//
// 没做鉴权: 这个接口只往外读公开数据、往自己库里写, 被人多点几下最多是多打
// 几次 OP.GG, 不会泄露也不会删东西.
export async function POST() {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "数据库还没配置好" }, { status: 503 });
  }
  try {
    const [pairs, names] = await Promise.all([ourChampionPositions(), getChampionNameMap()]);
    if (!pairs.length) {
      return NextResponse.json(
        { error: "库里还没有我们自己人的对局，先同步战绩再刷新大盘数据。" },
        { status: 400 }
      );
    }
    const withNames = pairs
      .map((p) => ({ ...p, opggName: names[p.championId] ? toOpggName(names[p.championId]) : "" }))
      .filter((p) => p.opggName);

    const result = await refreshOpggMatchups(withNames);
    return NextResponse.json({
      ...result,
      skippedNoName: pairs.length - withNames.length,
    });
  } catch (err) {
    console.error("[opgg/refresh] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "刷新失败" },
      { status: 502 }
    );
  }
}
