// 战绩同步用的车队名单 (见 src/lib/sgp.ts). name 要和 roster.ts 的昵称一致.
//
// 大区: 国服 GZ100. 注意客户端 LCU 的 platformId 接口返回的是统一平台名
// TENCENT, 不能拼域名; 真实大区在 token 的 dat.r 字段里 (get_sgp_token.ps1
// 已自动解出). 全队必须同大区, 否则一个 token 拉不到别区成员的战绩.
//
// 加人: 在 get_sgp_token.ps1 的名单里加一行 Riot ID 跑一次, 把打印出来的
// { name, riotId, puuid } 行贴到下面数组里即可.

export const SGP_REGION_CODE = "GZ100";
export const SGP_BASE = `https://${SGP_REGION_CODE}-sgp.lol.qq.com:21019`;

// 拉取端的最低门槛: 同一方至少 1 名车队成员就存, 也就是名单里每个人的对局
// 尽量全存. 「几个人才算车队局」是展示层的筛选参数 (见 filters.ts), 在网页上调.
export const MIN_TEAM_MEMBERS = 1;

export type RosterMember = {
  name: string;
  riotId: string;
  puuid: string;
};

export const matchesRoster: RosterMember[] = [
  { name: "爱玩雪球的努努", riotId: "爱玩雪球的努努#19918", puuid: "bec5a57a-651b-5554-8c2f-e63baf6990c0" },
  { name: "爱抽陀螺的尼菈", riotId: "爱抽陀螺的尼菈#14963", puuid: "5fb0aae2-f231-5c56-a7ed-120c88c51772" },
  // TODO puuid 待脚本查出: 爱击剑的菲欧娜#15653
  // TODO puuid 待脚本查出: 爱吃素的狼人#64022
  // TODO puuid 待脚本查出: 爱打ad的加里奥#33260
  // TODO puuid 待脚本查出: 爱坐牢的adc#86913
  // TODO puuid 待脚本查出: 爱玩VR的李青#14564
  // TODO puuid 待脚本查出: 爱惊鸿过隙的幻翎#28116
];

export const rosterPuuidSet = new Set(matchesRoster.map((m) => m.puuid));
export const rosterNameByPuuid: Record<string, string> = Object.fromEntries(
  matchesRoster.map((m) => [m.puuid, m.name])
);

// 拉取端的时间下限: 2026-01-01 (北京). SGP 每人最多往回翻 400 场, 实际能拉到
// 多早取决于对方打了多少场. 「从哪天开始看」同样是展示层参数, 在网页上调.
export const SYNC_SINCE_MS = Date.parse("2026-01-01T00:00:00+08:00");
