/**
 * 自然语言速记解析：
 *   「明天下午三点开会 #工作 P1 @30min !15」
 *   -> startAt=明天15:00, calendar=工作, priority=1, estimatedMin=30, remindBeforeSec=900
 * 中文相对时间交给 chrono-node（zh），再叠加一层中文数字归一化与显式 token 提取。
 * 无法解析时静默降级为普通文本（matched=false），不打断输入。
 */

import * as chrono from "chrono-node";
import type { NlpParseResult, NlpToken, Priority } from "@/types";

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};

/** 中文数字 -> 阿拉伯（支持 0-99，含「十」） */
export function cnNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s.length === 1) return CN_DIGIT[s] ?? null;
  const tenIdx = s.indexOf("十");
  if (tenIdx === -1) {
    let out = 0;
    for (const ch of s) {
      const d = CN_DIGIT[ch];
      if (d === undefined) return null;
      out = out * 10 + d;
    }
    return out;
  }
  const head = s.slice(0, tenIdx);
  const tail = s.slice(tenIdx + 1);
  const h = head ? (CN_DIGIT[head] ?? null) : 1;
  const t = tail ? (CN_DIGIT[tail] ?? null) : 0;
  if (h === null || t === null) return null;
  return h * 10 + t;
}

/** 把时间语境里的中文数字换成阿拉伯数字，提升 chrono 命中率 */
function normalizeChinese(text: string): string {
  return text
    .replace(
      /([零〇一二三四五六七八九十两]+)\s*(点|时|分|号|日|月|周|星期|天)/g,
      (m, num: string, unit: string) => {
        const n = cnNum(num);
        return n === null ? m : `${n}${unit}`;
      },
    )
    .replace(/点半/g, "点30分")
    .replace(/(\d+)\s*个?半小时/g, (_m, n: string) => `${Number(n) * 30}分钟`);
}

interface Explicit {
  token: NlpToken;
  value: string;
}

const DURATION_RE = /@(\d+(?:\.\d+)?)\s*(h|小时|m|min|分钟)?/i;
const REMIND_RE = /!(\d+)\s*(h|小时|m|min|分钟)?/i;

function parseDurationMin(value: string, unit?: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = (unit ?? "m").toLowerCase();
  if (u.startsWith("h") || u === "小时") return Math.round(n * 60);
  return Math.round(n);
}

/** 提取 #标签 / P1 / @时长 / !提前量 / 全天 等显式 token */
function extractExplicit(text: string): { cleaned: string; items: Explicit[] } {
  const items: Explicit[] = [];
  let cleaned = text;

  const consume = (re: RegExp, kind: NlpToken["kind"], make: (m: RegExpExecArray) => string) => {
    const m = re.exec(cleaned);
    if (!m) return;
    const start = m.index;
    const end = start + m[0].length;
    items.push({
      token: { raw: m[0], start, end, kind, label: make(m) },
      value: m[0],
    });
    cleaned = cleaned.slice(0, start) + cleaned.slice(end);
  };

  consume(/#([\p{Script=Han}A-Za-z0-9_-]{1,12})/u, "tag", (m) => `#${m[1]}`);
  consume(/\b[Pp]([123])\b/, "priority", (m) => `P${m[1]}`);
  consume(DURATION_RE, "duration", (m) => `@${m[1]}${m[2] ?? "min"}`);
  consume(REMIND_RE, "remind", (m) => `提前${m[1]}${m[2] ?? "min"}`);
  consume(/(全天|整天)/, "time", () => "全天");

  return { cleaned: cleaned.replace(/\s{2,}/g, " ").trim(), items };
}

/** 相对时间兜底：3天后 / 2小时后 / 下个月 */
function relativeFallback(text: string, now: Date): Date | null {
  const m = /(\d+(?:\.\d+)?)\s*(天|小时|分钟|周|个月)\s*(后|之后)/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const d = new Date(now);
  switch (m[2]) {
    case "天":
      d.setDate(d.getDate() + n);
      break;
    case "小时":
      d.setHours(d.getHours() + n);
      break;
    case "分钟":
      d.setMinutes(d.getMinutes() + n);
      break;
    case "周":
      d.setDate(d.getDate() + n * 7);
      break;
    case "个月":
      d.setMonth(d.getMonth() + n);
      break;
  }
  return d;
}

export function parseNlp(raw: string, now: Date = new Date()): NlpParseResult {
  const result: NlpParseResult = { cleanedTitle: raw.trim(), tokens: [], matched: false };
  if (!raw.trim()) return result;

  const { cleaned, items } = extractExplicit(raw);
  result.tokens = items.map((i) => i.token);

  for (const it of items) {
    if (it.token.kind === "priority") {
      result.priority = Number(it.token.label.slice(1)) as Priority;
    } else if (it.token.kind === "duration") {
      const m = DURATION_RE.exec(it.value);
      if (m) result.estimatedMin = parseDurationMin(m[1], m[2]);
    } else if (it.token.kind === "remind") {
      const m = REMIND_RE.exec(it.value);
      if (m) result.remindBeforeSec = parseDurationMin(m[1], m[2]) * 60;
    } else if (it.token.kind === "tag") {
      result.calendarName = it.token.label.slice(1);
    } else if (it.token.label === "全天") {
      result.allDay = true;
    }
  }

  // 时间解析：chrono zh 优先，失败再用相对时间兜底
  const normalized = normalizeChinese(cleaned);
  let start: Date | null = null;
  let end: Date | null = null;
  let chronoText: string | null = null;

  try {
    const parsed = chrono.zh.parse(normalized, now, { forwardDate: true });
    if (parsed.length > 0) {
      const first = parsed[0];
      start = first.start.date();
      end = first.end ? first.end.date() : null;
      chronoText = first.text;
    }
  } catch {
    start = null;
  }

  if (!start) start = relativeFallback(normalized, now);

  if (start) {
    result.startAt = start.toISOString();
    if (end && end.getTime() > start.getTime()) result.endAt = end.toISOString();
    result.matched = true;

    // 定位时间 token 在原文中的位置，用于内联高亮
    if (chronoText) {
      const idx = normalized.indexOf(chronoText);
      if (idx >= 0) {
        result.tokens.push({
          raw: chronoText,
          start: idx,
          end: idx + chronoText.length,
          kind: "time",
          label: chronoText,
        });
      }
    }
  }

  result.cleanedTitle = stripTimePhrases(cleaned, chronoText);
  if (items.length > 0 || result.matched) result.matched = true;
  return result;
}

const TIME_PHRASE_RE = [
  /(?:\d+(?:\.\d+)?|[零〇一二三四五六七八九十两]+)\s*(?:分钟|小时|天|周|个月)\s*(?:后|之后)/g,
  /(?:今天|明天|后天|大后天)?(?:早上|上午|中午|下午|傍晚|晚上|凌晨)?\s*\d{1,2}\s*(?:点|:|：)\s*\d{0,2}\s*分?/,
  /(?:今天|明天|后天|大后天)?(?:早上|上午|中午|下午|傍晚|晚上|凌晨)?\s*[零〇一二三四五六七八九十两]+\s*点(?:半|\s*[零〇一二三四五六七八九十两]+分?)?/,
  /下周[一二三四五六日天]?/,
  /下个月/,
  /今天|明天|后天|大后天|今晚|今早/,
];

/** 把「六分钟后开会」收成「开会」，时间交给 startAt 单独显示。 */
export function stripTimePhrases(title: string, chronoText?: string | null): string {
  let out = title;
  if (chronoText) out = out.split(chronoText).join(" ");
  for (const re of TIME_PHRASE_RE) {
    out = out.replace(re, " ");
  }
  return out.replace(/[，,。.\-_/]+/g, " ").replace(/\s{2,}/g, " ").trim() || title.trim();
}

/** 把 token 列表按位置排序去重，供输入框渲染内联高亮 */
export function sortTokens(tokens: NlpToken[]): NlpToken[] {
  return [...tokens].sort((a, b) => a.start - b.start);
}