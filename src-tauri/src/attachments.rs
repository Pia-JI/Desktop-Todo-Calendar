//! 附件：拖拽文件到表单后复制到 <app_data>/attachments/，数据库只存相对路径，
//! 便于整个数据目录搬迁。首期限制单文件 <= 10MB。

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

pub const MAX_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;

pub fn attachments_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("attachments");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 相对路径 -> 绝对路径（严格限制在 app_data_dir 内，防目录穿越）
pub fn resolve(app: &AppHandle, rel: &str) -> Result<PathBuf> {
    let base = app.path().app_data_dir()?;
    let candidate = base.join(rel);
    let canonical_base = base.canonicalize().unwrap_or_else(|_| base.clone());
    let canonical = candidate.canonicalize().unwrap_or_else(|_| candidate.clone());
    if !canonical.starts_with(&canonical_base) {
        return Err(AppError::msg("非法附件路径（超出应用数据目录）"));
    }
    Ok(canonical)
}

fn sanitize(name: &str) -> String {
    let bad = ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];
    let cleaned: String = name.chars().map(|c| if bad.contains(&c) { '_' } else { c }).collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

/// 复制外部文件到附件目录，返回相对路径（存库用）
pub fn import(app: &AppHandle, src: &str, todo_id: &str) -> Result<String> {
    let from = PathBuf::from(src);
    if !from.exists() {
        return Err(AppError::msg(format!("源文件不存在: {src}")));
    }
    let meta = std::fs::metadata(&from)?;
    if !meta.is_file() {
        return Err(AppError::msg("只支持单个文件，不支持目录"));
    }
    if meta.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::msg(format!(
            "文件超过 10MB 限制（当前 {:.1}MB）",
            meta.len() as f64 / 1048576.0
        )));
    }
    let dir = attachments_dir(app)?;
    let file_name = sanitize(
        &from
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "attachment".into()),
    );
    let prefix: String = todo_id.chars().take(8).collect();
    let stored = format!("{prefix}__{file_name}");
    let dest = dir.join(&stored);

    // 临时文件 + 原子替换
    let tmp = dir.join(format!(".{stored}.tmp"));
    std::fs::copy(&from, &tmp)?;
    if dest.exists() {
        std::fs::remove_file(&dest)?;
    }
    std::fs::rename(&tmp, &dest)?;

    Ok(format!("attachments/{stored}"))
}

pub fn remove(app: &AppHandle, rel: &str) -> Result<()> {
    let path = resolve(app, rel)?;
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// 在系统文件管理器中定位文件
pub fn reveal(app: &AppHandle, rel: &str) -> Result<()> {
    let path = resolve(app, rel)?;
    reveal_path(&path)
}

pub fn reveal_path(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| AppError::msg(format!("打开资源管理器失败: {e}")))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| AppError::msg(format!("打开 Finder 失败: {e}")))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = path.parent().map(PathBuf::from).unwrap_or_else(|| path.to_path_buf());
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| AppError::msg(format!("打开文件管理器失败: {e}")))?;
    }
    Ok(())
}