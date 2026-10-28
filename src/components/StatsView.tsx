/** 统计：本周/本月完成、专注时长、分类环形图、P1 完成率、年度热力图、连续打卡 */

import { Flame, Timer } from "lucide-react";
import { useMemo } from "react";
import { computeStats } from "@/lib/stats";
import { cn, humanMinutes } from "@/lib/util";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { Dialog } from "./Dialog";

function heatColor(count: number): string {
  if (count === 0) return "rgb(var(--c-surface-2))";
  if (count === 1) return "rgb(var(--c-primary) / 0.35)";
  if (count === 2) return "rgb(var(--c-primary) / 0.6)";
  return "rgb(var(--c-primary) / 0.9)";
}

function Donut({ data }: { data: { name: string; color: string; count: number }[] }) {
  const total = data.reduce((a, d) => a + d.count, 0) || 1;
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={R} fill="none" stroke="rgb(var(--c-surface-2))" strokeWidth="14" />
        {data.map((d) => {
          const frac = d.count / total;
          const dash = frac * C;
          const el = (
            <circle
              key={d.name}
              cx="55" cy="55" r={R} fill="none"
              stroke={d.color} strokeWidth="14"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 55 55)"
            />
          );
          offset += dash;
          return el;
        })}
        <text x="55" y="52" textAnchor="middle" className="fill-[rgb(var(--c-text))]" fontSize="18" fontWeight="700">{total}</text>
        <text x="55" y="68" textAnchor="middle" className="fill-[rgb(var(--c-muted))]" fontSize="9">完成</text>
      </svg>
      <div className="space-y-1">
        {data.slice(0, 6).map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-2xs">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-text w-[80px] truncate">{d.name}</span>
            <span className="text-muted tabular-nums">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsView() {
  const open = useUi((s) => s.statsOpen);
  const setOpen = useUi((s) => s.setStatsOpen);
  const todos = useTodos((s) => s.todos);
  const sessions = useTodos((s) => s.sessions);
  const calendars = useTodos((s) => s.calendars);

  const stats = useMemo(() => computeStats(todos, sessions, calendars), [todos, sessions, calendars]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="统计" width={640}>
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "本周完成", value: String(stats.weekCompleted) },
          { label: "本月完成", value: String(stats.monthCompleted) },
          { label: "专注时长", value: humanMinutes(stats.focusMinutes) || "0m" },
          { label: "连续打卡", value: `${stats.streak} 天` },
        ].map((c) => (
          <div key={c.label} className="card p-3 text-center">
            <div className="text-lg font-bold text-text tabular-nums">{c.value}</div>
            <div className="text-2xs text-muted mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-2xs font-semibold text-muted mb-2">按分类分布</div>
          <Donut data={stats.byCalendar} />
        </div>
        <div className="space-y-2">
          <div className="card p-3 flex items-center gap-2">
            <Timer size={16} className="text-primary" />
            <div>
              <div className="text-xs text-text">专注 {stats.focusSessions} 次</div>
              <div className="text-2xs text-muted">累计 {humanMinutes(stats.focusMinutes) || "0 分钟"}</div>
            </div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-text">P1 完成率</div>
            <div className="mt-1 h-2 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-danger rounded-full transition-all" style={{ width: `${stats.p1Rate}%` }} />
            </div>
            <div className="text-2xs text-muted mt-1">{stats.p1Done}/{stats.p1Total} · {stats.p1Rate}%</div>
          </div>
          <div className="card p-3 flex items-center gap-2">
            <Flame size={16} className="text-warning" />
            <div className="text-xs text-text">待处理 {stats.totalOpen} 件</div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-2xs font-semibold text-muted mb-2">年度热力图（最近 365 天）</div>
        <div className="overflow-x-auto scroll-thin">
          <div className="grid grid-flow-col grid-rows-7 gap-[3px] w-max">
            {stats.heatmap.map((h) => (
              <div
                key={h.date}
                title={`${h.date} · ${h.count} 件`}
                className={cn("w-[11px] h-[11px] rounded-[3px]")}
                style={{ background: heatColor(h.count) }}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}