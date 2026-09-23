// 展示层筛选参数: 门槛人数 + 起始日. 从 URL 查询串读, 前端改了就带参重查库.
// 拉取端不用这两个值 (拉取端尽量全存, 见 matchesRoster.ts), 只在 SQL 里过滤.
//
//   /matches?min=3&since=2026-09-01
//   min    同一方至少几名车队成员 (1~5), 默认 3
//   since  只看这天 (北京时间 00:00) 以后开局的对局, 默认 2026-09-01

export const DEFAULT_MIN_TEAM_MEMBERS = 3;
export const DEFAULT_SINCE_DATE = "2026-09-01";

export type DisplayFilters = {
  min: number;
  sinceDate: string; // YYYY-MM-DD
  sinceMs: number; // UTC ms, 北京时间当天 00:00
};

export function sinceDateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

export function parseFilters(sp: { min?: string; since?: string }): DisplayFilters {
  const minRaw = Number(sp.min);
  const min = Number.isInteger(minRaw) && minRaw >= 1 && minRaw <= 5 ? minRaw : DEFAULT_MIN_TEAM_MEMBERS;
  const sinceDate = sp.since && /^\d{4}-\d{2}-\d{2}$/.test(sp.since) && Number.isFinite(sinceDateToMs(sp.since))
    ? sp.since
    : DEFAULT_SINCE_DATE;
  return { min, sinceDate, sinceMs: sinceDateToMs(sinceDate) };
}

/** 把筛选参数写进 URLSearchParams, 默认值不写, 保持链接干净. */
export function applyFilterParams(params: URLSearchParams, f: { min: number; sinceDate: string }) {
  if (f.min !== DEFAULT_MIN_TEAM_MEMBERS) params.set("min", String(f.min));
  if (f.sinceDate !== DEFAULT_SINCE_DATE) params.set("since", f.sinceDate);
}
