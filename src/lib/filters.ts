// 展示层筛选参数: 门槛人数 + 起止日. 从 URL 查询串读, 前端改了就带参重查库.
// 拉取端不用这些值 (拉取端尽量全存, 见 matchesRoster.ts), 只在 SQL 里过滤.
//
//   /matches?min=3&since=2026-09-01&until=2026-12-31
//   min    同一方至少几名车队成员 (1~5), 默认 3
//   since  只看这天 (北京时间 00:00) 以后开局的对局, 默认 2026-09-01
//   until  只看这天 (含当天) 以前开局的对局, 默认不限

export const DEFAULT_MIN_TEAM_MEMBERS = 3;

// 模式必须分开看 —— 单双排、灵活、匹配的对局强度和匹配机制都不一样, 混在一起
// 统计会互相污染. 大乱斗更是另一回事 (没有分路、没有补刀概念).
// key 对应 matches.queue_name; 前缀 g: 的是分组, 展开成多个 queue_name.
export const QUEUE_GROUPS: Record<string, string[]> = {
  "g:排位": ["单双排", "灵活组排"],
  "g:大乱斗": ["大乱斗", "海克斯大乱斗"],
};

export const QUEUE_OPTIONS: { key: string; label: string; hint?: string }[] = [
  { key: "g:排位", label: "排位", hint: "单双排 + 灵活组排" },
  { key: "单双排", label: "单双排" },
  { key: "灵活组排", label: "灵活组排" },
  { key: "匹配", label: "匹配" },
  { key: "g:大乱斗", label: "大乱斗", hint: "含海克斯大乱斗" },
  { key: "", label: "全部", hint: "包括自定义和人机等所有模式" },
];

export const DEFAULT_QUEUE = "g:排位";

/** 展开成具体的 queue_name 列表; 返回空数组表示不限模式. */
export function queueNames(key: string): string[] {
  if (!key) return [];
  return QUEUE_GROUPS[key] ?? [key];
}
// 默认不设时间下限 —— 拉取端本来就尽量全存, 展示端再卡一个日期只会让人以为
// 数据没同步全. 想看某个赛段用上面的快捷按钮或自己填起止日.
export const DEFAULT_SINCE_DATE = "";

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
  /** 模式筛选. 空串 = 不限; g: 开头是分组 */
  queue: string;
  /** 展开后的 queue_name 列表, 空数组 = 不限 */
  queues: string[];
  sinceDate: string; // YYYY-MM-DD 或 "" (不限)
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

export function parseFilters(sp: {
  min?: string;
  since?: string;
  until?: string;
  queue?: string;
}): DisplayFilters {
  const minRaw = Number(sp.min);
  const min = Number.isInteger(minRaw) && minRaw >= 1 && minRaw <= 5 ? minRaw : DEFAULT_MIN_TEAM_MEMBERS;
  const queue = QUEUE_OPTIONS.some((q) => q.key === sp.queue) ? (sp.queue as string) : DEFAULT_QUEUE;
  const sinceDate = validDate(sp.since) ? sp.since : DEFAULT_SINCE_DATE;
  const untilDate = validDate(sp.until) ? sp.until : "";
  return {
    min,
    queue,
    queues: queueNames(queue),
    sinceDate,
    untilDate,
    sinceMs: sinceDate ? dateToMs(sinceDate) : 0,
    untilMs: untilDate ? dateToMs(untilDate) + 24 * 60 * 60 * 1000 : null,
  };
}

export type FilterInput = { min: number; queue: string; sinceDate: string; untilDate: string };

/** 把筛选参数写进 URLSearchParams, 默认值不写, 保持链接干净. */
export function applyFilterParams(params: URLSearchParams, f: FilterInput) {
  if (f.min !== DEFAULT_MIN_TEAM_MEMBERS) params.set("min", String(f.min));
  if (f.queue !== DEFAULT_QUEUE) params.set("queue", f.queue);
  if (f.sinceDate) params.set("since", f.sinceDate);
  if (f.untilDate) params.set("until", f.untilDate);
}
