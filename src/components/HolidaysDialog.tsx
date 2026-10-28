/** 节假日修正：查看内置数据 + 用户覆盖（写库持久化，优先于内置） */

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { BUILTIN_HOLIDAYS, holidayMeta } from "@/hooks/useHolidays";
import { dayKey } from "@/lib/date";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { Dialog } from "./Dialog";
import type { HolidayType } from "@/types";

export function HolidaysDialog() {
  const open = useUi((s) => s.holidaysOpen);
  const setOpen = useUi((s) => s.setHolidaysOpen);
  const overrides = useTodos((s) => s.holidayOverrides);
  const meta = useMemo(() => holidayMeta(), []);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [name, setName] = useState("");
  const [type, setType] = useState<HolidayType>("holiday");

  const builtin = BUILTIN_HOLIDAYS.filter((h) => h.date.startsWith(String(year)));
  const provisional = meta.provisionalYears.includes(year);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="节假日 / 调休修正" width={520}>
      <div className="text-2xs text-muted mb-2 leading-4">
        内置数据年份：{meta.years.join("、")}{provisional ? `（${year} 为暂定安排）` : ""}。
        修正结果写入 SQLite 并优先于内置；农历与节气由算法实时计算。
      </div>

      <div className="flex items-center gap-2 mb-2">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="input w-[100px]">
          {meta.years.map((y) => <option key={y} value={y}>{y} 年</option>)}
        </select>
        <span className="text-2xs text-muted">{builtin.length} 条内置</span>
      </div>

      <div className="max-h-[220px] overflow-y-auto scroll-thin space-y-0.5 mb-3">
        {builtin.map((h) => {
          const ov = overrides.find((o) => o.date === h.date);
          return (
            <div key={h.date} className="flex items-center gap-2 h-7 px-2 rounded-md bg-surface/50 text-2xs">
              <span className="tabular-nums text-muted w-[84px]">{h.date}</span>
              <span className="text-text flex-1 truncate">{ov?.name ?? h.name}</span>
              <span className={h.type === "holiday" ? "text-success" : "text-warning"}>{ov?.type ?? h.type}</span>
              {ov && (
                <button className="icon-btn w-5 h-5" onClick={() => void useTodos.getState().removeHolidayOverride(h.date)} aria-label="撤销修正">
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/60 pt-3 space-y-2">
        <div className="text-2xs font-semibold text-muted">添加 / 覆盖某一天</div>
        <div className="grid grid-cols-[130px_1fr_110px_auto] gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称，如 春节 / 班" className="input" />
          <select value={type} onChange={(e) => setType(e.target.value as HolidayType)} className="input">
            <option value="holiday">放假</option>
            <option value="workday">调休上班</option>
            <option value="solar-term">节气</option>
            <option value="removed">移除内置</option>
          </select>
          <button
            className="btn-primary h-8"
            onClick={() => {
              if (!date) return;
              void useTodos.getState().setHolidayOverride({ date, name: name || (type === "removed" ? "removed" : "自定义"), type });
              setName("");
            }}
          >
            <Plus size={13} /> 保存
          </button>
        </div>
      </div>
    </Dialog>
  );
}