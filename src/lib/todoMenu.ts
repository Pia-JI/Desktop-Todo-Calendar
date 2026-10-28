/** 待办条右键菜单的统一构造，供月/周/日/列表视图复用 */

import { CalendarClock, Check, Copy, Pencil, Play, Trash2, Undo2 } from "lucide-react";
import { useFocus } from "@/store/focus";
import { useMenu, type MenuItem } from "@/store/menu";
import { useTodos } from "@/store/todos";
import { useUi } from "@/store/ui";
import { parse, timeLabel } from "./date";
import type { Todo } from "@/types";

export function todoMenuItems(todo: Todo): MenuItem[] {
  const todos = useTodos.getState();
  const ui = useUi.getState();
  return [
    {
      label: todo.completed ? "标记未完成" : "完成",
      icon: todo.completed ? Undo2 : Check,
      onClick: () => void todos.toggleComplete(todo.id),
    },
    { label: "编辑", icon: Pencil, onClick: () => ui.openDrawer({ todoId: todo.id }) },
    {
      label: "开始专注",
      icon: Play,
      onClick: () => {
        useFocus.getState().start(todo.id, todo.estimatedMin || undefined);
        ui.toast({ text: `开始专注：${todo.title}`, kind: "info" });
      },
    },
    { label: "推迟到明天", icon: CalendarClock, onClick: () => void todos.postponeToTomorrow(todo.id) },
    {
      label: "复制内容",
      icon: Copy,
      onClick: () => {
        const d = parse(todo.startAt);
        const text = `${todo.title}${d ? ` · ${timeLabel(d)}` : ""}`;
        void navigator.clipboard?.writeText(text);
        ui.toast({ text: "已复制到剪贴板", kind: "success" });
      },
    },
    { separator: true },
    { label: "删除", icon: Trash2, danger: true, onClick: () => void todos.softDelete(todo.id) },
  ];
}

export function openTodoMenu(e: React.MouseEvent, todo: Todo) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.getState().openMenu(e.clientX, e.clientY, todoMenuItems(todo));
}