/** 周视图：7 列天头 + 每天一张横向卡片列表（可滚动） */

import { isSameDay } from "date-fns";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { dayKey, fmt, parse, weekDays, WD_LABEL } from "@/lib/date";
import { externalByDay, filterTodos, groupByDay, todoColor } from "@/lib/query";
import { cn } from "@/lib/util";
import { useHolidays } from "@/hooks/useHolidays";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { TodoBar } from "@/components/TodoBar";

export function WeekView() {
  const cursor = useUi((s) => s.cursor);
  const todayKey = useUi((s) => s.todayKey);
  const search = useUi((s) => s.searchQuery);
  const openDrawer = useUi((s) => s.openDrawer);
  const todos = useTodos((s) => s.todos);
  const external = useTodos((s) => s.external);
  const calendars = useTodos((s) => s.calendars);
  const hideCompleted = useSettings((s) => s.hideCompleted);
  const holidays = useHolidays();
  const hoverKey = useUi((s) => s.todoDrag.hoverKey);

  const anchor = useMemo(() => parse(cursor) ?? new Date(), [cursor]);
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const grouped = useMemo(() => groupByDay(filterTodos(todos, calendars, search, hideCompleted)), [todos, calendars, search, hideCompleted]);
  const extGrouped = useMemo(() => externalByDay(external, calendars), [external, calendars]);

  return (
    <div className="h-full flex flex-col gap-1 px-1 pb-1 min-h-0">
      <div className="grid grid-cols-7 gap-1 shrink-0">
        {days.map((d, i) => {
          const isTodayKey = dayKey(d) === todayKey;
          return (
          <button
            key={i}
            onClick={() => {
              useUi.getState().setSelectedDate(d.toISOString());
              useUi.getState().setCursor(d.toISOString());
              useUi.getState().setView("day");
            }}
            className={cn(
              "rounded-lg py-1.5 flex flex-col items-center gap-0.5 transition-colors hover:bg-surface-2",
              isTodayKey && "bg-primary/10",
            )}
          >
            <span className={cn("text-2xs", i >= 5 ? "text-primary/80" : "text-muted")}>{WD_LABEL[i]}</span>
            <span className={cn("text-sm font-semibold tabular-nums", isTodayKey ? "text-primary" : "text-text")}>
              {fmt(d, "d")}
            </span>
            <span className="text-2xs text-muted">{holidays.get(dayKey(d))?.name ?? ""}</span>
          </button>
          );
        })}
      </div>

      <div className="flex-1 grid grid-cols-7 gap-1 min-h-0">
        {days.map((d) => {
          const key = dayKey(d);
          const isTodayKey = key === todayKey;
          const list = grouped.get(key) ?? [];
          const ext = extGrouped.get(key) ?? [];
          return (
            <div
              key={key}
              data-drop-day={key}
              onDoubleClick={() => {
                const base = new Date(d);
                base.setHours(9, 0, 0, 0);
                openDrawer({ presetStart: base.toISOString() });
              }}
              className={cn(
                "rounded-lg border border-border/60 bg-surface/50 p-1 flex flex-col gap-1 min-h-0 overflow-y-auto scroll-thin",
                isTodayKey && "border-primary/40",
                hoverKey === key && "bg-primary/10 border-primary/50",
              )}
            >
              {ext.map((ev) => (
                <div key={ev.id} title={`${ev.title}（外部日历）`} className="rounded-md px-1.5 py-1 text-2xs readonly-hatch bg-surface-2 text-muted truncate">
                  {ev.title}
                </div>
              ))}
              {list.map((t) => (
                <TodoBar key={t.id} todo={t} color={todoColor(t, calendars)} />
              ))}
              {list.length === 0 && ext.length === 0 && (
                <button
                  className="mt-auto mx-auto mb-1 icon-btn w-6 h-6 opacity-0 hover:opacity-100 focus:opacity-100"
                  onClick={() => {
                    const base = new Date(d);
                    base.setHours(9, 0, 0, 0);
                    openDrawer({ presetStart: base.toISOString() });
                  }}
                  aria-label="新建"
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function isSameDayLocal(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}