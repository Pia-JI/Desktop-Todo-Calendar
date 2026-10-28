//! 环形日志缓冲 + 落盘，供「故障排查」页读取与导出诊断包。
//! 只保留最近 800 条内存记录，文件按天追加。

use std::collections::VecDeque;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

const MAX_LINES: usize = 800;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct LogLine {
    pub at: String,
    pub level: String,
    pub source: String,
    pub message: String,
}

#[derive(Clone, Default)]
pub struct LogStore {
    lines: Arc<Mutex<VecDeque<LogLine>>>,
    dir: Arc<Mutex<Option<PathBuf>>>,
}

impl LogStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// 设置日志目录（app_data_dir/logs）
    pub fn set_dir(&self, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        *self.dir.lock().unwrap() = Some(dir);
    }

    pub fn push(&self, level: &str, source: &str, message: impl Into<String>) {
        let line = LogLine {
            at: crate::timeutil::utc_now(),
            level: level.to_string(),
            source: source.to_string(),
            message: message.into(),
        };
        {
            let mut g = self.lines.lock().unwrap();
            if g.len() >= MAX_LINES {
                g.pop_front();
            }
            g.push_back(line.clone());
        }
        self.append_file(&line);
        match level {
            "error" | "warn" => log::warn!("[{}] {}", source, line.message),
            _ => log::info!("[{}] {}", source, line.message),
        }
    }

    fn append_file(&self, line: &LogLine) {
        let dir = self.dir.lock().unwrap().clone();
        let Some(dir) = dir else { return };
        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let path = dir.join(format!("app-{day}.log"));
        let text = format!(
            "{}\t{}\t{}\t{}\n",
            line.at, line.level, line.source, line.message.replace('\n', " ")
        );
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(text.as_bytes());
        }
    }

    pub fn info(&self, source: &str, m: impl Into<String>) {
        self.push("info", source, m)
    }
    pub fn warn(&self, source: &str, m: impl Into<String>) {
        self.push("warn", source, m)
    }
    pub fn error(&self, source: &str, m: impl Into<String>) {
        self.push("error", source, m)
    }

    pub fn list(&self) -> Vec<LogLine> {
        self.lines.lock().unwrap().iter().rev().cloned().collect()
    }

    pub fn clear(&self) {
        self.lines.lock().unwrap().clear();
    }
}