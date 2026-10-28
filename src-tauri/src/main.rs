// 桌面待办日历 · Tauri 2 入口（Windows 生产环境隐藏控制台窗口）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    desktop_todo_calendar_lib::run()
}
