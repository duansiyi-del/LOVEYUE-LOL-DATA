// 展示层筛选参数: 门槛人数 + 起止日. 从 URL 查询串读, 前端改了就带参重查库.
// 拉取端不用这些值 (拉取端尽量全存, 见 matchesRoster.ts), 只在 SQL 里过滤.
//
//   /matches?min=3&since=2026-09-01&until=2026-12-31
//   min    同一方至少几名车队成员 (1~5), 默认 3
//   since  只看这天 (北京时间 00:00) 以后开局的对局, 默认 2026-09-01
//   until  只看这天 (含当天) 以前开局的对局, 默认不限

export const DEFAULT_MIN_TEAM_MEMBERS = 3;
export const DEFAULT_SINCE_DATE = "2026-09-01";

// 赛段快捷选项. 2026 年三赛段随版本切换, 全球统一 (含国服):
//   S1 26.1~26.8   2026-01-08 ~ 04-28
//   S2 26.9~26.14  2026-04-29 ~ 07-28
//   S3 26.15~      2026-07-29 ~ 2027 年 1 月初
// 切换在开始日中午 12:00, 这里按整天划, 切换日上午的对局会归入新赛段 (可忽略).
// 来源: esports.net 2026 ranked season end / loltheory.gg season guide / 26.15 patch notes.
// until 为空 = 到现在. 新赛段开始时加一行.
export const SEASON_PRESETS: { label: string; since: string; until: string }[] = [
  { label: "2026 第一赛段", since: "2026-01-08", until: "2026-04-28" },
  { label: "2026 第二赛段", since: "2026-04-29", until: "2026-07-28" },
  { label: "2026 第三赛段", since: "2026-07-29", until: "" },
];

export type DisplayFilters = {
  min: number;
  sinceDate: string; // YYYY-MM-DD
  untilDate: string; // YYYY-MM-DD 或 "" (不限)
  sinceMs: number; // UTC ms, 北京时间当天 00:00
  untilMs: number | null; // UTC ms, 截止日次日 00:00 (不含); null 不限
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function dateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`);
}

function validDate(d: string | undefined): d is string {
  return Boolean(d && DATE_RE.test(d) && Number.isFinite(dateToMs(d)));
}

export function parseFilters(sp: { min?: string; since?: string; until?: string }): DisplayFilters {
  const minRaw = Number(sp.min);
  const min = Number.isInteger(minRaw) && minRaw >= 1 && minRaw <= 5 ? minRaw : DEFAULT_MIN_TEAM_MEMBERS;
  const sinceDate = validDate(sp.since) ? sp.since : DEFAULT_SINCE_DATE;
  const untilDate = validDate(sp.until) ? sp.until : "";
  return {
    min,
    sinceDate,
    untilDate,
    sinceMs: dateToMs(sinceDate),
    untilMs: untilDate ? dateToMs(untilDate) + 24 * 60 * 60 * 1000 : null,
  };
}

export type FilterInput = { min: number; sinceDate: string; untilDate: string };

/** 把筛选参数写进 URLSearchParams, 默认值不写, 保持链接干净. */
export function applyFilterParams(params: URLSearchParams, f: FilterInput) {
  if (f.min !== DEFAULT_MIN_TEAM_MEMBERS) params.set("min", String(f.min));
  if (f.sinceDate !== DEFAULT_SINCE_DATE) params.set("since", f.sinceDate);
  if (f.untilDate) params.set("until", f.untilDate);
}
