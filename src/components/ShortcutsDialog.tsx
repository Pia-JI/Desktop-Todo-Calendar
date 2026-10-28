/** 快捷键总览（? 唤起） */

import { MOD_LABEL } from "@/lib/platform";
import { useUi } from "@/store/ui";
import { Dialog } from "./Dialog";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "全局",
    items: [
      [`${MOD_LABEL}+Shift+Q`, "切换展开 / 收起（系统级热键）"],
      [`${MOD_LABEL}+K`, "命令面板"],
      [`${MOD_LABEL}+N`, "新建待办"],
      [`${MOD_LABEL}+,`, "打开设置"],
      [`${MOD_LABEL}+L`, "锁定应用"],
      [`${MOD_LABEL}+F`, "聚焦搜索"],
      ["?", "快捷键总览"],
      ["Esc", "逐层关闭 / 收起"],
    ],
  },
  {
    title: "视图",
    items: [
      [`${MOD_LABEL}+1`, "月视图"],
      [`${MOD_LABEL}+2`, "周视图"],
      [`${MOD_LABEL}+3`, "日视图"],
      [`${MOD_LABEL}+4`, "列表视图"],
    ],
  },
  {
    title: "编辑",
    items: [
      ["双击格子", "在该日新建待办"],
      ["拖拽待办条", "改期到目标格 / 时间段"],
      ["拖拽下边缘", "调整结束时间（15 分钟吸附）"],
      [`${MOD_LABEL}+点击`, "多选（出现批量工具栏）"],
      ["Tab（标题框）", "应用自然语言解析"],
      ["右键待办", "完成 / 专注 / 推迟 / 删除"],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="快捷键" width={460}>
      <div className="space-y-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="text-2xs font-semibold text-muted mb-1">{g.title}</div>
            <div className="space-y-1">
              {g.items.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between h-7 px-2 rounded-md bg-surface/50">
                  <kbd className="text-2xs font-mono px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text">{k}</kbd>
                  <span className="text-xs text-muted">{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}