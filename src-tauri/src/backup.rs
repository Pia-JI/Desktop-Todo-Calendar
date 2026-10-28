//! 备份 / 导入导出 / 目录同步。
//! 关键约束：任何写文件都「先写临时文件再原子替换」，避免中途崩溃产生半截文件。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};

use crate::db::{Db, SCHEMA_VERSION};
use crate::error::{AppError, Result};

/// 允许导入导出的表白名单（同时用于防注入）
pub const TABLES: [&str; 10] = [
    "todos",
    "subtasks",
    "calendars",
    "holidays",
    "pomodoro_sessions",
    "external_events",
    "reminders_log",
    "app_state",
    "settings",
    "command_history",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub app: String,
    pub version: String,
    pub schema_version: i64,
    pub created_at: String,
    pub tables: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub inserted: usize,
    pub skipped: usize,
    pub tables: Vec<String>,
}

pub fn backups_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?.join("backups");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 生成完整快照对象
pub async fn build_snapshot(db: &Db) -> Result<Snapshot> {
    let mut tables = Map::new();
    for t in TABLES.iter() {
        tables.insert(t.to_string(), Value::Array(db.dump_table(t).await?));
    }
    Ok(Snapshot {
        app: "desktop-todo-calendar".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        schema_version: SCHEMA_VERSION,
        created_at: crate::timeutil::utc_now(),
        tables,
    })
}

/// 每日自动 / 手动快照，写入 <app_data>/backups/snapshot-<ts>.json
pub async fn create_snapshot(app: &AppHandle, kind: &str, note: Option<&str>) -> Result<PathBuf> {
    let db = app.state::<crate::AppState>().db.clone();
    let snap = build_snapshot(&db).await?;
    let dir = backups_dir(app)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let path = dir.join(format!("snapshot-{kind}-{stamp}.json"));
    atomic_write_json(&path, &serde_json::to_value(&snap)?)?;

    let size = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
    sqlx::query(
        "INSERT INTO snapshots(id, created_at, path, kind, note, size_bytes) VALUES(?1,?2,?3,?4,?5,?6)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(crate::timeutil::utc_now())
    .bind(path.to_string_lossy().to_string())
    .bind(kind)
    .bind(note)
    .bind(size)
    .execute(&db.pool)
    .await?;
    Ok(path)
}

/// 只保留最近 keep 份，超出部分删除（文件 + 记录）
pub async fn prune_snapshots(app: &AppHandle, keep: usize) -> Result<usize> {
    let db = app.state::<crate::AppState>().db.clone();
    let rows = sqlx::query(
        "SELECT id, path FROM snapshots ORDER BY created_at DESC LIMIT -1 OFFSET ?1",
    )
    .bind(keep as i64)
    .fetch_all(&db.pool)
    .await?;

    let mut removed = 0usize;
    for r in rows {
        let id: String = r.get("id");
        let path: String = r.get("path");
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::warn!("[backup] 删除旧快照失败 {path}: {e}");
            }
        }
        sqlx::query("DELETE FROM snapshots WHERE id = ?1")
            .bind(&id)
            .execute(&db.pool)
            .await?;
        removed += 1;
    }
    Ok(removed)
}

pub async fn list_snapshots(app: &AppHandle) -> Result<Vec<Value>> {
    let db = app.state::<crate::AppState>().db.clone();
    let rows = sqlx::query(
        "SELECT id, created_at, path, kind, note, size_bytes FROM snapshots ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(&db.pool)
    .await?;
    Ok(rows.iter().map(crate::serialize::row_to_json).collect())
}

/// 导出 JSON 到用户指定路径（原子替换）
pub async fn export_json(app: &AppHandle, dest: PathBuf) -> Result<PathBuf> {
    let db = app.state::<crate::AppState>().db.clone();
    let snap = build_snapshot(&db).await?;
    atomic_write_json(&dest, &serde_json::to_value(&snap)?)?;
    Ok(dest)
}

/// 导出 CSV（仅 todos 表，扁平化，UTF-8 BOM 以便 Excel 正确识别中文）
pub async fn export_csv(app: &AppHandle, dest: PathBuf) -> Result<PathBuf> {
    let db = app.state::<crate::AppState>().db.clone();
    let cols = table_columns(&db.pool, "todos").await?;
    let rows = sqlx::query("SELECT * FROM todos ORDER BY start_at ASC")
        .fetch_all(&db.pool)
        .await?;

    let mut out = String::from("\u{feff}");
    out.push_str(&cols.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","));
    out.push('\n');
    for r in &rows {
        let line: Vec<String> = cols
            .iter()
            .enumerate()
            .map(|(i, _)| {
                let v = crate::serialize::row_to_json(r);
                match v.get(cols[i].as_str()) {
                    None | Some(Value::Null) => String::new(),
                    Some(Value::String(s)) => csv_escape(s),
                    Some(Value::Number(n)) => n.to_string(),
                    Some(Value::Bool(b)) => (if *b { "1" } else { "0" }).to_string(),
                    Some(other) => csv_escape(&other.to_string()),
                }
            })
            .collect();
        out.push_str(&line.join(","));
        out.push('\n');
    }

    let tmp = tmp_of(&dest);
    std::fs::write(&tmp, out.as_bytes())?;
    replace_file(&tmp, &dest)?;
    Ok(dest)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// 从 JSON 快照导入。overwrite=false 时按主键 upsert（不会删除现有数据）
pub async fn import_json(app: &AppHandle, src: PathBuf, overwrite: bool) -> Result<ImportReport> {
    let db = app.state::<crate::AppState>().db.clone();
    let raw = std::fs::read_to_string(&src)?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::msg(format!("JSON 解析失败: {e}")))?;

    let tables = value
        .get("tables")
        .cloned()
        .unwrap_or_else(|| value.clone())
        .as_object()
        .cloned()
        .ok_or_else(|| AppError::msg("快照缺少 tables 字段"))?;

    // 先备份当前库，导入出错也能回退
    create_snapshot(app, "pre-import", Some("导入前自动备份")).await.ok();

    let mut inserted = 0usize;
    let mut skipped = 0usize;
    let mut touched = Vec::new();

    let mut tx = db.pool.begin().await?;
    if overwrite {
        for t in TABLES.iter() {
            sqlx::query(&format!("DELETE FROM {t}")).execute(&mut *tx).await?;
        }
    }
    for t in TABLES.iter() {
        let Some(Value::Array(rows)) = tables.get(*t) else {
            continue;
        };
        if rows.is_empty() {
            continue;
        }
        let cols = table_columns(&db.pool, t).await?;
        let maps: Vec<Map<String, Value>> = rows
            .iter()
            .filter_map(|r| r.as_object().cloned())
            .collect();
        let used: Vec<String> = maps
            .first()
            .map(|m| {
                cols.iter()
                    .filter(|c| m.contains_key(c.as_str()))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        if used.is_empty() {
            skipped += rows.len();
            continue;
        }
        inserted += upsert_rows(&mut tx, t, &used, &maps).await?;
        skipped += rows.len().saturating_sub(maps.len());
        touched.push(t.to_string());
    }
    tx.commit().await?;
    db.migrate().await?;

    Ok(ImportReport {
        inserted,
        skipped,
        tables: touched,
    })
}

async fn table_columns(pool: &SqlitePool, table: &str) -> Result<Vec<String>> {
    if !TABLES.contains(&table) {
        return Err(AppError::msg(format!("未知表: {table}")));
    }
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(|r| r.get::<String, _>("name")).collect())
}

async fn upsert_rows(
    pool: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
    cols: &[String],
    rows: &[Map<String, Value>],
) -> Result<usize> {
    let placeholders = vec!["?"; cols.len()].join(",");
    let sql = format!(
        "INSERT OR REPLACE INTO {table}({}) VALUES({})",
        cols.join(","),
        placeholders
    );
    let mut n = 0usize;
    for row in rows {
        let mut q = sqlx::query(&sql);
        for c in cols {
            let v = row.get(c).cloned().unwrap_or(Value::Null);
            q = match v {
                Value::Null => q.bind(Option::<String>::None),
                Value::Bool(b) => q.bind(if b { 1i64 } else { 0i64 }),
                Value::Number(num) => {
                    if let Some(i) = num.as_i64() {
                        q.bind(i)
                    } else if let Some(f) = num.as_f64() {
                        q.bind(f)
                    } else {
                        q.bind(num.to_string())
                    }
                }
                Value::String(s) => q.bind(s),
                other => q.bind(other.to_string()),
            };
        }
        q.execute(&mut **pool).await.map_err(|e| {
            AppError::msg(format!("导入 {table} 失败: {e}"))
        })?;
        n += 1;
    }
    Ok(n)
}

/// 「指定目录定时复制」：db + backups 一起同步到用户目录
pub async fn sync_to_dir(app: &AppHandle, dir: &str) -> Result<usize> {
    let target = PathBuf::from(dir);
    std::fs::create_dir_all(&target)?;
    let db = app.state::<crate::AppState>().db.clone();

    // 先 checkpoint，保证 -wal 内容落到主库文件
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&db.pool)
        .await
        .ok();

    let mut count = 0usize;
    let db_dir = app.path().app_data_dir()?;
    let files = ["todocalendar.db", "todocalendar.db-wal", "todocalendar.db-shm"];
    for f in files {
        let src = db_dir.join(f);
        if src.exists() {
            std::fs::copy(&src, target.join(f))?;
            count += 1;
        }
    }
    let backup_target = target.join("backups");
    std::fs::create_dir_all(&backup_target)?;
    if let Ok(entries) = std::fs::read_dir(backups_dir(app)?) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                std::fs::copy(&p, backup_target.join(e.file_name()))?;
                count += 1;
            }
        }
    }
    Ok(count)
}

// ───────────────────────── 原子写工具 ─────────────────────────

fn tmp_of(dest: &Path) -> PathBuf {
    let mut name = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    name.push_str(&format!(".{}.tmp", uuid::Uuid::new_v4().simple()));
    dest.with_file_name(name)
}

fn replace_file(tmp: &Path, dest: &Path) -> Result<()> {
    if dest.exists() {
        // Windows 上 rename 不能覆盖，需先删除目标
        std::fs::remove_file(dest)?;
    }
    std::fs::rename(tmp, dest).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        AppError::msg(format!("原子替换失败: {e}"))
    })
}

pub fn atomic_write_json(dest: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = tmp_of(dest);
    let text = serde_json::to_string_pretty(value)?;
    std::fs::write(&tmp, text.as_bytes())?;
    replace_file(&tmp, dest)
}