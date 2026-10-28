/** 回收站：软删除列表，支持恢复 / 彻底删除 / 清空（二次确认） */

import { RotateCcw, Trash2 } from "lucide-react";
import { fmt, parse } from "@/lib/date";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { Dialog } from "./Dialog";

export function RecycleBin() {
  const open = useUi((s) => s.recycleOpen);
  const setOpen = useUi((s) => s.setRecycleOpen);
  const todos = useTodos((s) => s.todos);
  const trashed = todos.filter((t) => t.deletedAt);

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      title={`回收站（${trashed.length}）`}
      width={480}
      footer={
        trashed.length > 0 ? (
          <button
            className="btn-danger"
            onClick={() => {
              if (window.confirm(`确认清空回收站？将永久删除 ${trashed.length} 项，无法恢复。`)) {
                void useTodos.getState().emptyTrash();
              }
            }}
          >
            <Trash2 size={13} /> 清空回收站
          </button>
        ) : undefined
      }
    >
      {trashed.length === 0 ? (
        <div className="py-10 text-center text-xs text-muted">回收站是空的</div>
      ) : (
        <div className="space-y-1">
          {trashed.map((t) => (
            <div key={t.id} className="flex items-center gap-2 h-9 px-2 rounded-lg bg-surface/60 border border-border/50">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
              <span className="text-xs text-text truncate flex-1 line-through opacity-70">{t.title}</span>
              <span className="text-2xs text-muted">{parse(t.startAt) ? fmt(parse(t.startAt)!, "M-d") : ""}</span>
              <button className="icon-btn w-6 h-6" onClick={() => void useTodos.getState().restore(t.id)} aria-label="恢复">
                <RotateCcw size={12} />
              </button>
              <button
                className="icon-btn w-6 h-6 text-danger"
                onClick={() => {
                  if (window.confirm(`彻底删除「${t.title}」？`)) void useTodos.getState().purge(t.id);
                }}
                aria-label="彻底删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}