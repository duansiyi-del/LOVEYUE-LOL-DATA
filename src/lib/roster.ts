// 车队展示名单 (选手名单页). 昵称必须和 matchesRoster.ts 里的 name 一致,
// 战绩页按昵称高亮车队成员. 位置 / 英雄池 / 头像先占位, 后面按实际改.
// 头像放 public/roster/ 下, photo 留空则显示昵称首字占位块.

export type Player = {
  id: string;
  /** 游戏内昵称, 必须和 matchesRoster.ts 的 name 完全一致 —— 战绩是按它关联的 */
  nickname: string;
  /** 平时叫的名字, 全站显示用这个; 留空就显示游戏昵称 */
  alias: string;
  /** 头像路径, 放 public/roster/ 下; 留空则显示别名首字的占位块 */
  positions: string[];
  champions: string[];
  photo: string;
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
    photo: "/roster/p1.jpg",
    number: 1,
  },
  {
    id: "p2",
    nickname: "爱抽陀螺的尼菈",
    alias: "毅哥",
    positions: [],
    champions: [],
    photo: "",
    number: 2,
  },
  {
    id: "p3",
    nickname: "爱击剑的菲欧娜",
    alias: "花哥",
    positions: [],
    champions: [],
    photo: "/roster/p3.jpg",
    number: 3,
  },
  {
    id: "p4",
    nickname: "爱吃素的狼人",
    alias: "该文",
    positions: [],
    champions: [],
    photo: "/roster/p4.jpg",
    number: 4,
  },
  {
    id: "p5",
    nickname: "爱打ad的加里奥",
    alias: "TT",
    positions: [],
    champions: [],
    photo: "/roster/p5.jpg",
    number: 5,
  },
  {
    id: "p6",
    nickname: "爱坐牢的adc",
    alias: "猴猴",
    positions: [],
    champions: [],
    photo: "/roster/p6.jpg",
    number: 6,
  },
  {
    id: "p7",
    nickname: "爱玩VR的李青",
    alias: "农民",
    positions: [],
    champions: [],
    photo: "/roster/p7.jpg",
    number: 7,
  },
  {
    id: "p8",
    nickname: "爱惊鸿过隙的幻翎",
    alias: "航仔",
    positions: [],
    champions: [],
    photo: "",
    number: 8,
  },
];
