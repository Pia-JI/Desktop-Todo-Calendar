/**
 * 生成中国法定节假日 / 调休上班日数据 -> src/data/holidays-cn.json
 * 数据来源：国务院办公厅历年节假日安排通知。
 * 2026 年为「暂定」：官方公布完整调休后，可直接改本文件重跑，或在应用「设置 - 节假日」里手动修正（写库持久化）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, "../src/data/holidays-cn.json");

/** [起始, 结束, 名称, provisional] */
const holidays = [
  // 2024（官方）
  ["2023-12-30", "2024-01-01", "元旦", false],
  ["2024-02-10", "2024-02-17", "春节", false],
  ["2024-04-04", "2024-04-06", "清明", false],
  ["2024-05-01", "2024-05-05", "劳动节", false],
  ["2024-06-08", "2024-06-10", "端午", false],
  ["2024-09-15", "2024-09-17", "中秋", false],
  ["2024-10-01", "2024-10-07", "国庆", false],
  // 2025（官方）
  ["2025-01-01", "2025-01-01", "元旦", false],
  ["2025-01-28", "2025-02-04", "春节", false],
  ["2025-04-04", "2025-04-06", "清明", false],
  ["2025-05-01", "2025-05-05", "劳动节", false],
  ["2025-05-31", "2025-06-02", "端午", false],
  ["2025-10-01", "2025-10-08", "国庆·中秋", false],
  // 2026（暂定，等待官方调休细则）
  ["2026-01-01", "2026-01-03", "元旦", true],
  ["2026-02-15", "2026-02-22", "春节", true],
  ["2026-04-04", "2026-04-06", "清明", true],
  ["2026-05-01", "2026-05-05", "劳动节", true],
  ["2026-06-19", "2026-06-21", "端午", true],
  ["2026-09-25", "2026-09-27", "中秋", true],
  ["2026-10-01", "2026-10-07", "国庆", true],
];

/** 调休上班日（周末但需上班） */
const workdays = [
  // 2024
  ["2024-02-04", "班"],
  ["2024-02-18", "班"],
  ["2024-04-07", "班"],
  ["2024-04-28", "班"],
  ["2024-05-11", "班"],
  ["2024-09-14", "班"],
  ["2024-09-29", "班"],
  ["2024-10-12", "班"],
  // 2025
  ["2025-01-26", "班"],
  ["2025-02-08", "班"],
  ["2025-04-27", "班"],
  ["2025-09-28", "班"],
  ["2025-10-11", "班"],
  // 2026（暂定：官方公布后补充）
];

const entries = [];
const push = (date, name, type, provisional) => entries.push({ date, name, type, provisional: !!provisional });

for (const [from, to, name, provisional] of holidays) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    push(d, name, "holiday", provisional);
  }
}
for (const [d, name] of workdays) push(d, name, "workday", false);

entries.sort((a, b) => a.date.localeCompare(b.date));
const years = [...new Set(entries.map((e) => Number(e.date.slice(0, 4))))].sort((a, b) => a - b);

const doc = {
  region: "CN",
  generatedAt: new Date().toISOString(),
  years,
  provisionalYears: [2026],
  note: "2026 年为暂定安排；官方公布完整调休后可重跑 scripts/gen-holidays.mjs，或在应用内「设置 - 节假日」手动修正（修正结果写入 SQLite 的 holidays 表并优先于内置数据）。节气与农历传统节日由 lib/lunar.ts 算法计算，无需联网。",
  entries,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc, null, 2), "utf8");
console.log(`[holidays] wrote ${entries.length} entries (${years.join(", ")}) -> ${out}`);