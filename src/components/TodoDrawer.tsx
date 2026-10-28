/**
 * 创建/编辑待办抽屉：标题支持自然语言速记（Tab 应用 / Esc 忽略），
 * 子任务清单、附件（<=10MB，存相对路径）、重复、提醒、优先级、分类、颜色。
 */

import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, Image as ImageIcon, Paperclip, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke, isTauri } from "@/lib/platform";
import { parse } from "@/lib/date";
import { PALETTE, soft } from "@/lib/colors";
import { cn, humanMinutes, nowIso, uid } from "@/lib/util";
import { useNlp } from "@/hooks/useNlp";
import { useSettings } from "@/store/settings";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import type { Priority, Repeat, Todo } from "@/types";

const REPEATS: { id: Repeat; label: string }[] = [
  { id: "none", label: "不重复" },
  { id: "daily", label: "每天" },
  { id: "weekly", label: "每周" },
  { id: "monthly", label: "每月" },
];
const REMINDS = [0, 300, 600, 900, 1800, 3600, 86400];

function toLocalInput(isoStr: string | null | undefined): { date: string; time: string } {
  const d = parse(isoStr);
  if (!d) return { date: format(new Date(), "yyyy-MM-dd"), time: "09:00" };
  return { date: format(d, "yyyy-MM-dd"), time: format(d, "HH:mm") };
}

function fromLocalInput(date: string, time: string): string {
  const d = new Date(`${date}T${time || "00:00"}:00`);
  return d.toISOString();
}

export function TodoDrawer() {
  const drawer = useUi((s) => s.drawer);
  const close = useUi((s) => s.closeDrawer);
  const todos = useTodos((s) => s.todos);
  const subtasks = useTodos((s) => s.subtasks);
  const calendars = useTodos((s) => s.calendars);
  const editing = useMemo(() => todos.find((t) => t.id === drawer.todoId) ?? null, [todos, drawer.todoId]);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("10:00");
  const [hasEnd, setHasEnd] = useState(false);
  const [allDay, setAllDay] = useState(false);
  const [priority, setPriority] = useState<Priority>(2);
  const [color, setColor] = useState(PALETTE[0]);
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [remind, setRemind] = useState(900);
  const [estimated, setEstimated] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [attachment, setAttachment] = useState<string | null>(null);
  const [newSub, setNewSub] = useState("");
  const [nlpApplied, setNlpApplied] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const nlp = useNlp(title, !editing);

  useEffect(() => {
    if (!drawer.open) return;
    setNlpApplied(false);
    setNewSub("");
    if (editing) {
      setTitle(editing.title);
      const s = toLocalInput(editing.startAt);
      setDate(s.date);
      setTime(s.time);
      const e = toLocalInput(editing.endAt);
      setEndDate(e.date);
      setEndTime(e.time);
      setHasEnd(!!editing.endAt);
      setAllDay(editing.allDay);
      setPriority(editing.priority);
      setColor(editing.color);
      setCalendarId(editing.calendarId ?? null);
      setRepeat(editing.repeat);
      setRemind(editing.remindBeforeSec);
      setEstimated(editing.estimatedMin ?? null);
      setNotes(editing.notes ?? "");
      setAttachment(editing.attachmentPath ?? null);
    } else {
      const preset = drawer.presetStart ? toLocalInput(drawer.presetStart) : toLocalInput(null);
      setTitle("");
      setDate(preset.date);
      setTime(preset.time);
      setEndDate(preset.date);
      setEndTime(toLocalInput(new Date(Date.now() + 3600_000).toISOString()).time);
      setHasEnd(false);
      setAllDay(drawer.presetAllDay ?? false);
      setPriority(2);
      setColor(PALETTE[0]);
      setCalendarId(calendars.find((c) => !c.readonly)?.id ?? null);
      setRepeat("none");
      setRemind(useSettings.getState().defaultRemindSec);
      setEstimated(null);
      setNotes("");
      setAttachment(null);
    }
    window.setTimeout(() => titleRef.current?.focus(), 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer.open, drawer.todoId]);

  const applyNlp = () => {
    if (!nlp) return;
    setTitle(nlp.cleanedTitle);
    if (nlp.startAt) {
      const s = toLocalInput(nlp.startAt);
      setDate(s.date);
      setTime(s.time);
    }
    if (nlp.endAt) {
      const e = toLocalInput(nlp.endAt);
      setEndDate(e.date);
      setEndTime(e.time);
      setHasEnd(true);
    }
    if (nlp.allDay !== undefined) setAllDay(nlp.allDay);
    if (nlp.priority) setPriority(nlp.priority);
    if (nlp.estimatedMin) setEstimated(nlp.estimatedMin);
    if (nlp.remindBeforeSec !== undefined) setRemind(nlp.remindBeforeSec);
    if (nlp.calendarName) {
      const cal = calendars.find((c) => c.name === nlp.calendarName && !c.readonly);
      if (cal) setCalendarId(cal.id);
    }
    setNlpApplied(true);
  };

  const save = async () => {
    if (!title.trim()) {
      useUi.getState().toast({ text: "标题不能为空", kind: "warning" });
      return;
    }
    const parsed = !editing && nlp?.matched && !nlpApplied ? nlp : null;
    if (parsed) applyNlp();
    const nextTitle = parsed?.cleanedTitle?.trim() || title.trim();
    const nextAllDay = parsed?.allDay ?? allDay;
    const startSource = parsed?.startAt
      ? toLocalInput(parsed.startAt)
      : { date, time };
    const endSource = parsed?.endAt
      ? toLocalInput(parsed.endAt)
      : hasEnd
        ? { date: endDate, time: endTime }
        : null;
    const startAt = nextAllDay ? fromLocalInput(startSource.date, "00:00") : fromLocalInput(startSource.date, startSource.time);
    const endAt = endSource
      ? (nextAllDay ? fromLocalInput(endSource.date, "00:00") : fromLocalInput(endSource.date, endSource.time))
      : null;
    const store = useTodos.getState();
    const payload = {
      title: nextTitle,
      startAt,
      endAt,
      allDay: nextAllDay,
      priority: parsed?.priority ?? priority,
      color,
      calendarId: parsed?.calendarName
        ? calendars.find((c) => c.name === parsed.calendarName && !c.readonly)?.id ?? calendarId
        : calendarId,
      repeat,
      remindBeforeSec: parsed?.remindBeforeSec ?? remind,
      estimatedMin: parsed?.estimatedMin ?? estimated,
      notes: notes || null,
      attachmentPath: attachment,
    };
    if (editing) {
      await store.updateTodo(editing.id, payload);
    } else {
      await store.createTodo(payload);
    }
    close();
  };

  const pickAttachment = async () => {
    if (!isTauri()) {
      useUi.getState().toast({ text: "附件仅在桌面端可用", kind: "warning" });
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, directory: false });
    if (!picked || typeof picked !== "string") return;
    const todoId = editing?.id ?? uid();
    try {
      const rel = await invoke<string>("import_attachment", { src: picked, todoId });
      setAttachment(rel ?? null);
      useUi.getState().toast({ text: "附件已添加", kind: "success" });
    } catch (err) {
      useUi.getState().toast({ text: String(err), kind: "danger" });
    }
  };

  const attachmentUrl = useMemo(() => {
    if (!attachment || !isTauri()) return null;
    return null; // 需要异步 resolve，下面单独处理
  }, [attachment]);
  void attachmentUrl;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!attachment || !isTauri()) {
      setPreviewUrl(null);
      return;
    }
    void (async () => {
      const abs = await invoke<string>("resolve_attachment", { rel: attachment });
      if (!cancelled && abs) setPreviewUrl(convertFileSrc(abs));
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  const mySubtasks = subtasks.filter((s) => s.todoId === editing?.id);

  return createPortal(
    <AnimatePresence>
      {drawer.open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="fixed inset-0 z-[60] bg-black/30"
            onPointerDown={close}
          />
          <motion.aside
            initial={{ x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 16, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-2 bottom-2 right-2 z-[61] w-[400px] max-w-[94vw] sheet border border-border rounded-panel flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 h-12 border-b border-border/60 shrink-0">
              <span className="text-sm font-semibold">{editing ? "编辑待办" : "新建待办"}</span>
              <button className="icon-btn" onClick={close} aria-label="关闭">
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3">
              {/* 标题 + NLP */}
              <div>
                <div className="relative">
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); setNlpApplied(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" && nlp && nlp.matched && !nlpApplied) {
                        e.preventDefault();
                        applyNlp();
                      }
                    }}
                    placeholder="标题，如：明天下午三点开会 #工作 P1 @30min"
                    className="input h-9 text-sm"
                  />
                  {nlp && nlp.matched && !nlpApplied && (
                    <button
                      onClick={applyNlp}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 chip bg-primary/15 text-primary hover:bg-primary/25"
                      title="Tab 应用解析"
                    >
                      <Sparkles size={10} /> 应用
                    </button>
                  )}
                </div>
                {nlp && nlp.matched && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {nlp.tokens.map((t, i) => (
                      <span key={i} className={cn("chip", t.kind === "time" ? "bg-primary/15 text-primary" : t.kind === "priority" ? "bg-danger/15 text-danger" : t.kind === "tag" ? "bg-success/15 text-success" : "bg-surface-2 text-muted")}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 时间 */}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-2xs text-muted">日期</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
                </label>
                {!allDay && (
                  <label className="space-y-1">
                    <span className="text-2xs text-muted">开始</span>
                    <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
                  </label>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[rgb(var(--c-primary))]" />
                  全天
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={hasEnd} onChange={(e) => setHasEnd(e.target.checked)} className="accent-[rgb(var(--c-primary))]" />
                  结束时间
                </label>
              </div>
              {hasEnd && (
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
                  {!allDay && <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="input" />}
                </div>
              )}

              {/* 优先级 / 重复 / 提醒 */}
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-2xs text-muted">优先级</span>
                  <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)} className="input">
                    <option value={1}>P1 重要</option>
                    <option value={2}>P2 普通</option>
                    <option value={3}>P3 低</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-2xs text-muted">重复</span>
                  <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className="input">
                    {REPEATS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-2xs text-muted">提前提醒</span>
                  <select value={remind} onChange={(e) => setRemind(Number(e.target.value))} className="input">
                    {REMINDS.map((r) => <option key={r} value={r}>{r === 0 ? "到点提醒" : humanMinutes(r / 60) || `${r}s`}</option>)}
                  </select>
                </label>
              </div>

              {/* 分类 / 预估 */}
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-2xs text-muted">分类</span>
                  <select value={calendarId ?? ""} onChange={(e) => setCalendarId(e.target.value || null)} className="input">
                    <option value="">未分类</option>
                    {calendars.filter((c) => !c.readonly).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-2xs text-muted">预估（分钟）</span>
                  <input type="number" min={0} value={estimated ?? ""} onChange={(e) => setEstimated(e.target.value ? Number(e.target.value) : null)} className="input" placeholder="如 30" />
                </label>
              </div>

              {/* 颜色 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={cn("w-5 h-5 rounded-full transition-transform", color === c && "ring-2 ring-offset-1 ring-primary scale-110")}
                    style={{ background: c }}
                    aria-label={`颜色 ${c}`}
                  />
                ))}
              </div>

              {/* 备注 */}
              <label className="space-y-1 block">
                <span className="text-2xs text-muted">备注</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input h-auto py-2 resize-none" placeholder="补充说明…" />
              </label>

              {/* 附件 */}
              <div className="space-y-1">
                <span className="text-2xs text-muted">附件（≤10MB）</span>
                <div className="flex items-center gap-2">
                  <button onClick={pickAttachment} className="btn-ghost h-7 text-xs">
                    <Paperclip size={12} /> 添加
                  </button>
                  {attachment && (
                    <>
                      <span className="text-2xs text-muted truncate flex-1">{attachment.split("/").pop()}</span>
                      {previewUrl && /\.(png|jpe?g|gif|webp|svg)$/i.test(attachment) && (
                        <img src={previewUrl} alt="附件预览" className="w-10 h-10 rounded-md object-cover border border-border" />
                      )}
                      {!previewUrl && <ImageIcon size={14} className="text-muted" />}
                      <button className="icon-btn w-6 h-6" onClick={() => void invoke("reveal_in_folder", { path: attachment })} aria-label="打开所在文件夹">
                        <FolderOpen size={12} />
                      </button>
                      <button className="icon-btn w-6 h-6 text-danger" onClick={() => setAttachment(null)} aria-label="移除附件">
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 子任务 */}
              {editing && (
                <div className="space-y-1">
                  <span className="text-2xs text-muted">子任务 {mySubtasks.length ? `(${mySubtasks.filter((s) => s.done).length}/${mySubtasks.length})` : ""}</span>
                  <div className="space-y-0.5">
                    {mySubtasks.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 h-7 px-1 rounded-md hover:bg-surface-2 group">
                        <input type="checkbox" checked={s.done} onChange={() => void useTodos.getState().toggleSubtask(s.id)} className="accent-[rgb(var(--c-primary))]" />
                        <span className={cn("text-xs flex-1 truncate", s.done && "line-through opacity-60")}>{s.title}</span>
                        <button className="icon-btn w-5 h-5 opacity-0 group-hover:opacity-100 text-danger" onClick={() => void useTodos.getState().removeSubtask(s.id)} aria-label="删除子任务">
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newSub.trim()) { void useTodos.getState().addSubtask(editing.id, newSub.trim()); setNewSub(""); } }} placeholder="添加子任务，回车确认" className="input h-7 text-xs" />
                    <button className="icon-btn w-7 h-7" onClick={() => { if (newSub.trim()) { void useTodos.getState().addSubtask(editing.id, newSub.trim()); setNewSub(""); } }} aria-label="添加">
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 px-4 py-3 border-t border-border/60 flex items-center gap-2">
              {editing && (
                <button className="btn-danger" onClick={() => { void useTodos.getState().softDelete(editing.id); close(); }}>
                  <Trash2 size={13} /> 删除
                </button>
              )}
              <div className="flex-1" />
              <button className="btn-ghost" onClick={close}>取消</button>
              <button className="btn-primary" onClick={() => void save()}>保存</button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function newTodoSkeleton(): Partial<Todo> {
  return { createdAt: nowIso(), updatedAt: nowIso() };
}

export { soft };
