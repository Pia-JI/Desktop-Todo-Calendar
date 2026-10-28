/** 视图层派生数据：可见日历过滤 + 搜索筛选 + 按天分组 */

import type { CalendarCategory, ExternalEvent, HolidayEntry, Todo } from "@/types";
import { dayKey, parse } from "./date";
import { matchesFilters, parseQuery, type SearchFilters } from "./search";

export function visibleCalendarIds(calendars: CalendarCategory[]): Set<string> {
  return new Set(calendars.filter((c) => c.visible).map((c) => c.id));
}

export function calendarById(calendars: CalendarCategory[], id?: string | null): CalendarCategory | undefined {
  if (!id) return undefined;
  return calendars.find((c) => c.id === id);
}

export function todoColor(todo: Todo, calendars: CalendarCategory[]): string {
  return calendarById(calendars, todo.calendarId)?.color ?? todo.color;
}

export function filterTodos(
  todos: Todo[],
  calendars: CalendarCategory[],
  query: string,
  hideCompleted: boolean,
  now: Date = new Date(),
): Todo[] {
  const ids = visibleCalendarIds(calendars);
  const filters: SearchFilters = parseQuery(query, now);
  return todos.filter((t) => {
    if (t.deletedAt || t.parentId) return false;
    if (t.calendarId && !ids.has(t.calendarId)) return false;
    if (hideCompleted && t.completed) return false;
    return matchesFilters(t, filters, calendars, now);
  });
}

export function groupByDay(todos: Todo[]): Map<string, Todo[]> {
  const map = new Map<string, Todo[]>();
  for (const t of todos) {
    const d = parse(t.startAt);
    if (!d) continue;
    const k = dayKey(d);
    const arr = map.get(k);
    if (arr) arr.push(t);
    else map.set(k, [t]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (parse(a.startAt)?.getTime() ?? 0) - (parse(b.startAt)?.getTime() ?? 0);
    });
  }
  return map;
}

export function externalByDay(events: ExternalEvent[], calendars: CalendarCategory[]): Map<string, ExternalEvent[]> {
  const ids = visibleCalendarIds(calendars);
  const map = new Map<string, ExternalEvent[]>();
  for (const e of events) {
    if (e.calendarId && !ids.has(e.calendarId)) continue;
    const d = parse(e.startAt);
    if (!d) continue;
    const k = dayKey(d);
    const arr = map.get(k);
    if (arr) arr.push(e);
    else map.set(k, [e]);
  }
  return map;
}

export function holidayBadge(holidays: Map<string, HolidayEntry>, key: string): HolidayEntry | undefined {
  return holidays.get(key);
}

/** 子任务进度 x/y */
export function subtaskProgress(subtasks: { todoId: string; done: boolean }[], todoId: string) {
  const mine = subtasks.filter((s) => s.todoId === todoId);
  const done = mine.filter((s) => s.done).length;
  return { done, total: mine.length };
}