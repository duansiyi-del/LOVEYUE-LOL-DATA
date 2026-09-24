import { NextResponse } from "next/server";

import { matchesRoster } from "@/lib/matchesRoster";

export const dynamic = "force-dynamic";

// GET -> 车队名单的 puuid 列表.
//
// 给同步脚本用: 脚本遍历这份名单去查每个人的战绩, 而不是只查本机登录的账号.
// 这样一台机器就能覆盖全队, 不用每人都装一份.
//
// 名单放在服务端返回而不是写死在脚本里, 是为了加人的时候只改一处 —— 改完
// 大家手上的脚本自动跟着变, 不用重新发文件.
//
// puuid 不是密钥, 客户端里查任何人的战绩都会用到它.
export async function GET() {
  return NextResponse.json({
    members: matchesRoster.map((m) => ({ name: m.name, riotId: m.riotId, puuid: m.puuid })),
  });
}
