import { getMemberProfiles, isDbConfigured, type MemberProfile } from "@/lib/db";
import { displayName, roster, TEAM_NAME } from "@/lib/roster";
import RosterCard from "@/components/RosterCard";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "选手名单 · LOVEYUE",
};

// 名单页不带筛选条: 这里要回答的是「这个人平时打什么位置、常用什么英雄」,
// 口径固定为【全部已同步对局】—— 同一方只要有一个人 (min 1)、不限时间.
// 想按赛段看分路和英雄池, 去对位分析页.
const ALL_TIME = { min: 1, sinceMs: 0, untilMs: null };

export default async function RosterPage() {
  const profiles = isDbConfigured() ? await getMemberProfiles(ALL_TIME) : new Map<string, MemberProfile>();
  const anyMultiPhoto = roster.some((p) => p.photos.length > 1);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-12 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Official Roster
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">{TEAM_NAME}</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          分路、英雄池、胜率都按已同步的全部对局自动统计 · 分路只计召唤师峡谷
          {anyMultiPhoto ? " · 多张照片的卡片可以左右切换" : ""}
        </p>
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

          return (
            <RosterCard
              key={p.id}
              alias={displayName(p.nickname)}
              nickname={p.nickname}
              number={p.number}
              photos={p.photos}
              positions={positions}
              champions={champions}
              games={prof ? prof.games : null}
              winRate={prof && prof.games > 0 ? Math.round((prof.wins / prof.games) * 100) : null}
            />
          );
        })}
      </div>
    </div>
  );
}
