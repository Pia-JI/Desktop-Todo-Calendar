import { useEffect } from "react";
import { useFocus } from "@/store/focus";

/** 驱动番茄钟倒计时；页面隐藏时仍用时间戳计算，不会漂移 */
export function usePomodoro() {
  const running = useFocus((s) => s.running);

  useEffect(() => {
    if (!running) return;
    const tick = () => useFocus.getState().tick();
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [running]);
}