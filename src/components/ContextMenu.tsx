import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/util";
import { useMenu } from "@/store/menu";

const ITEM_W = 190;
const ITEM_H = 30;

export function ContextMenuHost() {
  const { open, x, y, items, close } = useMenu();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const visible = items.filter((i) => !i.separator).length;
  const sepCount = items.length - visible;
  const height = visible * ITEM_H + sepCount * 9 + 8;
  const left = Math.min(x, window.innerWidth - ITEM_W - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ left, top, width: ITEM_W }}
            className="fixed z-[91] sheet border border-border rounded-xl py-1 overflow-hidden"
            onContextMenu={(e) => e.preventDefault()}
          >
            {items.map((item, idx) =>
              item.separator ? (
                <div key={idx} className="h-px bg-border mx-2 my-1" />
              ) : (
                <button
                  key={idx}
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onClick?.();
                  }}
                  className={cn(
                    "w-full h-[30px] px-2.5 flex items-center gap-2 text-xs transition-colors",
                    item.danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-surface-2",
                    item.disabled && "opacity-40 pointer-events-none",
                  )}
                >
                  {item.icon ? <item.icon size={13} className="shrink-0 opacity-80" /> : <span className="w-[13px]" />}
                  <span className="truncate flex-1 text-left">{item.label}</span>
                  {item.checked && <Check size={12} className="text-primary" />}
                </button>
              ),
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}