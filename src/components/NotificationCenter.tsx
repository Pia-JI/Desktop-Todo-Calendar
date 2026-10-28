/** 应用内通知中心：承接系统通知的 Snooze / 完成 / 打开（Windows 无原生按钮回调的降级方案） */

import { AlarmClock, BellOff, Check, ExternalLink, Trash2 } from "lucide-react";
import { parse, relativeLabel, reminderClockLabel } from "@/lib/date";
import { stripTimePhrases } from "@/lib/nlp";
import { cn } from "@/lib/util";
import { Dialog } from "./Dialog";
import { useNotifications } from "@/hooks/useNotifications";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";

export function NotificationCenter() {
  const open = useUi((s) => s.notifOpen);
  const setNotifOpen = useUi((s) => s.setNotifOpen);
  const notifications = useUi((s) => s.notifications);
  const markRead = useUi((s) => s.markNotificationsRead);
  const clear = useUi((s) => s.clearNotifications);
  const { snooze, complete } = useNotifications();

  return (
    <Dialog open={open} onClose={() => setNotifOpen(false)} title="通知中心" side="right" width={400}>
      <div className="flex items-center justify-between pb-2">
        <span className="text-2xs text-muted">{notifications.length} 条记录</span>
        <div className="flex gap-1">
          <button className="btn-ghost h-6 text-2xs" onClick={markRead}>全部已读</button>
          <button className="btn-ghost h-6 text-2xs" onClick={clear}><Trash2 size={11} /> 清空</button>
        </div>
      </div>

      {notifications.length === 0 && (
        <div className="py-10 flex flex-col items-center gap-2 text-muted">
          <BellOff size={26} strokeWidth={1.4} className="opacity-40" />
          <p className="text-xs">暂无通知</p>
        </div>
      )}

      <div className="space-y-2">
        {notifications.map((n) => {
          const d = parse(n.at);
          const start = n.startAt ? parse(n.startAt) : null;
          const title = start ? `${reminderClockLabel(start)} ${stripTimePhrases(n.title)}` : n.title;
          return (
            <div
              key={n.id}
              className={cn(
                "rounded-lg border p-2 space-y-1.5 transition-colors",
                n.read ? "border-border/50 bg-surface/40" : "border-primary/40 bg-primary/5",
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    "mt-1 w-1.5 h-1.5 rounded-full shrink-0",
                    n.kind === "overdue" ? "bg-danger" : n.kind === "digest" ? "bg-success" : "bg-primary",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text truncate">{title}</div>
                  <div className="text-2xs text-muted truncate">{n.body}</div>
                  <div className="text-2xs text-muted/70 mt-0.5">
                    {d ? relativeLabel(d, new Date()).replace("后", "前").replace("前前", "前") : ""}
                  </div>
                </div>
              </div>
              {n.todoId && (
                <div className="flex gap-1 pl-3.5">
                  <button className="btn-ghost h-6 text-2xs" onClick={() => void snooze(n.todoId!, 5)}>
                    <AlarmClock size={11} /> 5分钟
                  </button>
                  <button className="btn-ghost h-6 text-2xs" onClick={() => void snooze(n.todoId!, 10)}>10分钟</button>
                  <button className="btn-ghost h-6 text-2xs" onClick={() => void snooze(n.todoId!, 30)}>30分钟</button>
                  <button className="btn-ghost h-6 text-2xs" onClick={() => void complete(n.todoId!)}>
                    <Check size={11} className="text-success" /> 完成
                  </button>
                  <button
                    className="btn-ghost h-6 text-2xs"
                    onClick={() => {
                      useUi.getState().openDrawer({ todoId: n.todoId! });
                      setNotifOpen(false);
                    }}
                  >
                    <ExternalLink size={11} /> 打开
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="pt-3 text-2xs text-muted/70">
        提示：Windows 系统通知不支持按钮回调，Snooze / 完成 / 打开 在此承接；macOS 原生通知按钮可用。
      </div>
    </Dialog>
  );
}

export function useTodosCount() {
  return useTodos((s) => s.todos.length);
}