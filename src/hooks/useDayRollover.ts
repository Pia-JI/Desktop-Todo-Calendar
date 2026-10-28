/**
 * 跨天心跳：常驻应用会连续运行好几天，日期组件不能只在首次渲染时取一次「今天」。
 * 这里在每天 00:00:00.120 精确触发一次 syncToday，并额外用
 * 「每分钟轮询 + 窗口获得焦点 + 页面可见性变化」兜底系统休眠/待机导致的定时器漂移。
 */

import { useEffect } from "react";
import { dayKey } from "@/lib/date";
import { useUi } from "@/store/ui";

const MIN_DELAY = 1_000;
const CHECK_INTERVAL = 60_000;
/** 跨过零点后再等一会，避免 23:59:59.999 的边界抖动 */
const ROLLOVER_GRACE = 120;

function delayToNextMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, ROLLOVER_GRACE);
  return Math.max(MIN_DELAY, next.getTime() - now);
}

export function useDayRollover() {
  useEffect(() => {
    let timer = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        useUi.getState().syncToday();
        schedule();
      }, delayToNextMidnight(Date.now()));
    };

    const check = () => {
      const ui = useUi.getState();
      if (ui.todayKey !== dayKey(new Date())) ui.syncToday();
      schedule();
    };

    schedule();
    const interval = window.setInterval(check, CHECK_INTERVAL);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
}
