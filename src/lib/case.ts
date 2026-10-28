/** camelCase <-> snake_case，用于内存模型与 SQLite 列名的双向映射 */

const IDENT = /^[a-z_][a-z0-9_]*$/;

export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_s, c: string) => c.toUpperCase());
}

/** 校验列名，杜绝任何拼接注入风险 */
export function assertIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`非法标识符: ${name}`);
  return name;
}

export function toRow<T extends object>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const col = camelToSnake(k);
    out[col] = normalizeValue(v);
  }
  return out;
}

export function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[snakeToCamel(k)] = v;
  }
  return out as T;
}

/** SQLite 没有布尔类型：boolean -> 0/1；null/undefined -> null */
function normalizeValue(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  return v;
}

/** 读取时把 0/1 还原成布尔（按字段名白名单，避免误转 id/sortOrder 等数值列） */
export function hydrate<T extends object>(row: Record<string, unknown>, boolFields: string[] = []): T {
  const obj = fromRow<Record<string, unknown>>(row);
  for (const f of boolFields) {
    if (f in obj) obj[f] = Number(obj[f]) === 1 || obj[f] === true;
  }
  return obj as T;
}

export const TODO_BOOLS = ["allDay", "completed"];
export const SUBTASK_BOOLS = ["done"];
export const CALENDAR_BOOLS = ["visible", "readonly"];
export const EXTERNAL_BOOLS = ["allDay"];
export const SESSION_BOOLS = ["completed"];
export const LOG_BOOLS = ["ok"];

