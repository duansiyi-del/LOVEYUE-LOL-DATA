import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import MatchFilterBar from "@/components/MatchFilterBar";
import IntervalChart, { type IntervalRow } from "@/components/IntervalChart";
import TrendChart from "@/components/TrendChart";
import RadarChart from "@/components/RadarChart";
import { isDbConfigured } from "@/lib/db";
import { memberMatchups, positionZh, teamGames } from "@/lib/draft";
import { applyFilterParams, parseFilters } from "@/lib/filters";
import { loadOpggBaseline } from "@/lib/opgg";
import { formatMetric, leaderboard, METRICS_BY_POSITION, type LeaderRow } from "@/lib/leaderboard";
import {
  championLearning,
  championReport,
  MIN_CHAMPION_REPORT,
  MIN_HALVES,
  monthlyTrend,
  playerGameRows,
  playerChampions,
  playerLosses,
  playerPositions,
  recentGames,
  teammateSynergy,
} from "@/lib/player";
import { memberRatings, overlaps, wilson } from "@/lib/report";
import { displayName, roster } from "@/lib/roster";

export const dynamic = "force-dynamic";

// 个人页. 入口在名单页 —— 点卡片进来.
//
// 口径和全站一致, 跟着上面那条筛选条走. 但默认门槛是【1 人】而不是全站的 3 人:
// 个人页要回答"这个人打得怎么样", 他单排的局也算数; 车队局的口径在组队归因页看.
//
// 样本少的时候一律不下结论 —— 胜率都带 95% 置信区间, 区间重叠就标成"说不清".

const MIN_CHAMPION_GAMES = 3;
const MIN_TEAMMATE_GAMES = 5;
const MIN_MATCHUP_GAMES = 3;

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function rateRow(label: string, wins: number, games: number, base: { lo: number; hi: number }): IntervalRow {
  const ci = wilson(wins, games);
  return {
    label,
    note: `${games} 场 · ${wins}胜${games - wins}负`,
    rate: games ? wins / games : 0,
    lo: ci.lo,
    hi: ci.hi,
    inconclusive: overlaps(ci, base),
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = roster.find((x) => x.id === id);
  return { title: p ? `${displayName(p.nickname)} · LOVEYUE` : "选手 · LOVEYUE" };
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ min?: string; since?: string; until?: string; queue?: string; champ?: string }>;
}) {
  const { id } = await params;
  const player = roster.find((x) => x.id === id);
  if (!player) notFound();

  const sp = await searchParams;
  // 个人页默认不设车队人数门槛, 见文件头.
  const filters = parseFilters({ ...sp, min: sp.min ?? "1" });
  const me = player.nickname;
  const alias = displayName(me);
  const dbReady = isDbConfigured();

  const [overall, positions, champions, games, matchups, ratings, months, learning, gameRows] = dbReady
    ? await Promise.all([
        leaderboard(filters, "", "member"),
        playerPositions(filters, me),
        playerChampions(filters, me),
        teamGames(filters),
        memberMatchups(filters),
        memberRatings(filters),
        monthlyTrend(filters, me),
        championLearning(filters, me),
        playerGameRows(filters, me),
      ])
    : [[] as LeaderRow[], [], [], [], [], [], [], [], []];

  const myRating = ratings.find((r) => r.member === me);

  const mainPosition = positions[0]?.key ?? "";
  // 六维指标按【主位置】选, 和数据榜单同一套分工 —— 辅助不拿输出排名.
  const byPos = dbReady && mainPosition ? await leaderboard(filters, mainPosition, "member") : overall;

  const myTotals = overall.find((r) => r.key === me);
  const totalGames = myTotals?.games ?? 0;
  const totalWins = myTotals?.wins ?? 0;
  const myCi = wilson(totalWins, totalGames);

  // 雷达只放"越大越好"的轴 —— 场均死亡那类反向指标放外圈会读反, 单独列在下面.
  const metrics = METRICS_BY_POSITION[mainPosition] ?? METRICS_BY_POSITION[""];
  const radarPool = byPos.filter((r) => r.games >= 3);
  const mine = byPos.find((r) => r.key === me);
  const axes = metrics
    .filter((m) => m.higherIsBetter)
    .map((m) => {
      const v = Number(mine?.[m.key] ?? 0) || 0;
      const max = Math.max(...radarPool.map((r) => Number(r[m.key] ?? 0) || 0), v);
      return { label: m.label, value: v, max, display: formatMetric(v, m.format) };
    });

  const posRows = positions.map((p) => rateRow(positionZh(p.key), p.wins, p.games, myCi));

  const champRows = champions.filter((c) => c.games >= MIN_CHAMPION_GAMES);
  const champRest = champions.filter((c) => c.games < MIN_CHAMPION_GAMES);

  const synergy = teammateSynergy(games, me).filter((s) => s.together >= MIN_TEAMMATE_GAMES);
  const synergyRows: IntervalRow[] = synergy.map((s) => {
    const row = rateRow(displayName(s.teammate), s.togetherWins, s.together, wilson(s.apartWins, s.apart));
    // 从来没分开打过的队友, 没有对照组可比 —— 这一行就等于他自己的总胜率, 说明不了
    // 搭配好坏. 标出来, 别让人当成"和他一起打胜率高".
    return s.apart === 0 ? { ...row, note: `${s.together} 场 · 没分开打过`, inconclusive: true } : row;
  });

  // 参照线用"他在场、这些队友不在"的合计胜率. 但如果他从来没离开过这拨人
  // (车队开黑常有), 这个分母是 0 —— 那就退回他自己的总胜率, 别画一条 0% 的线.
  const apartGames = synergy.reduce((s, x) => s + x.apart, 0);
  const synergyBase = apartGames
    ? { rate: synergy.reduce((s, x) => s + x.apartWins, 0) / apartGames, label: "他不带这人时" }
    : { rate: totalGames ? totalWins / totalGames : 0, label: "他自己" };

  const myMatchups = matchups
    .filter((x) => x.member === me && x.games >= MIN_MATCHUP_GAMES)
    .map((x) => ({ ...x, rate: x.wins / x.games }))
    .sort((a, b) => a.rate - b.rate);

  const losses = playerLosses(games, me);
  const recent = recentGames(games, me, 12);

  // ---- 单英雄专项 (?champ=) ----
  // 只认他真的玩过的英雄, 防止 URL 里随便传个名字进来查库.
  const selectedChamp = champions.some((c) => c.key === sp.champ) ? (sp.champ as string) : "";
  const report = selectedChamp ? championReport(gameRows, selectedChamp) : null;
  // OP.GG 大盘只在展开某个英雄时才读, 平时不碰那两张表
  const opgg = report ? await loadOpggBaseline() : null;
  const opggRow = report && opgg ? opgg.overall.get(`${report.championId}|${report.mainPosition}`) : undefined;
  // win_rate 没在别处消费过, 单位没法从代码确认: 大于 1 就当百分数
  const opggRate = opggRow ? (opggRow.winRate > 1 ? opggRow.winRate / 100 : opggRow.winRate) : null;

  // 英雄行的链接: 保留当前筛选, 只换 champ; 再点同一个就收起
  const champHref = (name: string) => {
    const params = new URLSearchParams();
    applyFilterParams(params, filters);
    if (name && name !== selectedChamp) params.set("champ", name);
    const qs = params.toString();
    return `/roster/${player.id}${qs ? `?${qs}` : ""}#champ`;
  };
  // 差值带正负号. 对位经济差的 format 自带符号, 别再叠一个 "+" 上去
  const signed = (fmt: (v: number) => string, v: number) => {
    const t = fmt(v);
    return v >= 0 && !t.startsWith("+") && !t.startsWith("-") ? `+${t}` : t;
  };
  const verdictOf = (c: { diff: number; significant: boolean; lowerIsBetter: boolean }) =>
    !c.significant ? "看不出" : (c.lowerIsBetter ? c.diff < 0 : c.diff > 0) ? "明显更好" : "明显更差";
  const verdictClass = (v: string) =>
    v === "明显更好" || v === "有进步"
      ? "text-[var(--status-good)]"
      : v === "明显更差" || v === "在退步"
        ? "text-[var(--status-critical)]"
        : "text-[var(--muted)]";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/roster" className="text-xs text-[var(--muted)] transition hover:text-[var(--gold)]">
        ‹ 返回名单
      </Link>

      {/* ---- 头部 ---- */}
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="relative h-36 w-28 shrink-0 overflow-hidden rounded-sm bg-[#0a0f1e]">
          {player.photos.length ? (
            <Image src={player.photos[0]} alt={alias} fill className="object-cover" sizes="112px" priority />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="font-display text-4xl font-black text-[var(--gold)]/40">{alias.slice(0, 1)}</span>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
            NO.{String(player.number).padStart(2, "0")}
          </p>
          <h1 className="font-display mt-1 text-4xl font-extrabold sm:text-5xl">{alias}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{player.nickname}</p>
        </div>
        {totalGames > 0 ? (
          <div className="flex gap-6 sm:gap-8">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">场次</p>
              <p className="font-display text-2xl font-bold tabular-nums">{totalGames}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">胜率</p>
              <p className="font-display text-2xl font-bold tabular-nums text-[var(--gold)]">
                {pct(totalWins / totalGames)}
              </p>
              <p className="text-[10px] tabular-nums text-[var(--muted)]">
                {pct(myCi.lo)}~{pct(myCi.hi)}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="my-8">
        <Suspense fallback={null}>
          <MatchFilterBar
            min={filters.min}
            queue={filters.queue}
            sinceDate={filters.sinceDate}
            untilDate={filters.untilDate}
          />
        </Suspense>
      </div>

      {!dbReady || totalGames === 0 ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          {dbReady ? "当前筛选下没有他的对局，换个模式或放宽时间试试。" : "数据库还没接好。"}
        </p>
      ) : (
        <div className="space-y-12">
          {/* ---- 六维 ---- */}
          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              能力分布
            </h2>
            <p className="mb-4 text-xs text-[var(--muted)]">
              指标按他的主位置（{mainPosition ? positionZh(mainPosition) : "全部"}）挑选，和数据榜单同一套。
              外圈 = 队内第一，是相对值不是满分。
            </p>
            <div className="grid items-center gap-6 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-5 sm:grid-cols-[220px_1fr]">
              <RadarChart axes={axes} size={220} />
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {metrics.map((m) => {
                  const v = mine?.[m.key];
                  return (
                    <div key={m.key}>
                      <p className="text-[11px] text-[var(--muted)]">{m.label}</p>
                      <p className="font-display text-lg font-bold tabular-nums">
                        {formatMetric(typeof v === "number" ? v : null, m.format)}
                      </p>
                    </div>
                  );
                })}
                <div>
                  <p className="text-[11px] text-[var(--muted)]">MVP / SVP</p>
                  <p className="font-display text-lg font-bold tabular-nums">
                    {myRating ? `${myRating.mvp} / ${myRating.svp}` : "—"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ---- 位置 ---- */}
          {posRows.length ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                各位置胜率
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                横线是 95% 置信区间。跨过虚线（他自己的总胜率）就说明这个位置打得好不好说不清，灰色标出。
              </p>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
                <IntervalChart rows={posRows} baseline={totalWins / totalGames} baselineLabel="他自己" />
              </div>
            </section>
          ) : null}

          {/* ---- 英雄池 ---- */}
          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              常用英雄
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              按场次排序，{MIN_CHAMPION_GAMES} 场以下的只在末尾列名字，不给胜率——两三场的胜率是噪音。
              点一个英雄看专项分析（{MIN_CHAMPION_REPORT} 场起）。
            </p>
            {champRows.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {champRows.map((c) => {
                  const r = c.wins / c.games;
                  return (
                    <Link
                      key={c.key}
                      href={champHref(c.key)}
                      scroll={false}
                      className={`flex items-center gap-3 rounded-sm border bg-[var(--bg-panel)] px-3 py-2 transition hover:border-[var(--gold)]/60 ${
                        c.key === selectedChamp ? "border-[var(--gold)]" : "border-[var(--border)]"
                      }`}
                    >
                      <span className="w-20 shrink-0 truncate text-sm">{c.key}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]/15">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(r * 100)}%`,
                            background: r >= 0.5 ? "var(--gold)" : "var(--muted)",
                          }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">
                        {c.games} 场 · {pct(r)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">还没有打满 {MIN_CHAMPION_GAMES} 场的英雄。</p>
            )}
            {champRest.length ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                还玩过：{champRest.map((c) => c.key).join("、")}
              </p>
            ) : null}
          </section>

          {/* ---- 单英雄专项 ---- */}
          {selectedChamp && !report ? (
            <p id="champ" className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4 text-sm text-[var(--muted)]">
              {selectedChamp} 不到 {MIN_CHAMPION_REPORT} 场，做不了专项分析。
            </p>
          ) : null}
          {report ? (
            <section id="champ" className="rounded-sm border border-[var(--gold)]/40 bg-[var(--bg-panel)] p-5">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-display text-xl font-bold">{report.champion}</h2>
                <span className="text-sm tabular-nums text-[var(--muted)]">
                  {report.games} 场 · {report.wins}胜{report.games - report.wins}负 ·{" "}
                  {pct(report.wins / report.games)}（{pct(wilson(report.wins, report.games).lo)}~
                  {pct(wilson(report.wins, report.games).hi)}）
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {report.byPosition.map((b) => `${positionZh(b.position)} ${b.games}`).join(" · ")}
                </span>
              </div>
              {report.mixedPositions ? (
                <p className="mb-3 text-xs text-[var(--status-warning,#e7b655)]">
                  ⚠ 这个英雄他在多个位置用过，下面的前后对比可能混进了位置变化。
                </p>
              ) : null}

              {/* A. 值不值得练 */}
              <h3 className="font-display mb-1 mt-4 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                值不值得练：绝对水平
              </h3>
              <p className="mb-3 text-xs text-[var(--muted)]">
                他用这个英雄 vs 他用别的英雄
                {report.othersSamePosition ? `（只比他同样打${positionZh(report.mainPosition)}的局，不然位置差异会盖过英雄差异）` : ""}
                ，全期。{opggRate !== null ? "第三行是 OP.GG 大盘同位置胜率。" : ""}
              </p>
              <IntervalChart
                rows={[
                  rateRow(`用${report.champion}`, report.wins, report.games, wilson(report.otherWins, report.otherGames)),
                  rateRow(
                    report.othersSamePosition ? `其他${positionZh(report.mainPosition)}英雄` : "其他英雄",
                    report.otherWins,
                    report.otherGames,
                    wilson(report.wins, report.games)
                  ),
                  ...(opggRate !== null
                    ? [
                        {
                          label: "OP.GG 大盘",
                          note: `${(opggRow!.play / 10000).toFixed(1)} 万场`,
                          rate: opggRate,
                          lo: opggRate,
                          hi: opggRate,
                          inconclusive: true,
                        },
                      ]
                    : []),
                ]}
                baseline={totalGames ? totalWins / totalGames : 0}
                baselineLabel="他自己"
              />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-2 py-1.5 text-left">指标</th>
                      <th className="px-2 py-1.5 text-right">
                        {report.othersSamePosition ? `其他${positionZh(report.mainPosition)}英雄` : "其他英雄"}
                      </th>
                      <th className="px-2 py-1.5 text-right">{report.champion}</th>
                      <th className="px-2 py-1.5 text-right">差</th>
                      <th className="px-2 py-1.5 text-right">结论</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.vsOthers
                      .filter((c) => c.a.n > 0 && c.b.n > 0)
                      .map((c) => {
                        const v = verdictOf(c);
                        return (
                          <tr key={c.key} className="border-b border-[var(--border)]/50 last:border-0">
                            <td className="px-2 py-1.5">
                              {c.label}
                              {c.lowerIsBetter ? <span className="text-[10px] text-[var(--muted)]">（越低越好）</span> : null}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--muted)]">{c.format(c.a.mean)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{c.format(c.b.mean)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{signed(c.format, c.diff)}</td>
                            <td className={`px-2 py-1.5 text-right ${verdictClass(v)}`}>{v}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* B. 有没有进步 */}
              <h3 className="font-display mb-1 mt-6 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                有没有进步：时间上的变化
              </h3>
              <p className="mb-3 text-xs text-[var(--muted)]">
                先看第几次玩这个英雄时的胜率（生手期过了没），再看前一半场次和后一半的表现指标。
                「其他英雄同期」是他同一时间段用别的英雄的变化——如果也朝同一个方向变了差不多的量，那是他整个人在变，不是这个英雄。
              </p>
              {report.learning.length >= 2 ? (
                <IntervalChart
                  rows={report.learning.map((l) => rateRow(l.label, l.wins, l.games, myCi))}
                  baseline={totalGames ? totalWins / totalGames : 0}
                  baselineLabel="他自己"
                />
              ) : null}
              {report.halves ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                      <tr className="border-b border-[var(--border)]">
                        <th className="px-2 py-1.5 text-left">指标</th>
                        <th className="px-2 py-1.5 text-right">前半（{report.halves[0].a.n} 场）</th>
                        <th className="px-2 py-1.5 text-right">后半（{report.halves[0].b.n} 场）</th>
                        <th className="px-2 py-1.5 text-right">变化</th>
                        <th className="px-2 py-1.5 text-right">
                          {report.othersSamePosition ? `其他${positionZh(report.mainPosition)}英雄同期` : "其他英雄同期"}
                        </th>
                        <th className="px-2 py-1.5 text-right">结论</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.halves
                        .filter((c) => c.a.n > 0 && c.b.n > 0)
                        .map((c) => (
                          <tr key={c.key} className="border-b border-[var(--border)]/50 last:border-0">
                            <td className="px-2 py-1.5">{c.label}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--muted)]">{c.format(c.a.mean)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{c.format(c.b.mean)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{signed(c.format, c.diff)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--muted)]">
                              {c.peerDiff === null ? "—" : signed(c.format, c.peerDiff)}
                            </td>
                            <td className={`px-2 py-1.5 text-right ${verdictClass(c.verdict)}`}>{c.verdict}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">
                    「看不出」不等于没进步：{report.games} 场切两半，大概只能抓住评分 1 分上下、死亡 1.5 次上下的跃迁，
                    小幅稳步进步在这个样本量下看不出来。
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  不到 {MIN_HALVES} 场，前后对比做不了；再攒几场。
                </p>
              )}
            </section>
          ) : null}

          {/* ---- 英雄熟练度 ---- */}
          {learning.length >= 2 ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                生手期有多贵
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                把每个英雄按时间排序，看「第几次玩这个英雄」时的胜率，再把所有英雄叠在一起。
                差距明显就说明排位里别拿新英雄试。
                ⚠ 粗看：能玩到 20 场以上的英雄，本来就是他擅长的那几个。
              </p>
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
                <IntervalChart
                  rows={learning.map((l) => rateRow(l.label, l.wins, l.games, myCi))}
                  baseline={totalGames ? totalWins / totalGames : 0}
                  baselineLabel="他自己"
                />
              </div>
            </section>
          ) : null}

          {/* ---- 月度走势 ---- */}
          {months.length >= 3 ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                在进步还是退步
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                按月看。空心点是那个月场次太少（不到 5 场），别当真。
                胜率和评分量纲不同，分两张画——叠成双轴图可以靠调刻度摆出任意想要的「关系」。
              </p>
              <div className="space-y-4 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
                <div>
                  <p className="mb-1 text-xs text-[var(--muted)]">胜率</p>
                  <TrendChart
                    points={months.map((m) => ({
                      label: m.month,
                      value: m.games ? m.wins / m.games : null,
                      n: m.games,
                    }))}
                    min={0}
                    max={1}
                    format={(v) => `${Math.round(v * 100)}%`}
                    baseline={totalGames ? totalWins / totalGames : undefined}
                    baselineLabel="全期"
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs text-[var(--muted)]">平均评分</p>
                  <TrendChart
                    points={months.map((m) => ({ label: m.month, value: m.avgScore, n: m.games }))}
                    min={0}
                    max={10}
                    format={(v) => v.toFixed(1)}
                    baseline={5}
                    baselineLabel="场内均分 5"
                  />
                </div>
              </div>
            </section>
          ) : null}

          {/* ---- 队友红黑榜 ---- */}
          <section>
            <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
              队友红黑榜
            </h2>
            <p className="mb-3 text-xs text-[var(--muted)]">
              和谁一起上赢得多。虚线是【他在场但这个队友不在】时的胜率，所以比的是搭配，不是谁强。
              ⚠ 相关不是因果：一起上的局往往人更多、对手也不同。
            </p>
            {synergyRows.length ? (
              <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-4">
                <IntervalChart rows={synergyRows} baseline={synergyBase.rate} baselineLabel={synergyBase.label} />
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                还没有一起打满 {MIN_TEAMMATE_GAMES} 场的队友。
              </p>
            )}
          </section>

          {/* ---- 对位 ---- */}
          {myMatchups.length ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                苦手对位
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                对面这条线拿出这个英雄时他的胜率，低的排前面。{MIN_MATCHUP_GAMES} 场起。
              </p>
              <div className="overflow-x-auto rounded-sm border border-[var(--border)] bg-[var(--bg-panel)]">
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-3 py-2 text-left">对位</th>
                      <th className="px-3 py-2 text-left">他常用</th>
                      <th className="px-3 py-2 text-right">场次</th>
                      <th className="px-3 py-2 text-right">胜率</th>
                      <th className="px-3 py-2 text-right">补刀差</th>
                      <th className="px-3 py-2 text-right">经济差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myMatchups.slice(0, 10).map((x) => (
                      <tr key={x.enemyChampion} className="border-b border-[var(--border)]/50 last:border-0">
                        <td className="px-3 py-2">{x.enemyChampion}</td>
                        <td className="px-3 py-2 text-[var(--muted)]">{x.ownChampions.slice(0, 2).join("、")}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{x.games}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            x.rate < 0.4 ? "text-[var(--status-critical)]" : ""
                          }`}
                        >
                          {pct(x.rate)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.round(x.csDiff)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Math.round(x.goldDiff)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* ---- 输的局 ---- */}
          {losses.losses > 0 ? (
            <section>
              <h2 className="font-display mb-1 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                输的局是怎么输的
              </h2>
              <p className="mb-3 text-xs text-[var(--muted)]">
                只看他在场的 {losses.losses} 场失利，分类口径和组队归因页一致。
              </p>
              <div className="flex flex-wrap gap-2">
                {losses.buckets.map((b) => (
                  <span
                    key={b.bucket}
                    className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-1.5 text-sm"
                  >
                    {b.bucket} <span className="tabular-nums text-[var(--muted)]">{b.count}</span>
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--muted)]">
                其中 {losses.worstCount} 场他是我方评分最低的那个
                {losses.losses ? `（占 ${pct(losses.worstCount / losses.losses)}，五人均摊是 20%）` : ""}。
              </p>
            </section>
          ) : null}

          {/* ---- 最近 ---- */}
          {recent.length ? (
            <section>
              <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
                最近对局
              </h2>
              <div className="grid gap-1.5">
                {recent.map((g) => (
                  <Link
                    key={g.gameId}
                    href={`/matches/${g.gameId}`}
                    className="flex items-center gap-3 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 text-sm transition hover:border-[var(--gold)]/60"
                  >
                    <span
                      className={`w-8 shrink-0 font-display text-xs font-bold ${
                        g.win ? "text-[var(--status-good)]" : "text-[var(--status-critical)]"
                      }`}
                    >
                      {g.win ? "胜" : "负"}
                    </span>
                    <span className="w-20 shrink-0 truncate">{g.champion}</span>
                    <span className="w-12 shrink-0 text-xs text-[var(--muted)]">{positionZh(g.position)}</span>
                    <span className="flex-1 truncate text-xs text-[var(--muted)]">{g.queueName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">
                      {g.score === null ? "—" : g.score.toFixed(1)} 分
                    </span>
                    <span className="hidden shrink-0 text-xs tabular-nums text-[var(--muted)] sm:inline">
                      {new Date(g.gameCreationMs).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
