"use client";

import Link from "next/link";
import { useState } from "react";
import { TEAM_NAME } from "@/lib/roster";

const links = [
  { href: "/", label: "首页" },
  { href: "/roster", label: "选手名单" },
  { href: "/matches", label: "战绩" },
  { href: "/draft", label: "阵容分析" },
  { href: "/matchups", label: "对位分析" },
  { href: "/attribution", label: "组队归因" },
  { href: "/leaderboard", label: "数据榜单" },
  { href: "/report", label: "战队体检" },
];

export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[#0a0f1e]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" onClick={() => setOpen(false)} className="flex items-center gap-2">
          <span className="h-2 w-2 rotate-45 bg-[var(--gold)]" />
          <span className="font-display text-lg font-bold tracking-wide sm:text-xl">
            {TEAM_NAME}
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-medium text-[var(--foreground)]/90 transition hover:text-[var(--gold)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "关闭菜单" : "打开菜单"}
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-[var(--border)] text-[var(--foreground)] transition hover:border-[var(--gold)]/60 hover:text-[var(--gold)] md:hidden"
        >
          <span className="text-lg leading-none">{open ? "✕" : "☰"}</span>
        </button>
      </div>

      {open ? (
        <nav className="border-t border-[var(--border)] bg-[#0a0f1e] px-4 py-2 md:hidden">
          <div className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-sm px-2 py-3 text-sm font-medium text-[var(--foreground)]/90 transition hover:bg-white/5 hover:text-[var(--gold)]"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}
