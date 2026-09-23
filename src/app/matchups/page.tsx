import { Suspense } from "react";
import Link from "next/link";
import championTitles from "@/data/championTitles.json";
import { isDbConfigured } from "@/lib/db";
import { banStats, memberMatchups, type MemberMatchup } from "@/lib/draft";
import { loadOpggBaseline, type OpggBaseline } from "@/lib/opgg";
import { parseFilters, applyFilterParams, type FilterInput } from "@/lib/filters";
import { roster } from "@/lib/roster";
import MatchFilterBar from "@/components/MatchFilterBar";
import OpggRefreshButton from "@/components/OpggRefreshButton";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "对位分析 · LOVEYUE",
};

// 进排名要的最低场次. 对位比组合更稀疏, 门槛比 /draft 低一档, 但仍然标注出来.
const MIN_GAMES = 3;

const champName = championTitles as Record<string, string>;

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function signed(n: number, digits = 0) {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}

// 场次少的胜率不可信, 向 50% 收缩再排序 (加两场虚拟的五五开),
// 这样 2 场全败不会盖过 8 场三成胜率.
function shrunkRate(wins: number, games: number) {
  return (wins + 1) / (games + 2);
}

// 大盘基准: 按「自己用的英雄 + 分路」去查这个对位在 OP.GG 的胜率, 多个英雄时
// 按场次加权. 查不到就返回 null (大盘样本不足, 或者还没刷过).
function baselineFor(r: MemberMatchup, base: OpggBaseline): number | null {
  let weighted = 0;
  let weight = 0;
  for (const o of r.ownBreakdown) {
    const hit = base.matchups.get(`${o.championId}|${o.position}|${r.enemyChampionId}`);
    if (!hit || !hit.play) continue;
    weighted += (hit.win / hit.play) * o.games;
    weight += o.games;
  }
  return weight ? weighted / weight : null;
}

function MatchupTable({ rows, base }: { rows: MemberMatchup[]; base: OpggBaseline; tone?: "bad" | "good" }) {
  if (!rows.length) {
    return <p className="px-3 py-4 text-sm text-[var(--muted)]">样本还不够。</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
        <tr className="border-b border-[var(--border)]">
          <th className="px-3 py-2 text-left">对位英雄</th>
          <th className="px-3 py-2 text-right">胜负</th>
          <th className="px-3 py-2 text-right">胜率</th>
          <th className="px-3 py-2 text-right">大盘</th>
          <th className="px-3 py-2 text-right">对比大盘</th>
          <th className="px-3 py-2 text-right">补刀差</th>
          <th className="px-3 py-2 text-right">经济差</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.enemyChampion} className="border-b border-[var(--border)]/50 last:border-0">
            <td className="px-3 py-2">
              {r.enemyChampion}
              {r.ownChampions.length ? (
                <span className="ml-2 text-[11px] text-[var(--muted)]">
                  用 {r.ownChampions.slice(0, 3).join("、")}
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {r.wins}-{r.games - r.wins}
            </td>
            <td
              className={`px-3 py-2 text-right tabular-nums ${
                r.wins / r.games < 0.5
                  ? "text-[var(--status-critical)]"
                  : r.wins / r.games > 0.5
                    ? "text-[var(--status-good)]"
                    : ""
              }`}
            >
              {pct(r.wins / r.games)}
            </td>
            {(() => {
              const b = baselineFor(r, base);
              const delta = b === null ? null : r.wins / r.games - b;
              return (
                <>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">
                    {b === null ? "—" : pct(b)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      delta === null
                        ? ""
                        : delta < -0.08
                          ? "text-[var(--status-critical)]"
                          : delta > 0.08
                            ? "text-[var(--status-good)]"
                            : ""
                    }`}
                  >
                    {delta === null ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}pp`}
                  </td>
                </>
              );
            })()}
            <td className="px-3 py-2 text-right tabular-nums">{signed(r.csDiff, 1)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{signed(r.goldDiff)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BanList({ title, hint, rows, total }: { title: string; hint: string; rows: { championId: number; count: number }[]; total: number }) {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
      <p className="font-display text-sm font-semibold text-[var(--gold)]">{title}</p>
      <p className="mb-2 text-xs text-[var(--muted)]">{hint}</p>
      {rows.length ? (
        <ul className="space-y-1 text-sm">
          {rows.slice(0, 8).map((b) => (
            <li key={b.championId} className="flex justify-between gap-2">
              <span className="truncate">{champName[String(b.championId)] ?? `英雄 ${b.championId}`}</span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {b.count} 次 · {total ? pct(b.count / total) : "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">还没有 ban 位数据。</p>
      )}
    </div>
  );
}

export default async function MatchupsPage({
  searchParams,
}: {
  searchParams: Promise<{ min?: string; since?: string; until?: string; member?: string }>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const dbReady = isDbConfigured();

  const [matchups, bans, base] = dbReady
    ? await Promise.all([memberMatchups(filters), banStats(filters), loadOpggBaseline()])
    : [
        [] as MemberMatchup[],
        { againstUs: [], byUs: [], matches: 0 },
        { matchups: new Map(), overall: new Map(), updatedAt: null } as OpggBaseline,
      ];

  // 名单顺序优先, 名单外出现过的成员补在后面
  const withData = new Set(matchups.map((m) => m.member));
  const members = [
    ...roster.map((r) => r.nickname).filter((n) => withData.has(n)),
    ...[...withData].filter((n) => !roster.some((r) => r.nickname === n)),
  ];
  const active = sp.member && withData.has(sp.member) ? sp.member : members[0];

  const mine = matchups.filter((m) => m.member === active);
  const ranked = mine.filter((m) => m.games >= MIN_GAMES);
  const thin = mine.filter((m) => m.games < MIN_GAMES);
  const byRate = [...ranked].sort(
    (a, b) => shrunkRate(a.wins, a.games) - shrunkRate(b.wins, b.games) || a.goldDiff - b.goldDiff
  );
  // 对半切, 保证同一个对位不会同时出现在「苦手」和「打得顺」两张表里.
  // 排名数太少时对半切没意义, 直接出一张全量表 (最难打的排前面).
  const splitTables = ranked.length >= 4;
  const half = Math.min(8, Math.floor(byRate.length / 2));
  const worst = splitTables ? byRate.slice(0, half) : byRate;
  const bestRows = splitTables ? byRate.slice(byRate.length - half).reverse() : [];

  const memberHref = (name: string) => {
    const params = new URLSearchParams();
    applyFilterParams(params, filters as FilterInput);
    params.set("member", name);
    return `/matchups?${params.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Matchups
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">对位分析</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          同一分路对上的敌方英雄 · 只计召唤师峡谷 · 少于 {MIN_GAMES} 场不参与排名
        </p>
      </div>

      <div className="mb-4">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
      </div>

      <div className="mb-8">
        <OpggRefreshButton
          updatedAt={base.updatedAt ? base.updatedAt.toLocaleDateString("zh-CN") : null}
        />
      </div>

      {!dbReady ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          数据库还没接好，这里会在同步战绩后显示对位分析。
        </p>
      ) : !members.length ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          当前筛选下还没有对位数据。同步战绩后，或把门槛人数调低、起始日提前再看。
        </p>
      ) : (
        <div className="space-y-10">
          <section className="grid gap-4 sm:grid-cols-2">
            <BanList
              title="对面最常 ban 掉的"
              hint={`共 ${bans.matches} 场有 ban 位记录。这是别人忌惮我们什么。`}
              rows={bans.againstUs}
              total={bans.matches}
            />
            <BanList
              title="我们最常 ban 掉的"
              hint="我们自己的 ban 习惯，和下面的苦手列表对照着看。"
              rows={bans.byUs}
              total={bans.matches}
            />
          </section>

          <section>
            <div className="mb-4 flex flex-wrap justify-center gap-2">
              {members.map((m) => (
                <Link
                  key={m}
                  href={memberHref(m)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                    active === m
                      ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50 hover:text-[var(--foreground)]"
                  }`}
                >
                  {m}
                </Link>
              ))}
            </div>

            {splitTables ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="overflow-x-auto rounded-sm border border-[var(--status-critical)]/40 bg-[var(--bg-panel)]">
                  <p className="border-b border-[var(--border)] px-3 py-2 font-display text-sm font-semibold text-[var(--status-critical)]">
                    苦手
                  </p>
                  <MatchupTable rows={worst} base={base} tone="bad" />
                </div>
                <div className="overflow-x-auto rounded-sm border border-[var(--status-good)]/40 bg-[var(--bg-panel)]">
                  <p className="border-b border-[var(--border)] px-3 py-2 font-display text-sm font-semibold text-[var(--status-good)]">
                    打得顺
                  </p>
                  <MatchupTable rows={bestRows} base={base} tone="good" />
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <p className="border-b border-[var(--border)] px-3 py-2 font-display text-sm font-semibold text-[var(--gold)]">
                  全部对位（最难打的排前面）
                </p>
                <MatchupTable rows={worst} base={base} tone="bad" />
              </div>
            )}

            {thin.length ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                另有 {thin.length} 个对位只打过 1~2 场，没算进排名：
                {thin.slice(0, 15).map((t) => t.enemyChampion).join("、")}
                {thin.length > 15 ? " 等" : ""}
              </p>
            ) : null}
          </section>

          <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            「大盘」是 OP.GG 上同一个对位的胜率，按你用的英雄和分路查，用多个英雄时按场次加权。
            它回答的是「这个对位本来就难打，还是我打不好」：
            大盘也低就是英雄天生被克，大盘不低而我们低才是自己的问题。
            注意那是全球数据、不分段位，只能当参照不能当结论；显示「—」是大盘样本不足或还没刷过。
          </p>

          <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
            补刀差和经济差是<span className="text-[var(--foreground)]">整场结束时</span>的差值，不是对线期的差值。
            我们只拉了对局汇总，没有时间轴数据，所以一场滚雪球会把差值放大。
            它衡量的是这一路整场下来吃没吃亏，不等于对线阶段谁赢。
            胜率同理：一路打赢但团队输掉很常见，所以两列要一起看。
          </p>
        </div>
      )}
    </div>
  );
}
