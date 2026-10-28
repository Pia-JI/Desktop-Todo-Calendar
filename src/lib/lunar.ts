/**
 * 农历 / 节气 / 传统节日 —— 全部离线算法，无任何网络依赖。
 * 数据表覆盖 1900-2100（经典 lunarInfo 压缩位图，每 4 字节描述一年的月大小与闰月）。
 * 法定节假日「调休上班日」不在此处，见 src/data/holidays-cn.json（可被用户修正覆盖）。
 */

import { dayKey } from "./date";

/** 每年农历信息位图：低 4 位为闰月月份（0 表示无闰月），bit16 为闰月天数标记，bit15..bit4 为各月大小 */
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6, // 1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
  0x0d520, // 2100
];

const HEAVENLY = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const EARTHLY = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const ZODIAC = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
const NUM_CN = ["日", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const DAY_PREFIX = ["初", "十", "廿", "三"];

export const TERM_NAMES = [
  "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
  "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑",
  "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至",
];

/** 节气分钟偏移表（1900 年起算） */
const S_TERM_INFO = [
  0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551, 218072, 240693,
  263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
];

const LUNAR_FESTIVAL: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵",
  "5-5": "端午",
  "7-7": "七夕",
  "7-15": "中元",
  "8-15": "中秋",
  "9-9": "重阳",
  "12-8": "腊八",
};

const SOLAR_FESTIVAL: Record<string, string> = {
  "1-1": "元旦",
  "2-14": "情人节",
  "3-8": "妇女节",
  "3-12": "植树节",
  "4-1": "愚人节",
  "5-1": "劳动节",
  "5-4": "青年节",
  "6-1": "儿童节",
  "7-1": "建党节",
  "8-1": "建军节",
  "9-10": "教师节",
  "10-1": "国庆节",
  "12-24": "平安夜",
  "12-25": "圣诞节",
};

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
  yearCn: string; // 干支
  zodiac: string; // 生肖
  monthCn: string; // 正月/二月...
  dayCn: string; // 初一/十五/廿三...
}

export interface LunarCellInfo {
  lunar: LunarDate;
  festival?: string;
  solarTerm?: string;
  /** 格子右上角优先展示：节日 > 节气 > 初一(月份) > 农历日 */
  badge: string;
  badgeKind: "festival" | "term" | "month" | "day";
}

function leapMonth(y: number): number {
  return LUNAR_INFO[y - 1900] & 0xf;
}

function leapDays(y: number): number {
  if (leapMonth(y)) return LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29;
  return 0;
}

function monthDays(y: number, m: number): number {
  return LUNAR_INFO[y - 1900] & (0x10000 >> m) ? 30 : 29;
}

function yearDays(y: number): number {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += LUNAR_INFO[y - 1900] & i ? 1 : 0;
  }
  return sum + leapDays(y);
}

function dayCn(d: number): string {
  if (d === 10) return "初十";
  if (d === 20) return "二十";
  if (d === 30) return "三十";
  return DAY_PREFIX[Math.floor(d / 10)] + NUM_CN[d % 10];
}

function monthCn(m: number): string {
  const names = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
  return `${names[m - 1]}月`;
}

/** 公历 -> 农历（支持 1900-01-31 ~ 2100-12-31） */
export function solarToLunar(date: Date): LunarDate | null {
  const y0 = date.getFullYear();
  if (y0 < 1900 || y0 > 2100) return null;

  const base = new Date(1900, 0, 31).getTime(); // 农历 1900 年正月初一
  const target = new Date(y0, date.getMonth(), date.getDate()).getTime();
  let offset = Math.round((target - base) / 86400000);
  if (offset < 0) return null;

  let year = 1900;
  let temp = 0;
  for (; year < 2101 && offset > 0; year++) {
    temp = yearDays(year);
    offset -= temp;
  }
  if (offset < 0) {
    offset += temp;
    year--;
  }

  const leap = leapMonth(year);
  let isLeapMonth = false;
  let month = 1;
  for (; month < 13 && offset > 0; month++) {
    if (leap > 0 && month === leap + 1 && !isLeapMonth) {
      month--;
      isLeapMonth = true;
      temp = leapDays(year);
    } else {
      temp = monthDays(year, month);
    }
    if (isLeapMonth && month === leap + 1) isLeapMonth = false;
    offset -= temp;
  }

  if (offset === 0 && leap > 0 && month === leap + 1) {
    if (isLeapMonth) {
      isLeapMonth = false;
    } else {
      isLeapMonth = true;
      month--;
    }
  }
  if (offset < 0) {
    offset += temp;
    month--;
  }

  const day = offset + 1;
  const ganZhiIdx = (year - 1900 + 36) % 60;
  return {
    year,
    month,
    day,
    isLeapMonth,
    yearCn: HEAVENLY[ganZhiIdx % 10] + EARTHLY[ganZhiIdx % 12],
    zodiac: ZODIAC[(year - 1900) % 12],
    monthCn: (isLeapMonth ? "闰" : "") + monthCnName(month),
    dayCn: dayCn(day),
  };
}

function monthCnName(m: number): string {
  const names = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
  return `${names[m - 1]}月`;
}

/** 某年第 n 个节气（n: 1..24）落在几号 */
export function solarTermDay(year: number, n: number): number {
  const ms =
    31556925974.7 * (year - 1900) + S_TERM_INFO[n - 1] * 60000 + Date.UTC(1900, 0, 6, 2, 5, 0);
  return new Date(ms).getUTCDate();
}

/** 某月的两个节气 */
export function solarTermsOfMonth(year: number, month: number): { day: number; name: string }[] {
  const n1 = (month - 1) * 2 + 1;
  const n2 = n1 + 1;
  return [
    { day: solarTermDay(year, n1), name: TERM_NAMES[n1 - 1] },
    { day: solarTermDay(year, n2), name: TERM_NAMES[n2 - 1] },
  ];
}

const cache = new Map<string, LunarCellInfo>();

/** 月历格子用的完整信息（带缓存，避免动画期间重复计算） */
export function lunarCellInfo(date: Date): LunarCellInfo | null {
  const key = dayKey(date);
  const hit = cache.get(key);
  if (hit) return hit;

  const lunar = solarToLunar(date);
  if (!lunar) return null;

  const m = date.getMonth() + 1;
  const d = date.getDate();
  const y = date.getFullYear();

  const term = solarTermsOfMonth(y, m).find((t) => t.day === d);

  let festival: string | undefined;
  const solarKey = `${m}-${d}`;
  if (SOLAR_FESTIVAL[solarKey]) festival = SOLAR_FESTIVAL[solarKey];
  const lunarKey = `${lunar.month}-${lunar.day}`;
  if (LUNAR_FESTIVAL[lunarKey]) festival = LUNAR_FESTIVAL[lunarKey];
  // 除夕：农历十二月最后一天
  if (lunar.month === 12 && lunar.day === monthDays(lunar.year, 12)) festival = "除夕";

  const badge =
    festival ?? term?.name ?? (lunar.day === 1 ? lunar.monthCn : lunar.dayCn);
  const badgeKind: LunarCellInfo["badgeKind"] = festival
    ? "festival"
    : term
      ? "term"
      : lunar.day === 1
        ? "month"
        : "day";

  const info: LunarCellInfo = { lunar, festival, solarTerm: term?.name, badge, badgeKind };
  cache.set(key, info);
  return info;
}

export function lunarYearLabel(date: Date): string {
  const l = solarToLunar(date);
  if (!l) return "";
  return `${l.yearCn}${l.zodiac}年`;
}

/** 清空缓存（一般不需要，测试用） */
export function clearLunarCache(): void {
  cache.clear();
}

export { monthCn, dayCn, yearDays, monthDays, leapMonth, leapDays };