/** 月视图：7 列（周一起）、六周矩阵、今日高亮、非本月置灰、格子内彩色小条 + +N */

import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { isSameDay } from "date-fns";
import { lunarCellInfo } from "@/lib/lunar";
import { dayKey, monthMatrix, parse, WD_SHORT } from "@/lib/date";
import { externalByDay, filterTodos, groupByDay, todoColor } from "@/lib/query";
import { cn } from "@/lib/util";
import { useHolidays } from "@/hooks/useHolidays";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { useMenu } from "@/store/menu";
import { TodoBar } from "@/components/TodoBar";
import type { Todo } from "@/types";

const MAX_PER_CELL = 3;

export function MonthView() {
  const cursor = useUi((s) => s.cursor);
  const selectedDate = useUi((s) => s.selectedDate);
  // 订阅 todayKey：跨天后重新渲染，才能把「今天」的实心圆挪到新的一天
  const todayKey = useUi((s) => s.todayKey);
  const search = useUi((s) => s.searchQuery);
  const openDrawer = useUi((s) => s.openDrawer);
  const openMenu = useMenu((s) => s.openMenu);
  const todos = useTodos((s) => s.todos);
  const external = useTodos((s) => s.external);
  const calendars = useTodos((s) => s.calendars);
  const hideCompleted = useSettings((s) => s.hideCompleted);
  const showLunar = useSettings((s) => s.showLunar);
  const holidays = useHolidays();
  const hoverKey = useUi((s) => s.todoDrag.hoverKey);

  const anchor = useMemo(() => parse(cursor) ?? new Date(), [cursor]);
  const cells = useMemo(() => monthMatrix(anchor), [anchor]);
  const grouped = useMemo(() => groupByDay(filterTodos(todos, calendars, search, hideCompleted)), [todos, calendars, search, hideCompleted]);
  const extGrouped = useMemo(() => externalByDay(external, calendars), [external, calendars]);

  const onCellDouble = (day: Date) => {
    const base = new Date(day);
    base.setHours(Math.min(23, new Date().getHours() + 1), 0, 0, 0);
    openDrawer({ presetStart: base.toISOString() });
  };

  const onCellContext = (e: React.MouseEvent, day: Date) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      {
        label: "新建待办",
        icon: Plus,
        onClick: () => {
          const base = new Date(day);
          base.setHours(9, 0, 0, 0);
          openDrawer({ presetStart: base.toISOString() });
        },
      },
      {
        label: "跳到该日（日视图）",
        onClick: () => {
          useUi.getState().setSelectedDate(day.toISOString());
          useUi.getState().setCursor(day.toISOString());
          useUi.getState().setView("day");
        },
      },
    ]);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="grid grid-cols-7 shrink-0 px-1 pb-1">
        {WD_SHORT.map((w, i) => (
          <div key={w} className={cn("text-center text-2xs font-medium py-1", i >= 5 ? "text-primary/70" : "text-muted")}>
            {w}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-cols-7 grid-rows-6 gap-1 px-1 pb-1 min-h-0">
        {cells.map((day) => {
          const key = dayKey(day);
          const inMonth = isSameDay(day, anchor) || day.getMonth() === anchor.getMonth();
          const dayTodos = grouped.get(key) ?? [];
          const dayExt = extGrouped.get(key) ?? [];
          const hol = holidays.get(key);
          const lunar = showLunar ? lunarCellInfo(day) : null;
          const shown = dayTodos.slice(0, MAX_PER_CELL);
          const extra = dayTodos.length - shown.length;
          const isSelected = isSameDay(day, parse(selectedDate) ?? new Date());

          return (
            <div
              key={key}
              data-drop-day={key}
              onDoubleClick={() => onCellDouble(day)}
              onContextMenu={(e) => onCellContext(e, day)}
              className={cn(
                "relative rounded-lg border p-1 flex flex-col gap-0.5 min-h-0 overflow-hidden transition-colors",
                inMonth ? "bg-surface/60 border-border/60" : "bg-transparent border-transparent opacity-40",
                hoverKey === key && "bg-primary/10 border-primary/50",
                isSelected && "ring-1 ring-primary/40",
              )}
            >
              <div className="flex items-start justify-between shrink-0">
                <span
                  className={cn(
                    "text-[11px] font-semibold tabular-nums leading-4 px-1 rounded-md",
                    key === todayKey ? "bg-primary text-white" : inMonth ? "text-text" : "text-muted",
                  )}
                >
                  {day.getDate()}
                </span>
                <span className="flex items-center gap-0.5">
                  {hol && (
                    <span
                      className={cn(
                        "text-2xs font-bold px-1 rounded",
                        hol.type === "holiday" ? "text-success bg-success/10" : hol.type === "workday" ? "text-warning bg-warning/10" : "text-muted",
                      )}
                      title={hol.name}
                    >
                      {hol.type === "holiday" ? "休" : hol.type === "workday" ? "班" : hol.name}
                    </span>
                  )}
                  {lunar && (
                    <span
                      className={cn(
                        "text-2xs leading-4",
                        lunar.badgeKind === "festival" ? "text-danger font-medium" : lunar.badgeKind === "term" ? "text-success" : "text-muted",
                      )}
                      title={lunar.festival ?? lunar.solarTerm ?? `${lunar.lunar.monthCn}${lunar.lunar.dayCn}`}
                    >
                      {lunar.badge}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex flex-col gap-0.5 min-h-0 overflow-hidden">
                {dayExt.map((ev) => (
                  <div
                    key={ev.id}
                    title={`${ev.title}（外部日历）`}
                    className="h-[16px] rounded-md px-1 text-2xs leading-4 truncate readonly-hatch bg-surface-2 text-muted border border-border/50"
                  >
                    {ev.title}
                  </div>
                ))}
                {shown.map((t) => (
                  <TodoBar key={t.id} todo={t} color={todoColor(t, calendars)} dense />
                ))}
                {extra > 0 && (
                  <button
                    className="text-2xs text-muted hover:text-primary text-left pl-1 transition-colors"
                    onClick={() => {
                      useUi.getState().setSelectedDate(day.toISOString());
                      useUi.getState().setCursor(day.toISOString());
                      useUi.getState().setView("day");
                    }}
                  >
                    +{extra}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function monthTodoCount(todos: Todo[], day: Date): number {
  return todos.filter((t) => isSameDay(parse(t.startAt) ?? new Date(0), day)).length;
}

export function MonthViewSkeleton() {
  return (
    <div className="h-full grid grid-cols-7 grid-rows-6 gap-1 p-1">
      {Array.from({ length: 42 }).map((_, i) => (
        <motion.div key={i} className="skeleton" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} />
      ))}
    </div>
  );
}