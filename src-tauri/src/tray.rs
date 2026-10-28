//! 系统托盘：图标 + 动态菜单（预览今日最多 5 条待办）+ 快捷操作。
//! 菜单在前端数据变化后通过 refresh_tray 命令重建，避免每次点击都查库。

use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::Result;
use crate::AppState;

/// 托盘 id：refresh 时用 app.tray_by_id(TRAY_ID) 现取句柄
pub const TRAY_ID: &str = "main-tray";

// 作为 refresh_tray 命令的入参，必须同时可反序列化
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayTodo {
    pub id: String,
    pub title: String,
    pub time: String,
    pub priority: i32,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayAction {
    pub action: String,
    pub todo_id: Option<String>,
}

pub fn emit_action(app: &AppHandle, action: &str, todo_id: Option<String>) {
    let _ = app.emit(
        "app://tray",
        TrayAction {
            action: action.to_string(),
            todo_id,
        },
    );
}

/// 构建托盘（在 setup 中调用一次）
pub fn build(app: &AppHandle) -> Result<()> {
    let menu = build_menu(app, &[], None)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("桌面待办日历")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str().to_string();
            if let Some(todo_id) = id.strip_prefix("open-todo:") {
                reveal(app);
                emit_action(app, "open-todo", Some(todo_id.to_string()));
                return;
            }
            match id.as_str() {
                "quit" => {
                    let _ = app.emit("app://tray", TrayAction { action: "quit".into(), todo_id: None });
                    // 留 320ms 让前端的设置写入落盘，否则「刚改完就退出」会让设置回退
                    let handle = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(320));
                        handle.exit(0);
                    });
                }
                "hide" => hide(app),
                // 其余动作都要先把窗口从托盘唤出来：skipTaskbar=true 后没有任务栏图标，
                // 若窗口处于隐藏态，只改前端状态会出现「点了菜单没反应」。
                other => {
                    if other != "collapse" {
                        reveal(app);
                    }
                    emit_action(app, other, None);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击 = 唤出窗口并切换展开/收起；菜单只走右键
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                reveal(app);
                emit_action(app, "toggle", None);
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn build_menu(
    app: &AppHandle,
    todos: &[TrayTodo],
    focus: Option<&str>,
) -> Result<tauri::menu::Menu<tauri::Wry>> {
    let mut builder = MenuBuilder::new(app);

    let header_text = if todos.is_empty() {
        "今日暂无待办".to_string()
    } else {
        format!("今日 {} 件事", todos.len())
    };
    builder = builder.item(&MenuItemBuilder::new(header_text).id("header").enabled(false).build(app)?);

    if let Some(f) = focus {
        builder = builder.item(
            &MenuItemBuilder::new(format!("⏱ 专注中：{f}"))
                .id("focus-info")
                .enabled(false)
                .build(app)?,
        );
        builder = builder.item(&MenuItemBuilder::new("停止专注").id("focus-stop").build(app)?);
    }

    for t in todos.iter().take(5) {
        let mark = if t.completed { "✓" } else { "·" };
        let p = match t.priority {
            1 => "P1",
            3 => "P3",
            _ => "P2",
        };
        let label = format!("{mark} {} [{}] {}", t.time, p, truncate(&t.title, 18));
        builder = builder.item(&MenuItemBuilder::new(label).id(format!("open-todo:{}", t.id)).build(app)?);
    }

    builder = builder.item(&PredefinedMenuItem::separator(app)?);
    builder = builder.item(&MenuItemBuilder::new("展开面板").id("expand").build(app)?);
    builder = builder.item(&MenuItemBuilder::new("收起为长条").id("collapse").build(app)?);
    builder = builder.item(&MenuItemBuilder::new("隐藏到托盘").id("hide").build(app)?);
    builder = builder.item(&MenuItemBuilder::new("新建待办").id("new").build(app)?);
    builder = builder.item(&MenuItemBuilder::new("回到今日").id("today").build(app)?);
    builder = builder.item(&PredefinedMenuItem::separator(app)?);
    builder = builder.item(&MenuItemBuilder::new("统计").id("stats").build(app)?);
    builder = builder.item(&MenuItemBuilder::new("设置").id("settings").build(app)?);
    builder = builder.item(&MenuItemBuilder::new("故障排查").id("diagnostics").build(app)?);
    builder = builder.item(&PredefinedMenuItem::separator(app)?);
    builder = builder.item(&MenuItemBuilder::new("退出").id("quit").build(app)?);

    Ok(builder.build()?)
}

fn truncate(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

/// 重建托盘菜单与 tooltip
pub async fn refresh(app: &AppHandle, todos: Vec<TrayTodo>, focus: Option<String>) -> Result<()> {
    if !app.state::<AppState>().tray_ok.load(Ordering::Relaxed) {
        return Ok(());
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    let menu = build_menu(app, &todos, focus.as_deref())?;
    let _ = tray.set_menu(Some(menu));

    let pending = todos.iter().filter(|t| !t.completed).count();
    let tip = if let Some(f) = focus.as_ref() {
        format!("桌面待办日历 · 专注中 {f}")
    } else if pending > 0 {
        format!("桌面待办日历 · 今日还有 {pending} 件未完成")
    } else {
        "桌面待办日历".to_string()
    };
    let _ = tray.set_tooltip(Some(tip.as_str()));
    Ok(())
}
/// 把窗口从托盘唤出。skipTaskbar=true 后没有任务栏图标，托盘是唯一入口，
/// 因此任何「要看到界面」的菜单动作都必须先 show，否则窗口隐藏时点了没反应。
pub fn reveal(app: &AppHandle) {
    crate::win::mark_user_hidden(false);
    if let Some(w) = app.get_webview_window("main") {
        if w.is_minimized().unwrap_or(false) {
            let _ = w.unminimize();
        }
        if !w.is_visible().unwrap_or(true) {
            let _ = w.show();
            // show() 会重算扩展样式把任务栏按钮带回来，补一次清理
            crate::win::reapply_skip_taskbar(w.clone());
        }
        crate::win::ensure_on_screen(&w);
        crate::win::apply_chrome(&w);
        let _ = w.set_focus();
    }
}

/// 隐藏到托盘，并通知前端收起面板（与关闭按钮行为一致）
pub fn hide(app: &AppHandle) {
    crate::win::mark_user_hidden(true);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        let _ = app.emit("app://window-hidden", ());
    }
}
