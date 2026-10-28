/** 故障排查：最近通知记录、运行日志、导出诊断包、打开数据目录、立即扫描 */

import { FileDown, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke, isTauri } from "@/lib/platform";
import { cn } from "@/lib/util";
import { useUi } from "@/store/ui";
import { Dialog } from "./Dialog";
import type { LogLine, ReminderLog } from "@/types";

export function DiagnosticsView() {
  const open = useUi((s) => s.diagnosticsOpen);
  const setOpen = useUi((s) => s.setDiagnosticsOpen);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [reminders, setReminders] = useState<ReminderLog[]>([]);
  const toast = useUi((s) => s.toast);

  const reload = async () => {
    const l = await invoke<LogLine[]>("read_logs");
    setLogs(l ?? []);
    // 通知记录直接读库
    const { getRepo } = await import("@/lib/db");
    const repo = await getRepo();
    const rows = await repo.all("reminders_log").catch(() => []);
    setReminders(
      (rows as Record<string, unknown>[])
        .map((r) => ({
          id: String(r.id),
          todoId: (r.todo_id as string) ?? null,
          sentAt: String(r.sent_at),
          channel: String(r.channel),
          body: (r.body as string) ?? null,
          ok: Number(r.ok) === 1,
          error: (r.error as string) ?? null,
        }))
        .slice(0, 50),
    );
  };

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="故障排查" width={620}>
      <div className="flex items-center gap-2 mb-3">
        <button className="btn-ghost h-7 text-xs" onClick={() => void reload()}><RefreshCw size={12} /> 刷新</button>
        <button className="btn-ghost h-7 text-xs" onClick={async () => { await invoke("scan_reminders_now"); toast({ text: "已触发一次到期扫描", kind: "info" }); void reload(); }}>
          立即扫描提醒
        </button>
        <button
          className="btn-ghost h-7 text-xs"
          onClick={async () => {
            if (!isTauri()) return toast({ text: "仅桌面端可用", kind: "warning" });
            const { save } = await import("@tauri-apps/plugin-dialog");
            const path = await save({ defaultPath: "diagnostics.json" });
            if (path && typeof path === "string") {
              await invoke("export_diagnostics", { path });
              toast({ text: `诊断包已导出：${path}`, kind: "success" });
            }
          }}
        >
          <FileDown size={12} /> 导出诊断包
        </button>
        <button className="btn-ghost h-7 text-xs" onClick={async () => { const m = await invoke<{ dataDir: string }>("app_meta"); if (m) await invoke("open_path", { path: m.dataDir }); }}>
          <FolderOpen size={12} /> 数据目录
        </button>
        <button className="btn-danger h-7 text-xs ml-auto" onClick={async () => { await invoke("clear_logs"); void reload(); }}>
          <Trash2 size={12} /> 清空日志
        </button>
      </div>

      <div className="text-2xs font-semibold text-muted mb-1">最近通知发送记录</div>
      <div className="max-h-[140px] overflow-y-auto scroll-thin mb-4 space-y-0.5">
        {reminders.length === 0 && <div className="text-2xs text-muted py-3 text-center">暂无记录</div>}
        {reminders.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-2xs px-1">
            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", r.ok ? "bg-success" : "bg-danger")} />
            <span className="text-muted tabular-nums shrink-0">{r.sentAt.replace("T", " ").slice(0, 19)}</span>
            <span className="text-text truncate flex-1">{r.body}</span>
            {r.error && <span className="text-danger truncate max-w-[160px]">{r.error}</span>}
          </div>
        ))}
      </div>

      <div className="text-2xs font-semibold text-muted mb-1">运行日志</div>
      <div className="max-h-[220px] overflow-y-auto scroll-thin font-mono text-2xs space-y-0.5 bg-surface/50 rounded-lg p-2 border border-border/50">
        {logs.length === 0 && <div className="text-muted text-center py-3">暂无日志</div>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-muted/70 shrink-0 tabular-nums">{l.at.replace("T", " ").slice(0, 19)}</span>
            <span className={cn("shrink-0 w-10", l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warning" : "text-success")}>{l.level}</span>
            <span className="text-muted shrink-0">[{l.source}]</span>
            <span className="text-text break-all">{l.message}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}