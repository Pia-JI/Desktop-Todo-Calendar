/** 展开态面板外壳：毛玻璃圆角 + 边栏 + 视图路由 */

import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BatchBar } from "./BatchBar";
import { MonthView } from "@/views/MonthView";
import { WeekView } from "@/views/WeekView";
import { DayView } from "@/views/DayView";
import { ListView } from "@/views/ListView";
import { useUi } from "@/store/ui";
import { useTodos } from "@/store/todos";

export function Panel() {
  const view = useUi((s) => s.view);
  const compact = useUi((s) => s.compact);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const loaded = useTodos((s) => s.loaded);
  const cursor = useUi((s) => s.cursor);

  const effectiveView = compact ? "list" : view;

  return (
    <div className="w-full h-full">
      <div className="relative h-full w-full sheet border border-border rounded-panel overflow-hidden flex flex-col">
        <TopBar />
        <div className="flex-1 flex min-h-0">
          <AnimatePresence initial={false}>
            {sidebarOpen && !compact && (
              <motion.div
                key="sidebar"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 180, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 32 }}
                className="overflow-hidden shrink-0"
              >
                <Sidebar />
              </motion.div>
            )}
          </AnimatePresence>

          <main className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 min-h-0 relative">
              {!loaded ? (
                <div className="h-full p-2 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton h-8" style={{ opacity: 1 - i * 0.13 }} />
                  ))}
                </div>
              ) : (
                <div key={`${effectiveView}:${cursor}`} className="absolute inset-0 calendar-page">
                  {effectiveView === "month" && <MonthView />}
                  {effectiveView === "week" && <WeekView />}
                  {effectiveView === "day" && <DayView />}
                  {effectiveView === "list" && <ListView />}
                </div>
              )}
            </div>
            <BatchBar />
          </main>
        </div>
      </div>
    </div>
  );
}
