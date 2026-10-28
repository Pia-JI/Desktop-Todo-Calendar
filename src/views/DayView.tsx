/**
 * 日视图 / 今日时间轴：00:00-24:00 小时网格 + 当前时间红线 + 全天事项置顶横条。
 * 点击空白格快速新建；拖拽待办条下边缘 resize 结束时间（15 分钟吸附）。
 */

import { motion } from "framer-motion";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { addMinutes, isSameDay } from "date-fns";
import { DAY_END_HOUR, HOUR_HEIGHT, dayAt, dayKey, hourTicks, parse, slotGeometry, snapToStep } from "@/lib/date";
import { externalByDay, filterTodos, todoColor } from "@/lib/query";
import { useNow } from "@/hooks/useNow";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { TodoBar } from "@/components/TodoBar";
import type { Todo } from "@/types";

export function DayView() {
  const selectedDate = useUi((s) => s.selectedDate);
  const search = useUi((s) => s.searchQuery);
  const openDrawer = useUi((s) => s.openDrawer);
  const todos = useTodos((s) => s.todos);
  const calendars = useTodos((s) => s.calendars);
  const external = useTodos((s) => s.external);
  const hideCompleted = useSettings((s) => s.hideCompleted);
  const now = useNow(30_000);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [resize, setResize] = useState<{ id: string; end: Date } | null>(null);
  const resizeRef = useRef<{ id: string; startY: number; startEnd: Date } | null>(null);

  const day = useMemo(() => parse(selectedDate) ?? new Date(), [selectedDate]);
  const dayStart = useMemo(() => dayAt(day, 0), [day]);
  const list = useMemo(
    () => filterTodos(todos, calendars, search, hideCompleted).filter((t) => isSameDay(parse(t.startAt)!, day)),
    [todos, calendars, search, hideCompleted, day],
  );
  const allDay = list.filter((t) => t.allDay);
  const timed = list.filter((t) => !t.allDay);
  const isTodayView = isSameDay(day, now);

  // 外部日历（.ics 导入）只读事件：灰色斜纹条，用来避让已有会议
  const extList = useMemo(
    () => externalByDay(external, calendars).get(dayKey(day)) ?? [],
    [external, calendars, day],
  );
  const extAllDay = extList.filter((e) => e.allDay);
  const extTimed = extList.filter((e) => !e.allDay);

  const onResizeStart = (e: ReactPointerEvent, todo: Todo) => {
    const end = parse(todo.endAt) ?? addMinutes(parse(todo.startAt)!, 30);
    resizeRef.current = { id: todo.id, startY: e.clientY, startEnd: end };
    setResize({ id: todo.id, end });
    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const deltaMin = Math.round(((ev.clientY - r.startY) / HOUR_HEIGHT) * 60 / 15) * 15;
      const next = snapToStep(addMinutes(r.startEnd, deltaMin), 15);
      setResize({ id: r.id, end: next });
    };
    const onUp = () => {
      const r = resizeRef.current;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (r) {
        setResize((cur) => {
          if (cur && cur.id === r.id) {
            const start = parse(todos.find((t) => t.id === r.id)?.startAt ?? "");
            if (start && cur.end > start) void useTodos.getState().resizeEnd(r.id, cur.end);
          }
          return null;
        });
      }
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onGridClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetY = e.clientY - rect.top + (scrollerRef.current?.scrollTop ?? 0);
    const minutes = Math.floor(offsetY / HOUR_HEIGHT) * 60;
    const start = snapToStep(addMinutes(dayStart, minutes), 30);
    openDrawer({ presetStart: start.toISOString() });
  };

  const nowTop = isTodayView ? slotGeometry(now, now, dayStart).top : -1;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 全天事项横条区 */}
      {(allDay.length > 0 || extAllDay.length > 0) && (
        <div className="shrink-0 px-2 py-1 flex flex-wrap gap-1 border-b border-border/60">
          <span className="text-2xs text-muted self-center mr-1">全天</span>
          {extAllDay.map((ev) => (
            <div
              key={ev.id}
              title={`${ev.title}（外部日历）`}
              className="readonly-hatch h-[22px] w-[180px] shrink-0 truncate rounded-md border border-border/50 bg-surface-2 px-1.5 text-2xs leading-[22px] text-muted"
            >
              {ev.title}
            </div>
          ))}
          {allDay.map((t) => (
            <div key={t.id} className="w-[180px]">
              <TodoBar todo={t} color={todoColor(t, calendars)} showTime={false} />
            </div>
          ))}
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto scroll-thin relative">
        <div className="relative" style={{ height: DAY_END_HOUR * HOUR_HEIGHT }} onClick={onGridClick}>
          {/* 小时网格 */}
          {hourTicks().map((h) => (
            <div
              key={h}
              className="absolute inset-x-0 flex items-start"
              style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
            >
              <span className="w-12 shrink-0 text-right pr-2 text-2xs text-muted tabular-nums -translate-y-1.5">
                {String(h).padStart(2, "0")}:00
              </span>
              <div className="flex-1 border-t border-border/50" />
            </div>
          ))}

          {/* 当前时间红线 */}
          {nowTop >= 0 && (
            <div className="absolute left-12 right-0 z-10 pointer-events-none" style={{ top: nowTop }}>
              <div className="relative h-px bg-danger">
                <span className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-danger" />
              </div>
            </div>
          )}

          {/* 时间段事项 */}
          {extTimed.map((ev) => {
            const evStart = parse(ev.startAt);
            if (!evStart) return null;
            const evEnd = parse(ev.endAt ?? "") ?? addMinutes(evStart, 30);
            const geo = slotGeometry(evStart, evEnd, dayStart);
            return (
              <div
                key={ev.id}
                title={`${ev.title}（外部日历${ev.location ? ` · ${ev.location}` : ""}）`}
                className="readonly-hatch pointer-events-none absolute left-14 right-2 z-[5] overflow-hidden rounded-md border border-border/50 bg-surface-2 px-1.5 text-2xs leading-4 text-muted"
                style={{ top: geo.top, height: geo.height }}
              >
                <span className="block truncate">{ev.title}</span>
              </div>
            );
          })}

          {timed.map((t) => {
            const start = parse(t.startAt)!;
            const end = resize?.id === t.id ? resize.end : parse(t.endAt) ?? addMinutes(start, 30);
            const geo = slotGeometry(start, end, dayStart);
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute left-14 right-2 z-20"
                style={{ top: geo.top, height: geo.height }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-full flex flex-col justify-center px-1">
                  <TodoBar todo={t} color={todoColor(t, calendars)} onResizeStart={onResizeStart} />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
