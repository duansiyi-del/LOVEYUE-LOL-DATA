import { Suspense } from "react";
import { isDbConfigured } from "@/lib/db";
import {
  championPairs,
  championProfiles,
  enemyChampions,
  ourChampionRecords,
} from "@/lib/draft";
import { parseFilters } from "@/lib/filters";
import MatchFilterBar from "@/components/MatchFilterBar";
import DraftChecker from "@/components/DraftChecker";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "阵容分析 · LOVEYUE",
};

// 场次低于这个数的组合只列出来, 不排名也不下结论 -- 三五场的胜率是噪音.
const MIN_PAIR_GAMES = 5;

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; since?: string; until?: string }>;
}) {
  const filters = parseFilters(await searchParams);
  const dbReady = isDbConfigured();

  const [profiles, pairs, ourRecords, enemies] = dbReady
    ? await Promise.all([
        championProfiles(filters),
        championPairs(filters),
        ourChampionRecords(filters),
        enemyChampions(filters),
      ])
    : [[], [], [], []];

  const soloRate = new Map(ourRecords.map((r) => [r.champion, r.games ? r.wins / r.games : 0]));

  // 组合增益 = 这一对一起上时的胜率 − 两人各自单独出场胜率的平均.
  // 正数说明放一起比各自平均表现更好. 场次少的不参与排序.
  const ranked = pairs
    .map((p) => {
      const rate = p.games ? p.wins / p.games : 0;
      const expected = ((soloRate.get(p.a) ?? 0) + (soloRate.get(p.b) ?? 0)) / 2;
      return { ...p, rate, delta: rate - expected, enough: p.games >= MIN_PAIR_GAMES };
    })
    .sort((a, b) => (a.enough === b.enough ? b.games - a.games : a.enough ? -1 : 1));

  const best = ranked.filter((p) => p.enough).slice().sort((a, b) => b.delta - a.delta);
  const worstEnemies = enemies
    .filter((e) => e.games >= MIN_PAIR_GAMES)
    .map((e) => ({ ...e, theirRate: e.games ? e.wins / e.games : 0 }))
    .sort((a, b) => b.theirRate - a.theirRate || b.games - a.games)
    .slice(0, 12);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Draft
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">阵容分析</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          全部基于已同步的对局 · 场次少于 {MIN_PAIR_GAMES} 场的组合不参与排名
        </p>
      </div>

      <div className="mb-8">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
      </div>

      {!dbReady ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          数据库还没接好，这里会在同步战绩后显示阵容分析。
        </p>
      ) : (
        <div className="space-y-10">
          <DraftChecker profiles={profiles} />

          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              我方常用组合
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              两个英雄同时在我方出场的场次。增益 = 一起上的胜率 − 两人各自单独胜率的平均。
            </p>
            {ranked.length === 0 ? (
              <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
                当前筛选下还没有组合数据。
              </p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-left">组合</th>
                      <th className="px-3 py-2 text-right">场次</th>
                      <th className="px-3 py-2 text-right">胜负</th>
                      <th className="px-3 py-2 text-right">胜率</th>
                      <th className="px-3 py-2 text-right">增益</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.slice(0, 25).map((p) => (
                      <tr
                        key={`${p.a}-${p.b}`}
                        className={`border-b border-[var(--border)]/50 last:border-0 ${
                          p.enough ? "" : "text-[var(--muted)]/60"
                        }`}
                      >
                        <td className="px-3 py-2">
                          {p.a} + {p.b}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.games}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.wins}胜 {p.games - p.wins}负
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(p.rate)}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            !p.enough
                              ? ""
                              : p.delta > 0.05
                                ? "text-[var(--status-good)]"
                                : p.delta < -0.05
                                  ? "text-[var(--status-critical)]"
                                  : ""
                          }`}
                        >
                          {p.enough ? `${p.delta >= 0 ? "+" : ""}${Math.round(p.delta * 100)}pp` : "样本少"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {best.length >= 2 ? (
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-sm border border-[var(--status-good)]/40 bg-[var(--bg-panel)] p-4">
                <p className="font-display text-sm font-semibold text-[var(--status-good)]">值得多用</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {best.slice(0, 5).map((p) => (
                    <li key={`${p.a}-${p.b}`} className="flex justify-between gap-2">
                      <span className="truncate">
                        {p.a} + {p.b}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {p.games} 场 · {pct(p.rate)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-sm border border-[var(--status-critical)]/40 bg-[var(--bg-panel)] p-4">
                <p className="font-display text-sm font-semibold text-[var(--status-critical)]">少碰</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {best
                    .slice(-5)
                    .reverse()
                    .map((p) => (
                      <li key={`${p.a}-${p.b}`} className="flex justify-between gap-2">
                        <span className="truncate">
                          {p.a} + {p.b}
                        </span>
                        <span className="shrink-0 text-xs text-[var(--muted)]">
                          {p.games} 场 · {pct(p.rate)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            </section>
          ) : null}

          {worstEnemies.length ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                最难打的对手英雄
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                对面拿出来之后赢面最大的英雄，ban 位可以从这里挑。
              </p>
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-left">英雄</th>
                      <th className="px-3 py-2 text-right">遇到</th>
                      <th className="px-3 py-2 text-right">我们输</th>
                      <th className="px-3 py-2 text-right">对面胜率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worstEnemies.map((e) => (
                      <tr key={e.champion} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="px-3 py-2">{e.champion}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.games}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.wins}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(e.theirRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
