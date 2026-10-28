import { useEffect } from "react";
import { invoke, isTauri } from "@/lib/platform";
import { useSettings } from "@/store/settings";

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.style.colorScheme = dark ? "dark" : "light";
  if (isTauri()) void invoke("set_window_glass", { dark });
}

/** 主题：system 跟随系统（matchMedia 监听），light/dark 手动覆盖 */
export function useTheme() {
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
}
