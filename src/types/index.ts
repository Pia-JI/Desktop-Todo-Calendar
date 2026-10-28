/** 全局领域模型。数据库列名是 snake_case，前端一律 camelCase，转换见 lib/case.ts */

export type Repeat = "none" | "daily" | "weekly" | "monthly";
export type Priority = 1 | 2 | 3;
export type ViewMode = "month" | "week" | "day" | "list";
export type DockMode = "dateNext" | "countdown" | "icon";
export type ThemeMode = "system" | "light" | "dark";
export type CalendarSource = "local" | "ics";
export type HolidayType = "holiday" | "workday" | "solar-term" | "removed";

export interface Todo {
  id: string;
  title: string;
  /** ISO UTC，例如 2026-09-20T07:30:00.000Z */
  startAt: string;
  endAt?: string | null;
  allDay: boolean;
  priority: Priority;
  color: string;
  completed: boolean;
  completedAt?: string | null;
  repeat: Repeat;
  remindBeforeSec: number;
  snoozeUntil?: string | null;
  repeatRemindIntervalSec?: number | null;
  repeatRemindCount?: number | null;
  remindSentCount?: number | null;
  lastRemindedAt?: string | null;
  estimatedMin?: number | null;
  actualMin?: number | null;
  parentId?: string | null;
  calendarId?: string | null;
  notes?: string | null;
  attachmentPath?: string | null;
  sortOrder?: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface Subtask {
  id: string;
  todoId: string;
  title: string;
  done: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarCategory {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  source: CalendarSource;
  readonly: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface HolidayEntry {
  date: string;
  name: string;
  type: HolidayType;
}

export interface PomodoroSession {
  id: string;
  todoId: string | null;
  startedAt: string;
  durationSec: number;
  kind: "focus" | "break";
  completed: boolean;
}

export interface ExternalEvent {
  id: string;
  uid?: string | null;
  calendarId?: string | null;
  title: string;
  startAt: string;
  endAt?: string | null;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
  sourcePath?: string | null;
  importedAt: string;
}

export interface ReminderLog {
  id: string;
  todoId?: string | null;
  sentAt: string;
  channel: string;
  body?: string | null;
  ok: boolean;
  error?: string | null;
}

export interface SnapshotRow {
  id: string;
  createdAt: string;
  path: string;
  kind: string;
  note?: string | null;
  sizeBytes: number;
}

export interface LogLine {
  at: string;
  level: string;
  source: string;
  message: string;
}

export interface AppMeta {
  version: string;
  platform: string;
  arch: string;
  dataDir: string;
  backupDir: string;
  attachmentDir: string;
  dbPath: string;
  schemaVersion: number;
}

/** 系统通知通道状态（Windows 上对应 AppUserModelID 是否已注册） */
export interface NotifyStatus {
  platform: string;
  aumid: string;
  registered: boolean;
  detail: string;
}

/** 单次系统通知发送结果（含真实错误，用于设置页自检） */
export interface NotifyOutcome {
  ok: boolean;
  error?: string | null;
  permission: string;
}

export interface ImportReport {
  inserted: number;
  skipped: number;
  tables: string[];
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 应用内通知中心条目（系统通知的平台降级承接） */
export interface AppNotification {
  id: string;
  todoId?: string | null;
  title: string;
  body: string;
  startAt?: string | null;
  at: string;
  read: boolean;
  kind: "due" | "overdue" | "digest" | "info";
}

export interface TrayTodo {
  id: string;
  title: string;
  time: string;
  priority: number;
  completed: boolean;
}

/** 数据库全量快照（一次性载入内存，视图层用 selector 派生） */
export interface DbSnapshot {
  todos: Todo[];
  subtasks: Subtask[];
  calendars: CalendarCategory[];
  externalEvents: ExternalEvent[];
  holidays: HolidayEntry[];
  sessions: PomodoroSession[];
}

/** 自然语言速记解析结果 */
export interface NlpParseResult {
  cleanedTitle: string;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  priority?: Priority;
  estimatedMin?: number;
  calendarName?: string;
  remindBeforeSec?: number;
  tokens: NlpToken[];
  matched: boolean;
}

export interface NlpToken {
  raw: string;
  start: number;
  end: number;
  kind: "time" | "priority" | "tag" | "duration" | "remind";
  label: string;
}

export interface CommandEntry {
  id: string;
  title: string;
  hint?: string;
  section: string;
  icon?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}