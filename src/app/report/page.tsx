import { Suspense } from "react";
import { isDbConfigured } from "@/lib/db";
import { teamGames } from "@/lib/draft";
import { parseFilters } from "@/lib/filters";
import { displayName, roster } from "@/lib/roster";
import {
  memberPositions,
  memberRatings,
  objectiveSplits,
  overlaps,
  presenceEffects,
  ratingSanity,
  squadSplits,
  wilson,
} from "@/lib/report";
import MatchFilterBar from "@/components/MatchFilterBar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "战队体检 · LOVEYUE",
};

const POS_ZH: Record<string, string> = {
  TOP: "上单",
  JUNGLE: "打野",
  MIDDLE: "中单",
  BOTTOM: "下路",
  UTILITY: "辅助",
};
const POS_ORDER = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function Rate({ wins, games }: { wins: number; games: number }) {
  if (!games) return <span className="text-[var(--muted)]">—</span>;
  const ci = wilson(wins, games);
  return (
    <span className="tabular-nums">
      {pct(wins / games)}
      <span className="ml-1 text-[11px] text-[var(--muted)]">
        {pct(ci.lo)}~{pct(ci.hi)}
      </span>
    </span>
  );
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; since?: string; until?: string }>;
}) {
  const filters = parseFilters(await searchParams);
  const dbReady = isDbConfigured();

  const [games, ratings, positions, objectives, sanity] = dbReady
    ? await Promise.all([
        teamGames(filters),
        memberRatings(filters),
        memberPositions(filters),
        objectiveSplits(filters),
        ratingSanity(filters),
      ])
    : [[], [], [], [], { games: 0, topOnWinner: 0 }];

  const total = games.length;
  const wins = games.filter((g) => g.win).length;
  const overallCi = wilson(wins, total);
  const avgMin = total ? games.reduce((s, g) => s + g.durationMin, 0) / total : 0;
  const squads = squadSplits(games);
  const presence = presenceEffects(
    games,
    roster.map((r) => r.nickname)
  );

  const byMember = new Map<string, typeof positions>();
  for (const p of positions) {
    const list = byMember.get(p.member);
    if (list) list.push(p);
    else byMember.set(p.member, [p]);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Team Report
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">战队体检</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          每个胜率后面的小字是 95% 置信区间 · 区间重叠的差异说明不了问题
        </p>
      </div>

      <div className="mb-8">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
      </div>

      {!dbReady || total === 0 ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          当前筛选下还没有对局。同步战绩后，或者把门槛人数调低再看。
        </p>
      ) : (
        <div className="space-y-10">
          <section className="grid gap-3 sm:grid-cols-4">
            {[
              { k: "总场次", v: String(total) },
              { k: "车队胜率", v: pct(wins / total), sub: `${pct(overallCi.lo)}~${pct(overallCi.hi)}` },
              { k: "场均时长", v: `${avgMin.toFixed(1)} 分钟` },
              {
                k: "评分口径自检",
                v: sanity.games ? pct(sanity.topOnWinner / sanity.games) : "—",
                sub: "全场最高分在胜方的比例",
              },
            ].map((c) => (
              <div key={c.k} className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
                <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">{c.k}</p>
                <p className="font-display mt-1 text-2xl font-black">{c.v}</p>
                {c.sub ? <p className="text-[11px] text-[var(--muted)]">{c.sub}</p> : null}
              </div>
            ))}
          </section>

          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              按车队规模
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              同时几个人在场。人越多未必胜率越高，排位的匹配机制对多人组排本来就更严。
            </p>
            <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-3 py-2 text-left">规模</th>
                    <th className="px-3 py-2 text-right">场次</th>
                    <th className="px-3 py-2 text-right">胜负</th>
                    <th className="px-3 py-2 text-right">胜率（95% 区间）</th>
                  </tr>
                </thead>
                <tbody>
                  {squads.map((s) => (
                    <tr key={s.size} className="border-b border-[var(--border)]/50 last:border-0">
                      <td className="px-3 py-2">{s.size} 人同队</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.games}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {s.wins}-{s.games - s.wins}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Rate wins={s.wins} games={s.games} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              成员表现
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              评分是同一场十个人之间归一化、按位置加权的 0~10 分。每分钟伤害只算正式模式且打满五分钟的局。
            </p>
            <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-3 py-2 text-left">成员</th>
                    <th className="px-3 py-2 text-right">场次</th>
                    <th className="px-3 py-2 text-right">平均评分</th>
                    <th className="px-3 py-2 text-right">MVP</th>
                    <th className="px-3 py-2 text-right">SVP</th>
                    <th className="px-3 py-2 text-right">伤害/分</th>
                    <th className="px-3 py-2 text-right">KDA</th>
                  </tr>
                </thead>
                <tbody>
                  {ratings.map((r) => (
                    <tr key={r.member} className="border-b border-[var(--border)]/50 last:border-0">
                      <td className="px-3 py-2">{displayName(r.member)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.games}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.avgScore === null ? "—" : r.avgScore.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.mvp}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.svp}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Math.round(r.damagePerMin)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.kda === null ? "—" : r.kda.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              各自在不同位置的表现
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              打得最多的位置未必是打得最好的位置。场次少的那一列胜率不用当真，看区间宽度就知道。
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...byMember.entries()].map(([member, list]) => (
                <div key={member} className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
                  <p className="font-display font-bold">{displayName(member)}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {[...list]
                      .sort((a, b) => POS_ORDER.indexOf(a.position) - POS_ORDER.indexOf(b.position))
                      .map((p) => (
                        <li key={p.position} className="flex items-baseline justify-between gap-2">
                          <span className="text-[var(--muted)]">
                            {POS_ZH[p.position] ?? p.position}
                            <span className="ml-2 text-[11px]">{p.games} 场</span>
                          </span>
                          <Rate wins={p.wins} games={p.games} />
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              谁在场时全队更能赢
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              这一节最容易被过度解读。缺席的那些局往往人更少、对手也不同，样本还常常很小。
              下面标了「区间重叠」的行，意思是这个差距用现有数据说明不了问题。
            </p>
            <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-3 py-2 text-left">成员</th>
                    <th className="px-3 py-2 text-right">在场</th>
                    <th className="px-3 py-2 text-right">缺席</th>
                    <th className="px-3 py-2 text-right">差值</th>
                    <th className="px-3 py-2 text-left">能不能当结论</th>
                  </tr>
                </thead>
                <tbody>
                  {presence.map((p) => {
                    const a = wilson(p.inWins, p.inGames);
                    const b = wilson(p.outWins, p.outGames);
                    const same = p.outGames === 0 || overlaps(a, b);
                    return (
                      <tr key={p.member} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="px-3 py-2">{displayName(p.member)}</td>
                        <td className="px-3 py-2 text-right">
                          <Rate wins={p.inWins} games={p.inGames} />
                          <span className="ml-1 text-[11px] text-[var(--muted)]">{p.inGames} 场</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Rate wins={p.outWins} games={p.outGames} />
                          <span className="ml-1 text-[11px] text-[var(--muted)]">{p.outGames} 场</span>
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            same
                              ? "text-[var(--muted)]"
                              : p.delta > 0
                                ? "text-[var(--status-good)]"
                                : "text-[var(--status-critical)]"
                          }`}
                        >
                          {p.outGames === 0
                            ? "—"
                            : `${p.delta >= 0 ? "+" : ""}${Math.round(p.delta * 100)}pp`}
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--muted)]">
                          {p.outGames === 0
                            ? "没有缺席的局，无从比较"
                            : same
                              ? "区间重叠，说明不了问题"
                              : "区间不重叠，值得留意"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {objectives.length ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                拿到关键资源时的胜率
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                这是相关不是因果：本来就打得好的局更容易拿到这些东西。它的用处是看哪一项和胜负绑得最紧，
                那一项就值得在战术上优先安排。
              </p>
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-left">资源</th>
                      <th className="px-3 py-2 text-right">拿到时</th>
                      <th className="px-3 py-2 text-right">没拿到时</th>
                      <th className="px-3 py-2 text-right">差值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objectives.map((o) => {
                      const wa = o.withGames ? o.withWins / o.withGames : 0;
                      const wb = o.withoutGames ? o.withoutWins / o.withoutGames : 0;
                      return (
                        <tr key={o.label} className="border-b border-[var(--border)]/50 last:border-0">
                          <td className="px-3 py-2">{o.label}</td>
                          <td className="px-3 py-2 text-right">
                            <Rate wins={o.withWins} games={o.withGames} />
                            <span className="ml-1 text-[11px] text-[var(--muted)]">{o.withGames} 场</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Rate wins={o.withoutWins} games={o.withoutGames} />
                            <span className="ml-1 text-[11px] text-[var(--muted)]">{o.withoutGames} 场</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {o.withGames && o.withoutGames
                              ? `${wa - wb >= 0 ? "+" : ""}${Math.round((wa - wb) * 100)}pp`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            胜率后面的小字是 95% 置信区间，表示这个胜率真实值大概落在哪个范围。
            场次越少区间越宽。两个区间重叠，就说明现有数据分不出高下，不要拿来下结论。
            本页所有对比都是相关性，不是因果。
          </p>
        </div>
      )}
    </div>
  );
}
