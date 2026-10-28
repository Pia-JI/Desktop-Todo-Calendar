/** UI 状态：展开/收缩、视图、抽屉、弹窗、通知中心、toast 等 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { dayKey } from "@/lib/date";
import { createKvStorage } from "@/lib/kvstorage";
import { uid } from "@/lib/util";
import { useMenu } from "@/store/menu";
import type { AppNotification, ViewMode } from "@/types";

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}

export interface DrawerState {
  open: boolean;
  todoId: string | null;
  /** 双击格子时预填的开始时间 */
  presetStart?: string;
  presetAllDay?: boolean;
  /** 抽屉滑入的起点（点击坐标） */
  origin?: { x: number; y: number };
}

export interface TodoDragState {
  id: string | null;
  hoverKey: string | null;
  active: boolean;
  moved: boolean;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  title: string;
  color: string;
  time: string;
}

export interface IslandAlert {
  todoId: string | null;
  title: string;
  body: string;
  startAt?: string | null;
  kind: AppNotification["kind"];
}

export interface UiState {
  expanded: boolean;
  compact: boolean;
  morphing: boolean;
  view: ViewMode;
  cursor: string; // ISO，当前视图锚点
  selectedDate: string; // ISO，日视图/侧栏选中
  /** 今天（yyyy-MM-dd）。跨天后由 useDayRollover 更新，视图据此重绘「今天」高亮 */
  todayKey: string;
  sidebarOpen: boolean;
  drawer: DrawerState;
  commandOpen: boolean;
  settingsOpen: boolean;
  settingsTab: string;
  statsOpen: boolean;
  recycleOpen: boolean;
  shortcutsOpen: boolean;
  diagnosticsOpen: boolean;
  holidaysOpen: boolean;
  locked: boolean;
  searchQuery: string;
  sortMode: "time" | "priority" | "created" | "smart";
  notifications: AppNotification[];
  notifOpen: boolean;
  toasts: Toast[];
  bellPulse: number;
  conflictIds: string[];
  booted: boolean;
  todoDrag: TodoDragState;
  islandAlert: IslandAlert | null;

  setExpanded: (v: boolean) => void;
  toggleExpanded: () => void;
  setCompact: (v: boolean) => void;
  setMorphing: (v: boolean) => void;
  setView: (v: ViewMode) => void;
  setCursor: (iso: string) => void;
  setSelectedDate: (iso: string) => void;
  /** 跨天同步：更新 todayKey，若视图仍停在旧的「今天」则一起前进到新的一天 */
  syncToday: (now?: Date) => void;
  toggleSidebar: () => void;
  openDrawer: (d: Partial<DrawerState>) => void;
  closeDrawer: () => void;
  setCommandOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean, tab?: string) => void;
  setStatsOpen: (v: boolean) => void;
  setRecycleOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setDiagnosticsOpen: (v: boolean) => void;
  setHolidaysOpen: (v: boolean) => void;
  setLocked: (v: boolean) => void;
  setSearch: (q: string) => void;
  setSort: (m: UiState["sortMode"]) => void;
  pushNotification: (n: Omit<AppNotification, "id" | "at" | "read">) => void;
  markNotificationsRead: () => void;
  clearNotifications: () => void;
  setNotifOpen: (v: boolean) => void;
  toast: (t: Omit<Toast, "id">) => string;
  dismissToast: (id: string) => void;
  pulseBell: () => void;
  flashConflict: (ids: string[]) => void;
  setBooted: (v: boolean) => void;
  beginTodoDrag: (id: string, x: number, y: number, meta?: { offsetX?: number; offsetY?: number; width?: number; title?: string; color?: string; time?: string }) => void;
  setTodoDragHover: (key: string | null) => void;
  consumeTodoDragClick: () => boolean;
  showIslandAlert: (a: IslandAlert) => void;
  dismissIslandAlert: () => void;
}

const nowIso = () => new Date().toISOString();
const nowDayKey = () => dayKey(new Date());

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      expanded: false,
      compact: false,
      morphing: false,
      view: "month",
      cursor: nowIso(),
      selectedDate: nowIso(),
      todayKey: nowDayKey(),
      sidebarOpen: true,
      drawer: { open: false, todoId: null },
      commandOpen: false,
      settingsOpen: false,
      settingsTab: "general",
      statsOpen: false,
      recycleOpen: false,
      shortcutsOpen: false,
      diagnosticsOpen: false,
      holidaysOpen: false,
      locked: false,
      searchQuery: "",
      sortMode: "smart",
      notifications: [],
      notifOpen: false,
      toasts: [],
      bellPulse: 0,
      conflictIds: [],
      booted: false,
      todoDrag: { id: null, hoverKey: null, active: false, moved: false, x: 0, y: 0, offsetX: 0, offsetY: 0, width: 0, title: "", color: "", time: "" },
      islandAlert: null,

      setExpanded: (v) => {
        if (get().expanded === v) return;
        useMenu.getState().close();
        set({
          expanded: v,
          morphing: true,
          ...(!v ? {
            drawer: { open: false, todoId: null },
            commandOpen: false,
            settingsOpen: false,
            statsOpen: false,
            recycleOpen: false,
            shortcutsOpen: false,
            diagnosticsOpen: false,
            holidaysOpen: false,
            notifOpen: false,
            islandAlert: null,
            toasts: [],
          } : { islandAlert: null }),
        });
      },
      toggleExpanded: () => get().setExpanded(!get().expanded),
      setCompact: (v) => set({ compact: v }),
      setMorphing: (v) => set({ morphing: v }),
      setView: (v) => set({ view: v }),
      setCursor: (iso) => set({ cursor: iso }),
      setSelectedDate: (iso) => set({ selectedDate: iso }),
      syncToday: (now = new Date()) => {
        const key = dayKey(now);
        const state = get();
        if (state.todayKey === key) return;
        const patch: Partial<UiState> = { todayKey: key };
        // 视图还停在旧的「今天」时跟着跨天；用户手动翻到别的日期则保持不动
        if (dayKey(new Date(state.cursor)) === state.todayKey) patch.cursor = now.toISOString();
        if (dayKey(new Date(state.selectedDate)) === state.todayKey) patch.selectedDate = now.toISOString();
        set(patch);
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      openDrawer: (d) => { get().setExpanded(true); set({ drawer: { open: true, todoId: null, ...d } }); },
      closeDrawer: () => set({ drawer: { open: false, todoId: null } }),
      setCommandOpen: (v) => { if (v) get().setExpanded(true); set({ commandOpen: v }); },
      setSettingsOpen: (v, tab) => { if (v) get().setExpanded(true); set({ settingsOpen: v, settingsTab: tab ?? get().settingsTab }); },
      setStatsOpen: (v) => { if (v) get().setExpanded(true); set({ statsOpen: v }); },
      setRecycleOpen: (v) => { if (v) get().setExpanded(true); set({ recycleOpen: v }); },
      setShortcutsOpen: (v) => { if (v) get().setExpanded(true); set({ shortcutsOpen: v }); },
      setDiagnosticsOpen: (v) => { if (v) get().setExpanded(true); set({ diagnosticsOpen: v }); },
      setHolidaysOpen: (v) => { if (v) get().setExpanded(true); set({ holidaysOpen: v }); },
      setLocked: (v) => set({ locked: v }),
      setSearch: (q) => set({ searchQuery: q }),
      setSort: (m) => set({ sortMode: m }),

      pushNotification: (n) => {
        set((s) => ({
          notifications: [
            { ...n, id: uid(), at: nowIso(), read: false },
            ...s.notifications,
          ].slice(0, 100),
          bellPulse: s.bellPulse + 1,
        }));
        if (!get().expanded && (n.kind === "due" || n.kind === "overdue")) {
          get().showIslandAlert({
            todoId: n.todoId ?? null,
            title: n.title,
            body: n.body,
            startAt: n.startAt ?? null,
            kind: n.kind,
          });
        } else if (n.kind === "due" || n.kind === "overdue") {
          get().toast({
            text: `${n.title} · ${n.body}`,
            kind: "warning",
            actionLabel: n.todoId ? "查看" : undefined,
            onAction: n.todoId ? () => get().openDrawer({ todoId: n.todoId }) : undefined,
          });
        }
      },
      markNotificationsRead: () =>
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      clearNotifications: () => set({ notifications: [] }),
      setNotifOpen: (v) => { if (v) get().setExpanded(true); set({ notifOpen: v }); },

      toast: (t) => {
        const id = uid();
        set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
        window.setTimeout(() => get().dismissToast(id), 5000);
        return id;
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      pulseBell: () => set((s) => ({ bellPulse: s.bellPulse + 1 })),
      flashConflict: (ids) => {
        set({ conflictIds: ids });
        window.setTimeout(() => set({ conflictIds: [] }), 1800);
      },
      setBooted: (v) => set({ booted: v }),
      beginTodoDrag: (id, x, y, meta) => {
        const startX = x;
        const startY = y;
        let live = {
          id,
          hoverKey: null as string | null,
          active: false,
          moved: false,
          x,
          y,
          offsetX: meta?.offsetX ?? 0,
          offsetY: meta?.offsetY ?? 0,
          width: meta?.width ?? 160,
          title: meta?.title ?? "",
          color: meta?.color ?? "",
          time: meta?.time ?? "",
        };
        set({ todoDrag: live });
        const onMove = (ev: PointerEvent) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!live.active && dx * dx + dy * dy < 36) {
            live = { ...live, x: ev.clientX, y: ev.clientY };
            return;
          }
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const cell = el?.closest("[data-drop-day]") as HTMLElement | null;
          const hoverKey = cell?.dataset.dropDay ?? null;
          live = {
            ...live,
            hoverKey,
            active: true,
            moved: true,
            x: ev.clientX,
            y: ev.clientY,
          };
          const prev = get().todoDrag;
          if (prev.hoverKey !== hoverKey || !prev.active || Math.abs(prev.x - live.x) > 1 || Math.abs(prev.y - live.y) > 1) {
            set({ todoDrag: live });
          }
        };
        const onUp = (ev: PointerEvent) => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const cell = el?.closest("[data-drop-day]") as HTMLElement | null;
          const dayIso = cell?.dataset.dropDay;
          set({
            todoDrag: {
              id: null,
              hoverKey: null,
              active: false,
              moved: live.moved,
              x: 0,
              y: 0,
              offsetX: 0,
              offsetY: 0,
              width: 0,
              title: "",
              color: "",
              time: "",
            },
          });
          if (live.moved && dayIso) {
            window.dispatchEvent(new CustomEvent("app://todo-drop", { detail: { id, day: dayIso } }));
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
      setTodoDragHover: (key) => set((s) => ({ todoDrag: { ...s.todoDrag, hoverKey: key } })),
      consumeTodoDragClick: () => {
        if (!get().todoDrag.moved) return false;
        set((s) => ({ todoDrag: { ...s.todoDrag, moved: false } }));
        return true;
      },
      showIslandAlert: (a) => {
        set({ islandAlert: a });
        window.setTimeout(() => {
          if (get().islandAlert === a) {
            get().dismissIslandAlert();
          }
        }, 8000);
      },
      dismissIslandAlert: () => set({ islandAlert: null }),
    }),
    {
      name: "ui",
      storage: createJSONStorage(() => createKvStorage("u")),
      partialize: (s) => ({
        view: s.view,
        sidebarOpen: s.sidebarOpen,
        sortMode: s.sortMode,
      }),
    },
  ),
);
