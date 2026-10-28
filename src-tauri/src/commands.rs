//! 全部前端可调用的 Tauri command。
//! 约定：CRUD 走 tauri-plugin-sql（前端直连），凡是需要文件系统 / 系统能力的走这里。

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::backup::ImportReport;
use crate::error::{AppError, Result};
use crate::tray::TrayTodo;
use crate::win::WindowRect;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMeta {
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub data_dir: String,
    pub backup_dir: String,
    pub attachment_dir: String,
    pub db_path: String,
    pub schema_version: i64,
}

#[tauri::command]
pub async fn app_meta(app: AppHandle) -> Result<AppMeta> {
    let data = app.path().app_data_dir()?;
    Ok(AppMeta {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: data.to_string_lossy().to_string(),
        backup_dir: crate::backup::backups_dir(&app)?.to_string_lossy().to_string(),
        attachment_dir: crate::attachments::attachments_dir(&app)?
            .to_string_lossy()
            .to_string(),
        db_path: crate::db::db_path(&app)?.to_string_lossy().to_string(),
        schema_version: crate::db::SCHEMA_VERSION,
    })
}

// ───────────────────────── 窗口几何 ─────────────────────────

#[tauri::command]
pub async fn load_window_state(app: AppHandle) -> Result<Option<WindowRect>> {
    crate::win::load_rect(&app).await
}

#[tauri::command]
pub async fn save_window_state(app: AppHandle, rect: WindowRect, expanded: bool) -> Result<()> {
    crate::win::save_rect(&app, rect).await?;
    crate::win::save_expanded(&app, expanded).await
}

#[tauri::command]
pub async fn load_window_expanded(app: AppHandle) -> Result<bool> {
    Ok(crate::win::load_expanded(&app).await)
}

/// 无动画直接落位（启动恢复 / 浏览器降级路径）
#[tauri::command]
pub fn set_window_rect(app: AppHandle, rect: WindowRect) {
    crate::win::set_rect_now(&app, rect);
}

#[tauri::command]
pub fn morph_window(app: AppHandle, rect: WindowRect, duration_ms: u64, reduced: bool) {
    crate::win::spawn_morph(app, rect, duration_ms, reduced);
}

/// 置顶开关。前端必须走这条命令，而不是直接调 Tauri 的 setAlwaysOnTop：
/// 后者会重算扩展样式并把任务栏按钮带回来（详见 win::reapply_skip_taskbar）。
#[tauri::command]
pub fn set_window_pinned(app: AppHandle, on_top: bool) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(on_top);
        crate::win::reapply_skip_taskbar(win);
    }
}

/// 主题变化时刷新亚克力颜色，让液态玻璃跟亮/暗色一致。
#[tauri::command]
pub fn set_window_glass(app: AppHandle, dark: bool) {
    crate::win::apply_glass_to_main(&app, dark);
}

/// 前端主动把窗口拉回工作区（显示器热插拔 / 分辨率变化后调用）。
#[tauri::command]
pub fn rescue_main_window(app: AppHandle) {
    crate::win::ensure_main_visible(&app);
}

// ───────────────────────── ICS ─────────────────────────

#[tauri::command]
pub async fn get_ics_content(app: AppHandle) -> Result<String> {
    let db = app.state::<AppState>().db.clone();
    crate::ics::generate_from_db(&db).await
}

#[tauri::command]
pub async fn export_ics(app: AppHandle, path: String) -> Result<String> {
    let db = app.state::<AppState>().db.clone();
    let content = crate::ics::generate_from_db(&db).await?;
    let dest = PathBuf::from(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("ics.tmp");
    std::fs::write(&tmp, content.as_bytes())?;
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    std::fs::rename(&tmp, &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn import_ics(app: AppHandle, path: String, calendar_id: Option<String>) -> Result<usize> {
    let db = app.state::<AppState>().db.clone();
    let cid = calendar_id.unwrap_or_else(|| "external".to_string());
    let n = crate::ics::import_ics_file(&db, &PathBuf::from(&path), &cid).await?;
    app.state::<AppState>()
        .logs
        .info("ics", format!("导入 {n} 条外部事件 <- {path}"));
    Ok(n)
}

// ───────────────────────── JSON / CSV ─────────────────────────

#[tauri::command]
pub async fn export_json(app: AppHandle, path: String) -> Result<String> {
    let p = crate::backup::export_json(&app, PathBuf::from(&path)).await?;
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn import_json(app: AppHandle, path: String, overwrite: bool) -> Result<ImportReport> {
    let r = crate::backup::import_json(&app, PathBuf::from(&path), overwrite).await?;
    app.state::<AppState>().logs.info(
        "backup",
        format!("导入完成 inserted={} tables={:?}", r.inserted, r.tables),
    );
    Ok(r)
}

#[tauri::command]
pub async fn export_csv(app: AppHandle, path: String) -> Result<String> {
    let p = crate::backup::export_csv(&app, PathBuf::from(&path)).await?;
    Ok(p.to_string_lossy().to_string())
}

// ───────────────────────── 快照 / 同步 ─────────────────────────

#[tauri::command]
pub async fn snapshot_now(app: AppHandle) -> Result<String> {
    crate::scheduler::snapshot_now(&app).await
}

#[tauri::command]
pub async fn list_snapshots(app: AppHandle) -> Result<Vec<serde_json::Value>> {
    crate::backup::list_snapshots(&app).await
}

#[tauri::command]
pub async fn restore_snapshot(app: AppHandle, path: String) -> Result<ImportReport> {
    crate::backup::import_json(&app, PathBuf::from(&path), true).await
}

#[tauri::command]
pub async fn delete_snapshot(app: AppHandle, path: String) -> Result<()> {
    let db = app.state::<AppState>().db.clone();
    let p = PathBuf::from(&path);
    if p.exists() {
        std::fs::remove_file(&p)?;
    }
    sqlx::query("DELETE FROM snapshots WHERE path = ?1")
        .bind(&path)
        .execute(&db.pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn run_sync(app: AppHandle, dir: String) -> Result<usize> {
    if dir.trim().is_empty() {
        return Err(AppError::msg("未设置同步目录"));
    }
    crate::backup::sync_to_dir(&app, dir.trim()).await
}

// ───────────────────────── 附件 ─────────────────────────

#[tauri::command]
pub async fn import_attachment(app: AppHandle, src: String, todo_id: String) -> Result<String> {
    crate::attachments::import(&app, &src, &todo_id)
}

#[tauri::command]
pub async fn resolve_attachment(app: AppHandle, rel: String) -> Result<String> {
    Ok(crate::attachments::resolve(&app, &rel)?
        .to_string_lossy()
        .to_string())
}

#[tauri::command]
pub async fn delete_attachment(app: AppHandle, rel: String) -> Result<()> {
    crate::attachments::remove(&app, &rel)
}

#[tauri::command]
pub async fn reveal_in_folder(app: AppHandle, path: String) -> Result<()> {
    let p = PathBuf::from(&path);
    // 允许直接揭示任意已存在路径（导出文件、备份目录等）
    if p.exists() {
        return crate::attachments::reveal_path(&p);
    }
    crate::attachments::reveal(&app, &path)
}

// ───────────────────────── 提醒 / 托盘 ─────────────────────────

#[tauri::command]
pub async fn reminders_ready(app: AppHandle) -> Result<()> {
    crate::scheduler::set_reminders_ready();
    crate::scheduler::scan_due(&app).await
}

#[tauri::command]
pub async fn scan_reminders_now(app: AppHandle) -> Result<()> {
    crate::scheduler::scan_now(&app).await
}

#[tauri::command]
pub async fn refresh_tray(app: AppHandle, todos: Vec<TrayTodo>, focus: Option<String>) -> Result<()> {
    crate::tray::refresh(&app, todos, focus).await
}

#[tauri::command]
pub async fn spawn_next_occurrence(app: AppHandle, id: String) -> Result<Option<String>> {
    let db = app.state::<AppState>().db.clone();
    db.spawn_next_occurrence(&id).await
}

// ───────────────────────── 日志 / 诊断 ─────────────────────────

#[tauri::command]
pub async fn read_logs(app: AppHandle) -> Result<Vec<crate::logs::LogLine>> {
    Ok(app.state::<AppState>().logs.list())
}

#[tauri::command]
pub async fn clear_logs(app: AppHandle) -> Result<()> {
    app.state::<AppState>().logs.clear();
    Ok(())
}

#[tauri::command]
pub async fn export_diagnostics(app: AppHandle, path: String) -> Result<String> {
    let db = app.state::<AppState>().db.clone();
    let logs = app.state::<AppState>().logs.list();
    let meta = app_meta(app.clone()).await?;

    let recent: Vec<serde_json::Value> = sqlx::query(
        "SELECT * FROM reminders_log ORDER BY sent_at DESC LIMIT 200",
    )
    .fetch_all(&db.pool)
    .await?
    .iter()
    .map(crate::serialize::row_to_json)
    .collect();

    let counts = sqlx::query(
        "SELECT (SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL) AS todos,
                (SELECT COUNT(*) FROM todos WHERE deleted_at IS NOT NULL) AS trashed,
                (SELECT COUNT(*) FROM external_events) AS external,
                (SELECT COUNT(*) FROM pomodoro_sessions) AS pomo,
                (SELECT COUNT(*) FROM snapshots) AS snapshots",
    )
    .fetch_one(&db.pool)
    .await
    .map(|r| crate::serialize::row_to_json(&r))
    .unwrap_or(serde_json::Value::Null);

    let bundle = serde_json::json!({
        "generatedAt": crate::timeutil::utc_now(),
        "meta": meta,
        "counts": counts,
        "recentReminders": recent,
        "logs": logs,
    });

    crate::backup::atomic_write_json(&PathBuf::from(&path), &bundle)?;
    Ok(path)
}

// ───────────────────────── 杂项 ─────────────────────────

#[tauri::command]
pub async fn open_path(_app: AppHandle, path: String) -> Result<()> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer").arg(&p).spawn().ok();
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open").arg(&p).spawn().ok();
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open").arg(&p).spawn().ok();
        }
        return Ok(());
    }
    crate::attachments::reveal_path(&p)
}

/// 更新检查（二期）：默认关闭，直接返回 disabled，绝不发起网络请求
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub enabled: bool,
    pub current: String,
    pub latest: Option<String>,
    pub note: String,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo> {
    let db = app.state::<AppState>().db.clone();
    let enabled = db.setting_bool("s_updateCheckEnabled", false).await;
    Ok(UpdateInfo {
        enabled,
        current: env!("CARGO_PKG_VERSION").to_string(),
        latest: None,
        note: if enabled {
            "更新检查为二期能力，当前构建未包含下载器；请在发布页手动获取新版本。".into()
        } else {
            "更新检查已关闭（默认）。全部功能离线可用。".into()
        },
    })
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    // 给前端 ~300ms 把待落盘的设置（SQLite 异步写）写完，避免「刚改完设置就退出 → 重启回退」
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(320));
        handle.exit(0);
    });
}

/// 系统通知通道的真实状态（Windows 上对应 AUMID 注册情况）
#[tauri::command]
pub fn notification_status(app: AppHandle) -> crate::notify::NotifyStatus {
    crate::notify::status(&app)
}

/// 发一条测试通知，把真实结果（含错误）回传给设置页
#[tauri::command]
pub fn notification_test(app: AppHandle) -> crate::notify::NotifyOutcome {
    crate::notify::send(&app, "桌面待办日历 · 测试通知", "看到这条系统通知，说明提醒通道已经打通。")
}
/// 显示主窗口。同样不能直接用 Tauri 的 show()：它会重算扩展样式，
/// 让 skipTaskbar 失效；这里走 tray::reveal，内部会补一次 DeleteTab。
#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    crate::tray::reveal(&app);
}

/// 隐藏到托盘（等价于点关闭按钮）
#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    crate::tray::hide(&app);
}
