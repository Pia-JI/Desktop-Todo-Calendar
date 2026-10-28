import { createPortal } from "react-dom";
import { soft } from "@/lib/colors";
import { useUi } from "@/store/ui";

export function TodoDragGhost() {
  const drag = useUi((s) => s.todoDrag);
  if (!drag.active || !drag.id) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[120] rounded-md px-1.5 h-[22px] flex items-center gap-1 text-[11px] leading-none shadow-lift border border-white/40"
      style={{
        left: drag.x - drag.offsetX,
        top: drag.y - drag.offsetY,
        width: Math.max(120, drag.width),
        background: drag.color ? soft(drag.color) : "rgb(var(--c-surface))",
      }}
    >
      {drag.time ? <span className="tabular-nums opacity-70 font-medium">{drag.time}</span> : null}
      <span className="truncate flex-1 text-text">{drag.title}</span>
    </div>,
    document.body,
  );
}
