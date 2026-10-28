/** 日历格子内的彩色待办条：左侧 3px 优先级色条 + 分类色底 */

import { Check, GripVertical } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { rgba, soft, textOn } from "@/lib/colors";
import { parse, timeLabel } from "@/lib/date";
import { cn, humanMinutes } from "@/lib/util";
import { openTodoMenu } from "@/lib/todoMenu";
import { useUi } from "@/store/ui";
import type { Todo } from "@/types";

interface Props {
  todo: Todo;
  color: string;
  showTime?: boolean;
  dense?: boolean;
  readonly?: boolean;
  selected?: boolean;
  onResizeStart?: (e: ReactPointerEvent, todo: Todo) => void;
  onSelect?: (e: React.MouseEvent, todo: Todo) => void;
}

export function TodoBar({ todo, color, showTime = true, dense, readonly, selected, onResizeStart, onSelect }: Props) {
  const conflict = useUi((s) => s.conflictIds.includes(todo.id));
  const dragging = useUi((s) => s.todoDrag.id === todo.id && s.todoDrag.active);
  const start = parse(todo.startAt);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readonly || e.button !== 0) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    useUi.getState().beginTodoDrag(todo.id, e.clientX, e.clientY, {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      title: todo.title,
      color,
      time: start && !todo.allDay ? timeLabel(start) : todo.allDay ? "全天" : "",
    });
  };

  return (
    <div
      onPointerDown={onPointerDown}
      onContextMenu={(e) => openTodoMenu(e, todo)}
      onClick={(e) => {
        if (useUi.getState().consumeTodoDragClick()) return;
        if (e.ctrlKey || e.metaKey) {
          onSelect?.(e, todo);
          return;
        }
        useUi.getState().openDrawer({ todoId: todo.id });
      }}
      title={`${todo.title}${start ? ` · ${timeLabel(start)}` : ""}`}
      className={cn(
        "group relative flex items-center gap-1 rounded-md pl-1.5 pr-1 cursor-pointer select-none",
        dense ? "h-[18px]" : "h-[22px]",
        "text-[11px] leading-none overflow-hidden",
        !readonly && "cursor-grab active:cursor-grabbing",
        readonly && "readonly-hatch opacity-80 cursor-default",
        conflict && "animate-pulse-border",
        selected && "ring-2 ring-primary/70",
        todo.completed && "opacity-55",
        dragging && "opacity-35",
      )}
      style={{
        background: soft(color),
        borderLeft: `3px solid ${todo.priority === 1 ? "var(--c-danger)" : todo.priority === 3 ? "var(--c-muted)" : color}`,
        color: textOn(color) === "#FFFFFF" ? "var(--c-text)" : "var(--c-text)",
      }}
    >
      {todo.completed && <Check size={10} className="shrink-0 text-success" />}
      {showTime && start && !todo.allDay && (
        <span className="shrink-0 tabular-nums opacity-70 font-medium">{timeLabel(start)}</span>
      )}
      {todo.allDay && <span className="shrink-0 opacity-70 font-medium">全天</span>}
      <span className={cn("truncate flex-1", todo.completed && "line-through")}>{todo.title}</span>
      {todo.estimatedMin ? (
        <span className="shrink-0 opacity-60 text-2xs">{humanMinutes(todo.estimatedMin)}</span>
      ) : null}
      <GripVertical size={10} className="shrink-0 opacity-0 group-hover:opacity-50" />

      {onResizeStart && !readonly && (
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onResizeStart(e, todo);
          }}
          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 group-hover:opacity-100"
          style={{ background: rgba(color, 0.5) }}
        />
      )}
    </div>
  );
}
