import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { TEAM_NAME } from "@/lib/roster";

export const metadata: Metadata = {
  title: TEAM_NAME,
  description: `${TEAM_NAME} 车队战绩站`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <NavBar />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted)]">
          {TEAM_NAME} · {new Date().getFullYear()}
          <span className="mx-2 opacity-40">|</span>
          <Link href="/download" className="transition hover:text-[var(--gold)]">
            工具下载
          </Link>
        </footer>
      </body>
    </html>
  );
}
