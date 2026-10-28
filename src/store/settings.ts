/**
 * 设置 store：持久化到 SQLite settings 表（通过 createKvStorage 按字段拆行），
 * 因此 Rust 后台任务可以直接读 s_digestEnabled / s_syncDir 等键。
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createKvStorage } from "@/lib/kvstorage";
import type { DockMode, ThemeMode } from "@/types";

export interface SettingsState {
  theme: ThemeMode;
  dockMode: DockMode;
  alwaysOnTop: boolean;
  autoCollapseOnBlur: boolean;
  hideCompleted: boolean;
  defaultRemindSec: number;
  repeatRemindIntervalMin: number;
  repeatRemindCount: number;
  soundEnabled: boolean;
  notifyEnabled: boolean;
  language: "zh" | "en";
  showLunar: boolean;
  digestEnabled: boolean;
  digestTime: string;
  weeklyReviewEnabled: boolean;
  workStart: string;
  workEnd: string;
  pomodoroFocusMin: number;
  pomodoroBreakMin: number;
  autoSnapshot: boolean;
  syncDir: string;
  updateCheckEnabled: boolean;
  lockEnabled: boolean;
  lockHash: string;
  set: (patch: Partial<Omit<SettingsState, "set" | "reset">>) => void;
  reset: () => void;
}

const DEFAULTS = {
  theme: "system" as ThemeMode,
  dockMode: "dateNext" as DockMode,
  alwaysOnTop: true,
  autoCollapseOnBlur: true,
  hideCompleted: false,
  defaultRemindSec: 900,
  repeatRemindIntervalMin: 10,
  repeatRemindCount: 2,
  soundEnabled: true,
  notifyEnabled: true,
  language: "zh" as const,
  showLunar: true,
  digestEnabled: false,
  digestTime: "08:00",
  weeklyReviewEnabled: true,
  workStart: "09:00",
  workEnd: "18:00",
  pomodoroFocusMin: 25,
  pomodoroBreakMin: 5,
  autoSnapshot: true,
  syncDir: "",
  updateCheckEnabled: false,
  lockEnabled: false,
  lockHash: "",
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "settings",
      storage: createJSONStorage(() => createKvStorage("s")),
      partialize: (s) => {
        const { set: _set, reset: _reset, ...rest } = s;
        void _set;
        void _reset;
        return rest as SettingsState;
      },
    },
  ),
);