//! 系统通知发送（Windows toast / macOS NSUserNotification / Linux libnotify）。
//!
//! Windows 上「权限 granted 但从来没弹过系统通知」的根因（已核对 tauri-plugin-notification 2.4 源码）：
//! - 桌面端插件把 `permission_state()` 硬编码成 `Granted`，所以设置页永远显示 granted；
//! - 插件在安装版里会把 AUMID 设成 `com.desktop.todocalendar`，而**未在系统里注册这个
//!   AppUserModelID 的 Win32 应用，toast 会被 Windows 静默丢弃**（`Show()` 仍返回 Ok）；
//! - 插件还把真正的 `show()` 丢进 spawn 里 `let _ =`，错误完全吞掉，所以 reminders_log 里
//!   永远是 `ok=1`。
//!
//! 因此这里改成：
//! 1) 启动/每次发送前确保 `HKCU\Software\Classes\AppUserModelId\<id>` 已注册（DisplayName + IconUri），
//!    这是未打包 Win32 应用显示 toast 的必要条件；
//! 2) Windows 上直接用 winrt 发送，能拿到真实错误写进 reminders_log；
//! 3) 给设置页一个能自检的 `status()` / `send_test()`。
//!
//! 平台能力边界：桌面端插件只暴露 title/body，没有 action 回调
//! （`registerActionTypes` / `onAction` 仅 Android / iOS 有效）。
//! 因此「完成 / 推迟 10 分钟」按钮统一降级到应用内「通知中心」承接。
use serde::Serialize;
use tauri::AppHandle;

#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

pub const APP_ID: &str = "com.desktop.todocalendar";
pub const APP_NAME: &str = "桌面待办日历";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyOutcome {
    pub ok: bool,
    pub error: Option<String>,
    pub permission: String,
}

/// 设置页展示的「系统通知通道」真实状态
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyStatus {
    pub platform: String,
    pub aumid: String,
    /// Windows 上表示 AUMID 是否已注册；其他平台恒为 true（由系统授权决定）
    pub registered: bool,
    /// 面向用户的说明文案
    pub detail: String,
}

#[allow(dead_code)]
pub fn permission_state(_app: &AppHandle) -> String {
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::PermissionState;
        return match _app.notification().permission_state() {
            Ok(PermissionState::Granted) => "granted".into(),
            Ok(PermissionState::Denied) => "denied".into(),
            Ok(PermissionState::Prompt) | Ok(PermissionState::PromptWithRationale) => "prompt".into(),
            Err(_) => "unknown".into(),
        };
    }
    // Windows 桌面端没有可查询的通知授权：能否弹出只取决于 AUMID 是否注册 + 系统勿扰设置
    #[allow(unreachable_code)]
    "granted".into()
}

/// 发送一条系统通知。任何失败都不 panic，转成 NotifyOutcome 供调用方记录日志。
#[allow(unused_variables)]
pub fn send(app: &AppHandle, title: &str, body: &str) -> NotifyOutcome {
    #[cfg(windows)]
    {
        return send_windows(title, body);
    }
    #[cfg(not(windows))]
    {
        let permission = permission_state(app);
        if permission == "denied" {
            return NotifyOutcome {
                ok: false,
                error: Some("通知权限被拒绝，请在系统设置中允许本应用发送通知".into()),
                permission,
            };
        }
        match app.notification().builder().title(title).body(body).show() {
            Ok(_) => NotifyOutcome { ok: true, error: None, permission },
            Err(e) => NotifyOutcome { ok: false, error: Some(e.to_string()), permission },
        }
    }
}

/// 保证系统通知标识可用（Windows 注册 AUMID，其他平台空操作），返回给人看的说明
pub fn ensure_ready() -> String {
    #[cfg(windows)]
    {
        match aumid::ensure() {
            Ok(()) => format!("系统通知标识已就绪（{APP_ID}）"),
            Err(e) => format!("系统通知标识注册失败：{e}"),
        }
    }
    #[cfg(not(windows))]
    {
        "系统通知由平台授权管理".to_string()
    }
}

#[allow(unused_variables)]
pub fn status(app: &AppHandle) -> NotifyStatus {
    #[cfg(windows)]
    {
        // 打开设置页时顺手自愈一次（例如换了安装路径、注册表被清理）
        let _ = aumid::ensure();
        let registered = aumid::registered();
        return NotifyStatus {
            platform: "windows".into(),
            aumid: APP_ID.into(),
            registered,
            detail: if registered {
                format!("已注册系统通知标识（{APP_ID}），提醒会以 Windows 通知弹出")
            } else {
                "未注册系统通知标识，提醒只会在应用内出现；可点「发送测试」重试注册".into()
            },
        };
    }
    #[cfg(not(windows))]
    {
        let permission = permission_state(app);
        NotifyStatus {
            platform: std::env::consts::OS.to_string(),
            aumid: APP_ID.into(),
            registered: permission != "denied",
            detail: format!("系统通知权限：{permission}"),
        }
    }
}

// ─────────────────────── Windows：AUMID 注册 + 原生 toast ───────────────────────

#[cfg(windows)]
mod aumid {
    //! 只写 HKCU（当前用户），不需要管理员权限，也不依赖 reg.exe 进程
    use std::sync::OnceLock;

    use windows::core::HSTRING;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_READ, REG_SZ,
    };

    static STATE: OnceLock<Result<(), String>> = OnceLock::new();

    fn subkey() -> HSTRING {
        HSTRING::from(format!(r"Software\Classes\AppUserModelId\{}", super::APP_ID))
    }

    fn err(what: &str, code: windows::Win32::Foundation::WIN32_ERROR) -> String {
        format!("{what} 失败（Win32 错误码 {}）", code.0)
    }

    /// 打开已存在的键判断是否注册过
    pub fn registered() -> bool {
        let path = subkey();
        let mut hkey = HKEY::default();
        let code = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &path, None, KEY_READ, &mut hkey) };
        if code == ERROR_SUCCESS {
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            true
        } else {
            false
        }
    }

    fn set_string(hkey: HKEY, name: &str, value: &str) -> Result<(), String> {
        let name = HSTRING::from(name);
        // REG_SZ 要求 UTF-16LE 且以 0 结尾
        let mut data: Vec<u8> = value.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
        data.extend_from_slice(&[0, 0]);
        let code = unsafe { RegSetValueExW(hkey, &name, None, REG_SZ, Some(&data)) };
        if code == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(err("写入注册表值", code))
        }
    }

    pub fn ensure() -> Result<(), String> {
        STATE
            .get_or_init(|| {
                // 每次都重写一遍（键已存在就是打开）：免安装版换了路径后 IconUri 也要跟着更新，
                // 整个流程只在进程生命周期内跑一次，开销可以忽略。
                let path = subkey();
                let mut hkey = HKEY::default();
                // RegCreateKeyW：已存在则直接打开，不需要 SECURITY_ATTRIBUTES
                let code = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, &path, &mut hkey) };
                if code != ERROR_SUCCESS {
                    return Err(err("创建 AppUserModelId 键", code));
                }
                let result = (|| {
                    set_string(hkey, "DisplayName", super::APP_NAME)?;
                    // 透明底，让图标按原样显示
                    set_string(hkey, "IconBackgroundColor", "0")?;
                    if let Ok(exe) = std::env::current_exe() {
                        set_string(hkey, "IconUri", &exe.to_string_lossy())?;
                    }
                    Ok(())
                })();
                unsafe {
                    let _ = RegCloseKey(hkey);
                }
                result
            })
            .clone()
    }
}

#[cfg(windows)]
fn send_windows(title: &str, body: &str) -> NotifyOutcome {
    if let Err(e) = aumid::ensure() {
        return NotifyOutcome {
            ok: false,
            error: Some(format!("系统通知标识注册失败：{e}")),
            permission: "granted".into(),
        };
    }
    let toast = tauri_winrt_notification::Toast::new(APP_ID)
        .title(title)
        .text1(body);
    match toast.show() {
        Ok(_) => NotifyOutcome { ok: true, error: None, permission: "granted".into() },
        Err(e) => NotifyOutcome {
            ok: false,
            error: Some(format!("系统通知发送失败：{e}")),
            permission: "granted".into(),
        },
    }
}
