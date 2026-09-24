// 把 tools/ 打包成 public/download/LOVEYUE-sync.zip, 让网站自己当传输通道.
//
// 为什么要这个: 装客户端的那台 Windows 没有代理也不方便连 git, 每次改完脚本都要
// 靠微信来回传文件. 但那台机器本来就能访问网站 (它就是往网站同步战绩的), 所以
// 把工具包挂到网站上, 直接下载最省事.
//
// 用法: npm run pack:tools
// 改完 tools/ 下任何文件都要重新跑一次, 然后 commit 产物.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, cpSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = join(root, "tools");
const outDir = join(root, "public", "download");
const stageRoot = join(root, ".pack-tmp");
const stageDir = join(stageRoot, "LOVEYUE-sync");
const zipPath = join(outDir, "LOVEYUE-sync.zip");

// 压缩包里一律用英文文件名 —— 中文名的 zip 在 Windows 上解出来常常是乱码,
// 到时候根本看不出该双击哪个.
const RENAME = {
  "战绩同步.bat": "START.bat",
  "诊断.bat": "DIAGNOSE.bat",
};
// 这些不进包: 取 token 和 README 是给开发看的, 队友用不到
const SKIP = new Set(["README.md", "get_sgp_token.ps1", "run_get_token.bat"]);

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const name of readdirSync(toolsDir)) {
  if (SKIP.has(name)) continue;
  const dest = RENAME[name] ?? name;
  if (/[^\x00-\x7F]/.test(dest)) {
    throw new Error(`包里出现了非 ASCII 文件名: ${dest} —— 在 RENAME 里给它一个英文名`);
  }
  // .ps1 必须带 UTF-8 BOM. Windows PowerShell 5 没有 BOM 就按系统代码页 (国服是
  // GBK) 读整个文件, 于是脚本里的中文全部乱码 —— 更糟的是"场"这类字的 UTF-8 尾字节
  // 会被当成 GBK 前导字节, 把后面那个引号一起吃掉, 字符串就断了, 整个脚本报
  // "表达式中缺少右)". 真发生过一次: 用 Python 回写文件时写成 utf-8 而不是
  // utf-8-sig, BOM 没了, 队友一运行就满屏解析错误.
  // 这台开发机上没有 pwsh 能先跑一遍语法, 所以这条拦在打包这一步.
  if (name.endsWith(".ps1")) {
    const head = readFileSync(join(toolsDir, name)).subarray(0, 3);
    if (!(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf)) {
      throw new Error(`${name} 缺 UTF-8 BOM —— PowerShell 5 会按 GBK 读, 中文乱码且字符串会断. 补上 BOM 再打包.`);
    }
  }
  cpSync(join(toolsDir, name), join(stageDir, dest));
  copied++;
}

// tools/readme.txt 会被一起复制进去 (上面的循环已经带上了)
const stamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
writeFileSync(join(stageDir, "VERSION.txt"), `打包时间: ${stamp}\r\n`, "utf8");

rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-q", zipPath, "LOVEYUE-sync"], { cwd: stageRoot });
rmSync(stageRoot, { recursive: true, force: true });

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ updatedAt: new Date().toISOString(), files: copied }, null, 2),
  "utf8"
);

console.log(`打包完成: ${zipPath} (${copied} 个文件, ${stamp})`);
