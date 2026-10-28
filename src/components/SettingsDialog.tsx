/** 设置：主题/外观、提醒、数据与备份、节假日、锁定、关于。全部写入 SQLite settings 表 */

import { Bell, Database, Download, FolderSync, Image as ImageIcon, Lock, Palette, RefreshCw, Settings2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@/lib/platform";
import { cn, humanMinutes } from "@/lib/util";
import { holidayMeta } from "@/hooks/useHolidays";
import { useNotifications } from "@/hooks/useNotifications";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { Dialog } from "./Dialog";
import type { AppMeta, SnapshotRow } from "@/types";

const TABS = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "reminder", label: "提醒", icon: Bell },
  { id: "data", label: "数据", icon: Database },
  { id: "lock", label: "锁定", icon: Lock },
  { id: "about", label: "关于", icon: ImageIcon },
] as const;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/40 last:border-0">
      <div className="min-w-0">
        <div className="text-xs text-text">{label}</div>
        {hint && <div className="text-2xs text-muted mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn("relative w-9 h-5 rounded-full transition-colors", value ? "bg-primary" : "bg-surface-3")}
      role="switch"
      aria-checked={value}
    >
      <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200", value && "translate-x-4")} />
    </button>
  );
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const tab = useUi((s) => s.settingsTab);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const setHolidaysOpen = useUi((s) => s.setHolidaysOpen);
  const s = useSettings();
  const { permission, status, sendTest } = useNotifications();
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [autostart, setAutostart] = useState(false);
  const [pwd1, setPwd1] = useState("");
  const [pwd2, setPwd2] = useState("");
  const toast = useUi((st) => st.toast);

  useEffect(() => {
    if (!open) return;
    void invoke<AppMeta>("app_meta").then((m) => setMeta(m ?? null));
    void invoke<SnapshotRow[]>("list_snapshots").then((r) => setSnapshots(r ?? []));
    if (isTauri()) {
      void (async () => {
        const mod = await import("@tauri-apps/plugin-autostart");
        setAutostart(await mod.isEnabled());
      })();
    }
  }, [open]);

  const hmeta = useMemo(() => holidayMeta(), []);

  const pickSave = async (kind: "ics" | "json" | "csv") => {
    if (!isTauri()) return toast({ text: "导出仅在桌面端可用", kind: "warning" });
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = kind;
    const path = await save({ defaultPath: `todocalendar.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path || typeof path !== "string") return;
    const cmd = kind === "ics" ? "export_ics" : kind === "json" ? "export_json" : "export_csv";
    const out = await invoke<string>(cmd, { path });
    toast({ text: `已导出：${out}`, kind: "success" });
  };

  const pickImport = async () => {
    if (!isTauri()) return toast({ text: "导入仅在桌面端可用", kind: "warning" });
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const path = await pick({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path || typeof path !== "string") return;
    const ok = window.confirm("导入将合并到现有数据（同 id 覆盖）。继续？");
    if (!ok) return;
    const rep = await invoke<{ inserted: number }>("import_json", { path, overwrite: false });
    toast({ text: `导入完成，写入 ${rep?.inserted ?? 0} 行`, kind: "success" });
    await useTodos.getState().load();
  };

  const pickImportIcs = async () => {
    if (!isTauri()) return toast({ text: "导入仅在桌面端可用", kind: "warning" });
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const path = await pick({ multiple: false, filters: [{ name: "iCalendar", extensions: ["ics"] }] });
    if (!path || typeof path !== "string") return;
    const n = await invoke<number>("import_ics", { path, calendarId: "cal-external" });
    toast({ text: `已导入 ${n ?? 0} 条外部日历事件（只读）`, kind: "success" });
    await useTodos.getState().load();
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="设置" width={620} height={480} bodyClassName="flex flex-col">
      <div className="flex flex-1 min-h-0 gap-4">
        <nav className="w-[120px] shrink-0 space-y-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setOpen(true, t.id)}
              className={cn("w-full h-8 px-2 rounded-lg flex items-center gap-2 text-xs transition-[color,background-color,transform] active:scale-95", tab === t.id ? "bg-primary/15 text-primary font-medium" : "text-muted hover:bg-surface-2")}
            >
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </nav>

        <div key={tab} className="flex-1 min-w-0 min-h-0 overflow-y-auto scroll-thin pr-1 calendar-page" style={{ scrollbarGutter: "stable" }}>
          {tab === "general" && (
            <div>
              <Row label="长条显示模式" hint="收缩态 Dock 的内容">
                <select value={s.dockMode} onChange={(e) => s.set({ dockMode: e.target.value as typeof s.dockMode })} className="input w-[130px]">
                  <option value="dateNext">日期 + 下一条</option>
                  <option value="countdown">下一条倒计时</option>
                  <option value="icon">仅图标</option>
                </select>
              </Row>
              <Row label="窗口置顶"><Toggle value={s.alwaysOnTop} onChange={(v) => s.set({ alwaysOnTop: v })} /></Row>
              <Row label="失焦自动收起"><Toggle value={s.autoCollapseOnBlur} onChange={(v) => s.set({ autoCollapseOnBlur: v })} /></Row>
              <Row label="隐藏已完成"><Toggle value={s.hideCompleted} onChange={(v) => s.set({ hideCompleted: v })} /></Row>
              <Row label="开机自启" hint="按平台注册（Windows 注册表 / macOS LaunchAgent）">
                <Toggle value={autostart} onChange={async (v) => {
                  if (!isTauri()) return;
                  const mod = await import("@tauri-apps/plugin-autostart");
                  if (v) await mod.enable(); else await mod.disable();
                  setAutostart(v);
                }} />
              </Row>
              <Row label="每周日回顾弹窗"><Toggle value={s.weeklyReviewEnabled} onChange={(v) => s.set({ weeklyReviewEnabled: v })} /></Row>
              <Row label="启动时检查更新" hint="二期能力，默认关闭且不联网">
                <Toggle value={s.updateCheckEnabled} onChange={(v) => s.set({ updateCheckEnabled: v })} />
              </Row>
              <Row label="工作时段" hint="用于统计与番茄钟">
                <input type="time" value={s.workStart} onChange={(e) => s.set({ workStart: e.target.value })} className="input w-[92px]" />
                <span className="text-muted text-2xs">-</span>
                <input type="time" value={s.workEnd} onChange={(e) => s.set({ workEnd: e.target.value })} className="input w-[92px]" />
              </Row>
            </div>
          )}

          {tab === "appearance" && (
            <div>
              <Row label="主题">
                <select value={s.theme} onChange={(e) => s.set({ theme: e.target.value as typeof s.theme })} className="input w-[110px]">
                  <option value="system">跟随系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </Row>
              <Row label="显示农历 / 节气 / 节日"><Toggle value={s.showLunar} onChange={(v) => s.set({ showLunar: v })} /></Row>
              <Row label="语言">
                <select value={s.language} onChange={(e) => s.set({ language: e.target.value as typeof s.language })} className="input w-[90px]">
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
              </Row>
            </div>
          )}

          {tab === "reminder" && (
            <div>
              <Row
                label="系统通知"
                hint={status?.detail ?? `当前权限：${permission}`}
              >
                <button className="btn-ghost h-7 text-xs" onClick={() => void sendTest()}>发送测试</button>
                <Toggle value={s.notifyEnabled} onChange={(v) => s.set({ notifyEnabled: v })} />
              </Row>
              <Row label="提示音"><Toggle value={s.soundEnabled} onChange={(v) => s.set({ soundEnabled: v })} /></Row>
              <Row label="默认提前提醒" hint="用于新建待办；已有待办请在编辑中修改">
                <select value={s.defaultRemindSec} onChange={(e) => s.set({ defaultRemindSec: Number(e.target.value) })} className="input w-[110px]">
                  {[0, 300, 600, 900, 1800, 3600].map((v) => <option key={v} value={v}>{v === 0 ? "到点提醒" : humanMinutes(v / 60)}</option>)}
                </select>
              </Row>
              <Row label="重复提醒间隔（分钟）" hint="应用于所有未完成待办；到点至少提醒一次">
                <input type="number" min={1} value={s.repeatRemindIntervalMin} onChange={(e) => s.set({ repeatRemindIntervalMin: Math.max(1, Number(e.target.value)) })} className="input w-[80px]" />
              </Row>
              <Row label="最多重复次数">
                <input type="number" min={0} max={20} value={s.repeatRemindCount} onChange={(e) => s.set({ repeatRemindCount: Math.min(20, Math.max(0, Number(e.target.value))) })} className="input w-[80px]" />
              </Row>
              <Row label="每日晨报">
                <input type="time" value={s.digestTime} onChange={(e) => s.set({ digestTime: e.target.value })} className="input w-[92px]" />
                <Toggle value={s.digestEnabled} onChange={(v) => s.set({ digestEnabled: v })} />
              </Row>
              <Row label="番茄钟 专注 / 休息（分钟）">
                <input type="number" min={1} value={s.pomodoroFocusMin} onChange={(e) => s.set({ pomodoroFocusMin: Number(e.target.value) })} className="input w-[70px]" />
                <span className="text-muted text-2xs">/</span>
                <input type="number" min={1} value={s.pomodoroBreakMin} onChange={(e) => s.set({ pomodoroBreakMin: Number(e.target.value) })} className="input w-[70px]" />
              </Row>
            </div>
          )}

          {tab === "data" && (
            <div>
              <Row label="每日自动快照" hint="保留最近 30 份">
                <Toggle value={s.autoSnapshot} onChange={(v) => s.set({ autoSnapshot: v })} />
              </Row>
              <Row label="立即备份">
                <button className="btn-ghost h-7 text-xs" onClick={async () => { const p = await invoke<string>("snapshot_now"); setSnapshots(await invoke<SnapshotRow[]>("list_snapshots") ?? []); toast({ text: `快照：${p}`, kind: "success" }); }}>
                  <Download size={12} /> 备份
                </button>
              </Row>
              <div className="py-2 space-y-1 max-h-[140px] overflow-y-auto scroll-thin">
                {snapshots.map((sp) => (
                  <div key={sp.id} className="flex items-center gap-2 text-2xs text-muted">
                    <span className="flex-1 truncate">{sp.path}</span>
                    <span>{(sp.sizeBytes / 1024).toFixed(1)}KB</span>
                    <button className="icon-btn w-5 h-5" onClick={async () => { await invoke("restore_snapshot", { path: sp.path }); await useTodos.getState().load(); toast({ text: "已恢复该快照", kind: "success" }); }} aria-label="恢复">
                      <RefreshCw size={10} />
                    </button>
                  </div>
                ))}
                {snapshots.length === 0 && <div className="text-2xs text-muted">暂无快照</div>}
              </div>
              <Row label="导出">
                <button className="btn-ghost h-7 text-xs" onClick={() => void pickSave("ics")}>.ics</button>
                <button className="btn-ghost h-7 text-xs" onClick={() => void pickSave("json")}>.json</button>
                <button className="btn-ghost h-7 text-xs" onClick={() => void pickSave("csv")}>.csv</button>
              </Row>
              <Row label="导入 JSON">
                <button className="btn-ghost h-7 text-xs" onClick={() => void pickImport()}><Upload size={12} /> 选择文件</button>
              </Row>
              <Row label="导入外部日历" hint=".ics 事件以只读灰条叠在月历/日视图，用于避让已有会议">
                <button className="btn-ghost h-7 text-xs" onClick={() => void pickImportIcs()}><Upload size={12} /> 选择 .ics</button>
              </Row>
              <Row label="同步目录" hint="定时把 db 与 backups 复制到该目录（WebDAV 为二期）">
                <input value={s.syncDir} onChange={(e) => s.set({ syncDir: e.target.value })} placeholder="如 D:\Sync\TodoCal" className="input w-[180px]" />
                <button className="icon-btn w-7 h-7" onClick={async () => { const n = await invoke<number>("run_sync", { dir: s.syncDir }); toast({ text: `已同步 ${n} 个文件`, kind: "success" }); }} aria-label="立即同步">
                  <FolderSync size={13} />
                </button>
              </Row>
              <Row label="节假日数据">
                <button className="btn-ghost h-7 text-xs" onClick={() => setHolidaysOpen(true)}>修正（{hmeta.years.join("/")}）</button>
              </Row>
              {meta && (
                <div className="pt-2 text-2xs text-muted space-y-0.5">
                  <div>数据目录：{meta.dataDir}</div>
                  <div>数据库：{meta.dbPath}（schema v{meta.schemaVersion}）</div>
                </div>
              )}
            </div>
          )}

          {tab === "lock" && (
            <div>
              <Row label="启用应用锁定" hint="Cmd/Ctrl+L 锁定；敏感字段加密为二期">
                <Toggle value={s.lockEnabled} onChange={(v) => s.set({ lockEnabled: v })} />
              </Row>
              <div className="py-2 space-y-2">
                <input type="password" value={pwd1} onChange={(e) => setPwd1(e.target.value)} placeholder="设置主密码" className="input" />
                <input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="再次输入" className="input" />
                <button
                  className="btn-primary h-7 text-xs"
                  onClick={async () => {
                    if (!pwd1 || pwd1 !== pwd2) return toast({ text: "两次密码不一致", kind: "danger" });
                    const hash = await sha256(pwd1);
                    s.set({ lockHash: hash, lockEnabled: true });
                    setPwd1(""); setPwd2("");
                    toast({ text: "主密码已设置", kind: "success" });
                  }}
                >
                  保存密码
                </button>
                {s.lockEnabled && <button className="btn-ghost h-7 text-xs" onClick={() => useUi.getState().setLocked(true)}>立即锁定</button>}
              </div>
            </div>
          )}

          {tab === "about" && (
            <div className="space-y-2 text-xs text-muted">
              <div className="text-sm font-semibold text-text">桌面待办日历</div>
              <div>版本 {meta?.version ?? "0.1.0"} · {meta?.platform ?? "web"} / {meta?.arch ?? "-"}</div>
              <p className="leading-5">
                常驻桌面的轻量待办日历。全部数据离线存储于本地 SQLite（WAL），不联网、无账号。
                通知在 Windows 上为系统 toast（按钮回调由应用内通知中心承接），macOS 支持原生 action。
              </p>
              <button className="btn-ghost h-7 text-xs" onClick={() => { setOpen(false); useUi.getState().setShortcutsOpen(true); }}>快捷键总览</button>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
