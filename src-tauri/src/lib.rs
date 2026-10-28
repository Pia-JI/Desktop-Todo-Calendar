//! 桌面待办日历 · Tauri 2 主入口
//!
//! 架构：
//! - 前端（React）通过 tauri-plugin-sql 直连 SQLite 做 CRUD
//! - Rust 侧持有独立 sqlx 连接池，负责：schema 迁移、到期扫描、晨报、每日快照、
//!   ICS 解析/生成、附件、系统托盘、全局热键、窗口位置持久化、日志与诊断
//! - 两侧共享同一个 db 文件，靠 WAL + busy_timeout 保证并发写安全

mod attachments;
mod backup;
mod commands;
mod db;
mod error;
mod ics;
mod logs;
mod notify;
mod scheduler;
mod serialize;
mod timeutil;
mod tray;
mod win;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::ShortcutState;

pub struct AppState {
    pub db: db::Db,
    pub logs: logs::LogStore,
    /// 托盘是否创建成功；托盘句柄用 app.tray_by_id(tray::TRAY_ID) 现取，
    /// 避免在 managed state 里跨线程持有平台句柄。
    pub tray_ok: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = try_run() {
        eprintln!("[fatal] 应用启动失败: {e}");
        std::process::exit(1);
    }
}

fn try_run() -> Result<(), Box<dyn std::error::Error>> {
    // 全局热键：Ctrl/Cmd+Shift+Q 一键切换展开/收起（无论窗口是否聚焦）
    let global_shortcut = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcuts(["CommandOrControl+Shift+Q"])?
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit("app://hotkey", "toggle");
            }
        })
        .build();

    let minimized = std::env::args().any(|a| a == "--minimized");

    tauri::Builder::default()
        // 单实例必须最先注册
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            crate::win::mark_user_hidden(false);
            crate::tray::reveal(app);
        }))
        .plugin(global_shortcut)
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_sql::Builder::default().build())
        // 桌面端通知插件不提供 action 回调（仅移动端支持），「完成 / 推迟 10 分钟」
        // 按钮降级到应用内「通知中心」承接，详见 notify.rs 的平台能力说明。
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::app_meta,
            commands::load_window_state,
            commands::save_window_state,
            commands::load_window_expanded,
            commands::set_window_rect,
            commands::morph_window,
            commands::set_window_pinned,
            commands::set_window_glass,
            commands::rescue_main_window,
            commands::show_main_window,
            commands::hide_main_window,
            commands::get_ics_content,
            commands::export_ics,
            commands::import_ics,
            commands::export_json,
            commands::import_json,
            commands::export_csv,
            commands::snapshot_now,
            commands::list_snapshots,
            commands::restore_snapshot,
            commands::delete_snapshot,
            commands::run_sync,
            commands::import_attachment,
            commands::resolve_attachment,
            commands::delete_attachment,
            commands::reveal_in_folder,
            commands::scan_reminders_now,
            commands::reminders_ready,
            commands::refresh_tray,
            commands::spawn_next_occurrence,
            commands::read_logs,
            commands::clear_logs,
            commands::export_diagnostics,
            commands::open_path,
            commands::check_update,
            commands::notification_status,
            commands::notification_test,
            commands::quit_app,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            let log_store = logs::LogStore::new();
            let data_dir = handle.path().app_data_dir()?;
            log_store.set_dir(data_dir.join("logs"));
            log_store.info(
                "app",
                format!("启动 v{} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS),
            );

            // 建库 + 迁移（Rust 是 schema 唯一真源）
            let database = tauri::async_runtime::block_on(db::connect(&handle))
                .map_err(|e| e.to_string())?;
            log_store.info("db", format!("数据库就绪: {}", database.path.display()));

            app.manage(AppState {
                db: database,
                logs: log_store.clone(),
                tray_ok: AtomicBool::new(false),
            });

            // 系统托盘
            match tray::build(&handle) {
                Ok(()) => {
                    app.state::<AppState>().tray_ok.store(true, Ordering::Relaxed);
                    log_store.info("tray", "托盘已创建");
                }
                Err(e) => log_store.warn("tray", format!("托盘创建失败（降级为仅窗口模式）: {e}")),
            }

            // 恢复窗口位置；--minimized（开机自启）时保持收缩态且不抢焦点
            let rect = tauri::async_runtime::block_on(win::load_rect(&handle))
                .ok()
                .flatten();
            win::apply_initial(&handle, rect);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.emit("app://boot", minimized);
                if !minimized {
                    let _ = w.set_focus();
                }
            }
            win::spawn_watchdog(handle.clone());

            // 后台定时任务（tokio interval，非阻塞）
            scheduler::spawn_all(handle.clone());
            log_store.info("scheduler", "已启动：到期扫描 15s / 晨报 60s / 快照 1h");

            // 系统通知标识：Windows 上必须注册 AUMID，否则 toast 会被系统静默丢弃
            log_store.info("notify", crate::notify::ensure_ready());

            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮 = 隐藏到托盘（常驻型应用的标准行为），退出走托盘菜单
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    crate::win::mark_user_hidden(true);
                    let _ = window.hide();
                    let _ = window.emit("app://window-hidden", ());
                }
            }
            if let tauri::WindowEvent::Focused(focused) = event {
                if window.label() == "main" {
                    crate::win::refresh_glass(window.app_handle());
                    if !focused {
                        let _ = window.emit("app://window-blur", ());
                    }
                }
            }
            if matches!(
                event,
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) && window.label() == "main"
            {
                crate::win::on_window_resized(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .map_err(|e| e.to_string())?;

    Ok(())
}
