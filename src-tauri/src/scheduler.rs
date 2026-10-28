//! 后台定时任务（全部 tokio interval，非阻塞、无 sleep 轮询主线程）：
//! 1) 到期扫描：每 15s 扫一遍未完成事项，按 remindBeforeSec / snoozeUntil / 重复提醒规则发系统通知
//! 2) 每日晨报：每分钟检查一次，到达设定时间（默认 08:00）推送「今天有 N 件事，其中 P1 有 M 件」
//! 3) 每日快照：每天首次触发时导出 JSON 到 backups/，保留最近 30 份，并可选同步到指定目录

use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Datelike, NaiveTime, Timelike, Utc};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Db;
use crate::timeutil::{self, parse_iso};
use crate::AppState;

static REMINDERS_READY: AtomicBool = AtomicBool::new(false);
static SCAN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn set_reminders_ready() {
    REMINDERS_READY.store(true, Ordering::Relaxed);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPayload {
    pub id: String,
    pub title: String,
    pub start_at: String,
    pub priority: i32,
    pub color: String,
    pub kind: String,
    pub sent_count: i32,
    pub reminded_at: String,
    pub body: String,
}

/// 启动全部后台任务。在 tauri setup 里调用一次。
pub fn spawn_all(app: AppHandle) {
    spawn_due_scanner(app.clone());
    spawn_daily_digest(app.clone());
    spawn_snapshot_job(app);
}

fn logs(app: &AppHandle) -> crate::logs::LogStore {
    app.state::<AppState>().logs.clone()
}

fn db(app: &AppHandle) -> Db {
    app.state::<AppState>().db.clone()
}

// ─────────────────────────── 1. 到期扫描 ───────────────────────────

fn spawn_due_scanner(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(15));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if let Err(e) = scan_due(&app).await {
                logs(&app).warn("scheduler", format!("到期扫描失败: {e}"));
            }
        }
    });
}

pub async fn scan_due(app: &AppHandle) -> crate::error::Result<()> {
    if !REMINDERS_READY.load(Ordering::Relaxed) {
        return Ok(());
    }
    let _guard = SCAN_LOCK.lock().await;
    if !db(app).setting_bool("s_notifyEnabled", true).await {
        return Ok(());
    }
    let rows = db(app).pending_rows().await?;
    if rows.is_empty() {
        return Ok(());
    }
    let now = Utc::now();
    let repeat_count = db(app).setting_str("s_repeatRemindCount", "").await.parse::<i64>().ok();
    let repeat_interval = db(app).setting_str("s_repeatRemindIntervalMin", "").await.parse::<i64>().ok();

    for r in rows {
        let Some(start) = parse_iso(&r.start_at) else {
            continue;
        };

        // snooze 未到期则跳过
        if let Some(s) = r.snooze_until.as_ref() {
            if let Some(sd) = parse_iso(s) {
                if sd > now {
                    continue;
                }
            }
        }

        let remind_at = start - chrono::Duration::seconds(r.remind_before_sec.max(0) as i64);
        let last = r.last_reminded_at.as_ref().and_then(|value| parse_iso(value));
        let rescheduled = last.is_some_and(|last| last < remind_at);
        let sent_count = if rescheduled { 0 } else { r.remind_sent_count };
        let extra = repeat_count.or(r.repeat_remind_count).unwrap_or(0).clamp(0, 20);
        let interval = repeat_interval.map(|minutes| minutes.clamp(1, 1440) * 60)
            .or(r.repeat_remind_interval_sec).unwrap_or(0).max(0);
        let allowed = if interval > 0 && extra > 0 {
            1 + extra as i32
        } else {
            1
        };

        let due_without_notice = now >= start && last.map_or(true, |last| last < start);
        if sent_count >= allowed && !due_without_notice {
            continue;
        }
        if now < remind_at {
            continue;
        }
        // 超过 24 小时的旧事项不再补发首次提醒，避免启动时被历史数据刷屏
        if (sent_count == 0 || due_without_notice) && now.signed_duration_since(start) > chrono::Duration::hours(24)
        {
            continue;
        }
        // 重复提醒需满足间隔
        if sent_count > 0 && !due_without_notice {
            if let Some(last) = last {
                if now.signed_duration_since(last)
                    < chrono::Duration::seconds(interval.max(60) as i64)
                {
                    continue;
                }
            }
        }

        let overdue = now > start;
        let kind = if overdue { "overdue" } else { "upcoming" };
        let clock = clock_label(start, now);
        let content = reminder_content(&r.title);
        let title = format!("{clock} {content}");
        let body = if overdue {
            format!("{clock} 已逾期 · {content}")
        } else {
            format!("{clock} {content}")
        };

        let outcome = crate::notify::send(app, &title, &body);
        db(app)
            .log_reminder(
                &r.id,
                &title,
                if outcome.ok { "system" } else { "failed" },
                outcome.ok,
                outcome.error.clone(),
            )
            .await
            .ok();

        let payload = ReminderPayload {
            id: r.id.clone(),
            title: r.title.clone(),
            start_at: r.start_at.clone(),
            priority: r.priority,
            color: r.color.clone(),
            kind: kind.to_string(),
            sent_count: sent_count + 1,
            reminded_at: now.to_rfc3339(),
            body,
        };
        let in_app = app.emit("app://reminder-fired", payload).is_ok();
        if outcome.ok || in_app {
            db(app).mark_reminded(&r.id, sent_count + 1).await?;
        }
        logs(app).info(
            "scheduler",
            format!("提醒已发送 #{} ({kind}) ok={}", r.title, outcome.ok),
        );
    }
    Ok(())
}

fn clock_label(target: DateTime<Utc>, now: DateTime<Utc>) -> String {
    let local = target.with_timezone(&chrono::Local);
    let today = now.with_timezone(&chrono::Local).date_naive();
    let day = local.date_naive();
    let clock = local.format("%H:%M").to_string();
    if day == today {
        clock
    } else if day == today.succ_opt().unwrap_or(today) {
        format!("明天 {clock}")
    } else if day == today.pred_opt().unwrap_or(today) {
        format!("昨天 {clock}")
    } else {
        format!("{} {clock}", local.format("%m-%d"))
    }
}

fn reminder_content(title: &str) -> String {
    let mut out = title.to_string();
    for phrase in [
        "今天", "明天", "后天", "大后天", "今晚", "今早", "上午", "下午", "晚上", "中午", "凌晨",
        "分钟后", "小时后", "天后", "周后", "个月后",
    ] {
        out = out.replace(phrase, " ");
    }
    let chars: Vec<char> = out.chars().collect();
    let mut buf = String::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let rest: String = chars[i..].iter().collect();
            if rest.starts_with("分钟")
                || rest.starts_with("小时")
                || rest.starts_with("点")
                || rest.starts_with(":")
                || rest.starts_with("：")
            {
                while i < chars.len() && (chars[i].is_ascii_digit() || "点:：分 ".contains(chars[i])) {
                    i += 1;
                }
                buf.push(' ');
                continue;
            }
            buf.extend(chars[start..i].iter());
            continue;
        }
        buf.push(chars[i]);
        i += 1;
    }
    let cleaned = buf.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        title.trim().to_string()
    } else {
        cleaned
    }
}

// ─────────────────────────── 2. 每日晨报 ───────────────────────────

fn spawn_daily_digest(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(60));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if let Err(e) = maybe_daily_digest(&app).await {
                logs(&app).warn("scheduler", format!("晨报任务失败: {e}"));
            }
        }
    });
}

pub async fn maybe_daily_digest(app: &AppHandle) -> crate::error::Result<()> {
    let d = db(app);
    if !d.setting_bool("s_digestEnabled", false).await {
        return Ok(());
    }
    let today = timeutil::local_today();
    let key = "lastDigestDate";
    if d.state_get(key).await? .as_deref() == Some(&today.to_string()) {
        return Ok(());
    }

    let hhmm = d.setting_str("s_digestTime", "08:00").await;
    let (hh, mm) = parse_hhmm(&hhmm);
    let target = NaiveTime::from_hms_opt(hh, mm, 0).unwrap_or(NaiveTime::MIN);
    let now_local = chrono::Local::now();
    if now_local.time() < target {
        return Ok(());
    }

    let (start, end) = timeutil::local_day_range_utc(today);
    let (total, p1) = d
        .today_summary(
            &timeutil::to_iso(start),
            &timeutil::to_iso(end),
        )
        .await?;

    let body = if total == 0 {
        "今天没有待办，好好休息一下吧 ☕".to_string()
    } else {
        format!("今天有 {total} 件事，其中 P1 有 {p1} 件")
    };
    let outcome = crate::notify::send(app, &format!("晨报 · {}", today.format("%m月%d日")), &body);
    d.state_set(key, &today.to_string()).await?;
    let _ = app.emit(
        "app://digest",
        serde_json::json!({ "date": today.to_string(), "total": total, "p1": p1, "ok": outcome.ok }),
    );
    logs(app).info("scheduler", format!("晨报已发送: {body}"));
    Ok(())
}

fn parse_hhmm(s: &str) -> (u32, u32) {
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() != 2 {
        return (8, 0);
    }
    let h: u32 = parts[0].parse().unwrap_or(8);
    let m: u32 = parts[1].parse().unwrap_or(0);
    (h.min(23), m.min(59))
}

// ─────────────────────────── 3. 每日快照 + 目录同步 ───────────────────────────

fn spawn_snapshot_job(app: AppHandle) {
    // 启动后延迟 8s 先做一次（避开冷启动峰值），之后每小时检查一次是否跨天
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        if let Err(e) = maybe_snapshot(&app).await {
            logs(&app).warn("snapshot", format!("快照任务失败: {e}"));
        }
        let mut ticker = tokio::time::interval(Duration::from_secs(3600));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            if let Err(e) = maybe_snapshot(&app).await {
                logs(&app).warn("snapshot", format!("快照任务失败: {e}"));
            }
        }
    });
}

pub async fn maybe_snapshot(app: &AppHandle) -> crate::error::Result<()> {
    let d = db(app);
    if !d.setting_bool("s_autoSnapshot", true).await {
        return Ok(());
    }
    let today = timeutil::local_today();
    if d.state_get("lastSnapshotDate").await?.as_deref() == Some(&today.to_string()) {
        return Ok(());
    }
    let path = crate::backup::create_snapshot(app, "auto", Some(&format!("每日自动快照 {today}"))).await?;
    d.state_set("lastSnapshotDate", &today.to_string()).await?;
    crate::backup::prune_snapshots(app, 30).await?;
    logs(app).info("snapshot", format!("已生成每日快照: {}", path.display()));

    // 指定目录同步（WebDAV 列为二期，这里做「定时复制到本地目录」）
    let sync_dir = d.setting_str("s_syncDir", "").await;
    if !sync_dir.is_empty() {
        match crate::backup::sync_to_dir(app, &sync_dir).await {
            Ok(n) => logs(app)
                .info("snapshot", format!("已同步 {n} 个文件到 {sync_dir}")),
            Err(e) => logs(app).warn("snapshot", format!("同步失败: {e}")),
        }
    }
    Ok(())
}

/// 供前端「立即备份」按钮调用
pub async fn snapshot_now(app: &AppHandle) -> crate::error::Result<String> {
    let p = crate::backup::create_snapshot(app, "manual", Some("手动备份")).await?;
    crate::backup::prune_snapshots(app, 30).await?;
    Ok(p.to_string_lossy().to_string())
}

/// 供托盘 / 命令面板调用：立即扫描一次
pub async fn scan_now(app: &AppHandle) -> crate::error::Result<()> {
    scan_due(app).await
}

/// 计算「今天」的本地起止（导出给 commands 用）
pub fn today_bounds() -> (DateTime<Utc>, DateTime<Utc>) {
    timeutil::local_day_range_utc(timeutil::local_today())
}

/// 周回顾：判断是否是周日晚上（前端负责弹窗，这里只提供工具）
pub fn is_weekly_review_time(now: DateTime<Utc>) -> bool {
    let local = now.with_timezone(&chrono::Local);
    local.weekday().number_from_monday() == 7 && local.hour() >= 20
}
