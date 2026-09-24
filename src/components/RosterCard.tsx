"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

// 名单卡片. 做成客户端组件只有一个原因: 一个人可以放多张照片, 要能左右切换.
// 三种切换方式: 点两侧箭头、点底部圆点、卡片获得焦点后按左右方向键.
// 只有一张照片时这些控件全部不出现, 卡片和原来一样.
//
// 整张卡片是通往个人页的链接. 做法是把 Link 铺在名字上再用伪元素撑满整张卡
// (stretched link): 直接把 Link 包在外面的话, 里面的切图按钮就成了链接里的按钮,
// 点一下会连带跳转. 箭头和圆点抬到 z-30, 压在伪元素上面, 所以切图不会误触发跳转.

export type RosterCardProps = {
  href: string;
  alias: string;
  nickname: string;
  number: number;
  photos: string[];
  positions: string[];
  champions: { name: string; games: number; wins: number }[];
  games: number | null;
  winRate: number | null;
};

export default function RosterCard({
  href,
  alias,
  nickname,
  number,
  photos,
  positions,
  champions,
  games,
  winRate,
}: RosterCardProps) {
  const [i, setI] = useState(0);
  const many = photos.length > 1;
  const go = (d: number) => setI((v) => (v + d + photos.length) % photos.length);

  return (
    <div
      className="group relative rounded-md border border-[var(--border)] bg-[var(--bg-panel)] p-2.5 focus-within:border-[var(--gold)]/60"
      tabIndex={many ? 0 : -1}
      onKeyDown={(e) => {
        if (!many) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
      aria-label={many ? `${alias}，${photos.length} 张照片，左右方向键切换` : alias}
    >
      <span className="pointer-events-none absolute right-3 top-3 z-20 rounded-sm bg-[var(--gold)] px-2 py-0.5 font-display text-xs font-bold text-[#0a0f1e]">
        NO.{String(number).padStart(2, "0")}
      </span>

      <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-[#0a0f1e]">
        {photos.length ? (
          <Image
            key={photos[i]}
            src={photos[i]}
            alt={alias}
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            priority={i === 0 && number <= 4}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {/* 没照片时的占位: 用别名首字 (越/毅/花…), 比游戏昵称的「爱」有区分度 */}
            <span className="font-display text-6xl font-black text-[var(--gold)]/40">
              {alias.slice(0, 1)}
            </span>
          </div>
        )}

        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: "inset 0 -60px 50px -20px rgba(10,15,30,0.85)" }}
        />

        {many ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="上一张"
              className="absolute left-1 top-1/2 z-30 -translate-y-1/2 rounded-sm bg-[#0a0f1e]/60 px-2 py-3 text-sm text-white/80 opacity-0 transition hover:bg-[#0a0f1e]/85 hover:text-[var(--gold)] focus:opacity-100 group-hover:opacity-100"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="下一张"
              className="absolute right-1 top-1/2 z-30 -translate-y-1/2 rounded-sm bg-[#0a0f1e]/60 px-2 py-3 text-sm text-white/80 opacity-0 transition hover:bg-[#0a0f1e]/85 hover:text-[var(--gold)] focus:opacity-100 group-hover:opacity-100"
            >
              ›
            </button>
            <div className="absolute bottom-8 left-0 right-0 z-30 flex justify-center gap-1.5">
              {photos.map((src, idx) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setI(idx)}
                  aria-label={`第 ${idx + 1} 张`}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === i ? "w-4 bg-[var(--gold)]" : "w-1.5 bg-white/45 hover:bg-white/70"
                  }`}
                />
              ))}
            </div>
          </>
        ) : null}

        {games !== null && winRate !== null ? (
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex items-end justify-between text-xs">
            <span className="text-[var(--muted)]">{games} 场</span>
            <span className="font-display font-bold text-[var(--gold)]">胜率 {winRate}%</span>
          </div>
        ) : null}
      </div>

      <div className="px-1 pb-1 pt-3">
        <div className="mb-2 h-[2px] w-8 -skew-x-12 bg-[var(--gold)]" />
        <h3 className="truncate text-lg font-black">
          <Link
            href={href}
            className="transition after:absolute after:inset-0 after:content-[''] hover:text-[var(--gold)]"
          >
            {alias}
          </Link>
        </h3>
        <p className="mb-2 truncate text-[11px] text-[var(--muted)]">{nickname}</p>

        <div className="mb-2 flex min-h-[22px] flex-wrap gap-1.5">
          {positions.length ? (
            positions.map((pos) => (
              <span
                key={pos}
                className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--gold-soft)]"
              >
                {pos}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[var(--muted)]">分路待同步</span>
          )}
        </div>

        <p className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Pool</p>
        {champions.length ? (
          <ul className="mt-0.5 space-y-0.5 text-sm text-[var(--foreground)]/90">
            {champions.map((c) => (
              <li key={c.name} className="flex items-baseline justify-between gap-2">
                <span className="truncate">{c.name}</span>
                {c.games > 0 ? (
                  <span className="shrink-0 text-[11px] text-[var(--muted)]">
                    {c.games} 场 · {Math.round((c.wins / c.games) * 100)}%
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted)]">待同步</p>
        )}
      </div>
    </div>
  );
}
