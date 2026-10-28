/**
 * 收缩态 Dock：右下角圆角长条。
 * 三种显示模式（设置可切）：① 日期+下一条 ② 下一条倒计时 ③ 仅图标。
 * 拖拽移动（位置持久化）、双击展开、右键菜单、过期未读红点呼吸。
 */

import { CalendarDays, ChevronUp, ListTodo, Settings, Plus, LogOut, BellRing } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { isSameDay } from "date-fns";
import { invoke, isTauri } from "@/lib/platform";
import { dockEventLabel, fmt, parse, reminderClockLabel } from "@/lib/date";
import { stripTimePhrases } from "@/lib/nlp";
import { cn, debounce, truncate } from "@/lib/util";
import { getRect, saveWindowState, startDrag } from "@/lib/window";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { useMenu } from "@/store/menu";
import { useNow } from "@/hooks/useNow";
import { useWindowFocus } from "@/hooks/useWindowFocus";

export function Dock() {
  const focused = useWindowFocus();
  const now = useNow(15_000);
  const island = useUi((s) => s.islandAlert);
  const dockMode = useSettings((s) => s.dockMode);
  const expanded = useUi((s) => s.expanded);
  const setExpanded = useUi((s) => s.setExpanded);
  const openDrawer = useUi((s) => s.openDrawer);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const todos = useTodos((s) => s.todos);
  const openMenu = useMenu((s) => s.openMenu);
  const dragging = useRef(false);

  const { next, overdueCount } = useMemo(() => {
    const live = todos.filter((t) => !t.deletedAt && !t.parentId);
    const nowMs = now.getTime();
    const upcoming = live
      .filter((t) => !t.completed && parse(t.startAt) && parse(t.startAt)!.getTime() >= nowMs)
      .sort((a, b) => parse(a.startAt)!.getTime() - parse(b.startAt)!.getTime());
    const overdue = live.filter(
      (t) =>
        !t.completed &&
        parse(t.startAt) &&
        parse(t.startAt)!.getTime() < nowMs &&
        (!t.snoozeUntil || parse(t.snoozeUntil)!.getTime() <= nowMs),
    );
    return { next: upcoming[0] ?? overdue[0] ?? null, overdueCount: overdue.length };
  }, [todos, now]);

  // 拖拽结束后持久化位置
  useEffect(() => {
    if (!isTauri()) return;
    const persist = debounce(() => {
      void (async () => {
        const r = await getRect();
        if (r) await saveWindowState(r, useUi.getState().expanded);
      })();
    }, 300);
    let un: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      un = await getCurrentWindow().onMoved(() => {
        if (dragging.current) persist();
      });
    })();
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", up);
    return () => {
      un?.();
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      void startDrag();
    },
    [],
  );

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [
        { label: expanded ? "收起为长条" : "展开面板", icon: ChevronUp, onClick: () => setExpanded(!expanded) },
        { label: "新建待办", icon: Plus, onClick: () => { setExpanded(true); openDrawer({}); } },
        {
          label: "回到今日",
          icon: CalendarDays,
          onClick: () => {
            const iso = new Date().toISOString();
            useUi.getState().setCursor(iso);
            useUi.getState().setSelectedDate(iso);
            setExpanded(true);
          },
        },
        { label: "设置", icon: Settings, onClick: () => { setExpanded(true); setSettingsOpen(true); } },
        { separator: true },
        { label: "退出", icon: LogOut, danger: true, onClick: () => void invoke("quit_app") },
      ]);
    },
    [expanded, openDrawer, openMenu, setExpanded, setSettingsOpen],
  );

  const dateText = fmt(now, "M月d日 EEE");
  const nextStart = next ? parse(next.startAt) : null;
  const nextTitle = next ? truncate(stripTimePhrases(next.title), 12) : "";
  const nextText = next && nextStart
    ? `${dockEventLabel(nextStart, now)} ${nextTitle}`
    : "今天没有待办";
  const islandStart = island?.startAt ? parse(island.startAt) : null;
  const islandTitle = island ? stripTimePhrases(island.title) || island.title : "";
  const islandTime = islandStart ? reminderClockLabel(islandStart, now) : island?.body ?? "";

  return (
    <div className="w-full h-full select-none">
      <div
        onPointerDown={onPointerDown}
        onDoubleClick={() => setExpanded(true)}
        onContextMenu={onContextMenu}
        className={cn(
          "group relative isolate h-full w-full liquid-glass border border-white/35 rounded-[14px]",
          focused && "dock-focused",
          "flex items-center gap-2 px-3 cursor-grab active:cursor-grabbing overflow-hidden",
        )}
      >
        {/* 过期未读红点 + 呼吸 */}
        {overdueCount > 0 && (
          <span className="absolute right-2 top-2 z-10 w-2 h-2 rounded-full bg-danger animate-breathe" />
        )}

        {island ? (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (island.todoId) {
                setExpanded(true);
                openDrawer({ todoId: island.todoId });
              }
              useUi.getState().dismissIslandAlert();
            }}
            className="relative z-10 flex items-center gap-2.5 w-full min-w-0 text-left rounded-lg transition-transform active:scale-[0.98]"
            aria-live="assertive"
            aria-atomic="true"
            title={islandTitle}
          >
            <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-danger/15 text-danger shrink-0">
              <BellRing size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-[18px] font-bold text-text line-clamp-2 break-words">{islandTitle || island.body}</span>
              <span className="block mt-1 text-[10px] dock-sub truncate">
                <span className="text-danger font-semibold">{island.kind === "overdue" ? "已逾期" : "待办提醒"}</span>
                {islandTime && ` · ${islandTime}`}
              </span>
            </span>
          </button>
        ) : dockMode === "icon" ? (
          <div className="relative z-10 flex items-center gap-2 w-full justify-center">
            <ListTodo size={16} className="text-primary" />
            {overdueCount > 0 && <BellRing size={13} className="text-danger" />}
          </div>
        ) : (
          <div className="relative z-10 flex items-center gap-2 min-w-0 flex-1">
            <CalendarDays size={15} className="text-primary shrink-0" />
            {dockMode === "dateNext" && (
              <span className="text-[11px] font-semibold text-text shrink-0 tabular-nums">{dateText}</span>
            )}
            <span className="h-3 w-px bg-text/15 shrink-0" />
            <span className="text-[11px] font-medium dock-sub truncate flex-1">{nextText}</span>
          </div>
        )}

        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setExpanded(!expanded)}
          className="relative z-10 icon-btn w-6 h-6 shrink-0 dock-sub"
          aria-label={expanded ? "收起" : "展开"}
        >
          <span className={cn("flex transition-transform duration-200", expanded && "rotate-180")}>
            <ChevronUp size={14} />
          </span>
        </button>
      </div>
    </div>
  );
}

/** 判断某待办是否属于「今天」，供 Dock 文案复用 */
export function isTodayTodo(startAt: string, now: Date): boolean {
  const d = parse(startAt);
  return d ? isSameDay(d, now) : false;
}
