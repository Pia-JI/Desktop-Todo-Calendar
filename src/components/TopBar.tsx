/** 顶栏：月份/周/日切换、视图切换、搜索、主题、通知、命令面板、设置 */

import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Command,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { motion } from "framer-motion";
import { addDays } from "date-fns";
import { useMemo } from "react";
import { nextMonth, nextWeek, parse, prevMonth, prevWeek, rangeTitle } from "@/lib/date";
import { cn } from "@/lib/util";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import type { ViewMode } from "@/types";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "month", label: "月" },
  { id: "week", label: "周" },
  { id: "day", label: "日" },
  { id: "list", label: "列" },
];

export function TopBar() {
  const view = useUi((s) => s.view);
  const cursor = useUi((s) => s.cursor);
  const setView = useUi((s) => s.setView);
  const setCursor = useUi((s) => s.setCursor);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const search = useUi((s) => s.searchQuery);
  const setSearch = useUi((s) => s.setSearch);
  const setCommandOpen = useUi((s) => s.setCommandOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const setNotifOpen = useUi((s) => s.setNotifOpen);
  const notifications = useUi((s) => s.notifications);
  const bellPulse = useUi((s) => s.bellPulse);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.set);

  const anchor = useMemo(() => parse(cursor) ?? new Date(), [cursor]);
  const unread = notifications.filter((n) => !n.read).length;

  const step = (dir: 1 | -1) => {
    const d = anchor;
    if (view === "month") setCursor((dir === 1 ? nextMonth(d) : prevMonth(d)).toISOString());
    else if (view === "week") setCursor((dir === 1 ? nextWeek(d) : prevWeek(d)).toISOString());
    else if (view === "day") setCursor(addDays(d, dir).toISOString());
    else setCursor(addDays(d, dir * 7).toISOString());
  };

  const cycleTheme = () => {
    const order = ["system", "light", "dark"] as const;
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme({ theme: next });
  };

  return (
    // data-tauri-drag-region="deep"：无边框窗口靠它拖动整块顶栏；
    // 内部的 button/input 会被 Tauri 自动排除，不影响点击。
    <div data-tauri-drag-region="deep" className="shrink-0 h-12 px-2 flex items-center gap-1.5 border-b border-border/60">
      <button className="icon-btn" onClick={toggleSidebar} aria-label="切换边栏">
        {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
      </button>

      <div className="flex items-center gap-0.5 shrink-0">
        <button className="icon-btn w-6 h-6" onClick={() => step(-1)} aria-label="上一页">
          <ChevronLeft size={14} />
        </button>
        <button
          className="btn-ghost h-6 px-2 text-2xs"
          onClick={() => {
            const iso = new Date().toISOString();
            setCursor(iso);
            useUi.getState().setSelectedDate(iso);
          }}
        >
          今天
        </button>
        <button className="icon-btn w-6 h-6" onClick={() => step(1)} aria-label="下一页">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="view-tabs" role="group" aria-label="日历视图">
        <span className="view-tab-indicator" style={{ transform: `translateX(${VIEWS.findIndex((item) => item.id === view) * 28}px)` }} />
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            aria-pressed={view === v.id}
            aria-label={`${v.label}视图`}
            className={cn(
              "view-tab rounded-md text-2xs font-medium",
              view === v.id ? "text-primary" : "text-muted hover:text-text",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <h1 className="flex-1 min-w-0 text-sm font-semibold text-text px-1 truncate select-none" title={rangeTitle(view, anchor)}>{rangeTitle(view, anchor)}</h1>

      <div className="relative w-[130px] shrink-0 max-[680px]:hidden">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          id="topbar-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 / #分类 p:1 is:done"
          className="input h-7 pl-6 text-2xs"
        />
      </div>

      <button className="icon-btn" onClick={() => setCommandOpen(true)} title="命令面板 (Ctrl/Cmd+K)" aria-label="命令面板">
        <Command size={14} />
      </button>
      <button className="icon-btn" onClick={cycleTheme} title={`主题：${theme}`} aria-label="切换主题">
        {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
      </button>
      <button className="icon-btn relative" onClick={() => setNotifOpen(true)} aria-label="通知中心">
        <motion.span key={bellPulse} animate={bellPulse ? { rotate: [0, -12, 10, -6, 0] } : {}} className="flex">
          <Bell size={14} />
        </motion.span>
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-danger text-white text-2xs leading-[14px] text-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="设置">
        <Settings size={14} />
      </button>
    </div>
  );
}
