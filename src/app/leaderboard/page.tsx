import { Suspense } from "react";
import Link from "next/link";
import { isDbConfigured } from "@/lib/db";
import { applyFilterParams, parseFilters, type FilterInput } from "@/lib/filters";
import {
  formatMetric,
  leaderboard,
  METRICS_BY_POSITION,
  type LeaderRow,
  type MetricDef,
} from "@/lib/leaderboard";
import { displayName } from "@/lib/roster";
import MatchFilterBar from "@/components/MatchFilterBar";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "数据榜单 · LOVEYUE",
};

// 场次低于这个数的不参与排名, 只在表格里灰显 —— 三五场的每分钟数据波动很大.
const MIN_GAMES = 3;

const POSITIONS: { key: string; label: string }[] = [
  { key: "", label: "全部" },
  { key: "TOP", label: "上单" },
  { key: "JUNGLE", label: "打野" },
  { key: "MIDDLE", label: "中单" },
  { key: "BOTTOM", label: "下路" },
  { key: "UTILITY", label: "辅助" },
];

function MetricBoard({ metric, rows }: { metric: MetricDef; rows: LeaderRow[] }) {
  const ranked = rows
    .filter((r) => r.games >= MIN_GAMES)
    .map((r) => ({ row: r, v: r[metric.key] as number | null }))
    .filter((x) => x.v !== null && Number.isFinite(x.v as number))
    .sort((a, b) =>
      metric.higherIsBetter ? (b.v as number) - (a.v as number) : (a.v as number) - (b.v as number)
    );
  const thin = rows.filter((r) => r.games < MIN_GAMES && r.games > 0);
  const best = ranked[0]?.v as number | undefined;

  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
      <p className="font-display text-sm font-bold text-[var(--gold)]">{metric.label}</p>
      <p className="mb-3 text-[11px] text-[var(--muted)]">{metric.hint}</p>

      {ranked.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">样本还不够。</p>
      ) : (
        <ol className="space-y-1.5">
          {ranked.map((x, i) => {
            const v = x.v as number;
            // 条形长度按和第一名的相对值, 越小越好的指标反过来算
            const ratio =
              best && best !== 0
                ? metric.higherIsBetter
                  ? Math.max(0.06, v / best)
                  : Math.max(0.06, best / Math.max(v, 0.0001))
                : 0;
            return (
              <li key={x.row.member} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={i === 0 ? "font-semibold text-[var(--gold)]" : ""}>
                    {i + 1}. {displayName(x.row.member)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatMetric(v, metric.format)}
                    <span className="ml-1.5 text-[11px] text-[var(--muted)]">
                      {x.row.games} 场
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={i === 0 ? "h-full bg-[var(--gold)]" : "h-full bg-white/25"}
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {thin.length ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {thin.map((r) => displayName(r.member)).join("、")} 不足 {MIN_GAMES} 场，未参与排名
        </p>
      ) : null}
    </div>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; since?: string; until?: string; pos?: string }>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const dbReady = isDbConfigured();
  const pos = POSITIONS.some((p) => p.key === (sp.pos ?? "")) ? sp.pos ?? "" : "";

  const rows = dbReady ? await leaderboard(filters, pos) : [];
  const metrics = METRICS_BY_POSITION[pos] ?? METRICS_BY_POSITION[""];

  const href = (p: string) => {
    const params = new URLSearchParams();
    applyFilterParams(params, filters as FilterInput);
    if (p) params.set("pos", p);
    const qs = params.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Leaderboard
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">数据榜单</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          每个位置只看这个位置真正吃的指标 · 一律按每分钟或占全队比例，不用总量
        </p>
      </div>

      <div className="mb-6">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
      </div>

      <div className="mb-8 flex flex-wrap justify-center gap-2">
        {POSITIONS.map((p) => (
          <Link
            key={p.key}
            href={href(p.key)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
              pos === p.key
                ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {!dbReady || rows.length === 0 ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          这个位置还没有对局数据。同步战绩后，或者把门槛人数调低、起始日提前再看。
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((m) => (
              <MetricBoard key={String(m.key)} metric={m} rows={rows} />
            ))}
          </div>

          <p className="mt-8 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            全部按每分钟或占全队比例计算，不用总量 —— 总量只反映谁的局更长。
            只统计召唤师峡谷、打满五分钟的对局。少于 {MIN_GAMES} 场的不参与排名。
            承伤、减伤、反野、目标物伤害这几项是后来才开始采集的，
            早期同步的对局没有值，要在同步菜单里做一次「刷新旧对局」才会补上。
          </p>
        </>
      )}
    </div>
  );
}
