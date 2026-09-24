import { Suspense } from "react";
import {
  countMatches,
  isDbConfigured,
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

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; queue?: string; min?: string; since?: string; until?: string }>;
}) {
  const sp = await searchParams;
  const { page: rawPage } = sp;
  // 模式已经收进统一筛选条 (filters.queues), 这里不再单独维护一套按钮
  const filters = parseFilters(sp);
  const dbReady = isDbConfigured();

  // Count (and the queue list) before fetching the page itself, so an
  // out-of-range ?page= from an old link or a filter change can't ask for
  // an offset past the end -- it just clamps to the last real page.
  const [total, version, championMap] = await Promise.all([
    dbReady ? countMatches(filters) : Promise.resolve(0),
    getDdragonVersion(),
    getChampionIconMap(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(rawPage) || 1), totalPages);
  const offset = (page - 1) * PAGE_SIZE;

  const matches = dbReady ? await listMatches(filters, PAGE_SIZE, offset) : ([] as StoredMatch[]);

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
          <MatchFilterBar
            min={filters.min}
            queue={filters.queue}
            sinceDate={filters.sinceDate}
            untilDate={filters.untilDate}
          />
        </Suspense>
        <p className="mt-2 text-center text-xs text-[var(--muted)]">
          当前: 同一方至少 {filters.min} 名成员 · {filters.sinceDate || "最早"} 至 {filters.untilDate || "现在"} · 共 {total} 场
        </p>
      </div>

      {!dbReady ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          数据库还没接好（本地开发环境没有 POSTGRES_URL）。部署到 Vercel 并接上 Postgres 存储后，这里会显示同步下来的战绩。
        </p>
      ) : total === 0 ? (
        <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
          当前筛选下没有对局。还没同步过的话，粘贴 token 点一下同步；同步过的话试试调低门槛人数或把起始日提前。
        </p>
      ) : (
        <MatchesList
          matches={matches}
          version={version}
          championMap={championMap}
          page={page}
          totalPages={totalPages}
          filters={{
            min: filters.min,
            queue: filters.queue,
            sinceDate: filters.sinceDate,
            untilDate: filters.untilDate,
          }}
        />
      )}
    </div>
  );
}
