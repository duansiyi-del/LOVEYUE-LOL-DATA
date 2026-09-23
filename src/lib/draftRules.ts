// 阵容结构规则 + 体检函数. 纯计算, 不碰数据库, 所以服务端和浏览器都能用
// (结构检查器是客户端组件). 英雄档案的取数在 draft.ts.

export type ChampionProfile = {
  champion: string;
  championId: number;
  games: number;
  // 伤害构成 (占该英雄总输出的比例, 三者和为 1)
  physicalShare: number;
  magicShare: number;
  trueShare: number;
  // 在自己队伍里的占比 (0~1), 五人均分是 0.2
  damageShare: number;
  tankShare: number;
  // 每场对敌方施加的控制时长 (秒)
  ccSeconds: number;
};

// 阈值写在一处, 不合团队习惯就改这几个数.
export const STRUCTURE_RULES = {
  // 物理 / 法术占比任一超过这个值 = 伤害过于单一, 对面一件防具通吃
  lopsidedDamage: 0.75,
  // 承伤占比超过这个值算前排 (五人均分 0.2)
  frontlineTankShare: 0.26,
  // 每场控制时长超过这个秒数算硬控点
  ccPointSeconds: 20,
  // 至少要有几个前排 / 几个控制点
  minFrontline: 1,
  minCcPoints: 2,
};

export type StructureReport = {
  physicalShare: number;
  magicShare: number;
  frontline: string[];
  ccPoints: string[];
  unknown: string[];
  warnings: string[];
};

export function evaluateDraft(
  champions: string[],
  profiles: Map<string, ChampionProfile>
): StructureReport {
  const known = champions.map((c) => profiles.get(c)).filter(Boolean) as ChampionProfile[];
  const unknown = champions.filter((c) => c && !profiles.has(c));

  // 按各自在队里的输出占比加权, 而不是简单平均 -- 一个占输出 35% 的法师比一个
  // 占 8% 的辅助更能决定这队的伤害类型.
  let phys = 0;
  let magic = 0;
  let weight = 0;
  for (const p of known) {
    const w = p.damageShare > 0 ? p.damageShare : 0.2;
    phys += p.physicalShare * w;
    magic += p.magicShare * w;
    weight += w;
  }
  const physicalShare = weight > 0 ? phys / weight : 0;
  const magicShare = weight > 0 ? magic / weight : 0;

  const frontline = known.filter((p) => p.tankShare >= STRUCTURE_RULES.frontlineTankShare).map((p) => p.champion);
  const ccPoints = known.filter((p) => p.ccSeconds >= STRUCTURE_RULES.ccPointSeconds).map((p) => p.champion);

  const warnings: string[] = [];
  if (physicalShare >= STRUCTURE_RULES.lopsidedDamage) {
    warnings.push(`伤害几乎全是物理（${Math.round(physicalShare * 100)}%），对面出一件甲就能通吃`);
  }
  if (magicShare >= STRUCTURE_RULES.lopsidedDamage) {
    warnings.push(`伤害几乎全是法术（${Math.round(magicShare * 100)}%），对面出一件魔抗就能通吃`);
  }
  if (frontline.length < STRUCTURE_RULES.minFrontline) {
    warnings.push("没有前排，团战没人开也没人扛");
  }
  if (ccPoints.length < STRUCTURE_RULES.minCcPoints) {
    warnings.push(`硬控点只有 ${ccPoints.length} 个，抓不住人也留不住人`);
  }
  if (unknown.length) {
    warnings.push(`${unknown.join("、")} 在已同步的对局里没出现过，没有档案，以上判断没算它们`);
  }
  return { physicalShare, magicShare, frontline, ccPoints, unknown, warnings };
}
