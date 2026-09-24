// 战绩同步用的车队名单 (见 src/lib/sgp.ts). name 要和 roster.ts 的昵称一致.
//
// 大区: 国服 GZ100. 注意客户端 LCU 的 platformId 接口返回的是统一平台名
// TENCENT, 不能拼域名; 真实大区在 token 的 dat.r 字段里 (get_sgp_token.ps1
// 已自动解出). 全队必须同大区, 否则一个 token 拉不到别区成员的战绩.
//
// 加人: 在 get_sgp_token.ps1 的名单里加一行 Riot ID 跑一次, 把打印出来的
// { name, riotId, puuid } 行贴到下面数组里即可.

// SGP 大区地址. 注意三件事 (对照真实可用的开源实现 cridyy/lol-stats 核过):
//   1. 主机名必须【小写】—— 我们之前用 GZ100-sgp... 一直被网关以 400 挡掉,
//      任何路径都 400 (连不存在的路径也是 400 而不是 404), 正是 Host 精确匹配
//      不上的典型表现.
//   2. 不同大区规则不一样, 有的带 -k8s-, 不能统一按「小写 + -sgp」拼.
//   3. 真实大区在 token 的 dat.r 字段里. 客户端 platformId 接口返回的是统一
//      平台名 TENCENT, 拿它拼域名必然失败.
const SGP_BASE_BY_REGION: Record<string, string> = {
  HN1: "https://hn1-k8s-sgp.lol.qq.com:21019",
  HN10: "https://hn10-k8s-sgp.lol.qq.com:21019",
  TJ100: "https://tj100-sgp.lol.qq.com:21019",
  TJ101: "https://tj101-sgp.lol.qq.com:21019",
  NJ100: "https://nj100-sgp.lol.qq.com:21019",
  GZ100: "https://gz100-sgp.lol.qq.com:21019",
  CQ100: "https://cq100-sgp.lol.qq.com:21019",
  BGP2: "https://bgp2-k8s-sgp.lol.qq.com:21019",
};

export const SGP_REGION_CODE = "GZ100";
export const SGP_BASE =
  SGP_BASE_BY_REGION[SGP_REGION_CODE] ??
  `https://${SGP_REGION_CODE.toLowerCase()}-sgp.lol.qq.com:21019`;

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
  { name: "爱击剑的菲欧娜", riotId: "爱击剑的菲欧娜#15653", puuid: "f51d135b-5b5c-56d9-bfd1-12e325616d70" },
  { name: "爱吃素的狼人", riotId: "爱吃素的狼人#64022", puuid: "8b410699-274e-548e-be7d-775791178667" },
  { name: "爱打ad的加里奥", riotId: "爱打ad的加里奥#33260", puuid: "79402fe8-5472-5c7a-a9e9-b43055c8e01c" },
  { name: "爱坐牢的adc", riotId: "爱坐牢的adc#86913", puuid: "7c5e3305-e12f-5bbb-a53f-7d9ac7c14ca9" },
  { name: "爱玩VR的李青", riotId: "爱玩VR的李青#14564", puuid: "331c7d44-125a-57f1-842f-af6f7cb01f60" },
  { name: "爱惊鸿过隙的幻翎", riotId: "爱惊鸿过隙的幻翎#28116", puuid: "a1e18d14-be78-5d5b-9f22-18bf2c868418" },
];

export const rosterPuuidSet = new Set(matchesRoster.map((m) => m.puuid));
export const rosterNameByPuuid: Record<string, string> = Object.fromEntries(
  matchesRoster.map((m) => [m.puuid, m.name])
);

// 拉取端的时间下限: 2026-01-01 (北京). SGP 每人最多往回翻 400 场, 实际能拉到
// 多早取决于对方打了多少场. 「从哪天开始看」同样是展示层参数, 在网页上调.
export const SYNC_SINCE_MS = Date.parse("2026-01-01T00:00:00+08:00");
