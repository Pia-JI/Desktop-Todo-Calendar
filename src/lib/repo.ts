/**
 * 仓储层：把领域模型 <-> SQLite 行做映射，并向 store 暴露语义化方法。
 * 所有写操作都是「先落库、再更新内存」，失败时抛出交由 store 做乐观回滚。
 */

import { getRepo, type Row } from "./db";
import {
  CALENDAR_BOOLS,
  EXTERNAL_BOOLS,
  SESSION_BOOLS,
  SUBTASK_BOOLS,
  TODO_BOOLS,
  hydrate,
  toRow,
} from "./case";
import { nowIso, uid } from "./util";
import type {
  CalendarCategory,
  DbSnapshot,
  ExternalEvent,
  HolidayEntry,
  PomodoroSession,
  Subtask,
  Todo,
} from "@/types";

const SEED_TS = "2024-01-01T00:00:00.000Z";

export const DEFAULT_CALENDARS: CalendarCategory[] = [
  { id: "cal-work", name: "工作", color: "#4F6EF7", visible: true, source: "local", readonly: false, sortOrder: 0, createdAt: SEED_TS, updatedAt: SEED_TS },
  { id: "cal-personal", name: "个人", color: "#22C55E", visible: true, source: "local", readonly: false, sortOrder: 1, createdAt: SEED_TS, updatedAt: SEED_TS },
  { id: "cal-family", name: "家庭", color: "#F59E0B", visible: true, source: "local", readonly: false, sortOrder: 2, createdAt: SEED_TS, updatedAt: SEED_TS },
  {
    id: "cal-external",
    name: "外部日历（只读）",
    color: "#9AA0B0",
    visible: true,
    source: "ics",
    readonly: true,
    sortOrder: 90,
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  },
];

export async function loadSnapshot(): Promise<DbSnapshot> {
  const repo = await getRepo();
  const [todoRows, subRows, calRows, extRows, holRows, sesRows] = await Promise.all([
    repo.all("todos"),
    repo.all("subtasks"),
    repo.all("calendars"),
    repo.all("external_events"),
    repo.all("holidays"),
    repo.all("pomodoro_sessions"),
  ]);

  const calendars = calRows.map((r) => hydrate<CalendarCategory>(r, CALENDAR_BOOLS));
  if (calendars.length === 0) {
    const seeded = DEFAULT_CALENDARS.map((c) => withStamps(c));
    await repo.upsertMany("calendars", seeded.map((c) => toRow(c)));
    calendars.push(...seeded);
  }

  return {
    todos: todoRows.map((r) => hydrate<Todo>(r, TODO_BOOLS)),
    subtasks: subRows.map((r) => hydrate<Subtask>(r, SUBTASK_BOOLS)),
    calendars: calendars.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    externalEvents: extRows.map((r) => hydrate<ExternalEvent>(r, EXTERNAL_BOOLS)),
    holidays: holRows.map((r) => hydrate<HolidayEntry>(r)),
    sessions: sesRows.map((r) => hydrate<PomodoroSession>(r, SESSION_BOOLS)),
  };
}

function withStamps<T extends object>(o: T): T {
  const stamp = nowIso();
  return { ...o, createdAt: (o as Record<string, unknown>).createdAt ?? stamp, updatedAt: stamp } as T;
}

// ───────────── todos ─────────────

export async function saveTodo(todo: Todo): Promise<void> {
  const repo = await getRepo();
  await repo.upsert("todos", toRow(todo));
}

export async function patchTodo(id: string, changes: Partial<Todo>): Promise<void> {
  const repo = await getRepo();
  await repo.patch("todos", id, toRow({ ...changes, updatedAt: nowIso() }));
}

export async function deleteTodo(id: string): Promise<void> {
  const repo = await getRepo();
  await repo.remove("todos", id);
}

export async function bulkSaveTodos(todos: Todo[]): Promise<void> {
  const repo = await getRepo();
  await repo.upsertMany("todos", todos.map((t) => toRow(t)));
}

// ───────────── subtasks ─────────────

export async function saveSubtask(s: Subtask): Promise<void> {
  const repo = await getRepo();
  await repo.upsert("subtasks", toRow(s));
}

export async function patchSubtask(id: string, changes: Partial<Subtask>): Promise<void> {
  const repo = await getRepo();
  await repo.patch("subtasks", id, { ...changes, updatedAt: nowIso() });
}

export async function deleteSubtask(id: string): Promise<void> {
  const repo = await getRepo();
  await repo.remove("subtasks", id);
}

// ───────────── calendars ─────────────

export async function saveCalendar(c: CalendarCategory): Promise<void> {
  const repo = await getRepo();
  await repo.upsert("calendars", toRow(withStamps(c)));
}

export async function deleteCalendar(id: string): Promise<void> {
  const repo = await getRepo();
  await repo.remove("calendars", id);
}

// ───────────── external events（只读外部日历） ─────────────

export async function clearExternal(): Promise<void> {
  const repo = await getRepo();
  await repo.clear("external_events");
}

export async function loadExternal(): Promise<ExternalEvent[]> {
  const repo = await getRepo();
  const rows = await repo.all("external_events");
  return rows.map((r) => hydrate<ExternalEvent>(r, EXTERNAL_BOOLS));
}

// ───────────── pomodoro ─────────────

export async function saveSession(s: PomodoroSession): Promise<void> {
  const repo = await getRepo();
  await repo.upsert("pomodoro_sessions", toRow(s));
}

export async function loadSessions(): Promise<PomodoroSession[]> {
  const repo = await getRepo();
  const rows = await repo.all("pomodoro_sessions");
  return rows.map((r) => hydrate<PomodoroSession>(r, SESSION_BOOLS));
}

// ───────────── holidays（用户手动修正） ─────────────

export async function saveHoliday(h: HolidayEntry): Promise<void> {
  const repo = await getRepo();
  const row = toRow(h);
  await repo.exec(
    `INSERT INTO holidays(date, name, type) VALUES($1,$2,$3)
     ON CONFLICT(date) DO UPDATE SET name = excluded.name, type = excluded.type`,
    [row.date, row.name, row.type],
  ).catch(async () => {
    // 内存预览模式没有 exec：退化为主键 upsert
    await repo.upsert("holidays", { ...row, id: row.date });
  });
}

export async function deleteHoliday(date: string): Promise<void> {
  const repo = await getRepo();
  await repo.remove("holidays", date);
}

// ───────────── command history（最近使用排序） ─────────────

export async function bumpCommandHistory(commandId: string): Promise<void> {
  const repo = await getRepo();
  await repo
    .exec(
      `INSERT INTO command_history(command_id, hits, used_at) VALUES($1, 1, $2)
       ON CONFLICT(command_id) DO UPDATE SET hits = command_history.hits + 1, used_at = excluded.used_at`,
      [commandId, nowIso()],
    )
    .catch(() => undefined);
}

export async function loadCommandHistory(): Promise<Record<string, number>> {
  const repo = await getRepo();
  const rows: Row[] = await repo.all("command_history").catch(() => []);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.command_id)] = Number(r.hits ?? 0);
  return out;
}

export function newId(): string {
  return uid();
}
