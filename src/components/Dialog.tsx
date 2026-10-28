import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/util";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
  height?: number;
  bodyClassName?: string;
  /** 抽屉模式：从右侧滑入 */
  side?: "right" | "center";
  footer?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 560,
  height,
  bodyClassName,
  side = "center",
  footer,
  className,
}: DialogProps) {
  const reduced = useReducedMotion();
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[70] bg-black/45"
            onPointerDown={onClose}
          />
          <motion.div
            key="panel"
            initial={reduced ? { opacity: 0 } : side === "right" ? { x: 24, opacity: 0 } : { y: 8, scale: 0.98, opacity: 0 }}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : side === "right" ? { x: 16, opacity: 0 } : { y: 4, scale: 0.99, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            style={{ width: side === "right" ? Math.min(width, 460) : width, height, maxWidth: "calc(100vw - 32px)" }}
            className={cn(
              "fixed z-[71] sheet border border-border flex flex-col overflow-hidden",
              // 居中不能用 -translate-x/y-1/2：framer-motion 会写内联 transform 把它整条覆盖，
              // 弹层会以左上角对齐视口中心、右下被裁掉（「设置只显示一部分」的根因）。
              // 改用 inset-0 + margin auto 居中，完全不依赖 transform。
              side === "right"
                ? "top-3 bottom-3 right-3 rounded-panel"
                : "inset-0 m-auto h-fit max-h-[calc(100%_-_24px)] rounded-panel",
              className,
            )}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-12 shrink-0 border-b border-border/70">
              <div className="text-sm font-semibold text-text truncate">{title}</div>
              <button className="icon-btn" onClick={onClose} aria-label="关闭">
                <X size={15} />
              </button>
            </div>
            <div className={cn("flex-1 min-h-0 overflow-y-auto scroll-thin p-4", bodyClassName)}>{children}</div>
            {footer && <div className="shrink-0 px-4 py-3 border-t border-border/70 flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
