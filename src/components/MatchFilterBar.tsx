"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { applyFilterParams, DEFAULT_MIN_TEAM_MEMBERS, DEFAULT_SINCE_DATE } from "@/lib/filters";

// 门槛人数 + 起始日筛选条. 改完写进 URL 查询串 (?min=&since=), 页面按参数重查库.
// 不改库里的任何东西, 拉取端也不受影响 (拉取端尽量全存).
export default function MatchFilterBar({
  min,
  sinceDate,
}: {
  min: number;
  sinceDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [draftMin, setDraftMin] = useState(min);
  const [draftSince, setDraftSince] = useState(sinceDate);

  function push(next: { min: number; sinceDate: string }) {
    const params = new URLSearchParams(sp.toString());
    params.delete("min");
    params.delete("since");
    params.delete("page"); // 换筛选回到第 1 页
    applyFilterParams(params, next);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const dirty = draftMin !== min || draftSince !== sinceDate;
  const isDefault = min === DEFAULT_MIN_TEAM_MEMBERS && sinceDate === DEFAULT_SINCE_DATE;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        push({ min: draftMin, sinceDate: draftSince });
      }}
      className="flex flex-wrap items-end justify-center gap-3 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 text-sm"
    >
      <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
        同一方至少几名成员
        <select
          value={draftMin}
          onChange={(e) => setDraftMin(Number(e.target.value))}
          className="rounded-sm border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm text-[var(--foreground)] outline-none focus:border-[var(--gold)]"
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
          value={draftSince}
          onChange={(e) => setDraftSince(e.target.value)}
          className="rounded-sm border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm text-[var(--foreground)] outline-none [color-scheme:dark] focus:border-[var(--gold)]"
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
            setDraftMin(DEFAULT_MIN_TEAM_MEMBERS);
            setDraftSince(DEFAULT_SINCE_DATE);
            push({ min: DEFAULT_MIN_TEAM_MEMBERS, sinceDate: DEFAULT_SINCE_DATE });
          }}
          className="rounded-sm border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition hover:border-[var(--gold)]/60 hover:text-[var(--gold)]"
        >
          恢复默认 ({DEFAULT_MIN_TEAM_MEMBERS} 人 · {DEFAULT_SINCE_DATE})
        </button>
      ) : null}
    </form>
  );
}
