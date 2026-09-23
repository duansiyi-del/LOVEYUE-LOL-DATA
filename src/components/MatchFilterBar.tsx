"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  applyFilterParams,
  DEFAULT_MIN_TEAM_MEMBERS,
  DEFAULT_SINCE_DATE,
  SEASON_PRESETS,
  type FilterInput,
} from "@/lib/filters";

// 门槛人数 + 起止日筛选条. 改完写进 URL 查询串 (?min=&since=&until=), 页面按参数重查库.
// 不改库里的任何东西, 拉取端也不受影响 (拉取端尽量全存).
export default function MatchFilterBar({
  min,
  sinceDate,
  untilDate,
}: FilterInput) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [draft, setDraft] = useState<FilterInput>({ min, sinceDate, untilDate });

  function push(next: FilterInput) {
    const params = new URLSearchParams(sp.toString());
    params.delete("min");
    params.delete("since");
    params.delete("until");
    params.delete("page"); // 换筛选回到第 1 页
    applyFilterParams(params, next);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const dirty = draft.min !== min || draft.sinceDate !== sinceDate || draft.untilDate !== untilDate;
  const isDefault = min === DEFAULT_MIN_TEAM_MEMBERS && sinceDate === DEFAULT_SINCE_DATE && !untilDate;
  const activePreset = SEASON_PRESETS.find((p) => p.since === sinceDate && p.until === untilDate)?.label;

  const inputCls =
    "rounded-sm border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm text-[var(--foreground)] outline-none [color-scheme:dark] focus:border-[var(--gold)]";

  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-[var(--muted)]">赛段</span>
        {SEASON_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              const next = { min: draft.min, sinceDate: p.since, untilDate: p.until };
              setDraft(next);
              push(next);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
              activePreset === p.label
                ? "border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)]"
                : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]/50 hover:text-[var(--foreground)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          push(draft);
        }}
        className="flex flex-wrap items-end justify-center gap-3"
      >
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          同一方至少几名成员
          <select
            value={draft.min}
            onChange={(e) => setDraft({ ...draft, min: Number(e.target.value) })}
            className={inputCls}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n} className="bg-[#0a0f1e]">
                {n} 人
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          起始日
          <input
            type="date"
            value={draft.sinceDate}
            onChange={(e) => setDraft({ ...draft, sinceDate: e.target.value })}
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          截止日 (留空到现在)
          <input
            type="date"
            value={draft.untilDate}
            onChange={(e) => setDraft({ ...draft, untilDate: e.target.value })}
            className={inputCls}
          />
        </label>

        <button
          type="submit"
          disabled={!dirty}
          className="font-display rounded-sm bg-[var(--gold)] px-4 py-1.5 text-sm font-bold text-[#0a0f1e] transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          应用
        </button>

        {!isDefault ? (
          <button
            type="button"
            onClick={() => {
              const next = { min: DEFAULT_MIN_TEAM_MEMBERS, sinceDate: DEFAULT_SINCE_DATE, untilDate: "" };
              setDraft(next);
              push(next);
            }}
            className="rounded-sm border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
          >
            恢复默认
          </button>
        ) : null}
      </form>
    </div>
  );
}
