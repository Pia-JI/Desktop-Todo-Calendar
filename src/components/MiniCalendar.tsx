/** 侧栏迷你月历：点击跳转，今日高亮，有点的日期加小圆点 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isSameDay } from "date-fns";
import { dayKey, monthMatrix, parse, WD_SHORT } from "@/lib/date";
import { cn } from "@/lib/util";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";

export function MiniCalendar() {
  const cursor = useUi((s) => s.cursor);
  const selectedDate = useUi((s) => s.selectedDate);
  const todayKey = useUi((s) => s.todayKey);
  const todos = useTodos((s) => s.todos);
  const [anchor, setAnchor] = useState(() => parse(cursor) ?? new Date());

  // 视图锚点跨月（含跨天自动前进）时迷你月历跟着翻页，否则「今天」会跑到看不见的月份
  useEffect(() => {
    const d = parse(cursor);
    if (!d) return;
    setAnchor((prev) =>
      prev.getFullYear() === d.getFullYear() && prev.getMonth() === d.getMonth() ? prev : d,
    );
  }, [cursor]);

  const cells = useMemo(() => monthMatrix(anchor), [anchor]);
  const dotDays = useMemo(() => {
    const set = new Set<string>();
    for (const t of todos) {
      if (t.deletedAt || t.completed) continue;
      const d = parse(t.startAt);
      if (d) set.add(dayKey(d));
    }
    return set;
  }, [todos]);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-2xs font-semibold text-text">{anchor.getFullYear()}年{anchor.getMonth() + 1}月</span>
        <div className="flex">
          <button className="icon-btn w-5 h-5" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} aria-label="上月">
            <ChevronLeft size={11} />
          </button>
          <button className="icon-btn w-5 h-5" onClick={() => setAnchor(new Date())} aria-label="今天">
            <span className="text-2xs">今</span>
          </button>
          <button className="icon-btn w-5 h-5" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} aria-label="下月">
            <ChevronRight size={11} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {WD_SHORT.map((w) => (
          <span key={w} className="text-center text-2xs text-muted/70">{w}</span>
        ))}
        {cells.map((d) => {
          const key = dayKey(d);
          const inMonth = d.getMonth() === anchor.getMonth();
          const isTodayKey = key === todayKey;
          return (
            <button
              key={key}
              onClick={() => {
                useUi.getState().setCursor(d.toISOString());
                useUi.getState().setSelectedDate(d.toISOString());
              }}
              className={cn(
                "relative h-6 rounded-md text-2xs tabular-nums flex items-center justify-center transition-colors",
                inMonth ? "text-text" : "text-muted/40",
                isSameDay(d, parse(selectedDate) ?? new Date()) && "bg-primary text-white",
                !isSameDay(d, parse(selectedDate) ?? new Date()) && "hover:bg-surface-2",
              )}
            >
              {d.getDate()}
              {dotDays.has(key) && !isTodayKey && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-primary/70" />
              )}
              {isTodayKey && !isSameDay(d, parse(selectedDate) ?? new Date()) && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-danger" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}