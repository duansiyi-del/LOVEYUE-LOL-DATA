import { Suspense } from "react";
import Link from "next/link";
import { isDbConfigured } from "@/lib/db";
import { applyFilterParams, parseFilters, type FilterInput } from "@/lib/filters";
import { getChampionTagMap } from "@/lib/ddragon";
import {
  formatMetric,
  leaderboard,
  METRICS_BY_POSITION,
  METRICS_BY_TAG,
  TAG_ORDER,
  TAG_ZH,
  type Dimension,
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

function MetricBoard({
  metric,
  rows,
  useAlias,
}: {
  metric: MetricDef;
  rows: LeaderRow[];
  /** 成员维度要把游戏昵称换成平时叫的名字; 英雄维度直接显示英雄名 */
  useAlias: boolean;
}) {
  const name = (r: LeaderRow) => (useAlias ? displayName(r.key) : r.key);
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
              <li key={x.row.key} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={i === 0 ? "font-semibold text-[var(--gold)]" : ""}>
                    {i + 1}. {name(x.row)}
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
          {thin.map(name).join("、")} 不足 {MIN_GAMES} 场，未参与排名
        </p>
      ) : null}
    </div>
  );
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    min?: string;
    since?: string;
    until?: string;
    pos?: string;
    by?: string;
    tag?: string;
  }>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const dbReady = isDbConfigured();

  // 两个维度: 按成员看位置, 按英雄看官方标签. 指标集跟着维度自动换 ——
  // 辅助不该拿输出排名, 坦克不该拿补刀排名.
  const by: Dimension = sp.by === "champion" ? "champion" : "member";
  const pos = POSITIONS.some((p) => p.key === (sp.pos ?? "")) ? sp.pos ?? "" : "";
  const tag = TAG_ORDER.includes(sp.tag ?? "") ? sp.tag ?? "" : "";

  const [allRows, tagMap] = dbReady
    ? await Promise.all([
        leaderboard(filters, by === "champion" ? "" : pos, by),
        by === "champion" ? getChampionTagMap() : Promise.resolve({} as Record<number, string[]>),
      ])
    : [[] as LeaderRow[], {} as Record<number, string[]>];

  const rows =
    by === "champion" && tag
      ? allRows.filter((r) => r.championId !== null && (tagMap[r.championId] ?? []).includes(tag))
      : allRows;

  const metrics =
    by === "champion"
      ? METRICS_BY_TAG[tag] ?? METRICS_BY_TAG[""]
      : METRICS_BY_POSITION[pos] ?? METRICS_BY_POSITION[""];

  const href = (next: { by?: Dimension; pos?: string; tag?: string }) => {
    const params = new URLSearchParams();
    applyFilterParams(params, filters as FilterInput);
    const b = next.by ?? by;
    if (b === "champion") params.set("by", "champion");
    const p = next.pos ?? (b === by ? pos : "");
    const t = next.tag ?? (b === by ? tag : "");
    if (b === "member" && p) params.set("pos", p);
    if (b === "champion" && t) params.set("tag", t);
    const qs = params.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };

  const pill = (active: boolean) =>
    `rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
      active
        ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
        : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50 hover:text-[var(--foreground)]"
    }`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Leaderboard
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">数据榜单</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          指标跟着维度走 · 辅助看视野控制，坦克看承伤减伤，射手看输出发育 ·
          一律按每分钟或占全队比例，不用总量
        </p>
      </div>

      <div className="mb-6">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-[var(--muted)]">维度</span>
        <Link href={href({ by: "member" })} className={pill(by === "member")}>
          按成员
        </Link>
        <Link href={href({ by: "champion" })} className={pill(by === "champion")}>
          按英雄
        </Link>
      </div>

      <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
        {by === "member" ? (
          <>
            <span className="text-xs text-[var(--muted)]">位置</span>
            {POSITIONS.map((p) => (
              <Link key={p.key} href={href({ pos: p.key })} className={pill(pos === p.key)}>
                {p.label}
              </Link>
            ))}
          </>
        ) : (
          <>
            <span className="text-xs text-[var(--muted)]">英雄类型</span>
            <Link href={href({ tag: "" })} className={pill(tag === "")}>
              全部
            </Link>
            {TAG_ORDER.map((t) => (
              <Link key={t} href={href({ tag: t })} className={pill(tag === t)}>
                {TAG_ZH[t]}
              </Link>
            ))}
          </>
        )}
      </div>

      {!dbReady || rows.length === 0 ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          {by === "champion" && tag
            ? `还没有${TAG_ZH[tag]}类英雄的对局数据。`
            : "还没有对局数据。同步战绩后，或者把门槛人数调低、起始日提前再看。"}
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.map((m) => (
              <MetricBoard
                key={String(m.key)}
                metric={m}
                rows={rows}
                useAlias={by === "member"}
              />
            ))}
          </div>

          <p className="mt-8 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            英雄类型是 Riot 官方分类（一个英雄可能同时属于两类，比如牛头是坦克也是辅助）。
            全部按每分钟或占全队比例计算，不用总量 —— 总量只反映谁的局更长。
            只统计召唤师峡谷、打满五分钟的对局，少于 {MIN_GAMES} 场不参与排名。
            承伤、减伤、反野、目标物伤害这几项是后来才开始采集的，早期同步的对局没有值，
            要在同步菜单里做一次「刷新旧对局」才会补上。
          </p>
        </>
      )}
    </div>
  );
}
