import { useEffect, useLayoutEffect } from "react";
import { invoke, isTauri } from "@/lib/platform";
import {
  COMPACT_W, DOCK, DOCK_ICON, DOCK_PAD, ISLAND, PANEL,
  clampRect, getRect, loadWindowState, migrateLegacyDockRect,
  rescueWindow, saveWindowState, setAlwaysOnTop, setRect, workArea,
  type Rect,
} from "@/lib/window";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";

let panelSize = { ...PANEL };
let generation = 0;
let pending = Promise.resolve();

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function useMorphWindow() {
  const expanded = useUi((state) => state.expanded);
  const island = useUi((state) => !!state.islandAlert);
  const booted = useUi((state) => state.booted);
  const dockMode = useSettings((state) => state.dockMode);
  const alwaysOnTop = useSettings((state) => state.alwaysOnTop);
  const mode = expanded ? "panel" : island ? "island" : dockMode === "icon" ? "icon" : "dock";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await loadWindowState();
        const savedExpanded = (await invoke<boolean>("load_window_expanded")) ?? false;
        if (cancelled) return;
        if (saved) {
          const rect = migrateLegacyDockRect({ x: saved.x, y: saved.y, w: saved.width, h: saved.height });
          if (savedExpanded) panelSize = { w: rect.w - DOCK_PAD * 2, h: rect.h - DOCK_PAD * 2 };
          await setRect(rect);
        }
        if (!cancelled) useUi.setState({ expanded: savedExpanded });
      } catch (error) {
        console.warn("[window] 初始化窗口失败", error);
      } finally {
        if (!cancelled) useUi.getState().setBooted(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    if (!booted) return;
    const request = ++generation;
    useUi.getState().setMorphing(true);
    pending = pending.then(async () => {
      if (request !== generation) return;
      try {
        const area = await workArea();
        const from = await getRect() ?? { x: area.x, y: area.y, w: area.w, h: area.h };
        const size = mode === "panel" ? panelSize : mode === "island" ? ISLAND : mode === "icon" ? DOCK_ICON : DOCK;
        const target: Rect = clampRect({
          x: from.x + from.w - size.w,
          y: from.y + from.h - size.h,
          w: size.w,
          h: size.h,
        }, area);
        if (request !== generation) return;
        await nextFrame();
        await setRect(target);
        await nextFrame();
        await nextFrame();
        if (request !== generation) return;
        if (mode === "panel") {
          panelSize = { w: target.w, h: target.h };
          useUi.getState().setCompact(target.w <= COMPACT_W);
        }
        if (mode !== "island") await saveWindowState(target, mode === "panel");
      } catch (error) {
        console.warn("[window] 切换窗口失败", error);
      } finally {
        if (request === generation) useUi.getState().setMorphing(false);
      }
    });
    return () => { generation++; };
  }, [booted, mode]);

  useEffect(() => { void setAlwaysOnTop(alwaysOnTop); }, [alwaysOnTop]);

  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ui = useUi.getState();
        if (ui.expanded && !ui.morphing) {
          ui.setCompact(window.innerWidth <= COMPACT_W);
        }
      }, 100);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && !useUi.getState().morphing) void rescueWindow();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const listeners = await Promise.all([
        listen("app://window-blur", () => {
          const ui = useUi.getState();
          if (useSettings.getState().autoCollapseOnBlur && ui.expanded && !ui.morphing &&
              !document.querySelector('[role="dialog"]') && !ui.locked &&
              !ui.drawer.open && !ui.commandOpen && !ui.settingsOpen && !ui.notifOpen) {
            ui.setExpanded(false);
          }
        }),
        listen("app://window-hidden", () => useUi.getState().setExpanded(false)),
        listen("app://hotkey", () => useUi.getState().toggleExpanded()),
      ]);
      if (cancelled) listeners.forEach((stop) => stop());
      else unlisten.push(...listeners);
    })();
    return () => {
      cancelled = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);
}
