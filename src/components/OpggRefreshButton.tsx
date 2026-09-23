"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// 手动刷新 OP.GG 大盘对位数据. 版本更新后或名单里多了新英雄时点一下就行,
// 不用常刷 —— 一个版本内大盘基本不动.
export default function OpggRefreshButton({ updatedAt }: { updatedAt: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/opgg/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "刷新失败");
        setState("error");
        return;
      }
      const failed = data.failed?.length ?? 0;
      setMsg(
        `更新了 ${data.ok}/${data.requested} 个英雄分路，共 ${data.rows} 条对位` +
          (failed ? `，${failed} 个没拉到` : "")
      );
      setState("done");
      router.refresh();
    } catch {
      setMsg("网络错误，请重试");
      setState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        className="rounded-sm border border-[var(--border)] px-3 py-1.5 font-semibold text-[var(--muted)] transition hover:border-[var(--gold)]/60 hover:text-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "loading" ? "正在拉取大盘数据…（约一分钟）" : "刷新大盘对位数据"}
      </button>
      <span className={state === "error" ? "text-[var(--status-critical)]" : "text-[var(--muted)]"}>
        {msg || (updatedAt ? `大盘数据更新于 ${updatedAt}` : "大盘数据还没拉过")}
      </span>
    </div>
  );
}
