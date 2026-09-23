import Link from "next/link";
import { TEAM_NAME } from "@/lib/roster";

const quickLinks = [
  {
    href: "/matches",
    eyebrow: "Match History",
    title: "战绩",
    desc: "同步全队对局，含 MVP / SVP 评分与详细数据。",
    cta: "查看战绩 →",
  },
  {
    href: "/roster",
    eyebrow: "Roster",
    title: "选手名单",
    desc: "车队成员的位置与英雄池。",
    cta: "查看名单 →",
  },
];

export default function Home() {
  return (
    <div>
      <section className="relative overflow-hidden px-4 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-24">
        <div
          className="pointer-events-none absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "linear-gradient(180deg, rgba(231,182,85,0.06), transparent 60%)",
          }}
        />
        <div className="mx-auto max-w-4xl text-center">
          <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
            Team Portal
          </p>
          <h1 className="font-display mt-4 text-4xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
            {TEAM_NAME}
          </h1>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href="/matches"
              className="rounded-sm bg-[var(--gold)] px-6 py-3 text-sm font-semibold text-[#0a0f1e] transition hover:bg-[var(--gold-soft)]"
            >
              查看战绩
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="grid gap-4 sm:grid-cols-2">
          {quickLinks.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              className="group flex flex-col justify-between gap-4 rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-6 transition hover:border-[var(--gold)]/60"
            >
              <div>
                <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
                  {item.eyebrow}
                </p>
                <h2 className="font-display mt-2 text-2xl font-bold">{item.title}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{item.desc}</p>
              </div>
              <span className="self-start rounded-sm border border-[var(--gold)]/40 px-4 py-2 text-sm font-semibold text-[var(--gold)] transition group-hover:bg-[var(--gold)] group-hover:text-[#0a0f1e]">
                {item.cta}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
