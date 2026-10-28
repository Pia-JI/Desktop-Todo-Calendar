import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// 移除首屏骨架
window.addEventListener("load", () => {
  document.getElementById("boot")?.remove();
});
// 兜底：即便 load 未触发，1.5s 后也移除骨架，保证冷启动观感 <=2s
window.setTimeout(() => document.getElementById("boot")?.remove(), 1500);