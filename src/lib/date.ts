/** 日期计算：月历六周矩阵、周/日视图时间网格、UTC 存储 <-> 本地显示 */

import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMinutes,
} from "date-fns";
import { zhCN } from "date-fns/locale";

/** 周一开头（符合国内习惯） */
export const WEEK_STARTS_ON = 1 as const;
export const MONTH_MATRIX_CELLS = 42; // 6 周
export const HOUR_HEIGHT = 48; // 日视图每小时像素高
export const DAY_START_HOUR = 0;
export const DAY_END_HOUR = 24;

export const WD_SHORT = ["一", "二", "三", "四", "五", "六", "日"];
export const WD_LABEL = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function iso(d: Date): string {
  return d.toISOString();
}

export function startOfLocalDay(d: Date): Date {
  return startOfDay(d);
}

export function endOfLocalDay(d: Date): Date {
  return endOfDay(d);
}

/** 本地日期键 yyyy-MM-dd（用于分组、农历、节假日查询） */
export function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? parse(d) ?? new Date(d) : d;
  return format(date, "yyyy-MM-dd");
}

/** 月视图 6×7 矩阵：从「本月 1 号所在周的周一」开始 */
export function monthMatrix(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON });
  return Array.from({ length: MONTH_MATRIX_CELLS }, (_, i) => addDays(first, i));
}

export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

export function nextMonth(d: Date): Date {
  return addMonths(startOfMonth(d), 1);
}
export function prevMonth(d: Date): Date {
  return addMonths(startOfMonth(d), -1);
}
export function nextWeek(d: Date): Date {
  return addWeeks(d, 1);
}
export function prevWeek(d: Date): Date {
  return addWeeks(d, -1);
}

export function inMonth(d: Date, anchor: Date): boolean {
  return isSameMonth(d, anchor);
}

export { isToday, isSameDay, isBefore, isAfter, addDays, addMinutes, subMinutes, differenceInMinutes, startOfWeek, endOfMonth, format };

export function fmt(d: Date, pattern: string): string {
  return format(d, pattern, { locale: zhCN });
}

/** 顶栏标题：2026年9月 / 第39周 / 9月20日 周日 */
export function rangeTitle(view: string, anchor: Date): string {
  if (view === "month") return fmt(anchor, "yyyy年M月");
  if (view === "week") {
    const days = weekDays(anchor);
    return `${fmt(days[0], "M月d日")} - ${fmt(days[6], "M月d日")}`;
  }
  return fmt(anchor, "yyyy年M月d日 EEEE");
}

/** 当天 00:00 的 Date */
export function dayAt(d: Date, hour: number, minute = 0): Date {
  const base = startOfDay(d);
  return addMinutes(base, hour * 60 + minute);
}

/** 日视图：事件在时间轴上的 top / height（px） */
export function slotGeometry(start: Date, end: Date, dayStart: Date) {
  const topMin = Math.max(0, differenceInMinutes(start, dayStart));
  const endMin = Math.min(24 * 60, Math.max(topMin + 15, differenceInMinutes(end, dayStart)));
  return {
    top: (topMin / 60) * HOUR_HEIGHT,
    height: Math.max(18, ((endMin - topMin) / 60) * HOUR_HEIGHT),
  };
}

/** 时间段重叠判定（用于冲突提示） */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return isBefore(aStart, bEnd) && isBefore(bStart, aEnd);
}

/** 把时间吸附到 step 分钟（默认 15） */
export function snapToStep(d: Date, step = 15): Date {
  const minutes = d.getHours() * 60 + d.getMinutes();
  const snapped = Math.round(minutes / step) * step;
  const base = startOfDay(d);
  return addMinutes(base, snapped);
}

/** 「x分钟前 / x小时后 / 明天 14:00」这类相对描述，用于 Dock 与通知 */
export function relativeLabel(target: Date, now = new Date()): string {
  const diffMin = Math.round(differenceInMinutes(target, now));
  const abs = Math.abs(diffMin);
  const suffix = diffMin >= 0 ? "后" : "前";
  if (abs < 1) return diffMin >= 0 ? "马上" : "刚刚";
  if (abs < 60) return `${abs}分钟${suffix}`;
  if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m === 0 ? `${h}小时${suffix}` : `${h}小时${m}分${suffix}`;
  }
  const days = Math.round(abs / (60 * 24));
  if (days === 1) return diffMin >= 0 ? "明天" : "昨天";
  if (days < 30) return `${days}天${suffix}`;
  return fmt(target, "M月d日");
}

export function timeLabel(d: Date): string {
  return format(d, "HH:mm");
}

/** 小窗下一事项文案：显示具体钟点，而不是「六分钟后」。 */
export function dockEventLabel(target: Date, now = new Date()): string {
  const clock = timeLabel(target);
  if (isSameDay(target, now)) return clock;
  if (isSameDay(addDays(now, 1), target)) return `明天 ${clock}`;
  if (isSameDay(addDays(now, -1), target)) return `昨天 ${clock}`;
  return `${fmt(target, "M月d日")} ${clock}`;
}

export function reminderClockLabel(target: Date, now = new Date()): string {
  const clock = timeLabel(target);
  if (isSameDay(target, now)) return clock;
  if (isSameDay(addDays(now, 1), target)) return `明天 ${clock}`;
  if (isSameDay(addDays(now, -1), target)) return `昨天 ${clock}`;
  return `${fmt(target, "M月d日")} ${clock}`;
}

export function isSameDayIso(a: string, b: Date): boolean {
  const da = parse(a);
  return da ? isSameDay(da, b) : false;
}

/** 生成 0..23 小时刻度 */
export function hourTicks(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}