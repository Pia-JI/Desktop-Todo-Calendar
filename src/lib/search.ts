/**
 * 全局搜索与筛选语法：
 *   普通文本      -> 标题/备注模糊匹配
 *   #工作         -> 日历分类
 *   p:1           -> 优先级
 *   is:done / is:open / is:overdue
 *   after:today / before:2026-10-01 / on:today
 *   repeat:daily
 * 多个条件之间是 AND。
 */

import { addDays, endOfDay, endOfMonth, startOfDay, startOfMonth } from "date-fns";
import type { CalendarCategory, Todo } from "@/types";
import { parse } from "./date";

export interface SearchFilters {
  text: string;
  calendars: string[];
  priorities: number[];
  statuses: ("done" | "open" | "overdue")[];
  repeat?: string;
  after?: Date;
  before?: Date;
  on?: Date;
}

const DATE_WORDS: Record<string, (now: Date) => Date> = {
  today: (n) => n,
  tomorrow: (n) => addDays(n, 1),
  yesterday: (n) => addDays(n, -1),
  week: (n) => n,
  month: (n) => n,
};

function parseDateToken(value: string, now: Date): Date | null {
  const w = DATE_WORDS[value.toLowerCase()];
  if (w) return w(now);
  return parse(value);
}

export function parseQuery(raw: string, now: Date = new Date()): SearchFilters {
  const f: SearchFilters = { text: "", calendars: [], priorities: [], statuses: [] };
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const free: string[] = [];

  for (const w of words) {
    const lower = w.toLowerCase();
    if (w.startsWith("#")) {
      f.calendars.push(w.slice(1));
    } else if (/^p:[123]$/.test(lower)) {
      f.priorities.push(Number(lower.slice(2)));
    } else if (lower === "is:done") {
      f.statuses.push("done");
    } else if (lower === "is:open" || lower === "is:todo") {
      f.statuses.push("open");
    } else if (lower === "is:overdue") {
      f.statuses.push("overdue");
    } else if (lower.startsWith("after:")) {
      const d = parseDateToken(w.slice(6), now);
      if (d) f.after = endOfDay(d);
    } else if (lower.startsWith("before:")) {
      const d = parseDateToken(w.slice(7), now);
      if (d) f.before = startOfDay(d);
    } else if (lower.startsWith("on:")) {
      const d = parseDateToken(w.slice(3), now);
      if (d) f.on = d;
    } else if (lower.startsWith("repeat:")) {
      f.repeat = w.slice(7);
    } else {
      free.push(w);
    }
  }
  f.text = free.join(" ").trim();
  return f;
}

export function hasActiveFilters(f: SearchFilters): boolean {
  return Boolean(
    f.text || f.calendars.length || f.priorities.length || f.statuses.length || f.repeat || f.after || f.before || f.on,
  );
}

export function matchesFilters(
  todo: Todo,
  f: SearchFilters,
  calendars: CalendarCategory[],
  now: Date = new Date(),
): boolean {
  if (todo.deletedAt) return false;

  if (f.calendars.length) {
    const names = f.calendars.map((c) => c.toLowerCase());
    const cal = calendars.find((c) => c.id === todo.calendarId);
    const ok = names.includes((cal?.name ?? "").toLowerCase()) || names.includes("none");
    if (!ok) return false;
  }
  if (f.priorities.length && !f.priorities.includes(todo.priority)) return false;

  if (f.statuses.length) {
    const start = parse(todo.startAt);
    const overdue = !todo.completed && start ? start.getTime() < now.getTime() : false;
    const ok = f.statuses.some((s) =>
      s === "done" ? todo.completed : s === "open" ? !todo.completed : overdue,
    );
    if (!ok) return false;
  }

  if (f.repeat && todo.repeat !== f.repeat) return false;

  const start = parse(todo.startAt);
  if (f.after && (!start || start.getTime() <= f.after.getTime())) return false;
  if (f.before && (!start || start.getTime() >= f.before.getTime())) return false;
  if (f.on && start) {
    const a = startOfDay(f.on).getTime();
    const b = endOfDay(f.on).getTime();
    if (start.getTime() < a || start.getTime() > b) return false;
  }

  if (f.text) {
    const hay = `${todo.title} ${todo.notes ?? ""}`.toLowerCase();
    if (!hay.includes(f.text.toLowerCase())) return false;
  }
  return true;
}

/** 排序：智能排序 = 先 P1，再按时间 */
export type SortMode = "time" | "priority" | "created" | "smart";

export function sortTodos(todos: Todo[], mode: SortMode): Todo[] {
  const arr = [...todos];
  const t = (x: Todo) => parse(x.startAt)?.getTime() ?? 0;
  switch (mode) {
    case "priority":
      return arr.sort((a, b) => a.priority - b.priority || t(a) - t(b));
    case "created":
      return arr.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    case "smart":
      return arr.sort((a, b) => {
        const pa = a.priority === 1 ? 0 : 1;
        const pb = b.priority === 1 ? 0 : 1;
        return pa - pb || t(a) - t(b);
      });
    default:
      return arr.sort((a, b) => t(a) - t(b));
  }
}

export { startOfMonth, endOfMonth };