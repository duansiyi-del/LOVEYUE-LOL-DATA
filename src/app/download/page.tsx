import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "工具下载 · LOVEYUE",
};

// 工具包下载页. 存在的理由很实际: 装客户端的那台 Windows 没有代理, 也不方便连
// git, 每次改完脚本都得靠微信来回传. 但那台机器本来就能访问这个网站 (它就是往
// 这儿同步战绩的), 所以把工具包挂在网站上直接下载最省事.
//
// 压缩包由 `npm run pack:tools` 从 tools/ 生成, 产物提交进仓库.

async function readUpdatedAt(): Promise<string | null> {
  try {
    const raw = await readFile(join(process.cwd(), "public", "download", "manifest.json"), "utf8");
    const m = JSON.parse(raw) as { updatedAt?: string };
    if (!m.updatedAt) return null;
    return new Date(m.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch {
    return null;
  }
}

export default async function DownloadPage() {
  const updatedAt = await readUpdatedAt();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="mb-8 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-[0.3em] text-[var(--gold)]">
          Tools
        </p>
        <h1 className="font-display mt-3 text-4xl font-extrabold sm:text-5xl">工具下载</h1>
        <p className="mt-3 text-xs text-[var(--muted)]">
          在装了英雄联盟客户端的 Windows 上用 · 只读战绩，不改游戏，不需要账号密码
        </p>
      </div>

      <a
        href="/download/LOVEYUE-sync.zip"
        download
        className="font-display block rounded-sm bg-[var(--gold)] px-6 py-4 text-center text-base font-bold text-[#0a0f1e] transition hover:bg-[var(--gold-soft)]"
      >
        下载战绩同步工具包
      </a>
      <p className="mt-2 text-center text-xs text-[var(--muted)]">
        {updatedAt ? `打包时间 ${updatedAt}` : "LOVEYUE-sync.zip"}
      </p>

      <section className="mt-10 space-y-6 text-sm leading-relaxed">
        <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-5">
          <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            怎么用
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-[var(--foreground)]/90">
            <li>
              把压缩包<span className="text-[var(--gold-soft)]">整个解压</span>到一个固定位置，
              比如 D:\LOVEYUE-sync。不要在压缩包里直接双击，那样会找不到旁边的文件。
            </li>
            <li>打开英雄联盟客户端并登录，停在主界面即可，不用进游戏。</li>
            <li>
              双击 <code className="text-[var(--gold-soft)]">START.bat</code>，弹出菜单。
              第一次先选 2 做全量回填，再右键这个文件选「以管理员身份运行」，进菜单选 3
              开启自动同步。之后就不用管了。
            </li>
          </ol>
        </div>

        <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-5">
          <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            包里几个入口
          </h2>
          <ul className="space-y-2 text-[var(--foreground)]/90">
            <li>
              <code className="text-[var(--gold-soft)]">START.bat</code>
              <span className="text-[var(--muted)]"> —— 日常用这个，同步菜单</span>
            </li>
            <li>
              <code className="text-[var(--gold-soft)]">DEPTH_TEST.bat</code>
              <span className="text-[var(--muted)]">
                {" "}—— 排查能往回翻多少场，跑完把桌面生成的 txt 发群里
              </span>
            </li>
            <li>
              <code className="text-[var(--gold-soft)]">DIAGNOSE.bat</code>
              <span className="text-[var(--muted)]"> —— START 没反应时用，导出环境信息</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-[var(--muted)]">
            解压后的 readme.txt 里有更详细的说明，包括各种没反应的处理办法。
          </p>
        </div>

        <div className="rounded-sm border border-[var(--border)] bg-[var(--bg-panel)] p-5">
          <h2 className="font-display mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            双击没反应
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-[var(--foreground)]/90">
            <li>还在压缩包里没解压，先解压整个文件夹</li>
            <li>文件被 Windows 当成「来自网络」拦了：右键属性，勾选下方的解除锁定</li>
            <li>杀毒软件拦截，允许运行即可</li>
            <li>权限不够，右键选「以管理员身份运行」</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
