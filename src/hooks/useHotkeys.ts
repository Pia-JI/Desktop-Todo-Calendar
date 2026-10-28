import { useEffect } from "react";
import { IS_MAC } from "@/lib/platform";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

/** 全局快捷键（应用内）；Ctrl/Cmd+Shift+Q 由 Rust 全局热键兜底 */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();

      if (key === "escape") {
        if (ui.commandOpen) return ui.setCommandOpen(false);
        if (ui.drawer.open) return ui.closeDrawer();
        if (ui.settingsOpen) return ui.setSettingsOpen(false);
        if (ui.statsOpen) return ui.setStatsOpen(false);
        if (ui.recycleOpen) return ui.setRecycleOpen(false);
        if (ui.shortcutsOpen) return ui.setShortcutsOpen(false);
        if (ui.diagnosticsOpen) return ui.setDiagnosticsOpen(false);
        if (ui.holidaysOpen) return ui.setHolidaysOpen(false);
        if (ui.notifOpen) return ui.setNotifOpen(false);
        if (ui.expanded) return ui.setExpanded(false);
        return;
      }

      if (isTyping(e.target)) return;

      if (mod && key === "k") {
        e.preventDefault();
        ui.setCommandOpen(!ui.commandOpen);
        return;
      }
      if (mod && e.shiftKey && key === "q") {
        e.preventDefault();
        ui.toggleExpanded();
        return;
      }
      if (mod && key === "n") {
        e.preventDefault();
        ui.openDrawer({});
        return;
      }
      if (mod && key === ",") {
        e.preventDefault();
        ui.setSettingsOpen(!ui.settingsOpen);
        return;
      }
      if (mod && key === "l") {
        e.preventDefault();
        if (useSettings.getState().lockEnabled) ui.setLocked(true);
        return;
      }
      if (mod && key === "f") {
        e.preventDefault();
        if (!ui.expanded) ui.setExpanded(true);
        window.setTimeout(() => {
          document.getElementById("topbar-search")?.focus();
        }, 60);
        return;
      }
      if (mod && ["1", "2", "3", "4"].includes(key)) {
        e.preventDefault();
        const views = ["month", "week", "day", "list"] as const;
        ui.setView(views[Number(key) - 1]);
        return;
      }
      if (e.key === "?" ) {
        e.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}