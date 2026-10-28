/** 命令面板 Ctrl/Cmd+K：模糊匹配命令 + 搜索事项 + 跳转日期，最近使用优先 */

import {
  CalendarDays,
  Download,
  Moon,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fuzzyScore } from "@/lib/fuzzy";
import { parse, fmt } from "@/lib/date";
import { cn } from "@/lib/util";
import { invoke } from "@/lib/platform";
import * as repo from "@/lib/repo";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import type { CommandEntry } from "@/types";

export function CommandPalette() {
  const open = useUi((s) => s.commandOpen);
  const setOpen = useUi((s) => s.setCommandOpen);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Record<string, number>>({});
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 关闭时保留 110ms 播放退场动画。入场/退场全部交给 CSS 动画（合成层），
  // 不再用 framer 逐帧写内联样式：透明窗口 + 亚克力背景下，整窗半透明遮罩逐帧
  // 改 opacity 会让 DWM 每帧重组整块窗口，表现为「界面闪烁」。
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 110);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      void repo.loadCommandHistory().then(setHistory);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const commands = useMemo<CommandEntry[]>(() => {
    const ui = useUi.getState();
    const theme = useSettings.getState().theme;
    return [
      { id: "view.month", title: "切换到月视图", section: "视图", icon: "month", run: () => ui.setView("month") },
      { id: "view.week", title: "切换到周视图", section: "视图", run: () => ui.setView("week") },
      { id: "view.day", title: "切换到日视图", section: "视图", run: () => ui.setView("day") },
      { id: "view.list", title: "切换到列表视图", section: "视图", run: () => ui.setView("list") },
      { id: "nav.today", title: "回到今天", section: "导航", run: () => { const iso = new Date().toISOString(); ui.setCursor(iso); ui.setSelectedDate(iso); } },
      { id: "todo.new", title: "新建待办", section: "待办", run: () => ui.openDrawer({}) },
      { id: "ui.collapse", title: "收起为长条", section: "窗口", run: () => ui.setExpanded(false) },
      { id: "theme.toggle", title: `切换主题（当前 ${theme}）`, section: "外观", run: () => { const order = ["system", "light", "dark"] as const; useSettings.getState().set({ theme: order[(order.indexOf(theme) + 1) % 3] }); } },
      { id: "open.settings", title: "打开设置", section: "应用", run: () => ui.setSettingsOpen(true) },
      { id: "open.stats", title: "打开统计", section: "应用", run: () => ui.setStatsOpen(true) },
      { id: "open.recycle", title: "打开回收站", section: "应用", run: () => ui.setRecycleOpen(true) },
      { id: "open.shortcuts", title: "快捷键总览", section: "应用", run: () => ui.setShortcutsOpen(true) },
      { id: "open.diag", title: "故障排查", section: "应用", run: () => ui.setDiagnosticsOpen(true) },
      { id: "open.holidays", title: "节假日修正", section: "应用", run: () => ui.setHolidaysOpen(true) },
      { id: "export.ics", title: "导出 .ics", section: "数据", run: async () => { const content = await invoke<string>("get_ics_content"); void navigator.clipboard?.writeText(content ?? ""); ui.toast({ text: "ICS 内容已复制（或到设置页选择文件导出）", kind: "success" }); } },
      { id: "backup.now", title: "立即创建备份快照", section: "数据", run: async () => { const p = await invoke<string>("snapshot_now"); ui.toast({ text: `快照已生成：${p}`, kind: "success" }); } },
    ];
  }, [open]);

  const todoResults = useMemo(() => {
    if (!query.trim()) return [];
    return useTodos
      .getState()
      .todos.filter((t) => !t.deletedAt)
      .map((t) => ({ t, score: fuzzyScore(query, t.title) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [query]);

  const dateJump = useMemo(() => {
    if (!query.trim()) return null;
    const d = parse(query);
    if (d && /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(query.trim())) return d;
    return null;
  }, [query]);

  const items = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, score: fuzzyScore(query, c.title) + (history[c.id] ?? 0) * 2 }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.c);
  }, [commands, query, history]);

  const total = items.length + todoResults.length + (dateJump ? 1 : 0);

  const runAt = (i: number) => {
    if (i < items.length) {
      const c = items[i];
      void repo.bumpCommandHistory(c.id);
      setOpen(false);
      void c.run();
      return;
    }
    let j = i - items.length;
    if (dateJump && j === 0) {
      setOpen(false);
      useUi.getState().setCursor(dateJump.toISOString());
      useUi.getState().setSelectedDate(dateJump.toISOString());
      return;
    }
    if (dateJump) j -= 1;
    const t = todoResults[j];
    if (t) {
      setOpen(false);
      useUi.getState().openDrawer({ todoId: t.t.id });
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(total - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); runAt(index); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const ICONS: Record<string, typeof Plus> = {
    视图: CalendarDays, 导航: CalendarDays, 待办: Plus, 窗口: PanelLeftClose,
    外观: Sun, 应用: Settings, 数据: Download,
  };

  let runningIdx = -1;

  if (!mounted) return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-[80]", open ? "palette-open" : "palette-closing")}>
      <div className="palette-backdrop absolute inset-0" onPointerDown={() => setOpen(false)} />
      <div className="palette-panel fixed z-[81] inset-x-0 top-[12%] mx-auto w-[440px] max-w-[92vw] sheet border border-border rounded-panel overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          placeholder="输入命令、事项或日期（2026-10-01）…"
          className="w-full h-11 px-3 bg-transparent outline-none text-sm text-text placeholder:text-muted/70 border-b border-border/60"
        />
        <div ref={listRef} className="max-h-[320px] overflow-y-auto scroll-thin py-1">
          {items.map((c) => {
            runningIdx += 1;
            const idx = runningIdx;
            const Icon = ICONS[c.section] ?? Pencil;
            return (
              <button
                key={c.id}
                data-idx={idx}
                onMouseEnter={() => setIndex(idx)}
                onClick={() => runAt(idx)}
                className={cn("w-full h-8 px-3 flex items-center gap-2 text-xs text-left transition-colors", idx === index ? "bg-primary/15 text-text" : "hover:bg-surface-2")}
              >
                <Icon size={13} className="text-muted shrink-0" />
                <span className="truncate flex-1">{c.title}</span>
                <span className="text-2xs text-muted/70">{c.section}</span>
              </button>
            );
          })}

          {dateJump && (
            <button
              data-idx={(runningIdx += 1)}
              onClick={() => runAt(runningIdx)}
              className={cn("w-full h-8 px-3 flex items-center gap-2 text-xs text-left", runningIdx === index ? "bg-primary/15" : "hover:bg-surface-2")}
            >
              <CalendarDays size={13} className="text-primary" />
              跳转到 {fmt(dateJump, "yyyy年M月d日")}
            </button>
          )}

          {todoResults.map((r) => {
            runningIdx += 1;
            const idx = runningIdx;
            return (
              <button
                key={r.t.id}
                data-idx={idx}
                onMouseEnter={() => setIndex(idx)}
                onClick={() => runAt(idx)}
                className={cn("w-full h-8 px-3 flex items-center gap-2 text-xs text-left", idx === index ? "bg-primary/15" : "hover:bg-surface-2")}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.t.color }} />
                <span className={cn("truncate flex-1", r.t.completed && "line-through opacity-60")}>{r.t.title}</span>
                <span className="text-2xs text-muted">{fmt(parse(r.t.startAt)!, "M-d HH:mm")}</span>
              </button>
            );
          })}

          {total === 0 && <div className="py-8 text-center text-xs text-muted">没有匹配项</div>}
        </div>
        <div className="h-7 px-3 flex items-center gap-3 text-2xs text-muted/70 border-t border-border/60">
          <span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span>
          <span className="ml-auto flex items-center gap-1"><Moon size={10} /> 支持模糊匹配与最近使用排序</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

