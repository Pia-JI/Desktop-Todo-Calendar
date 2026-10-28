import { useEffect, useMemo, useState } from "react";
import { parseNlp } from "@/lib/nlp";
import type { NlpParseResult } from "@/types";

/** 标题输入框的自然语言速记：防抖解析，解析失败静默降级 */
export function useNlp(text: string, enabled = true): NlpParseResult | null {
  const [result, setResult] = useState<NlpParseResult | null>(null);

  useEffect(() => {
    if (!enabled || !text.trim()) {
      setResult(null);
      return;
    }
    const t = window.setTimeout(() => setResult(parseNlp(text)), 180);
    return () => window.clearTimeout(t);
  }, [text, enabled]);

  return useMemo(() => result, [result]);
}