/**
 * 番茄钟 / 专注计时：store 只保存状态，计时由 hooks/usePomodoro 的 interval 驱动。
 * 结束后把 session 落库并累加到待办的 actualMin。
 */

import { create } from "zustand";
import { useSettings } from "./settings";
import { useTodos } from "./todos";
import { useUi } from "./ui";

interface FocusState {
  running: boolean;
  isBreak: boolean;
  todoId: string | null;
  /** 本段结束的时间戳（ms） */
  endsAt: number | null;
  /** 本段总时长（秒） */
  totalSec: number;
  remainingSec: number;

  start: (todoId: string | null, minutes?: number) => void;
  startBreak: () => void;
  stop: (completed: boolean) => void;
  tick: () => void;
  reset: () => void;
}

export const useFocus = create<FocusState>()((set, get) => ({
  running: false,
  isBreak: false,
  todoId: null,
  endsAt: null,
  totalSec: 0,
  remainingSec: 0,

  start: (todoId, minutes) => {
    const mins = minutes ?? useSettings.getState().pomodoroFocusMin;
    const total = Math.max(1, mins) * 60;
    set({
      running: true,
      isBreak: false,
      todoId,
      endsAt: Date.now() + total * 1000,
      totalSec: total,
      remainingSec: total,
    });
  },

  startBreak: () => {
    const mins = useSettings.getState().pomodoroBreakMin;
    const total = Math.max(1, mins) * 60;
    set({
      running: true,
      isBreak: true,
      endsAt: Date.now() + total * 1000,
      totalSec: total,
      remainingSec: total,
    });
  },

  stop: (completed) => {
    const { running, isBreak, todoId, totalSec, remainingSec } = get();
    if (!running) return;
    const elapsed = completed ? totalSec : Math.max(0, totalSec - remainingSec);
    set({ running: false, isBreak: false, endsAt: null, todoId: null, totalSec: 0, remainingSec: 0 });

    if (elapsed > 0) {
      void useTodos.getState().addSession({
        todoId: isBreak ? null : todoId,
        startedAt: new Date(Date.now() - elapsed * 1000).toISOString(),
        durationSec: elapsed,
        kind: isBreak ? "break" : "focus",
        completed,
      });
    }
    if (completed && !isBreak) {
      useUi.getState().toast({ text: "专注完成，休息一下吧 ☕", kind: "success" });
    }
  },

  tick: () => {
    const { endsAt } = get();
    if (!endsAt) return;
    const remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    set({ remainingSec: remaining });
    if (remaining <= 0) {
      const wasBreak = get().isBreak;
      get().stop(true);
      if (!wasBreak) get().startBreak();
    }
  },

  reset: () =>
    set({ running: false, isBreak: false, endsAt: null, todoId: null, totalSec: 0, remainingSec: 0 }),
}));

/** 供 Dock / 托盘展示的倒计时文本 */
export function focusLabel(s: Pick<FocusState, "running" | "remainingSec" | "isBreak">): string {
  if (!s.running) return "";
  const m = Math.floor(s.remainingSec / 60);
  const sec = s.remainingSec % 60;
  return `${s.isBreak ? "休息" : "专注"} ${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}