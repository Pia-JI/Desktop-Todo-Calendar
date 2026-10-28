/**
 * 存储层：Tauri 环境走 tauri-plugin-sql -> SQLite（Rust 侧建表迁移）；
 * 浏览器预览（pnpm dev 直接开 http://localhost:1420）走内存实现，
 * 保证 UI 开发/演示不依赖 Rust 工具链。生产构建始终是 SQLite，不使用 localStorage 存业务数据。
 */

import { isTauri } from "./platform";
import { assertIdent, toRow } from "./case";

export type Row = Record<string, unknown>;

export interface Repo {
  readonly kind: "sqlite" | "memory";
  all(table: string): Promise<Row[]>;
  upsert(table: string, row: Row): Promise<void>;
  upsertMany(table: string, rows: Row[]): Promise<void>;
  patch(table: string, id: string, changes: Row): Promise<void>;
  remove(table: string, id: string): Promise<void>;
  clear(table: string): Promise<void>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  kvGetAll(ns: string): Promise<Record<string, string>>;
  kvSet(ns: string, key: string, value: string): Promise<void>;
  kvDel(ns: string, key: string): Promise<void>;
}

const TABLES = new Set([
  "todos",
  "subtasks",
  "calendars",
  "holidays",
  "pomodoro_sessions",
  "external_events",
  "reminders_log",
  "app_state",
  "settings",
  "snapshots",
  "command_history",
]);

function assertTable(table: string): string {
  if (!TABLES.has(table)) throw new Error(`未知数据表: ${table}`);
  return table;
}

// ───────────────────────── SQLite 实现 ─────────────────────────

type SqlDatabase = {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>;
  close(): Promise<void>;
};

class SqlRepo implements Repo {
  readonly kind = "sqlite" as const;
  constructor(private db: SqlDatabase) {}

  async all(table: string): Promise<Row[]> {
    assertTable(table);
    return this.db.select<Row>(`SELECT * FROM ${table}`);
  }

  async upsert(table: string, row: Row): Promise<void> {
    assertTable(table);
    const cols = Object.keys(row).map(assertIdent);
    if (cols.length === 0) return;
    const values = cols.map((c) => row[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const updates = cols.filter((c) => c !== "id");
    if (updates.length === 0) {
      await this.db.execute(
        `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
        values,
      );
      return;
    }
    await this.db.execute(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates.map((c) => `${c} = excluded.${c}`).join(", ")}`,
      values,
    );
  }

  async upsertMany(table: string, rows: Row[]): Promise<void> {
    for (const r of rows) await this.upsert(table, r);
  }

  async patch(table: string, id: string, changes: Row): Promise<void> {
    assertTable(table);
    const cols = Object.keys(changes).map(assertIdent).filter((c) => c !== "id");
    if (cols.length === 0) return;
    const params = cols.map((c) => changes[c]);
    params.push(id);
    await this.db.execute(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")} WHERE id = $${cols.length + 1}`,
      params,
    );
  }

  async remove(table: string, id: string): Promise<void> {
    assertTable(table);
    await this.db.execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
  }

  async clear(table: string): Promise<void> {
    assertTable(table);
    await this.db.execute(`DELETE FROM ${table}`);
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    await this.db.execute(sql, params);
  }

  async kvGetAll(ns: string): Promise<Record<string, string>> {
    const rows = await this.db.select<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE key LIKE $1`,
      [`${ns}\_%`],
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key.slice(ns.length + 1)] = r.value;
    return out;
  }

  async kvSet(ns: string, key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings(key, value) VALUES($1, $2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [`${ns}_${key}`, value],
    );
  }

  async kvDel(ns: string, key: string): Promise<void> {
    await this.db.execute(`DELETE FROM settings WHERE key = $1`, [`${ns}_${key}`]);
  }
}

// ───────────────────────── 内存实现（仅浏览器预览） ─────────────────────────

class MemoryRepo implements Repo {
  readonly kind = "memory" as const;
  private tables = new Map<string, Map<string, Row>>();
  private kv = new Map<string, string>();

  constructor() {
    for (const t of TABLES) this.tables.set(t, new Map());
    seedDemo(this);
  }

  private store(table: string) {
    assertTable(table);
    let m = this.tables.get(table);
    if (!m) {
      m = new Map();
      this.tables.set(table, m);
    }
    return m;
  }

  async all(table: string): Promise<Row[]> {
    return [...this.store(table).values()].map((r) => ({ ...r }));
  }
  async upsert(table: string, row: Row): Promise<void> {
    const id = String(row.id ?? crypto.randomUUID());
    this.store(table).set(id, { ...this.store(table).get(id), ...row, id });
  }
  async upsertMany(table: string, rows: Row[]): Promise<void> {
    for (const r of rows) await this.upsert(table, r);
  }
  async patch(table: string, id: string, changes: Row): Promise<void> {
    const m = this.store(table);
    const cur = m.get(id);
    if (cur) m.set(id, { ...cur, ...toRow(changes as object) });
  }
  async remove(table: string, id: string): Promise<void> {
    this.store(table).delete(id);
  }
  async clear(table: string): Promise<void> {
    this.store(table).clear();
  }
  async exec(): Promise<void> {
    /* 预览模式不支持裸 SQL */
  }
  async kvGetAll(ns: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.kv) if (k.startsWith(`${ns}_`)) out[k.slice(ns.length + 1)] = v;
    return out;
  }
  async kvSet(ns: string, key: string, value: string): Promise<void> {
    this.kv.set(`${ns}_${key}`, value);
  }
  async kvDel(ns: string, key: string): Promise<void> {
    this.kv.delete(`${ns}_${key}`);
  }
}

/** 预览模式塞几条示例数据，方便直接看 UI 效果 */
function seedDemo(repo: MemoryRepo) {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const base = {
    all_day: 0,
    repeat: "none",
    remind_before_sec: 900,
    completed: 0,
    actual_min: 0,
    sort_order: 0,
    created_at: iso(now),
    updated_at: iso(now),
  };
  const demo: Row[] = [
    { ...base, id: "demo-1", title: "站会 · 同步排期", start_at: iso(at(0, 9, 30)), end_at: iso(at(0, 10, 0)), priority: 2, color: "#4F6EF7", calendar_id: "cal-work"},
    { ...base, id: "demo-2", title: "写季度复盘文档", start_at: iso(at(0, 14, 0)), end_at: iso(at(0, 16, 0)), priority: 1, color: "#EF4444", calendar_id: "cal-work", estimated_min: 90},
    { ...base, id: "demo-3", title: "健身", start_at: iso(at(0, 19, 30)), end_at: iso(at(0, 20, 30)), priority: 3, color: "#22C55E", calendar_id: "cal-personal"},
    { ...base, id: "demo-4", title: "父母生日礼物", start_at: iso(at(2, 10, 0)), all_day: 1, priority: 1, color: "#F59E0B", calendar_id: "cal-family"},
    { ...base, id: "demo-5", title: "周报", start_at: iso(at(4, 17, 0)), end_at: iso(at(4, 18, 0)), priority: 2, color: "#4F6EF7", calendar_id: "cal-work", repeat: "weekly"},
  ];
  for (const row of demo) repo["store"]("todos").set(String(row.id), row);
}

// ───────────────────────── 单例 ─────────────────────────

let repoPromise: Promise<Repo> | null = null;

export function getRepo(): Promise<Repo> {
  if (!repoPromise) repoPromise = createRepo();
  return repoPromise;
}

/** 轮询等待 Rust 侧迁移完成（最多 5s），避免首帧 "no such table: todos" */
async function waitForSchema(db: SqlDatabase, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const rows = await db.select<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todos'",
      );
      if (rows.length > 0) return;
    } catch {
      // 表还没建好，继续等
    }
    if (Date.now() >= deadline) throw new Error("数据库迁移超时：未检测到 todos 表");
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function createRepo(): Promise<Repo> {
  if (!isTauri()) {
    console.info("[db] 非 Tauri 环境，使用内存存储（仅用于 UI 预览）");
    return new MemoryRepo();
  }
  try {
    const { default: Database } = await import("@tauri-apps/plugin-sql");
    const db = (await Database.load("sqlite:todocalendar.db")) as unknown as SqlDatabase;
    // Rust 侧在 tauri setup 里建表迁移，首帧 JS 可能抢跑：等 schema 就绪再放行
    await waitForSchema(db);
    // 与 Rust 侧连接池共用一个文件；WAL 已在 Rust 迁移时开启，这里再兜底一次
    await db.execute("PRAGMA busy_timeout = 8000").catch(() => undefined);
    return new SqlRepo(db);
  } catch (err) {
    console.error("[db] SQLite 初始化失败，降级到内存存储", err);
    return new MemoryRepo();
  }
}

export { toRow };