import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/util";
import { useUi, type Toast } from "@/store/ui";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const COLORS: Record<Toast["kind"], string> = {
  info: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);

  return createPortal(
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto sheet border border-border rounded-xl px-3 h-9 flex items-center gap-2 text-xs"
            >
              <Icon size={14} className={COLORS[t.kind]} />
              <span className="text-text max-w-[320px] truncate">{t.text}</span>
              {t.actionLabel && (
                <button
                  className="ml-1 px-2 h-6 rounded-md bg-primary/15 text-primary font-medium hover:bg-primary/25 transition-colors"
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id);
                  }}
                >
                  {t.actionLabel}
                </button>
              )}
              <button className={cn("icon-btn w-6 h-6")} onClick={() => dismiss(t.id)} aria-label="关闭提示">
                <XCircle size={12} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>,
    document.body,
  );
}