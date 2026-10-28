/**
 * 通知：监听 Rust 侧到期扫描事件 + 应用内通知中心兜底 + 可选提示音。
 * Windows 上系统 toast 能否弹出只取决于 AppUserModelID 是否注册（不是「权限」），
 * 因此这里读 Rust 侧的真实状态（notification_status），并能发一条测试通知自检。
 * Windows 上系统通知不支持按钮回调，Snooze/完成/打开 统一由应用内通知中心承接。
 */

import { useCallback, useEffect, useState } from "react";
import { addMinutes } from "date-fns";
import { invoke, isTauri } from "@/lib/platform";
import { parse } from "@/lib/date";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import type { NotifyOutcome, NotifyStatus } from "@/types";
import type { ReminderPayload } from "./reminderTypes";

let audioCtx: AudioContext | null = null;

function beep() {
  if (!useSettings.getState().soundEnabled) return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx = audioCtx ?? new Ctor();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    /* 无声环境忽略 */
  }
}

export function useNotifications(listenEvents = false) {
  const booted = useUi((state) => state.booted);
  const loaded = useTodos((state) => state.loaded);
  const [permission, setPermission] = useState<string>("unknown");
  const [status, setStatus] = useState<NotifyStatus | null>(null);

  const refreshPermission = useCallback(async () => {
    if (!isTauri()) {
      setPermission("granted");
      setStatus(null);
      return;
    }
    try {
      const next = await invoke<NotifyStatus>("notification_status");
      setStatus(next ?? null);
      setPermission(next?.registered ? "granted" : "unregistered");
    } catch {
      setPermission("unknown");
    }
  }, []);

  /** 发一条测试通知：把 Rust 侧的真实结果反馈出来，方便判断到底是系统静默丢弃还是没发出去 */
  const sendTest = useCallback(async () => {
    if (!isTauri()) {
      useUi.getState().toast({ text: "系统通知仅在桌面端可用", kind: "warning" });
      return null;
    }
    try {
      const outcome = await invoke<NotifyOutcome>("notification_test");
      if (outcome?.ok) {
        useUi.getState().toast({
          text: "已发送测试通知；若没看到，请检查系统「通知 → 勿扰/专注助手」是否拦掉了",
          kind: "success",
        });
      } else {
        useUi.getState().toast({
          text: `系统通知发送失败：${outcome?.error ?? "未知错误"}`,
          kind: "danger",
        });
      }
      await refreshPermission();
      return outcome ?? null;
    } catch (error) {
      useUi.getState().toast({ text: `系统通知发送失败：${String(error)}`, kind: "danger" });
      return null;
    }
  }, [refreshPermission]);

  const requestPermission = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const mod = await import("@tauri-apps/plugin-notification");
      const res = await mod.requestPermission();
      setPermission(res);
      if (res !== "granted") {
        useUi.getState().toast({
          text: "系统通知权限未开启：请到 系统设置 → 通知 中允许本应用，应用内通知中心仍会正常提醒。",
          kind: "warning",
        });
      }
    } catch {
      setPermission("unknown");
    }
  }, []);

  useEffect(() => {
    void refreshPermission();
    if (!isTauri() || !listenEvents || !booted || !loaded) return;

    let cancelled = false;
    let unlisten1: (() => void) | undefined;
    let unlisten2: (() => void) | undefined;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten1 = await listen<ReminderPayload>("app://reminder-fired", (e) => {
        const p = e.payload;
        if (cancelled) return;
        useTodos.setState((state) => ({ todos: state.todos.map((todo) =>
          todo.id === p.id && todo.startAt === p.startAt
            ? { ...todo, remindSentCount: p.sentCount, lastRemindedAt: p.remindedAt }
            : todo) }));
        const ui = useUi.getState();
        ui.pushNotification({
          todoId: p.id,
          title: p.title,
          body: p.body,
          startAt: p.startAt,
          kind: p.kind === "overdue" ? "overdue" : "due",
        });
        beep();
      });
      unlisten2 = await listen<{ total: number; p1: number }>("app://digest", (e) => {
        if (cancelled) return;
        useUi.getState().pushNotification({
          title: "每日晨报",
          body: `今天有 ${e.payload.total} 件事，其中 P1 有 ${e.payload.p1} 件`,
          kind: "digest",
        });
        beep();
      });
      if (cancelled) {
        unlisten1?.();
        unlisten2?.();
      } else {
        await invoke("reminders_ready");
      }
    })();

    return () => {
      cancelled = true;
      unlisten1?.();
      unlisten2?.();
    };
  }, [refreshPermission, listenEvents, booted, loaded]);

  /** Snooze：把 snoozeUntil 推到 n 分钟后，并重置已提醒计数 */
  const snooze = useCallback(async (todoId: string, minutes: number) => {
    const todo = useTodos.getState().todos.find((t) => t.id === todoId);
    if (!todo) return;
    const base = parse(todo.snoozeUntil ?? null) ?? new Date();
    const until = addMinutes(new Date(Math.max(base.getTime(), Date.now())), minutes);
    await useTodos.getState().updateTodo(todoId, {
      snoozeUntil: until.toISOString(),
      remindSentCount: 0,
      lastRemindedAt: null,
    });
    useUi.getState().toast({ text: `已稍后 ${minutes} 分钟提醒`, kind: "info" });
  }, []);

  const complete = useCallback(async (todoId: string) => {
    await useTodos.getState().toggleComplete(todoId);
  }, []);

  return { permission, status, requestPermission, refreshPermission, sendTest, snooze, complete };
}
