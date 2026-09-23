import Image from "next/image";
import { roster, TEAM_NAME } from "@/lib/roster";
import { getMemberProfiles, isDbConfigured, type MemberProfile } from "@/lib/db";
import { parseFilters } from "@/lib/filters";
import MatchFilterBar from "@/components/MatchFilterBar";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "选手名单 · LOVEYUE",
};

// 名单页的分路 / 英雄池 / 场次胜率全部从已同步的战绩里统计 (见 getMemberProfiles),
// roster.ts 里手填的 positions / champions 只在库里还没有该成员数据时兜底.
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; since?: string }>;
}) {
  const filters = parseFilters(await searchParams);
  const profiles = isDbConfigured() ? await getMemberProfiles(filters) : new Map<string, MemberProfile>();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-12 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Official Roster
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">
          {TEAM_NAME}
        </h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          分路与英雄池按已同步对局自动统计 · 分路只计召唤师峡谷
        </p>
      </div>

      <div className="mb-10">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {roster.map((p) => {
          const prof = profiles.get(p.nickname);
          const positions = prof?.positions.length
            ? prof.positions.slice(0, 2).map((x) => x.name)
            : p.positions;
          const champions = prof?.champions.length
            ? prof.champions.slice(0, 3)
            : p.champions.map((name) => ({ name, games: 0, wins: 0 }));
          const winRate = prof && prof.games > 0 ? Math.round((prof.wins / prof.games) * 100) : null;

          return (
            <div
              key={p.id}
              className="group relative rounded-md border border-[var(--border)] bg-[var(--bg-panel)] p-2.5"
            >
              <span className="absolute right-3 top-3 z-10 rounded-sm bg-[var(--gold)] px-2 py-0.5 font-display text-xs font-bold text-[#0a0f1e]">
                NO.{String(p.number).padStart(2, "0")}
              </span>

              <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-[#0a0f1e]">
                {p.photo ? (
                  <Image
                    src={p.photo}
                    alt={p.nickname}
                    fill
                    className="object-cover"
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="font-display text-6xl font-black text-[var(--gold)]/40">
                      {p.nickname.slice(0, 1)}
                    </span>
                  </div>
                )}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    boxShadow: "inset 0 -60px 50px -20px rgba(10,15,30,0.85)",
                  }}
                />
                {prof ? (
                  <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between text-xs">
                    <span className="text-[var(--muted)]">{prof.games} 场</span>
                    <span className="font-display font-bold text-[var(--gold)]">
                      胜率 {winRate}%
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="px-1 pb-1 pt-3">
                <div className="mb-2 h-[2px] w-8 -skew-x-12 bg-[var(--gold)]" />
                <h3 className="mb-2 truncate text-lg font-black">{p.nickname}</h3>

                <div className="mb-2 flex min-h-[22px] flex-wrap gap-1.5">
                  {positions.length ? (
                    positions.map((pos) => (
                      <span
                        key={pos}
                        className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--gold-soft)]"
                      >
                        {pos}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-[var(--muted)]">分路待同步</span>
                  )}
                </div>

                <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Pool</p>
                {champions.length ? (
                  <ul className="mt-0.5 space-y-0.5 text-sm text-[var(--foreground)]/90">
                    {champions.map((c) => (
                      <li key={c.name} className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{c.name}</span>
                        {c.games > 0 ? (
                          <span className="shrink-0 text-[11px] text-[var(--muted)]">
                            {c.games} 场 · {Math.round((c.wins / c.games) * 100)}%
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--muted)]">待同步</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
