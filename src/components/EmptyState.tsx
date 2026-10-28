import { CalendarHeart } from "lucide-react";
import { motion } from "framer-motion";

export function EmptyState({ hint = "双击格子创建第一条待办" }: { hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col items-center justify-center gap-3 text-muted select-none"
    >
      <div className="relative">
        <CalendarHeart size={44} strokeWidth={1.4} className="opacity-40" />
        <motion.span
          className="absolute -right-1 -top-1 w-2.5 h-2.5 rounded-full bg-primary/70"
          animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <p className="text-xs">{hint}</p>
    </motion.div>
  );
}