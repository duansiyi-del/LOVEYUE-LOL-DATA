"use client";

import { useMemo, useState } from "react";
import { evaluateDraft, STRUCTURE_RULES, type ChampionProfile } from "@/lib/draftRules";

// 五人阵容体检器. 选五个英雄, 按已同步对局算出来的英雄档案给结构读数.
// 判断依据全部来自我们自己库里的真实对局, 不接任何第三方数据.

const SLOTS = 5;

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export default function DraftChecker({ profiles }: { profiles: ChampionProfile[] }) {
  const [picks, setPicks] = useState<string[]>(Array(SLOTS).fill(""));

  const byName = useMemo(
    () => new Map(profiles.map((p) => [p.champion, p])),
    [profiles]
  );
  // 下拉里按名字排, 找起来快; 场次太少的档案本身也不可靠, 标出来
  const options = useMemo(
    () => [...profiles].sort((a, b) => a.champion.localeCompare(b.champion, "zh")),
    [profiles]
  );

  const chosen = picks.filter(Boolean);
  const report = useMemo(() => evaluateDraft(chosen, byName), [chosen, byName]);
  const thinProfiles = chosen.filter((c) => (byName.get(c)?.games ?? 0) < 5);

  if (!profiles.length) {
    return (
      <p className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 text-center text-sm text-[var(--muted)]">
        还没有同步过对局，英雄档案是空的，体检器暂时用不了。
      </p>
    );
  }

  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
          阵容体检
        </h2>
        <p className="text-xs text-[var(--muted)]">
          档案取自双方十人的真实对局数据，不是第三方胜率
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {picks.map((pick, i) => (
          <select
            key={i}
            value={pick}
            onChange={(e) => {
              const next = [...picks];
              next[i] = e.target.value;
              setPicks(next);
            }}
            className="rounded-sm border border-[var(--border)] bg-transparent px-2 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--gold)]"
          >
            <option value="" className="bg-[#0a0f1e]">
              — 位置 {i + 1} —
            </option>
            {options.map((o) => (
              <option key={o.champion} value={o.champion} className="bg-[#0a0f1e]">
                {o.champion}
                {o.games < 5 ? " (样本少)" : ""}
              </option>
            ))}
          </select>
        ))}
      </div>

      {chosen.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">选上英雄后这里出结构读数。</p>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-sm border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">伤害构成</p>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#0a0f1e]">
                <div style={{ width: pct(report.physicalShare) }} className="bg-[var(--gold)]" />
                <div style={{ width: pct(report.magicShare) }} className="bg-sky-400" />
              </div>
              <p className="mt-2 text-sm">
                物理 {pct(report.physicalShare)} · 法术 {pct(report.magicShare)}
              </p>
            </div>

            <div className="rounded-sm border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">前排</p>
              <p className="mt-2 text-2xl font-black">{report.frontline.length}</p>
              <p className="text-xs text-[var(--muted)]">
                {report.frontline.length ? report.frontline.join("、") : "无"}
              </p>
            </div>

            <div className="rounded-sm border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
                控制点（每场 ≥ {STRUCTURE_RULES.ccPointSeconds} 秒）
              </p>
              <p className="mt-2 text-2xl font-black">{report.ccPoints.length}</p>
              <p className="text-xs text-[var(--muted)]">
                {report.ccPoints.length ? report.ccPoints.join("、") : "无"}
              </p>
            </div>
          </div>

          {report.warnings.length ? (
            <ul className="space-y-1.5">
              {report.warnings.map((w) => (
                <li
                  key={w}
                  className="rounded-sm border border-[var(--status-critical)]/40 bg-[var(--status-critical)]/10 px-3 py-2 text-sm"
                >
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-sm border border-[var(--status-good)]/40 bg-[var(--status-good)]/10 px-3 py-2 text-sm">
              结构上没有明显短板。
            </p>
          )}

          {thinProfiles.length ? (
            <p className="text-xs text-[var(--muted)]">
              {thinProfiles.join("、")} 的档案只有个位数场次，读数仅供参考。
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
