import { useEffect, useState } from "react";
import { isTauri } from "@/lib/platform";

export function useWindowFocus() {
  const [focused, setFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);

    if (isTauri()) {
      void (async () => {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const current = getCurrentWindow();
        let receivedEvent = false;
        const stop = await current.onFocusChanged(({ payload }) => {
          receivedEvent = true;
          if (!cancelled) setFocused(payload);
        });
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
        const initial = await current.isFocused();
        if (!cancelled && !receivedEvent) setFocused(initial);
      })().catch((error) => console.warn("[window] 读取焦点失败", error));
    } else {
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
    }

    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}
