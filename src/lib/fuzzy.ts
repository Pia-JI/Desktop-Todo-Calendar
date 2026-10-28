/** 模糊匹配打分：子序列匹配 + 连续片段加成，用于命令面板与搜索建议 */

export function fuzzyScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q) * 0.5 + (t.length === q.length ? 20 : 0);

  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 2 + streak;
    // 词边界加成
    if (found === 0 || /[\s\-_/#.]/.test(t[found - 1])) score += 4;
    ti = found + 1;
  }
  return score;
}

export function fuzzyMatch(query: string, target: string): boolean {
  return fuzzyScore(query, target) > 0;
}

/** 高亮片段：返回 [start, end) 区间列表 */
export function highlightRanges(query: string, target: string): [number, number][] {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();
  if (!q) return [];
  const direct = t.indexOf(q);
  if (direct >= 0) return [[direct, direct + q.length]];
  const ranges: [number, number][] = [];
  let ti = 0;
  let runStart = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return [];
    if (runStart === -1 || found !== ti) {
      if (runStart !== -1) ranges.push([runStart, ti]);
      runStart = found;
    }
    ti = found + 1;
  }
  if (runStart !== -1) ranges.push([runStart, ti]);
  return ranges;
}