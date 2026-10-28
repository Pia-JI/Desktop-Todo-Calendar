/**
 * 窗口几何与「收缩 <-> 展开」形变。
 * 桌面端一次 IPC 直接落位，不再逐帧改 HWND 尺寸（WebView2 每帧整页重排会掉帧）。
 * 非 Tauri 环境全部 no-op。
 */

import { isTauri, invoke } from "./platform";
import { clamp } from "./util";
import type { WindowRect } from "@/types";

type WindowModule = typeof import("@tauri-apps/api/window");

let windowMod: WindowModule | null = null;

async function winMod(): Promise<WindowModule> {
  if (!windowMod) windowMod = await import("@tauri-apps/api/window");
  return windowMod;
}

const toNativeRect = (r: Rect): WindowRect => ({ x: r.x, y: r.y, width: r.w, height: r.h });

/** 收缩态不再预留透明外边距，避免窗口边缘出现一圈半透明黑边。 */
export const DOCK_PAD = 0;
export const DOCK = { w: 264, h: 44 };
export const DOCK_ICON = { w: 168, h: 44 };
export const ISLAND = { w: 336, h: 92 };
export const PANEL = { w: 760, h: 560 };
export const PANEL_MIN = { w: 640, h: 480 };
export const COMPACT_W = 420;
export const MORPH_MS = 360;
const LEGACY_DOCK_PAD = 12;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

type MonitorLike = {
  size?: { width: number; height: number };
  position?: { x: number; y: number };
  workArea?: { position?: { x: number; y: number }; size?: { width: number; height: number } } | null;
  scaleFactor?: number;
} | null;

export async function workArea(): Promise<Area> {
  if (!isTauri()) {
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  }
  try {
    const { currentMonitor, primaryMonitor } = await import("@tauri-apps/api/window");
    const mon = ((await currentMonitor()) ?? (await primaryMonitor())) as unknown as MonitorLike;
    if (mon) {
      const sf = mon.scaleFactor || 1;
      const wa = mon.workArea;
      if (wa?.size && wa.position) {
        return {
          x: wa.position.x / sf,
          y: wa.position.y / sf,
          w: wa.size.width / sf,
          h: wa.size.height / sf,
        };
      }
      if (mon.size && mon.position) {
        return {
          x: mon.position.x / sf,
          y: mon.position.y / sf,
          w: mon.size.width / sf,
          h: mon.size.height / sf - 56,
        };
      }
    }
  } catch (err) {
    console.warn("[window] 读取工作区失败", err);
  }
  return { x: 0, y: 0, w: 1920, h: 1080 - 56 };
}

export function clampRect(rect: Rect, area: Area): Rect {
  const w = Math.min(rect.w, Math.max(80, area.w - 8));
  const h = Math.min(rect.h, Math.max(32, area.h - 8));
  const maxX = Math.max(area.x, area.x + area.w - w);
  const maxY = Math.max(area.y, area.y + area.h - h);
  return {
    w,
    h,
    x: clamp(rect.x, area.x, maxX),
    y: clamp(rect.y, area.y, maxY),
  };
}

export function anchorRect(target: Rect, anchor: { x: number; y: number }, area: Area): Rect {
  const x = anchor.x - target.w;
  const y = anchor.y - target.h;
  return clampRect({ ...target, x, y }, area);
}

export function migrateLegacyDockRect(rect: Rect): Rect {
  if (rect.h > DOCK.h + 8 && rect.h <= DOCK.h + LEGACY_DOCK_PAD * 2 + 4) {
    const pad = Math.max(0, Math.round((rect.h - DOCK.h) / 2));
    return {
      x: rect.x + pad,
      y: rect.y + pad,
      w: rect.w <= DOCK_ICON.w + LEGACY_DOCK_PAD * 2 + 8 ? DOCK_ICON.w : DOCK.w,
      h: DOCK.h,
    };
  }
  return rect;
}

export async function setRect(rect: Rect): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_window_rect", { rect: toNativeRect(rect) });
}

export async function getRect(): Promise<Rect | null> {
  if (!isTauri()) return null;
  const { getCurrentWindow } = await winMod();
  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  const size = await win.outerSize();
  const sf = await win.scaleFactor();
  return { x: pos.x / sf, y: pos.y / sf, w: size.width / sf, h: size.height / sf };
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

let animationFrame = 0;

export function animateRect(
  from: Rect,
  to: Rect,
  ms: number,
  reduced: boolean,
  onFrame?: (r: Rect) => void,
): Promise<void> {
  cancelAnimationFrame(animationFrame);

  if (isTauri()) {
    if (reduced || ms <= 0) {
      onFrame?.(to);
      return setRect(to);
    }
    onFrame?.(to);
    return invoke("morph_window", {
      rect: toNativeRect(to),
      durationMs: ms,
      reduced,
    }).then(() => undefined);
  }

  if (reduced || ms <= 0) {
    onFrame?.(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = clamp((now - start) / ms, 0, 1);
      const e = easeOutCubic(t);
      onFrame?.({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        w: from.w + (to.w - from.w) * e,
        h: from.h + (to.h - from.h) * e,
      });
      if (t < 1) animationFrame = requestAnimationFrame(step);
      else resolve();
    };
    animationFrame = requestAnimationFrame(step);
  });
}

export async function loadWindowState(): Promise<WindowRect | null> {
  return (await invoke<WindowRect>("load_window_state")) ?? null;
}

export async function saveWindowState(rect: Rect, expanded: boolean): Promise<void> {
  await invoke("save_window_state", {
    rect: { x: rect.x, y: rect.y, width: rect.w, height: rect.h },
    expanded,
  });
}

export async function startResize(_direction: string): Promise<void> {
  return;
}

export async function startDrag(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await winMod();
  await getCurrentWindow().startDragging();
}

export async function setAlwaysOnTop(v: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_window_pinned", { onTop: v });
}

export async function setWindowGlass(dark: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke("set_window_glass", { dark });
}

export async function rescueWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("rescue_main_window");
}

export async function hideWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_main_window");
}

export async function showWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("show_main_window");
}
