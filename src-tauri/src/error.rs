//! 统一错误类型：所有 Tauri command 返回 Result<T, AppError>，
//! AppError 会被序列化成字符串送到前端，前端用 toast 展示。

use serde::ser::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Sql(#[from] sqlx::Error),

    #[error("文件读写错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri 运行时错误: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("数据序列化错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn msg<S: Into<String>>(s: S) -> Self {
        AppError::Other(s.into())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}