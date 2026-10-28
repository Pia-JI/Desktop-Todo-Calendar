/** 托盘联动：菜单动作分发 + 定时把「今日待办 / 专注状态」推给 Rust 重建托盘菜单 */

import { useEffect } from "react";
import { isSameDay } from "date-fns";
import { invoke, isTauri } from "@/lib/platform";
import { parse, timeLabel } from "@/lib/date";
import { debounce } from "@/lib/util";
import { focusLabel, useFocus } from "@/store/focus";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import type { TrayTodo } from "@/types";

async function refreshTray() {
  if (!isTauri()) return;
  const now = new Date();
  const todos = useTodos
    .getState()
    .todos.filter((t) => !t.deletedAt && parse(t.startAt) && isSameDay(parse(t.startAt)!, now))
    .sort((a, b) => (parse(a.startAt)?.getTime() ?? 0) - (parse(b.startAt)?.getTime() ?? 0))
    .slice(0, 5)
    .map<TrayTodo>((t) => ({
      id: t.id,
      title: t.title,
      time: t.allDay ? "全天" : timeLabel(parse(t.startAt)!),
      priority: t.priority,
      completed: t.completed,
    }));
  const focus = focusLabel(useFocus.getState()) || null;
  await invoke("refresh_tray", { todos, focus });
}

export function useTray() {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;

    const handle = (action: string, todoId?: string) => {
      const ui = useUi.getState();
      switch (action) {
        case "toggle":
          ui.toggleExpanded();
          break;
        case "expand":
          ui.setExpanded(true);
          break;
        case "collapse":
          ui.setExpanded(false);
          break;
        case "new":
          ui.setExpanded(true);
          ui.openDrawer({});
          break;
        case "today": {
          const iso = new Date().toISOString();
          ui.setCursor(iso);
          ui.setSelectedDate(iso);
          ui.setExpanded(true);
          break;
        }
        case "settings":
          ui.setExpanded(true);
          ui.setSettingsOpen(true);
          break;
        case "stats":
          ui.setExpanded(true);
          ui.setStatsOpen(true);
          break;
        case "diagnostics":
          ui.setExpanded(true);
          ui.setDiagnosticsOpen(true);
          break;
        case "open-todo":
          if (todoId) {
            ui.setExpanded(true);
            ui.openDrawer({ todoId });
          }
          break;
        case "focus-stop":
          useFocus.getState().stop(false);
          break;
        case "quit":
          void invoke("quit_app");
          break;
        default:
          break;
      }
    };

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ action: string; todoId?: string }>("app://tray", (e) =>
        handle(e.payload.action, e.payload.todoId),
      );
    })();

    const timer = window.setInterval(() => void refreshTray(), 20_000);
    void refreshTray();

    // 数据或专注状态变化后刷新托盘（防抖）
    const push = debounce(() => void refreshTray(), 600);
    const unsubTodos = useTodos.subscribe(push);
    const unsubFocus = useFocus.subscribe(push);

    return () => {
      unlisten?.();
      window.clearInterval(timer);
      unsubTodos();
      unsubFocus();
    };
  }, []);
}