/** 周回顾弹窗：每周日晚弹出（可关闭），本周总结 + 下周 P1 一览 */

import { useEffect, useState } from "react";
import { getWeek, getYear } from "date-fns";
import { weeklyReview } from "@/lib/stats";
import { fmt, parse } from "@/lib/date";
import { getRepo } from "@/lib/db";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { Dialog } from "./Dialog";

const KEY = "lastWeeklyReview";

function weekKey(now: Date): string {
  return `${getYear(now)}-W${getWeek(now)}`;
}

export function WeeklyReview() {
  const [open, setOpen] = useState(false);
  const enabled = useSettings((s) => s.weeklyReviewEnabled);
  const todos = useTodos((s) => s.todos);
  const sessions = useTodos((s) => s.sessions);
  const loaded = useTodos((s) => s.loaded);

  useEffect(() => {
    if (!enabled || !loaded) return;
    const now = new Date();
    const isSundayEvening = now.getDay() === 0 && now.getHours() >= 18;
    if (!isSundayEvening) return;
    void (async () => {
      const repo = await getRepo();
      const all = await repo.kvGetAll("u");
      if (all[KEY] === weekKey(now)) return;
      setOpen(true);
      await repo.kvSet("u", KEY, weekKey(now));
    })();
  }, [enabled, loaded]);

  const review = weeklyReview(todos, sessions);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="本周回顾" width={420}>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="card p-3 text-center">
            <div className="text-lg font-bold text-text tabular-nums">{review.doneCount}</div>
            <div className="text-2xs text-muted">本周完成</div>
          </div>
          <div className="card p-3 text-center">
            <div className="text-lg font-bold text-text tabular-nums">{review.focusMin}m</div>
            <div className="text-2xs text-muted">专注时长</div>
          </div>
        </div>
        <div>
          <div className="text-2xs font-semibold text-muted mb-1">下周 P1 一览</div>
          {review.nextWeekP1.length === 0 ? (
            <div className="text-2xs text-muted">暂无 P1，轻松一周 🎉</div>
          ) : (
            <div className="space-y-1">
              {review.nextWeekP1.slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center gap-2 h-7 px-2 rounded-md bg-danger/10">
                  <span className="text-2xs font-bold text-danger">P1</span>
                  <span className="text-text truncate flex-1">{t.title}</span>
                  <span className="text-2xs text-muted">{parse(t.startAt) ? fmt(parse(t.startAt)!, "M-d") : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}