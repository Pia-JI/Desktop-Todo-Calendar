/** 运行环境判定与 invoke 包装：浏览器预览（pnpm dev）下所有原生能力优雅降级 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;

/** 统一的 invoke 入口；非 Tauri 环境下返回 fallback，不抛错打断 UI */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T | undefined> {
  if (!isTauri()) return fallback;
  try {
    if (!cachedInvoke) {
      const mod = await import("@tauri-apps/api/core");
      cachedInvoke = mod.invoke as unknown as InvokeFn;
    }
    return await cachedInvoke<T>(cmd, args);
  } catch (err) {
    console.warn(`[invoke] ${cmd} 失败`, err);
    return fallback;
  }
}

export async function platform(): Promise<string> {
  if (!isTauri()) return "web";
  const mod = await import("@tauri-apps/plugin-os");
  try {
    return mod.platform();
  } catch {
    return "unknown";
  }
}

export const IS_MAC = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
/** 快捷键展示用：macOS 显示 ⌘，其它显示 Ctrl */
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";