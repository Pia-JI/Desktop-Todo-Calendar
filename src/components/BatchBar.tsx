/** 多选批量操作工具栏：Ctrl/Cmd+点击多选后从底部滑入 */

import { AnimatePresence, motion } from "framer-motion";
import { CalendarClock, Check, Trash2, X } from "lucide-react";
import { useTodos } from "@/store/todos";

export function BatchBar() {
  const selected = useTodos((s) => s.selected);
  const clear = useTodos((s) => s.clearSelected);
  const bulkComplete = useTodos((s) => s.bulkComplete);
  const bulkDelete = useTodos((s) => s.bulkDelete);
  const bulkPostpone = useTodos((s) => s.bulkPostpone);

  return (
    <AnimatePresence>
      {selected.length > 0 && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="shrink-0 h-10 px-3 flex items-center gap-2 border-t border-border/60 glass"
        >
          <span className="text-xs text-muted">已选 {selected.length} 项</span>
          <div className="flex-1" />
          <button className="btn-ghost h-7" onClick={() => void bulkComplete(selected, true)}>
            <Check size={13} className="text-success" /> 完成
          </button>
          <button className="btn-ghost h-7" onClick={() => void bulkPostpone(selected)}>
            <CalendarClock size={13} /> 推迟到明天
          </button>
          <button className="btn-danger h-7" onClick={() => void bulkDelete(selected)}>
            <Trash2 size={13} /> 删除
          </button>
          <button className="icon-btn w-7 h-7" onClick={clear} aria-label="取消选择">
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}