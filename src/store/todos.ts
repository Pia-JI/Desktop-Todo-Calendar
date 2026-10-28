/**
 * 待办 store：内存工作集 + SQLite 落库。
 * 所有变更「先写库、成功后更新内存」；失败回滚并 toast。
 * 破坏性操作（删除/清空）走软删除 + Undo toast，可跳过二次确认。
 */

import { create } from "zustand";
import { addDays, addMinutes } from "date-fns";
import * as repo from "@/lib/repo";
import { parse, overlaps } from "@/lib/date";
import { nowIso, uid } from "@/lib/util";
import { invoke } from "@/lib/platform";
import { useUi } from "./ui";
import { useSettings } from "./settings";
import type {
  CalendarCategory,
  ExternalEvent,
  HolidayEntry,
  PomodoroSession,
  Subtask,
  Todo,
} from "@/types";

interface UndoEntry {
  label: string;
  todos: Todo[];
}

interface TodosState {
  loaded: boolean;
  loading: boolean;
  todos: Todo[];
  subtasks: Subtask[];
  calendars: CalendarCategory[];
  external: ExternalEvent[];
  holidayOverrides: HolidayEntry[];
  sessions: PomodoroSession[];
  selected: string[];
  undoStack: UndoEntry[];

  load: () => Promise<void>;
  createTodo: (input: Partial<Todo> & { title: string }) => Promise<Todo>;
  updateTodo: (id: string, patch: Partial<Todo>, opts?: { undoLabel?: string }) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  moveTo: (id: string, start: Date, end?: Date | null) => Promise<void>;
  resizeEnd: (id: string, end: Date) => Promise<void>;
  postponeToTomorrow: (id: string) => Promise<void>;
  softDelete: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  purge: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  bulkComplete: (ids: string[], done: boolean) => Promise<void>;
  bulkDelete: (ids: string[]) => Promise<void>;
  bulkPostpone: (ids: string[]) => Promise<void>;
  setSelected: (ids: string[]) => void;
  toggleSelected: (id: string) => void;
  clearSelected: () => void;
  addSubtask: (todoId: string, title: string) => Promise<void>;
  toggleSubtask: (id: string) => Promise<void>;
  removeSubtask: (id: string) => Promise<void>;
  addCalendar: (name: string, color: string) => Promise<void>;
  updateCalendar: (id: string, patch: Partial<CalendarCategory>) => Promise<void>;
  removeCalendar: (id: string) => Promise<void>;
  addSession: (s: Omit<PomodoroSession, "id">) => Promise<void>;
  setHolidayOverride: (h: HolidayEntry) => Promise<void>;
  removeHolidayOverride: (date: string) => Promise<void>;
  undo: () => Promise<void>;
  refreshExternal: () => Promise<void>;
}

function stamp<T extends object>(o: T): T {
  return { ...o, updatedAt: nowIso() } as T;
}

/** 与外部只读日历 / 其它待办的时间冲突 */
export function findConflicts(
  candidate: { startAt: string; endAt?: string | null; allDay: boolean; id?: string },
  todos: Todo[],
  external: ExternalEvent[],
): string[] {
  if (candidate.allDay) return [];
  const s = parse(candidate.startAt);
  const e = parse(candidate.endAt ?? null) ?? (s ? addMinutes(s, 30) : null);
  if (!s || !e) return [];
  const hits: string[] = [];
  for (const ev of external) {
    if (ev.allDay) continue;
    const es = parse(ev.startAt);
    const ee = parse(ev.endAt ?? null) ?? (es ? addMinutes(es, 30) : null);
    if (es && ee && overlaps(s, e, es, ee)) hits.push(ev.title);
  }
  for (const t of todos) {
    if (t.deletedAt || t.allDay || t.id === candidate.id) continue;
    const ts = parse(t.startAt);
    const te = parse(t.endAt ?? null) ?? (ts ? addMinutes(ts, 30) : null);
    if (ts && te && overlaps(s, e, ts, te)) hits.push(t.title);
  }
  return hits;
}

export const useTodos = create<TodosState>()((set, get) => {
  const ui = () => useUi.getState();

  const pushUndo = (entry: UndoEntry) =>
    set((s) => ({ undoStack: [...s.undoStack, entry].slice(-20) }));

  const fail = (msg: string) => {
    ui().toast({ text: msg, kind: "danger" });
  };

  return {
    loaded: false,
    loading: false,
    todos: [],
    subtasks: [],
    calendars: [],
    external: [],
    holidayOverrides: [],
    sessions: [],
    selected: [],
    undoStack: [],

    load: async () => {
      if (get().loading) return;
      set({ loading: true });
      try {
        const snap = await repo.loadSnapshot();
        set({
          todos: snap.todos,
          subtasks: snap.subtasks,
          calendars: snap.calendars,
          external: snap.externalEvents,
          holidayOverrides: snap.holidays,
          sessions: snap.sessions,
          loaded: true,
        });
      } catch (err) {
        console.error("[todos] 载入失败", err);
        fail("数据载入失败，请查看故障排查页");
      } finally {
        set({ loading: false });
      }
    },

    createTodo: async (input) => {
      const settings = useSettings.getState();
      const now = nowIso();
      const startAt = input.startAt ?? now;
      const todo: Todo = {
        id: uid(),
        title: input.title.trim(),
        startAt,
        endAt: input.endAt ?? null,
        allDay: input.allDay ?? false,
        priority: input.priority ?? 2,
        color: input.color ?? "#4F6EF7",
        completed: false,
        completedAt: null,
        repeat: input.repeat ?? "none",
        remindBeforeSec: input.remindBeforeSec ?? settings.defaultRemindSec,
        snoozeUntil: null,
        repeatRemindIntervalSec: settings.repeatRemindIntervalMin * 60,
        repeatRemindCount: settings.repeatRemindCount,
        remindSentCount: 0,
        lastRemindedAt: null,
        estimatedMin: input.estimatedMin ?? null,
        actualMin: 0,
        parentId: input.parentId ?? null,
        calendarId: input.calendarId ?? null,
        notes: input.notes ?? null,
        attachmentPath: input.attachmentPath ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      try {
        await repo.saveTodo(todo);
        set((s) => ({ todos: [...s.todos, todo] }));

        const conflicts = findConflicts(todo, get().todos, get().external);
        if (conflicts.length) {
          ui().flashConflict([todo.id]);
          ui().toast({ text: `与「${conflicts[0]}」时间冲突`, kind: "warning" });
        }
        return todo;
      } catch (err) {
        fail(`创建失败: ${String(err)}`);
        throw err;
      }
    },

    updateTodo: async (id, patch, opts) => {
      const prev = get().todos.find((t) => t.id === id);
      if (!prev) return;
      const rescheduled = (patch.startAt !== undefined && patch.startAt !== prev.startAt) ||
        (patch.remindBeforeSec !== undefined && patch.remindBeforeSec !== prev.remindBeforeSec);
      const changes = rescheduled
        ? { ...patch, remindSentCount: 0, lastRemindedAt: null, snoozeUntil: null }
        : patch;
      const next = stamp({ ...prev, ...changes });
      if (opts?.undoLabel) pushUndo({ label: opts.undoLabel, todos: [{ ...prev }] });
      set((s) => ({ todos: s.todos.map((t) => (t.id === id ? next : t)) }));
      try {
        await repo.patchTodo(id, changes);
      } catch (err) {
        set((s) => ({ todos: s.todos.map((t) => (t.id === id ? prev : t)) }));
        fail(`保存失败: ${String(err)}`);
      }
    },

    toggleComplete: async (id) => {
      const prev = get().todos.find((t) => t.id === id);
      if (!prev) return;
      const done = !prev.completed;
      const next = stamp({
        ...prev,
        completed: done,
        completedAt: done ? nowIso() : null,
        snoozeUntil: null,
      });
      pushUndo({ label: done ? "撤销完成" : "撤销取消完成", todos: [{ ...prev }] });
      set((s) => ({ todos: s.todos.map((t) => (t.id === id ? next : t)) }));
      try {
        await repo.saveTodo(next);
        // 重复事项完成后自动生成下一条实例（Rust 侧）
        if (done && next.repeat !== "none") {
          const spawned = await invoke<string | null>("spawn_next_occurrence", { id });
          if (spawned) await get().load();
        }
      } catch (err) {
        set((s) => ({ todos: s.todos.map((t) => (t.id === id ? prev : t)) }));
        fail(`更新失败: ${String(err)}`);
      }
    },

    moveTo: async (id, start, end) => {
      const prev = get().todos.find((t) => t.id === id);
      if (!prev) return;
      const next = stamp({
        ...prev,
        startAt: start.toISOString(),
        endAt: end ? end.toISOString() : prev.endAt,
        remindSentCount: 0,
        lastRemindedAt: null,
        snoozeUntil: null,
      });
      pushUndo({ label: "撤销改期", todos: [{ ...prev }] });
      set((s) => ({ todos: s.todos.map((t) => (t.id === id ? next : t)) }));
      try {
        await repo.saveTodo(next);
        const conflicts = findConflicts(next, get().todos, get().external);
        if (conflicts.length) {
          ui().flashConflict([id]);
          ui().toast({ text: `与「${conflicts[0]}」时间冲突`, kind: "warning" });
        }
      } catch (err) {
        set((s) => ({ todos: s.todos.map((t) => (t.id === id ? prev : t)) }));
        fail(`改期失败: ${String(err)}`);
      }
    },

    resizeEnd: async (id, end) => {
      await get().updateTodo(id, { endAt: end.toISOString() }, { undoLabel: "撤销调整时长" });
    },

    postponeToTomorrow: async (id) => {
      const prev = get().todos.find((t) => t.id === id);
      if (!prev) return;
      const base = parse(prev.startAt) ?? new Date();
      const nextStart = addDays(base, 1);
      const nextEnd = prev.endAt ? addDays(parse(prev.endAt)!, 1) : null;
      await get().moveTo(id, nextStart, nextEnd);
      if (prev.completed) await get().updateTodo(id, { completed: false, completedAt: null });
      ui().toast({ text: "已推迟到明天同一时间", kind: "info" });
    },

    softDelete: async (id) => {
      const prev = get().todos.find((t) => t.id === id);
      if (!prev) return;
      const kids = get().todos.filter((t) => t.parentId === id);
      const affected = [prev, ...kids].map((t) => ({ ...t }));
      pushUndo({ label: "撤销删除", todos: affected });
      const next = stamp({ ...prev, deletedAt: nowIso() });
      set((s) => ({
        todos: s.todos.map((t) =>
          t.id === id ? next : t.parentId === id ? stamp({ ...t, deletedAt: next.deletedAt }) : t,
        ),
      }));
      try {
        await repo.saveTodo(next);
        for (const k of kids) await repo.saveTodo(stamp({ ...k, deletedAt: next.deletedAt }));
        ui().toast({
          text: "已移入回收站",
          kind: "info",
          actionLabel: "撤销",
          onAction: () => void get().undo(),
        });
      } catch (err) {
        fail(`删除失败: ${String(err)}`);
      }
    },

    restore: async (id) => {
      const prev = get().todos.find((t) => t.id === id);
      if (!prev) return;
      const next = stamp({ ...prev, deletedAt: null });
      set((s) => ({
        todos: s.todos.map((t) =>
          t.id === id ? next : t.parentId === id ? stamp({ ...t, deletedAt: null }) : t,
        ),
      }));
      await repo.saveTodo(next);
      for (const k of get().todos.filter((t) => t.parentId === id)) {
        await repo.saveTodo(stamp({ ...k, deletedAt: null }));
      }
    },

    purge: async (id) => {
      await repo.deleteTodo(id);
      set((s) => ({ todos: s.todos.filter((t) => t.id !== id && t.parentId !== id) }));
    },

    emptyTrash: async () => {
      const trashed = get().todos.filter((t) => t.deletedAt);
      for (const t of trashed) await repo.deleteTodo(t.id);
      set((s) => ({ todos: s.todos.filter((t) => !t.deletedAt) }));
      ui().toast({ text: `已清空回收站（${trashed.length} 项）`, kind: "info" });
    },

    bulkComplete: async (ids, done) => {
      const prev = get().todos.filter((t) => ids.includes(t.id)).map((t) => ({ ...t }));
      pushUndo({ label: "撤销批量操作", todos: prev });
      const next = prev.map((t) =>
        stamp({ ...t, completed: done, completedAt: done ? nowIso() : null }),
      );
      set((s) => ({ todos: s.todos.map((t) => (ids.includes(t.id) ? next.find((n) => n.id === t.id) ?? t : t)) }));
      await repo.bulkSaveTodos(next);
      set({ selected: [] });
    },

    bulkDelete: async (ids) => {
      const prev = get().todos.filter((t) => ids.includes(t.id)).map((t) => ({ ...t }));
      pushUndo({ label: "撤销批量删除", todos: prev });
      const next = prev.map((t) => stamp({ ...t, deletedAt: nowIso() }));
      set((s) => ({ todos: s.todos.map((t) => (ids.includes(t.id) ? next.find((n) => n.id === t.id) ?? t : t)) }));
      await repo.bulkSaveTodos(next);
      set({ selected: [] });
      ui().toast({ text: "已移入回收站", kind: "info", actionLabel: "撤销", onAction: () => void get().undo() });
    },

    bulkPostpone: async (ids) => {
      for (const id of ids) await get().postponeToTomorrow(id);
      set({ selected: [] });
    },

    setSelected: (ids) => set({ selected: ids }),
    toggleSelected: (id) =>
      set((s) => ({
        selected: s.selected.includes(id) ? s.selected.filter((x) => x !== id) : [...s.selected, id],
      })),
    clearSelected: () => set({ selected: [] }),

    addSubtask: async (todoId, title) => {
      const s: Subtask = {
        id: uid(),
        todoId,
        title,
        done: false,
        sortOrder: get().subtasks.filter((x) => x.todoId === todoId).length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await repo.saveSubtask(s);
      set((st) => ({ subtasks: [...st.subtasks, s] }));
    },

    toggleSubtask: async (id) => {
      const prev = get().subtasks.find((s) => s.id === id);
      if (!prev) return;
      const next = stamp({ ...prev, done: !prev.done });
      set((s) => ({ subtasks: s.subtasks.map((x) => (x.id === id ? next : x)) }));
      await repo.saveSubtask(next);
    },

    removeSubtask: async (id) => {
      await repo.deleteSubtask(id);
      set((s) => ({ subtasks: s.subtasks.filter((x) => x.id !== id) }));
    },

    addCalendar: async (name, color) => {
      const c: CalendarCategory = {
        id: uid(),
        name,
        color,
        visible: true,
        source: "local",
        readonly: false,
        sortOrder: get().calendars.length,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await repo.saveCalendar(c);
      set((s) => ({ calendars: [...s.calendars, c] }));
    },

    updateCalendar: async (id, patch) => {
      const prev = get().calendars.find((c) => c.id === id);
      if (!prev) return;
      const next = stamp({ ...prev, ...patch });
      set((s) => ({ calendars: s.calendars.map((c) => (c.id === id ? next : c)) }));
      await repo.saveCalendar(next);
    },

    removeCalendar: async (id) => {
      await repo.deleteCalendar(id);
      set((s) => ({
        calendars: s.calendars.filter((c) => c.id !== id),
        todos: s.todos.map((t) => (t.calendarId === id ? { ...t, calendarId: null } : t)),
      }));
    },

    addSession: async (s) => {
      const session: PomodoroSession = { ...s, id: uid() };
      await repo.saveSession(session);
      set((st) => ({ sessions: [...st.sessions, session] }));
      // 累加实际耗时到对应待办
      if (session.todoId && session.kind === "focus") {
        const todo = get().todos.find((t) => t.id === session.todoId);
        if (todo) {
          await get().updateTodo(todo.id, {
            actualMin: (todo.actualMin ?? 0) + Math.round(session.durationSec / 60),
          });
        }
      }
    },

    setHolidayOverride: async (h) => {
      await repo.saveHoliday(h);
      set((s) => ({
        holidayOverrides: [...s.holidayOverrides.filter((x) => x.date !== h.date), h],
      }));
    },

    removeHolidayOverride: async (date) => {
      await repo.deleteHoliday(date);
      set((s) => ({ holidayOverrides: s.holidayOverrides.filter((x) => x.date !== date) }));
    },

    undo: async () => {
      const entry = get().undoStack[get().undoStack.length - 1];
      if (!entry) return;
      set((s) => ({ undoStack: s.undoStack.slice(0, -1) }));
      for (const t of entry.todos) {
        set((s) => ({ todos: s.todos.map((x) => (x.id === t.id ? { ...t } : x)) }));
        await repo.saveTodo({ ...t });
      }
      ui().toast({ text: `已${entry.label.replace("撤销", "") || "撤销"}`, kind: "success" });
    },

    refreshExternal: async () => {
      const external = await repo.loadExternal();
      set({ external });
    },
  };
});
