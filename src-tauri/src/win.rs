//! 窗口几何：收缩态 Dock / 展开态 Panel 的尺寸常量与位置持久化。
//! 展开/收起改为一次落位（不再逐帧改 HWND 尺寸），避免 WebView2 整页重排掉帧。
//! 同时负责亚克力液态玻璃、圆角、以及窗口跑出屏幕后的回收。

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::window::{Color, Effect, EffectsBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

use crate::error::Result;
use crate::AppState;

/// 收缩态不再预留透明外边距：那圈半透明阴影就是用户看到的黑边。
pub const DOCK_W: f64 = 264.0;
pub const DOCK_H: f64 = 44.0;
pub const DOCK_W_MIN: f64 = 168.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

const KEY: &str = "windowRect";
const KEY_MODE: &str = "windowExpanded";

static USER_HIDDEN: AtomicBool = AtomicBool::new(false);
static GLASS_THEME: AtomicU8 = AtomicU8::new(0);
static GLASS_DARK: AtomicBool = AtomicBool::new(false);

pub async fn load_rect(app: &AppHandle) -> Result<Option<WindowRect>> {
    let db = app.state::<AppState>().db.clone();
    Ok(match db.state_get(KEY).await? {
        Some(raw) => serde_json::from_str::<WindowRect>(&raw).ok(),
        None => None,
    })
}

pub async fn save_rect(app: &AppHandle, rect: WindowRect) -> Result<()> {
    let db = app.state::<AppState>().db.clone();
    db.state_set(KEY, &serde_json::to_string(&rect)?).await
}

pub async fn save_expanded(app: &AppHandle, expanded: bool) -> Result<()> {
    let db = app.state::<AppState>().db.clone();
    db.state_set(KEY_MODE, if expanded { "1" } else { "0" }).await
}

pub async fn load_expanded(app: &AppHandle) -> bool {
    let db = app.state::<AppState>().db.clone();
    db.state_get(KEY_MODE).await.ok().flatten().as_deref() == Some("1")
}

pub fn mark_user_hidden(hidden: bool) {
    USER_HIDDEN.store(hidden, Ordering::Relaxed);
}

/// 启动时定位并显示窗口：优先用持久化位置，否则贴到主屏右下角。
pub fn apply_initial(app: &AppHandle, rect: Option<WindowRect>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let fallback = default_dock_rect(&win);
    let mut rect = rect.unwrap_or(fallback);
    // 旧版本窗口含 12px 透明边。收缩态启动时剥掉 padding，避免那圈黑边残留。
    if rect.height > DOCK_H + 8.0 && rect.height <= DOCK_H + 28.0 {
        let pad = ((rect.height - DOCK_H) / 2.0).clamp(0.0, 16.0);
        rect.x += pad;
        rect.y += pad;
        rect.width = if rect.width <= DOCK_W_MIN + 40.0 {
            DOCK_W_MIN
        } else {
            DOCK_W
        };
        rect.height = DOCK_H;
    }
    apply_rect(&win, &rect);
    ensure_on_screen(&win);
    apply_chrome(&win);
    let _ = win.set_always_on_top(true);
    mark_user_hidden(false);
    let _ = win.show();
    let _ = win.set_focus();
    reapply_skip_taskbar(win.clone());
}

pub fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(3));
            if USER_HIDDEN.load(Ordering::Relaxed) {
                continue;
            }
            let Some(win) = app.get_webview_window("main") else {
                continue;
            };
            if win.is_minimized().unwrap_or(false) {
                let _ = win.unminimize();
            }
            if !win.is_visible().unwrap_or(false) {
                let _ = win.show();
                reapply_skip_taskbar(win.clone());
                apply_chrome(&win);
            }
            ensure_on_screen(&win);
        }
    });
}

pub fn reapply_skip_taskbar(win: tauri::WebviewWindow) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        let _ = win.set_skip_taskbar(true);
        strip_appwindow_flag(&win);
        round_corners(&win);
    });
}

#[cfg(windows)]
mod native {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: isize, index: i32, newlong: isize) -> isize;
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, width: i32, height: i32, flags: u32) -> i32;
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const c_void, size: u32) -> i32;
    }

    pub fn set_rect(hwnd: isize, x: i32, y: i32, width: i32, height: i32) -> bool {
        unsafe { SetWindowPos(hwnd, 0, x, y, width, height, 0x0004 | 0x0010 | 0x0200) != 0 }
    }

    pub fn strip_appwindow_flag(hwnd: isize) {
        const GWL_EXSTYLE: i32 = -20;
        const WS_EX_APPWINDOW: isize = 0x0004_0000;
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            if ex & WS_EX_APPWINDOW != 0 {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !WS_EX_APPWINDOW);
            }
        }
    }

    pub fn round_corners(hwnd: isize) {
        const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
        const DWMWCP_ROUND: u32 = 2;
        let pref = DWMWCP_ROUND;
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const u32 as *const c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(windows)]
fn strip_appwindow_flag(win: &tauri::WebviewWindow) {
    if let Ok(h) = win.hwnd() {
        native::strip_appwindow_flag(h.0 as isize);
    }
}

#[cfg(not(windows))]
fn strip_appwindow_flag(_win: &tauri::WebviewWindow) {}

#[cfg(windows)]
fn round_corners(win: &tauri::WebviewWindow) {
    if let Ok(h) = win.hwnd() {
        native::round_corners(h.0 as isize);
    }
}

#[cfg(not(windows))]
fn round_corners(_win: &tauri::WebviewWindow) {}

pub fn apply_chrome(win: &WebviewWindow) {
    let dark = matches!(win.theme().ok(), Some(tauri::Theme::Dark));
    apply_glass(win, dark);
    round_corners(win);
}

pub fn apply_glass(win: &WebviewWindow, dark: bool) {
    GLASS_DARK.store(dark, Ordering::Relaxed);
    let compact = win.inner_size().ok().zip(win.scale_factor().ok())
        .map(|(size, scale)| size.height as f64 / scale.max(0.5) <= 120.0)
        .unwrap_or(false);
    let clear = compact && !win.is_focused().unwrap_or(true);
    let theme = if clear { 3 } else if dark { 2 } else { 1 };
    if GLASS_THEME.load(Ordering::Relaxed) == theme {
        return;
    }
    if clear {
        if win.set_effects(None::<tauri::utils::config::WindowEffectsConfig>).is_ok() {
            GLASS_THEME.store(theme, Ordering::Relaxed);
        }
        let _ = win.set_background_color(Some(Color(0, 0, 0, 0)));
        return;
    }
    let color = if dark {
        Color(18, 21, 30, 72)
    } else {
        Color(255, 255, 255, 48)
    };
    let effects = EffectsBuilder::new()
        .effect(Effect::Blur)
        .color(color)
        .build();
    if win.set_effects(effects).is_ok() {
        GLASS_THEME.store(theme, Ordering::Relaxed);
    }
    let _ = win.set_background_color(Some(if dark {
        Color(18, 21, 30, 0)
    } else {
        Color(255, 255, 255, 0)
    }));
}

pub fn apply_glass_to_main(app: &AppHandle, dark: bool) {
    if let Some(win) = app.get_webview_window("main") {
        apply_glass(&win, dark);
        round_corners(&win);
    }
}

pub fn refresh_glass(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        apply_glass(&win, GLASS_DARK.load(Ordering::Relaxed));
    }
}

pub fn ensure_main_visible(app: &AppHandle) {
    if USER_HIDDEN.load(Ordering::Relaxed) {
        return;
    }
    if let Some(win) = app.get_webview_window("main") {
        if win.is_minimized().unwrap_or(false) {
            let _ = win.unminimize();
        }
        if !win.is_visible().unwrap_or(false) {
            let _ = win.show();
            reapply_skip_taskbar(win.clone());
        }
        ensure_on_screen(&win);
        round_corners(&win);
    }
}

fn default_dock_rect(win: &tauri::WebviewWindow) -> WindowRect {
    let (x, y, w, h, sf) = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten())
        .map(|m| {
            let wa = m.work_area();
            let scale = m.scale_factor().max(0.5);
            (
                wa.position.x as f64,
                wa.position.y as f64,
                wa.size.width as f64,
                wa.size.height as f64,
                scale,
            )
        })
        .unwrap_or((0.0, 0.0, 1920.0, 1080.0, 1.0));

    let margin = 16.0 * sf;
    let width = (DOCK_W * sf).round();
    let height = (DOCK_H * sf).round();
    WindowRect {
        x: (x + w - width - margin).max(x) / sf,
        y: (y + h - height - margin).max(y) / sf,
        width: DOCK_W,
        height: DOCK_H,
    }
}

fn apply_rect(win: &tauri::WebviewWindow, r: &WindowRect) {
    #[cfg(windows)]
    if let (Ok(handle), Ok(scale)) = (win.hwnd(), win.scale_factor()) {
        if native::set_rect(
            handle.0 as isize,
            (r.x * scale).round() as i32,
            (r.y * scale).round() as i32,
            (r.width.max(1.0) * scale).round() as i32,
            (r.height.max(1.0) * scale).round() as i32,
        ) {
            return;
        }
    }
    let size = LogicalSize::new(r.width.max(1.0), r.height.max(1.0));
    let _ = win.set_size(size);
    let _ = win.set_position(LogicalPosition::new(r.x, r.y));
}

pub fn ensure_on_screen(win: &WebviewWindow) {
    let Ok(pos) = win.outer_position() else {
        return;
    };
    let Ok(size) = win.outer_size() else {
        return;
    };
    let monitors = win.available_monitors().ok().unwrap_or_default();
    if monitors.is_empty() {
        return;
    }

    let visible = monitors.iter().any(|m| {
        let wa = m.work_area();
        let ix = pos.x.max(wa.position.x);
        let iy = pos.y.max(wa.position.y);
        let ax = (pos.x + size.width as i32).min(wa.position.x + wa.size.width as i32);
        let ay = (pos.y + size.height as i32).min(wa.position.y + wa.size.height as i32);
        let w = (ax - ix).max(0);
        let h = (ay - iy).max(0);
        w >= 48 && h >= 24
    });
    if visible {
        return;
    }

    let monitor = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next());
    let Some(monitor) = monitor else {
        return;
    };
    let wa = monitor.work_area();
    let margin = (16.0 * monitor.scale_factor()).round() as i32;
    let x = wa.position.x + wa.size.width as i32 - size.width as i32 - margin;
    let y = wa.position.y + wa.size.height as i32 - size.height as i32 - margin;
    let _ = win.set_position(PhysicalPosition::new(x.max(wa.position.x), y.max(wa.position.y)));
}

pub fn set_rect_now(app: &AppHandle, rect: WindowRect) {
    if let Some(win) = app.get_webview_window("main") {
        apply_rect(&win, &rect);
        apply_glass(&win, GLASS_DARK.load(Ordering::Relaxed));
        ensure_on_screen(&win);
        round_corners(&win);
    }
}

pub fn spawn_morph(app: AppHandle, to: WindowRect, _ms: u64, _reduced: bool) {
    set_rect_now(&app, to);
}

pub fn on_window_resized(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        round_corners(&win);
        if !USER_HIDDEN.load(Ordering::Relaxed) {
            ensure_on_screen(&win);
        }
    }
}
