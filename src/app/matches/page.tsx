import { Suspense } from "react";
import {
  countMatches,
  isDbConfigured,
  listMatchQueues,
  listMatches,
  type StoredMatch,
} from "@/lib/db";
import { getChampionIconMap, getDdragonVersion } from "@/lib/ddragon";
import { parseFilters } from "@/lib/filters";
import MatchFilterBar from "@/components/MatchFilterBar";
import MatchSyncForm from "@/components/MatchSyncForm";
import MatchesList from "@/components/MatchesList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "战绩 · LOVEYUE",
};

const PAGE_SIZE = 20;

// Fixed display order for the filter pills -- only modes that actually
// have synced games (per listMatchQueues) show up, in this order.
const QUEUE_ORDER = ["单双排", "灵活组排", "大乱斗", "海克斯大乱斗", "匹配"];

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; queue?: string; min?: string; since?: string; until?: string }>;
}) {
  const sp = await searchParams;
  const { page: rawPage, queue: rawQueue } = sp;
  const filters = parseFilters(sp);
  const dbReady = isDbConfigured();
  const queue = rawQueue && rawQueue !== "全部" ? rawQueue : undefined;

  // Count (and the queue list) before fetching the page itself, so an
  // out-of-range ?page= from an old link or a filter change can't ask for
  // an offset past the end -- it just clamps to the last real page.
  const [total, rawQueues, version, championMap] = await Promise.all([
    dbReady ? countMatches(filters, queue) : Promise.resolve(0),
    dbReady ? listMatchQueues(filters) : Promise.resolve([] as string[]),
    getDdragonVersion(),
    getChampionIconMap(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(rawPage) || 1), totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const matches = dbReady
    ? await listMatches(filters, PAGE_SIZE, offset, queue)
    : ([] as StoredMatch[]);

  const availableQueues = QUEUE_ORDER.filter((q) => rawQueues.includes(q));
  const hasAnyMatches = rawQueues.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-4 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Match History
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">战绩</h1>
      </div>

      <div className="mb-6">
        <MatchSyncForm />
      </div>

      <div className="mb-8">
        <Suspense fallback={null}>
          <MatchFilterBar min={filters.min} sinceDate={filters.sinceDate} untilDate={filters.untilDate} />
        </Suspense>
        <p className="mt-2 text-center text-xs text-[var(--muted)]">
          当前: 同一方至少 {filters.min} 名成员 · {filters.sinceDate || "最早"} 至 {filters.untilDate || "现在"} · 共 {total} 场
        </p>
      </div>

      {!dbReady ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          数据库还没接好（本地开发环境没有 POSTGRES_URL）。部署到 Vercel 并接上 Postgres 存储后，这里会显示同步下来的战绩。
        </p>
      ) : !hasAnyMatches ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          当前筛选下没有对局。还没同步过的话，粘贴 token 点一下同步；同步过的话试试调低门槛人数或把起始日提前。
        </p>
      ) : (
        <MatchesList
          matches={matches}
          version={version}
          championMap={championMap}
          currentQueue={queue ?? "全部"}
          availableQueues={availableQueues}
          page={page}
          totalPages={totalPages}
          filters={{ min: filters.min, sinceDate: filters.sinceDate, untilDate: filters.untilDate }}
        />
      )}
    </div>
  );
}
