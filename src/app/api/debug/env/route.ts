import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 排查数据库没接上用: 只列出和数据库相关的环境变量【名字】, 不输出任何值.
// 问题解决后可以删掉这个文件.
export async function GET() {
  const names = Object.keys(process.env)
    .filter((k) => /^(POSTGRES|DATABASE|PG|NEON|VERCEL_ENV|VERCEL_GIT_COMMIT_SHA)/i.test(k))
    .sort();
  return NextResponse.json({
    env: process.env.VERCEL_ENV ?? "unknown",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
    hasPostgresUrl: Boolean(process.env.POSTGRES_URL),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    dbRelatedVarNames: names,
  });
}
