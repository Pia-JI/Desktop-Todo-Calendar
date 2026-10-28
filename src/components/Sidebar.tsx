/** 左侧可折叠边栏：迷你月历 + 今日入口 + 分类过滤（含未完成角标） */

import { BarChart3, CalendarDays, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { dayKey, parse } from "@/lib/date";
import { cn } from "@/lib/util";
import { MiniCalendar } from "./MiniCalendar";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";

export function Sidebar() {
  const calendars = useTodos((s) => s.calendars);
  const todos = useTodos((s) => s.todos);
  const updateCalendar = useTodos((s) => s.updateCalendar);
  const setRecycleOpen = useUi((s) => s.setRecycleOpen);
  const setStatsOpen = useUi((s) => s.setStatsOpen);
  const todayKey = useUi((s) => s.todayKey);

  const openCounts = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    for (const t of todos) {
      if (t.deletedAt || t.completed || t.parentId) continue;
      const key = t.calendarId ?? "none";
      map.set(key, (map.get(key) ?? 0) + 1);
      void now;
    }
    return map;
  }, [todos]);

  const todayCount = useMemo(
    () =>
      todos.filter((t) => {
        if (t.deletedAt || t.completed || t.parentId) return false;
        const d = parse(t.startAt);
        return d ? dayKey(d) === todayKey : false;
      }).length,
    [todos, todayKey],
  );

  return (
    <aside className="w-[180px] shrink-0 border-r border-border/60 p-2 flex flex-col gap-3 overflow-y-auto scroll-thin">
      <MiniCalendar />

      <button
        onClick={() => {
          const iso = new Date().toISOString();
          useUi.getState().setCursor(iso);
          useUi.getState().setSelectedDate(iso);
        }}
        className="btn-ghost w-full justify-start h-7 text-xs"
      >
        <CalendarDays size={13} className="text-primary" />
        今日
        <span className="ml-auto text-2xs text-muted tabular-nums">{todayCount}</span>
      </button>

      <div>
        <div className="text-2xs font-semibold text-muted px-1 pb-1">日历分类</div>
        <div className="space-y-0.5">
          {calendars.map((c) => (
            <label
              key={c.id}
              className={cn(
                "flex items-center gap-2 px-1.5 h-7 rounded-md cursor-pointer transition-colors hover:bg-surface-2",
                !c.visible && "opacity-50",
              )}
            >
              <input
                type="checkbox"
                checked={c.visible}
                onChange={() => void updateCalendar(c.id, { visible: !c.visible })}
                className="w-3 h-3 accent-[rgb(var(--c-primary))]"
              />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
              <span className="text-xs text-text truncate flex-1">{c.name}</span>
              {c.readonly && <span className="text-2xs text-muted">只读</span>}
              <span className="text-2xs text-muted tabular-nums">{openCounts.get(c.id) ?? 0}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-auto space-y-0.5">
        <button onClick={() => setStatsOpen(true)} className="btn-ghost w-full justify-start h-7 text-xs">
          <BarChart3 size={13} />
          统计
        </button>
        <button onClick={() => setRecycleOpen(true)} className="btn-ghost w-full justify-start h-7 text-xs">
          <Trash2 size={13} />
          回收站
        </button>
      </div>
    </aside>
  );
}