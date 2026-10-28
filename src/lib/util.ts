import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 秒 -> "23分钟" / "2小时" / "3天" */
export function humanDurationSec(sec: number): string {
  const s = Math.abs(Math.round(sec));
  if (s < 60) return `${s}秒`;
  if (s < 3600) return `${Math.round(s / 60)}分钟`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m === 0 ? `${h}小时` : `${h}小时${m}分`;
  }
  return `${Math.round(s / 86400)}天`;
}

/** 分钟 -> "1h30m" / "45m" */
export function humanMinutes(min: number | null | undefined): string {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 简单的防抖，用于窗口拖拽/尺寸变化写库 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: number | undefined;
  const wrapped = (...args: A) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (t) window.clearTimeout(t);
  };
  return wrapped;
}

/** 优先级 -> 展示色（左侧 3px 色条） */
export const PRIORITY_COLOR: Record<number, string> = {
  1: "var(--c-danger)",
  2: "var(--c-warning)",
  3: "var(--c-muted)",
};

export const PRIORITY_LABEL: Record<number, string> = { 1: "P1 重要", 2: "P2 普通", 3: "P3 低" };

/** 15 分钟步长吸附 */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}