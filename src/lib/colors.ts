/** 调色板与对比色：分类固定色全局统一图例 */

export const PALETTE = [
  "#4F6EF7",
  "#7B93FF",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#8B5CF6",
  "#06B6D4",
  "#84CC16",
  "#9AA0B0",
];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 依据背景亮度选择黑/白文字 */
export function textOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#1A1D27" : "#FFFFFF";
}

/** 低饱和背景（用于 chip / 标签） */
export function soft(hex: string, dark = false): string {
  return rgba(hex, dark ? 0.22 : 0.14);
}

export function pickPaletteColor(index: number): string {
  return PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
}