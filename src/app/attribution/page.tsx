import { Suspense } from "react";
import Link from "next/link";
import { isDbConfigured } from "@/lib/db";
import {
  ATTRIBUTION_RULES,
  attribute,
  gamesWithMembers,
  memberCombos,
  teamGames,
  type TeamGame,
} from "@/lib/draft";
import { parseFilters, applyFilterParams, type FilterInput } from "@/lib/filters";
import MatchFilterBar from "@/components/MatchFilterBar";
import { displayName } from "@/lib/roster";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "组队归因 · LOVEYUE",
};

const BUCKET_HINT: Record<string, string> = {
  优势没转化: "总经济是领先的，仗还是输了 —— 运营和团战的问题，不是谁打得差",
  单点拖累: "队里有人评分明显低于其他人，其他人打得还行",
  路人拖累: "掉队的那个是路人，不是车队成员",
  全线崩盘: "没有人特别掉队，是整队评分被对面整体压住",
  打得胶着: "没有明显的崩点，也没被压住，输在细节",
};

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function signed(n: number) {
  return n > 0 ? `+${Math.round(n)}` : String(Math.round(n));
}

function signed1(n: number) {
  const v = n.toFixed(1);
  if (v === "0.0" || v === "-0.0") return "0.0";
  return n > 0 ? `+${v}` : v;
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function AttributionPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; since?: string; until?: string; who?: string; size?: string }>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const dbReady = isDbConfigured();

  const all: TeamGame[] = dbReady ? await teamGames(filters) : [];
  const size = Math.min(5, Math.max(2, Number(sp.size) || 3));
  const combos = memberCombos(all, size);

  const picked = (sp.who ?? "").split("|").filter(Boolean);
  const selected = picked.length ? picked : combos[0]?.members ?? [];
  const games = gamesWithMembers(all, selected);
  const report = attribute(games);
  const losses = games.filter((g) => !g.win);

  const href = (who: string[], newSize = size) => {
    const params = new URLSearchParams();
    applyFilterParams(params, filters as FilterInput);
    if (newSize !== 3) params.set("size", String(newSize));
    if (who.length) params.set("who", who.join("|"));
    const qs = params.toString();
    return qs ? `/attribution?${qs}` : "/attribution";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Attribution
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">组队归因</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          某几个人一起打胜率低，到底是全线崩、某一路崩、路人坑，还是优势没转化
        </p>
      </div>

      <div className="mb-8">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
      </div>

      {!dbReady ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          数据库还没接好，这里会在同步战绩后显示归因。
        </p>
      ) : !combos.length ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          当前筛选下没有 {size} 人同时在场的对局。换个人数，或把门槛人数调低、起始日提前。
        </p>
      ) : (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-[var(--muted)]">组合人数</span>
            {[2, 3, 4, 5].map((n) => (
              <Link
                key={n}
                href={href([], n)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  size === n
                    ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                    : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50"
                }`}
              >
                {n} 人
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {combos.map((c) => {
              const active = c.members.join("|") === selected.join("|");
              return (
                <Link
                  key={c.members.join("|")}
                  href={href(c.members)}
                  className={`rounded-sm border px-3 py-2 text-xs transition ${
                    active
                      ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50"
                  }`}
                >
                  <span className="font-semibold">{c.members.map(displayName).join(" + ")}</span>
                  <span className="ml-2 opacity-70">
                    {c.games} 场 · {pct(c.wins / c.games)}
                  </span>
                </Link>
              );
            })}
          </div>

          <section className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold">{selected.map(displayName).join(" + ")}</h2>
              <p className="text-sm text-[var(--muted)]">
                {report.games} 场 · {report.wins} 胜 {report.games - report.wins} 负 ·{" "}
                <span className="text-[var(--foreground)]">
                  胜率 {report.games ? pct(report.wins / report.games) : "—"}
                </span>
              </p>
            </div>

            {losses.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">这个组合在当前筛选下没有输过。</p>
            ) : (
              <>
                <p className="mb-2 text-xs uppercase tracking-wider text-[var(--muted)]">
                  {losses.length} 场失利的分类
                </p>
                <ul className="space-y-2">
                  {report.buckets.map((b) => (
                    <li key={b.bucket} className="rounded-sm border border-[var(--border)] p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{b.bucket}</span>
                        <span className="text-sm tabular-nums text-[var(--muted)]">
                          {b.count} 场 · 占失利 {pct(b.count / losses.length)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">{BUCKET_HINT[b.bucket]}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {losses.length > 0 ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                失利时谁最掉队
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                评分是同一场十个人之间归一化、再按位置加权算的 0~10 分，队友之间可以直接比。
                「比队友」是本人评分减掉我方五人的中位数，负数越大越掉队。
                「背锅次数」是在多少场失利里是队内最低分。路人按位置合并统计。
              </p>
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-left">谁</th>
                      <th className="px-3 py-2 text-left">位置</th>
                      <th className="px-3 py-2 text-right">失利场次</th>
                      <th className="px-3 py-2 text-right">平均评分</th>
                      <th className="px-3 py-2 text-right">比队友</th>
                      <th className="px-3 py-2 text-right">背锅次数</th>
                      <th className="px-3 py-2 text-right">相对经济</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.blame.map((b) => (
                      <tr key={b.key} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="px-3 py-2">{b.member ? displayName(b.member) : b.key}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">{b.position}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{b.losses}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {b.avgScore === null ? "—" : b.avgScore.toFixed(1)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            b.avgScoreVsTeam < -0.5
                              ? "text-[var(--status-critical)]"
                              : b.avgScoreVsTeam > 0.5
                                ? "text-[var(--status-good)]"
                                : ""
                          }`}
                        >
                          {signed1(b.avgScoreVsTeam)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {b.worstCount} 次
                          {b.losses ? (
                            <span className="ml-1 text-[11px] text-[var(--muted)]">
                              {" · "}
                              {pct(b.worstCount / b.losses)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                          {signed(b.avgGoldRelative)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {losses.length > 0 ? (
            <section>
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                逐场失利
              </h2>
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-left">日期</th>
                      <th className="px-3 py-2 text-left">模式</th>
                      <th className="px-3 py-2 text-left">判定</th>
                      <th className="px-3 py-2 text-left">队内最低分</th>
                      <th className="px-3 py-2 text-right">我方均分</th>
                      <th className="px-3 py-2 text-right">对面均分</th>
                      <th className="px-3 py-2 text-right">经济差</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {losses.slice(0, 30).map((g) => (
                      <tr key={g.gameId} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="px-3 py-2 tabular-nums">{fmtDate(g.gameCreationMs)}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">{g.queueName}</td>
                        <td className="px-3 py-2">{g.bucket}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">
                          {g.worstLane
                            ? `${g.worstLane.member ? displayName(g.worstLane.member) : "路人"} ${g.worstLane.champion}` +
                              (g.worstLane.score === null
                                ? ""
                                : ` ${g.worstLane.score.toFixed(1)} (${signed1(g.worstLane.scoreVsTeam)})`)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {g.ourAvgScore === null ? "—" : g.ourAvgScore.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                          {g.enemyAvgScore === null ? "—" : g.enemyAvgScore.toFixed(1)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            g.teamGoldDiff > 0 ? "text-[var(--status-good)]" : ""
                          }`}
                        >
                          {signed(g.teamGoldDiff)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/matches/${g.gameId}`}
                            className="text-xs text-[var(--gold)] hover:underline"
                          >
                            详情
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            判定主要看<span className="text-[var(--foreground)]">评分</span>，不是经济。
            评分在同一场十个人之间归一化、并按位置加权，所以辅助不会因为经济低被判成打得差，队友之间也能直接比。
            只看经济的话，输的一方每个人经济都低，结论永远是「大家都差」，等于没说。
            判定顺序是：经济领先却输掉算优势没转化；
            有人比队友中位数低 {ATTRIBUTION_RULES.soloGap} 分以上算他掉队（是路人就算路人拖累）；
            没人特别掉队但我方均分比对面低 {ATTRIBUTION_RULES.teamGap} 分以上算全线崩盘；
            其余算打得胶着。
            早期同步的对局如果没有评分字段，会自动退回按经济判定。
          </p>
        </div>
      )}
    </div>
  );
}
