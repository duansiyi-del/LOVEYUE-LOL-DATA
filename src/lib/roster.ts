// 车队展示名单 (选手名单页). 昵称必须和 matchesRoster.ts 里的 name 一致,
// 战绩页和所有统计都按昵称关联.
//
// positions / champions 只是兜底: 库里有这个人的对局时, 名单页显示的是从战绩
// 自动统计出来的分路和英雄池, 不看这两个字段.

export type Player = {
  id: string;
  /** 游戏内昵称, 必须和 matchesRoster.ts 的 name 完全一致 —— 战绩是按它关联的 */
  nickname: string;
  /** 平时叫的名字, 全站显示用这个; 留空就显示游戏昵称 */
  alias: string;
  /** 兜底用的位置, 库里有数据时不生效 */
  positions: string[];
  /** 兜底用的英雄池, 库里有数据时不生效 */
  champions: string[];
  /**
   * 头像, 可以放多张 —— 卡片上能左右切换 (方向键, 或点两侧箭头 / 底部圆点).
   * 图片放 public/roster/ 下; 数组为空则显示别名首字的占位块.
   * 竖版接近 4:5 最好, 会自动裁剪填充.
   */
  photos: string[];
  number: number;
};

export const TEAM_NAME = "LOVEYUE";

const ALIAS: Record<string, string> = {
  "爱玩雪球的努努": "越哥",
  "爱抽陀螺的尼菈": "毅哥",
  "爱击剑的菲欧娜": "花哥",
  "爱吃素的狼人": "该文",
  "爱打ad的加里奥": "TT",
  "爱坐牢的adc": "猴猴",
  "爱玩VR的李青": "农民",
  "爱惊鸿过隙的幻翎": "航仔",
};

/** 昵称 -> 平时叫的名字. 库里 member 存的是游戏昵称, 展示一律走这里. */
export function displayName(nickname: string): string {
  return ALIAS[nickname] || nickname;
}

export const roster: Player[] = [
  {
    id: "p1",
    nickname: "爱玩雪球的努努",
    alias: "越哥",
    positions: [],
    champions: [],
    photos: ["/roster/p1.jpg", "/roster/p1b.jpg"],
    number: 1,
  },
  {
    id: "p2",
    nickname: "爱抽陀螺的尼菈",
    alias: "毅哥",
    positions: [],
    champions: [],
    photos: ["/roster/p2.jpg"],
    number: 2,
  },
  {
    id: "p3",
    nickname: "爱击剑的菲欧娜",
    alias: "花哥",
    positions: [],
    champions: [],
    photos: ["/roster/p3.jpg"],
    number: 3,
  },
  {
    id: "p4",
    nickname: "爱吃素的狼人",
    alias: "该文",
    positions: [],
    champions: [],
    photos: ["/roster/p4.jpg"],
    number: 4,
  },
  {
    id: "p5",
    nickname: "爱打ad的加里奥",
    alias: "TT",
    positions: [],
    champions: [],
    photos: ["/roster/p5.jpg"],
    number: 5,
  },
  {
    id: "p6",
    nickname: "爱坐牢的adc",
    alias: "猴猴",
    positions: [],
    champions: [],
    photos: ["/roster/p6.jpg"],
    number: 6,
  },
  {
    id: "p7",
    nickname: "爱玩VR的李青",
    alias: "农民",
    positions: [],
    champions: [],
    photos: ["/roster/p7.jpg"],
    number: 7,
  },
  {
    id: "p8",
    nickname: "爱惊鸿过隙的幻翎",
    alias: "航仔",
    positions: [],
    champions: [],
    photos: [],
    number: 8,
  },
];
