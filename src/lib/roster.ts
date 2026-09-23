// 车队展示名单 (选手名单页). 昵称必须和 matchesRoster.ts 里的 name 一致,
// 战绩页按昵称高亮车队成员. 位置 / 英雄池 / 头像先占位, 后面按实际改.
// 头像放 public/roster/ 下, photo 留空则显示昵称首字占位块.

export type Player = {
  id: string;
  nickname: string;
  positions: string[];
  champions: string[];
  photo: string;
  number: number;
};

export const TEAM_NAME = "LOVEYUE";

export const roster: Player[] = [
  {
    id: "p1",
    nickname: "爱玩雪球的努努",
    positions: [],
    champions: [],
    photo: "",
    number: 1,
  },
  {
    id: "p2",
    nickname: "爱抽陀螺的尼菈",
    positions: [],
    champions: [],
    photo: "",
    number: 2,
  },
  {
    id: "p3",
    nickname: "爱击剑的菲欧娜",
    positions: [],
    champions: [],
    photo: "",
    number: 3,
  },
  {
    id: "p4",
    nickname: "爱吃素的狼人",
    positions: [],
    champions: [],
    photo: "",
    number: 4,
  },
  {
    id: "p5",
    nickname: "爱打ad的加里奥",
    positions: [],
    champions: [],
    photo: "",
    number: 5,
  },
  {
    id: "p6",
    nickname: "爱坐牢的adc",
    positions: [],
    champions: [],
    photo: "",
    number: 6,
  },
  {
    id: "p7",
    nickname: "爱玩VR的李青",
    positions: [],
    champions: [],
    photo: "",
    number: 7,
  },
  {
    id: "p8",
    nickname: "爱惊鸿过隙的幻翎",
    positions: [],
    champions: [],
    photo: "",
    number: 8,
  },
];
