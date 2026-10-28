/** 应用根：窗口形变 + 全局 hooks + 收缩/展开两态 + 全部弹层 */

import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { CommandPalette } from "@/components/CommandPalette";
import { ContextMenuHost } from "@/components/ContextMenu";
import { DiagnosticsView } from "@/components/DiagnosticsView";
import { Dock } from "@/components/Dock";
import { TodoDragGhost } from "@/components/TodoDragGhost";
import { HolidaysDialog } from "@/components/HolidaysDialog";
import { LockScreen } from "@/components/LockScreen";
import { NotificationCenter } from "@/components/NotificationCenter";
import { Panel } from "@/components/Panel";
import { RecycleBin } from "@/components/RecycleBin";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import { StatsView } from "@/components/StatsView";
import { Toasts } from "@/components/Toasts";
import { TodoDrawer } from "@/components/TodoDrawer";
import { WeeklyReview } from "@/components/WeeklyReview";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDayRollover } from "@/hooks/useDayRollover";
import { useMorphWindow } from "@/hooks/useMorphWindow";
import { useNotifications } from "@/hooks/useNotifications";
import { usePomodoro } from "@/hooks/usePomodoro";
import { useTheme } from "@/hooks/useTheme";
import { useTray } from "@/hooks/useTray";
import { dayKey, parse } from "@/lib/date";
import { cn } from "@/lib/util";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";

export default function App() {
  const expanded = useUi((s) => s.expanded);
  const booted = useUi((s) => s.booted);
  const morphing = useUi((s) => s.morphing);

  useTheme();
  useHotkeys();
  useDayRollover();
  useMorphWindow();
  useTray();
  useNotifications(true);
  usePomodoro();

  useEffect(() => {
    void useTodos.getState().load();
  }, []);

  useEffect(() => {
    const onDrop = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; day: string }>).detail;
      if (!detail?.id || !detail.day) return;
      const todo = useTodos.getState().todos.find((t) => t.id === detail.id);
      if (!todo || todo.deletedAt) return;
      const oldStart = parse(todo.startAt) ?? new Date();
      if (dayKey(oldStart) === detail.day) return;
      const next = parse(`${detail.day}T00:00:00`) ?? new Date(detail.day);
      next.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
      const delta = next.getTime() - oldStart.getTime();
      const nextEnd = todo.endAt ? new Date((parse(todo.endAt) ?? oldStart).getTime() + delta) : null;
      void useTodos.getState().moveTo(detail.id, next, nextEnd);
    };
    window.addEventListener("app://todo-drop", onDrop);
    return () => window.removeEventListener("app://todo-drop", onDrop);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
    <div className={cn(
      "w-screen h-screen overflow-hidden relative",
      !booted && "app-booting window-transitioning",
      morphing && "window-morphing",
    )}>
      <div className={cn("app-shell", expanded && "app-shell-inactive")} aria-hidden={expanded} inert={expanded || morphing}>
        <Dock />
      </div>
      <div className={cn("app-shell", !expanded && "app-shell-inactive")} aria-hidden={!expanded} inert={!expanded || morphing}>
        <Panel />
      </div>
      <TodoDragGhost />

      {booted && expanded && !morphing && (
        <>
          <TodoDrawer />
          <CommandPalette />
          <NotificationCenter />
          <SettingsDialog />
          <StatsView />
          <RecycleBin />
          <ShortcutsDialog />
          <DiagnosticsView />
          <HolidaysDialog />
          <WeeklyReview />
          <LockScreen />
        </>
      )}

      {expanded && !morphing && <Toasts />}
      {!morphing && <ContextMenuHost />}
    </div>
    </MotionConfig>
  );
}
