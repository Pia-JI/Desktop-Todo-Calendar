//! SQLite 建表与迁移（Rust 侧唯一真源）。
//!
//! 设计要点：
//! - 前端通过 tauri-plugin-sql 做 CRUD，Rust 侧另开一个 sqlx 连接池供
//!   到期扫描 / 快照 / ICS 等后台任务使用。两个池指向同一个文件，
//!   依赖 WAL + busy_timeout 保证并发写安全（崩溃不丢数据）。
//! - 迁移用 `PRAGMA user_version` 递增，全部 DDL 幂等。
//! - 对 startAt / completed / deletedAt 建索引，保证 2000+ 事项时查询仍快。

use std::path::PathBuf;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

/// 当前 schema 版本。每次改表 +1，并在 MIGRATIONS 里追加对应 SQL。
pub const SCHEMA_VERSION: i64 = 1;

#[derive(Clone)]
pub struct Db {
    pub pool: SqlitePool,
    pub path: PathBuf,
}

/// 数据库文件绝对路径：<app_data_dir>/todocalendar.db
pub fn db_path(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("todocalendar.db"))
}

pub async fn connect(app: &AppHandle) -> Result<Db> {
    let path = db_path(app)?;
    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .busy_timeout(Duration::from_secs(10))
        .foreign_keys(false);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(15))
        .connect_with(opts)
        .await?;

    let db = Db { pool, path };
    db.migrate().await?;
    Ok(db)
}

impl Db {
    /// 执行迁移：读取 user_version，逐条应用缺失的脚本。
    pub async fn migrate(&self) -> Result<()> {
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&self.pool)
            .await
            .unwrap_or(0);

        if version >= SCHEMA_VERSION {
            return Ok(());
        }

        for step in (version + 1)..=SCHEMA_VERSION {
            let sql = migration_sql(step);
            // 单条迁移放到事务里，失败可回滚，避免半迁移状态
            let mut tx = self.pool.begin().await?;
            for stmt in sql.split(";\n") {
                let s = stmt.trim();
                if s.is_empty() {
                    continue;
                }
                sqlx::query(s).execute(&mut *tx).await.map_err(|e| {
                    AppError::msg(format!("迁移 v{step} 失败: {e}\n语句: {s}"))
                })?;
            }
            sqlx::query(&format!("PRAGMA user_version = {step}"))
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            log::info!("[db] migration applied -> v{step}");
        }
        Ok(())
    }

    /// 键值存储（窗口位置、晨报上次发送日期、同步目录等）
    pub async fn state_get(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query_scalar::<_, String>("SELECT value FROM app_state WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }

    pub async fn state_set(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO app_state(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn state_del(&self, key: &str) -> Result<()> {
        sqlx::query("DELETE FROM app_state WHERE key = ?1")
            .bind(key)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// 追加一条通知发送记录（诊断页展示）
    #[allow(clippy::too_many_arguments)]
    pub async fn log_reminder(
        &self,
        todo_id: &str,
        title: &str,
        channel: &str,
        ok: bool,
        error: Option<String>,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO reminders_log(id, todo_id, sent_at, channel, body, ok, error)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(todo_id)
        .bind(crate::timeutil::utc_now())
        .bind(channel)
        .bind(title)
        .bind(ok)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 待处理提醒候选集（未删除、未完成、未 snooze 到未来）
    pub async fn pending_rows(&self) -> Result<Vec<PendingTodo>> {
        let rows = sqlx::query(
            "SELECT id, title, start_at, end_at, all_day, priority, color, repeat,
                    remind_before_sec, snooze_until, repeat_remind_interval_sec,
                    repeat_remind_count, remind_sent_count, last_reminded_at, calendar_id
               FROM todos
              WHERE deleted_at IS NULL AND completed = 0",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(PendingTodo {
                id: r.get("id"),
                title: r.get("title"),
                start_at: r.get("start_at"),
                end_at: r.get("end_at"),
                all_day: r.get::<i64, _>("all_day") != 0,
                priority: r.get::<i64, _>("priority") as i32,
                color: r.get("color"),
                repeat: r.get("repeat"),
                remind_before_sec: r.get::<i64, _>("remind_before_sec") as i32,
                snooze_until: r.get("snooze_until"),
                repeat_remind_interval_sec: r.get("repeat_remind_interval_sec"),
                repeat_remind_count: r.get("repeat_remind_count"),
                remind_sent_count: r.get::<i64, _>("remind_sent_count") as i32,
                last_reminded_at: r.get("last_reminded_at"),
                calendar_id: r.get("calendar_id"),
            });
        }
        Ok(out)
    }

    /// 标记已提醒，避免重复推送
    pub async fn mark_reminded(&self, id: &str, sent_count: i32) -> Result<()> {
        sqlx::query(
            "UPDATE todos SET remind_sent_count = ?2, last_reminded_at = ?3, updated_at = ?3
              WHERE id = ?1",
        )
        .bind(id)
        .bind(sent_count as i64)
        .bind(crate::timeutil::utc_now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 重复事项完成后生成下一条实例（返回新 id）
    pub async fn spawn_next_occurrence(&self, id: &str) -> Result<Option<String>> {
        let row = sqlx::query(
            "SELECT title, start_at, end_at, all_day, priority, color, repeat,
                    remind_before_sec, repeat_remind_interval_sec, repeat_remind_count,
                    estimated_min, calendar_id, notes, parent_id
               FROM todos WHERE id = ?1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else { return Ok(None) };
        let repeat: String = row.get("repeat");
        if repeat == "none" || repeat.is_empty() {
            return Ok(None);
        }

        let start_at: String = row.get("start_at");
        let end_at: Option<String> = row.get("end_at");
        let base = match crate::timeutil::parse_iso(&start_at) {
            Some(d) => d,
            None => return Ok(None),
        };
        let next = match repeat.as_str() {
            "daily" => base + chrono::Duration::days(1),
            "weekly" => base + chrono::Duration::days(7),
            "monthly" => crate::timeutil::add_months(base, 1),
            _ => return Ok(None),
        };

        let new_id = uuid::Uuid::new_v4().to_string();
        let now = crate::timeutil::utc_now();
        let next_start = crate::timeutil::to_iso(next);
        let next_end = end_at.and_then(|e| {
            crate::timeutil::parse_iso(&e).map(|d| {
                let delta = d.signed_duration_since(base);
                crate::timeutil::to_iso(next + delta)
            })
        });

        sqlx::query(
            "INSERT INTO todos(id, title, start_at, end_at, all_day, priority, color, completed,
                               repeat, remind_before_sec, repeat_remind_interval_sec,
                               repeat_remind_count, remind_sent_count, estimated_min, actual_min,
                               parent_id, calendar_id, notes, sort_order, created_at, updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,0,?8,?9,?10,?11,0,?12,0,?13,?14,?15,0,?16,?16)",
        )
        .bind(&new_id)
        .bind(row.get::<String, _>("title"))
        .bind(&next_start)
        .bind(next_end)
        .bind(row.get::<i64, _>("all_day"))
        .bind(row.get::<i64, _>("priority"))
        .bind(row.get::<String, _>("color"))
        .bind(&repeat)
        .bind(row.get::<i64, _>("remind_before_sec"))
        .bind(row.get::<Option<i64>, _>("repeat_remind_interval_sec"))
        .bind(row.get::<Option<i64>, _>("repeat_remind_count"))
        .bind(row.get::<Option<i64>, _>("estimated_min"))
        .bind(row.get::<Option<String>, _>("parent_id"))
        .bind(row.get::<Option<String>, _>("calendar_id"))
        .bind(row.get::<Option<String>, _>("notes"))
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok(Some(new_id))
    }

    /// 统计：今日未完成数 / P1 数（晨报用）
    pub async fn today_summary(&self, day_start: &str, day_end: &str) -> Result<(i64, i64)> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN priority = 1 THEN 1 ELSE 0 END) AS p1
               FROM todos
              WHERE deleted_at IS NULL AND completed = 0 AND parent_id IS NULL
                AND start_at >= ?1 AND start_at < ?2",
        )
        .bind(day_start)
        .bind(day_end)
        .fetch_one(&self.pool)
        .await?;
        Ok((
            row.get::<Option<i64>, _>("total").unwrap_or(0),
            row.get::<Option<i64>, _>("p1").unwrap_or(0),
        ))
    }

    /// 导出全量 JSON 快照用的原始行
    pub async fn dump_table(&self, table: &str) -> Result<Vec<serde_json::Value>> {
        // 白名单复用 backup::TABLES：既杜绝 SQL 注入，也保证「快照能导出的表」
        // 与「备份覆盖的表」永远是同一份清单
        if !crate::backup::TABLES.contains(&table) {
            return Err(AppError::msg(format!("不允许导出表: {table}")));
        }
        let rows = sqlx::query(&format!("SELECT * FROM {table}"))
            .fetch_all(&self.pool)
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            out.push(crate::serialize::row_to_json(&r));
        }
        Ok(out)
    }
}

#[derive(Debug, Clone)]
pub struct PendingTodo {
    pub id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub all_day: bool,
    pub priority: i32,
    pub color: String,
    pub repeat: String,
    pub remind_before_sec: i32,
    pub snooze_until: Option<String>,
    pub repeat_remind_interval_sec: Option<i64>,
    pub repeat_remind_count: Option<i64>,
    pub remind_sent_count: i32,
    pub last_reminded_at: Option<String>,
    pub calendar_id: Option<String>,
}

/// 迁移脚本：按版本号返回 DDL
fn migration_sql(version: i64) -> &'static str {
    match version {
        1 => V1_SCHEMA,
        _ => "",
    }
}

const V1_SCHEMA: &str = r#"CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 2,
  color TEXT NOT NULL DEFAULT '#4F6EF7',
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  repeat TEXT NOT NULL DEFAULT 'none',
  remind_before_sec INTEGER NOT NULL DEFAULT 900,
  snooze_until TEXT,
  repeat_remind_interval_sec INTEGER,
  repeat_remind_count INTEGER DEFAULT 0,
  remind_sent_count INTEGER NOT NULL DEFAULT 0,
  last_reminded_at TEXT,
  estimated_min INTEGER,
  actual_min INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  calendar_id TEXT,
  notes TEXT,
  attachment_path TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_start_at ON todos(start_at);
CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
CREATE INDEX IF NOT EXISTS idx_todos_deleted_at ON todos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_todos_parent_id ON todos(parent_id);
CREATE INDEX IF NOT EXISTS idx_todos_calendar_id ON todos(calendar_id);
CREATE INDEX IF NOT EXISTS idx_todos_start_completed ON todos(start_at, completed, deleted_at);
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY NOT NULL,
  todo_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subtasks_todo ON subtasks(todo_id);
CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4F6EF7',
  visible INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'local',
  readonly INTEGER NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'holiday'
);
CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  todo_id TEXT,
  started_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'focus',
  completed INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pomo_started ON pomodoro_sessions(started_at);
CREATE TABLE IF NOT EXISTS reminders_log (
  id TEXT PRIMARY KEY NOT NULL,
  todo_id TEXT,
  sent_at TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'system',
  body TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_reminders_sent ON reminders_log(sent_at);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'auto',
  note TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
CREATE TABLE IF NOT EXISTS external_events (
  id TEXT PRIMARY KEY NOT NULL,
  uid TEXT,
  calendar_id TEXT,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  notes TEXT,
  source_path TEXT,
  imported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ext_start ON external_events(start_at);
CREATE TABLE IF NOT EXISTS command_history (
  command_id TEXT PRIMARY KEY NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  used_at TEXT NOT NULL
)"#;
impl Db {
    /// 读取前端 Zustand 持久化写入的设置项（settings 表，value 为 JSON 字符串）
    pub async fn setting_get(&self, key: &str) -> Result<Option<String>> {
        if let Some(field) = key.strip_prefix("s_") {
            let raw = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 's_state'")
                .fetch_optional(&self.pool)
                .await?;
            if let Some(value) = raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok()) {
                if let Some(setting) = value.get(field) {
                    return Ok(Some(setting.to_string()));
                }
            }
        }
        Ok(sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?)
    }

    pub async fn setting_set(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 读取布尔设置，缺省返回 default
    pub async fn setting_bool(&self, key: &str, default: bool) -> bool {
        match self.setting_get(key).await.ok().flatten() {
            Some(v) => match v.as_str() {
                "true" => true,
                "false" => false,
                other => other.trim_matches('"') == "true",
            },
            None => default,
        }
    }

    pub async fn setting_str(&self, key: &str, default: &str) -> String {
        match self.setting_get(key).await.ok().flatten() {
            Some(v) => v.trim_matches('"').to_string(),
            None => default.to_string(),
        }
    }
}
