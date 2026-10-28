import { useMemo } from "react";
import raw from "@/data/holidays-cn.json";
import { useTodos } from "@/store/todos";
import type { HolidayEntry } from "@/types";

interface HolidayDoc {
  entries: HolidayEntry[];
  provisionalYears?: number[];
  note?: string;
}

const BUILTIN = (raw as HolidayDoc).entries;

/** 内置节假日 + 用户手动修正（DB 优先）；type=removed 表示用户删除了内置条目 */
export function useHolidays(): Map<string, HolidayEntry> {
  const overrides = useTodos((s) => s.holidayOverrides);
  return useMemo(() => {
    const map = new Map<string, HolidayEntry>();
    for (const e of BUILTIN) map.set(e.date, e);
    for (const o of overrides) {
      if (o.type === "removed") map.delete(o.date);
      else map.set(o.date, o);
    }
    return map;
  }, [overrides]);
}

export function holidayMeta(): { years: number[]; provisionalYears: number[]; note: string } {
  const doc = raw as HolidayDoc & { years?: number[] };
  return {
    years: doc.years ?? [],
    provisionalYears: doc.provisionalYears ?? [],
    note: doc.note ?? "",
  };
}

export const BUILTIN_HOLIDAYS = BUILTIN;