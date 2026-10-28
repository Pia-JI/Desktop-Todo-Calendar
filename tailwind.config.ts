import type { Config } from "tailwindcss";

/**
 * 主题系统：所有颜色都走 CSS 变量（见 src/styles/themes.css），
 * Tailwind 只负责把 var() 包装成工具类，保证亮/暗色切换零重渲染成本。
 */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-3": "rgb(var(--c-surface-3) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        text: "rgb(var(--c-text) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        primary: "rgb(var(--c-primary) / <alpha-value>)",
        success: "rgb(var(--c-success) / <alpha-value>)",
        warning: "rgb(var(--c-warning) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
      },
      borderRadius: {
        card: "12px",
        panel: "16px",
      },
      boxShadow: {
        soft: "0 1px 2px rgb(var(--c-shadow) / 0.06), 0 8px 24px rgb(var(--c-shadow) / 0.10)",
        lift: "0 2px 6px rgb(var(--c-shadow) / 0.10), 0 18px 48px rgb(var(--c-shadow) / 0.22)",
        dock: "0 4px 14px rgb(var(--c-shadow) / 0.18), 0 16px 40px rgb(var(--c-shadow) / 0.24)",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "Noto Sans SC",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Cascadia Mono", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.22, 1.2, 0.36, 1)",
      },
      keyframes: {
        breathe: {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(1.35)" },
        },
        pulseBorder: {
          "0%,100%": { boxShadow: "0 0 0 0 rgb(var(--c-warning) / 0)" },
          "50%": { boxShadow: "0 0 0 2px rgb(var(--c-warning) / 0.85)" },
        },
        bellBounce: {
          "0%,100%": { transform: "translateY(0) rotate(0deg)" },
          "25%": { transform: "translateY(-4px) rotate(-10deg)" },
          "50%": { transform: "translateY(0) rotate(8deg)" },
          "75%": { transform: "translateY(-2px) rotate(-4deg)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-420px 0" },
          "100%": { backgroundPosition: "420px 0" },
        },
      },
      animation: {
        breathe: "breathe 1.9s cubic-bezier(0.4,0,0.6,1) infinite",
        "pulse-border": "pulseBorder 0.55s ease-in-out 3",
        "bell-bounce": "bellBounce 0.7s cubic-bezier(0.22,1.2,0.36,1) 2",
        shimmer: "shimmer 1.3s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
