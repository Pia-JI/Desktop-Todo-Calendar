/** 列表视图 / 紧凑模式：按天分组的单列清单，也用于全局搜索结果展示 */

import { addDays, isSameDay } from "date-fns";
import { useMemo } from "react";
import { dayKey, fmt, parse } from "@/lib/date";
import { filterTodos, todoColor } from "@/lib/query";
import { sortTodos } from "@/lib/search";
import { cn } from "@/lib/util";
import { useHolidays } from "@/hooks/useHolidays";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { TodoBar } from "@/components/TodoBar";
import { EmptyState } from "@/components/EmptyState";

const DAYS = 14;

export function ListView() {
  const cursor = useUi((s) => s.cursor);
  const todayKey = useUi((s) => s.todayKey);
  const search = useUi((s) => s.searchQuery);
  const sortMode = useUi((s) => s.sortMode);
  const todos = useTodos((s) => s.todos);
  const calendars = useTodos((s) => s.calendars);
  const hideCompleted = useSettings((s) => s.hideCompleted);
  const holidays = useHolidays();

  const anchor = useMemo(() => parse(cursor) ?? new Date(), [cursor]);
  const filtered = useMemo(
    () => sortTodos(filterTodos(todos, calendars, search, hideCompleted), sortMode),
    [todos, calendars, search, hideCompleted, sortMode],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (let i = 0; i < DAYS; i++) {
      const d = addDays(anchor, i);
      const key = dayKey(d);
      const items = filtered.filter((t) => isSameDay(parse(t.startAt)!, d));
      if (items.length) map.set(key, items);
    }
    // 超出 14 天的归到「更晚」
    const later = filtered.filter((t) => {
      const d = parse(t.startAt)!;
      return d.getTime() >= addDays(anchor, DAYS).getTime();
    });
    if (later.length) map.set("__later__", later);
    return [...map.entries()];
  }, [filtered, anchor]);

  if (filtered.length === 0) {
    return <EmptyState hint={search ? "没有匹配的待办" : "这段时间暂无待办"} />;
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin px-2 py-2 space-y-3">
      {groups.map(([key, items]) => {
        const isLater = key === "__later__";
        const day = isLater ? null : parse(`${key}T00:00:00`);
        const hol = day ? holidays.get(key) : undefined;
        return (
          <div key={key}>
            <div className="flex items-center gap-2 px-1 pb-1 sticky top-0 glass z-10">
              <span className={cn("text-xs font-semibold", !isLater && key === todayKey ? "text-primary" : "text-text")}>
                {isLater ? "更晚" : day ? fmt(day, "M月d日 EEEE") : key}
              </span>
              {hol && (
                <span className={cn("text-2xs px-1 rounded", hol.type === "holiday" ? "text-success bg-success/10" : "text-warning bg-warning/10")}>
                  {hol.name}
                </span>
              )}
              <span className="text-2xs text-muted">{items.length} 项</span>
              <div className="flex-1 h-px bg-border/60" />
            </div>
            <div className="space-y-1">
              {items.map((t) => (
                <TodoBar key={t.id} todo={t} color={todoColor(t, calendars)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}