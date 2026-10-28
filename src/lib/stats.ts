/** 统计与年度热力图：全部在内存中派生，避免额外 SQL 聚合 */

import { differenceInCalendarDays, isSameDay, startOfWeek, subDays } from "date-fns";
import type { CalendarCategory, PomodoroSession, Todo } from "@/types";
import { WEEK_STARTS_ON, dayKey, parse } from "./date";

export interface CalendarStat {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface HeatCell {
  date: string;
  count: number;
}

export interface StatsSummary {
  weekCompleted: number;
  monthCompleted: number;
  focusMinutes: number;
  focusSessions: number;
  byCalendar: CalendarStat[];
  p1Total: number;
  p1Done: number;
  p1Rate: number;
  heatmap: HeatCell[];
  streak: number;
  totalOpen: number;
}

export function computeStats(
  todos: Todo[],
  sessions: PomodoroSession[],
  calendars: CalendarCategory[],
  now: Date = new Date(),
): StatsSummary {
  const live = todos.filter((t) => !t.deletedAt);
  const done = live.filter((t) => t.completed && t.completedAt);

  const weekStart = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON });
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const inRange = (isoStr: string | null | undefined, from: Date) => {
    const d = parse(isoStr);
    return d ? d.getTime() >= from.getTime() && d.getTime() <= now.getTime() : false;
  };

  const weekCompleted = done.filter((t) => inRange(t.completedAt, weekStart)).length;
  const monthCompleted = done.filter((t) => inRange(t.completedAt, monthStart)).length;

  const focus = sessions.filter((s) => s.kind === "focus" && s.completed);
  const focusMinutes = Math.round(focus.reduce((acc, s) => acc + s.durationSec, 0) / 60);

  const byCalendarMap = new Map<string, number>();
  for (const t of done) {
    const key = t.calendarId ?? "none";
    byCalendarMap.set(key, (byCalendarMap.get(key) ?? 0) + 1);
  }
  const byCalendar: CalendarStat[] = [...byCalendarMap.entries()].map(([id, count]) => {
    const cal = calendars.find((c) => c.id === id);
    return {
      id,
      name: cal?.name ?? (id === "none" ? "未分类" : id),
      color: cal?.color ?? "#9AA0B0",
      count,
    };
  });
  byCalendar.sort((a, b) => b.count - a.count);

  const p1 = live.filter((t) => t.priority === 1);
  const p1Done = p1.filter((t) => t.completed).length;

  // 热力图：最近 365 天
  const counts = new Map<string, number>();
  for (const t of done) {
    const d = parse(t.completedAt);
    if (!d) continue;
    const k = dayKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const heatmap: HeatCell[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = subDays(now, i);
    heatmap.push({ date: dayKey(d), count: counts.get(dayKey(d)) ?? 0 });
  }

  // 连续打卡天数
  let streak = 0;
  let cursor = now;
  if ((counts.get(dayKey(cursor)) ?? 0) === 0) cursor = subDays(cursor, 1);
  while ((counts.get(dayKey(cursor)) ?? 0) > 0) {
    streak++;
    cursor = subDays(cursor, 1);
  }

  return {
    weekCompleted,
    monthCompleted,
    focusMinutes,
    focusSessions: focus.length,
    byCalendar,
    p1Total: p1.length,
    p1Done,
    p1Rate: p1.length ? Math.round((p1Done / p1.length) * 100) : 0,
    heatmap,
    streak,
    totalOpen: live.filter((t) => !t.completed).length,
  };
}

/** 周回顾：本周完成数 / 专注分钟 / 下周 P1 列表 */
export function weeklyReview(
  todos: Todo[],
  sessions: PomodoroSession[],
  now: Date = new Date(),
) {
  const weekStart = startOfWeek(now, { weekStartsOn: WEEK_STARTS_ON });
  const done = todos.filter(
    (t) => !t.deletedAt && t.completed && t.completedAt && parse(t.completedAt)! >= weekStart,
  );
  const focusMin = Math.round(
    sessions
      .filter((s) => s.kind === "focus" && s.completed && parse(s.startedAt)! >= weekStart)
      .reduce((a, s) => a + s.durationSec, 0) / 60,
  );
  const nextWeekP1 = todos.filter((t) => {
    if (t.deletedAt || t.completed || t.priority !== 1) return false;
    const d = parse(t.startAt);
    if (!d) return false;
    return differenceInCalendarDays(d, now) >= 0 && differenceInCalendarDays(d, now) <= 7;
  });
  return { doneCount: done.length, focusMin, nextWeekP1 };
}

export function isSameDayLocal(a: string, b: Date): boolean {
  const d = parse(a);
  return d ? isSameDay(d, b) : false;
}