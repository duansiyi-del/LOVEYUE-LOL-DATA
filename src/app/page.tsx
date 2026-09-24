import Link from "next/link";
import { TEAM_NAME } from "@/lib/roster";

const quickLinks = [
  {
    href: "/matches",
    eyebrow: "Match History",
    title: "战绩",
    desc: "全队对局列表与详情，含评分和 MVP。",
  },
  {
    href: "/roster",
    eyebrow: "Roster",
    title: "选手名单",
    desc: "分路、英雄池、胜率，全部按排位对局自动统计。",
  },
  {
    href: "/leaderboard",
    eyebrow: "Leaderboard",
    title: "数据榜单",
    desc: "分位置、分英雄类型排名，指标跟着维度走。",
  },
  {
    href: "/draft",
    eyebrow: "Draft",
    title: "阵容分析",
    desc: "常用组合增益、五人阵容结构体检。",
  },
  {
    href: "/matchups",
    eyebrow: "Matchups",
    title: "对位分析",
    desc: "ban 位建议、每个人的苦手对位。",
  },
  {
    href: "/attribution",
    eyebrow: "Attribution",
    title: "组队归因",
    desc: "某几个人一起打胜率低，到底是谁的问题。",
  },
  {
    href: "/report",
    eyebrow: "Team Report",
    title: "战队体检",
    desc: "总览、车队规模、在场缺席，全部带置信区间。",
  },
  {
    href: "/download",
    eyebrow: "Tools",
    title: "工具下载",
    desc: "战绩同步工具包，装在开客户端的那台电脑上。",
    highlight: true,
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
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/matches"
              className="rounded-sm bg-[var(--gold)] px-6 py-3 text-sm font-semibold text-[#0a0f1e] transition hover:bg-[var(--gold-soft)]"
            >
              查看战绩
            </Link>
            <Link
              href="/download"
              className="rounded-sm border border-[var(--gold)]/50 px-6 py-3 text-sm font-semibold text-[var(--gold)] transition hover:bg-[var(--gold)]/10"
            >
              下载同步工具
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              className={`group flex flex-col justify-between gap-3 rounded-sm border bg-[var(--bg-panel)] p-5 transition hover:border-[var(--gold)]/60 ${
                item.highlight ? "border-[var(--gold)]/50" : "border-[var(--border)]"
              }`}
            >
              <div>
                <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
                  {item.eyebrow}
                </p>
                <h2 className="font-display mt-2 text-xl font-bold">{item.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
