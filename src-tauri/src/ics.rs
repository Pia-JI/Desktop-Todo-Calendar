//! iCalendar (.ics) 解析与生成 —— 纯手写实现，不引入需要编译原生模块的 heavy deps。
//!
//! 能力边界（明确标注）：
//! - 生成：timed 事件统一用 UTC（...Z），全天事件用 VALUE=DATE；带 VALARM（由 remindBeforeSec 推导）
//! - 解析：支持 VEVENT 的 DTSTART/DTEND/SUMMARY/DESCRIPTION/LOCATION/UID/RRULE，
//!   支持行折叠、`\n`/`\,`/`\\` 转义、DATE 与 DATE-TIME 两种取值
//! - 时区：未内置 IANA 时区表（避免 chrono-tz 体积），带 TZID 的时间按「本机时区」解释，
//!   导入外部日历时若源事件时区与本机不同，可能有小时级偏移；二期可接 chrono-tz 修正

use serde::Serialize;
use sqlx::Row;

use crate::db::Db;
use crate::error::{AppError, Result};
use crate::timeutil;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IcsEvent {
    pub uid: Option<String>,
    pub title: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub all_day: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub rrule: Option<String>,
}

// ───────────────────────── 解析 ─────────────────────────

/// 行折叠还原：以空格/Tab 开头的行是上一行的续行（RFC5545 3.1）
fn unfold(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_end_matches(['\r', '\n']);
        if let Some(rest) = line.strip_prefix([' ', '\t']) {
            if let Some(last) = out.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        if !line.trim().is_empty() {
            out.push(line.to_string());
        }
    }
    out
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some('\\') => out.push('\\'),
                Some(',') => out.push(','),
                Some(';') => out.push(';'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// 拆出 `NAME;PARAMS` 与 `VALUE`（返回 owned，避免 &str 生命周期/leak 问题）
fn split_prop(line: &str) -> Option<(String, Option<String>, String)> {
    let (head, value) = line.split_once(':')?;
    let (name, params) = match head.split_once(';') {
        Some((n, p)) => (n.trim(), Some(p.to_string())),
        None => (head.trim(), None),
    };
    Some((name.to_ascii_uppercase(), params, value.trim().to_string()))
}

/// 从属性参数里取某个 KEY 的值，例如 param_value("TZID=Asia/Shanghai;VALUE=DATE", "TZID")
fn param_value(params: &Option<String>, key: &str) -> Option<String> {
    let p = params.as_ref()?;
    for kv in p.split(';') {
        if let Some((k, v)) = kv.split_once('=') {
            if k.trim().eq_ignore_ascii_case(key) {
                return Some(v.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

pub fn parse_ics(text: &str) -> Vec<IcsEvent> {
    let lines = unfold(text);
    let mut events = Vec::new();
    let mut in_event = false;
    let mut in_alarm = false;

    let mut uid = None;
    let mut summary = None;
    let mut desc = None;
    let mut loc = None;
    let mut rrule = None;
    let mut start: Option<(String, bool, Option<String>)> = None;
    let mut end: Option<(String, bool)> = None;

    macro_rules! reset {
        () => {
            uid = None;
            summary = None;
            desc = None;
            loc = None;
            rrule = None;
            start = None;
            end = None;
        };
    }

    for line in &lines {
        let upper = line.to_ascii_uppercase();
        if upper.starts_with("BEGIN:VEVENT") {
            in_event = true;
            reset!();
            continue;
        }
        if upper.starts_with("END:VEVENT") {
            if let Some((sv, all_day, tzid)) = start.clone() {
                if let Some(start_dt) = timeutil::parse_ics_datetime(&sv, tzid.is_none()) {
                    let end_dt = end.as_ref().and_then(|(ev, _)| {
                        timeutil::parse_ics_datetime(ev, tzid.is_none())
                    });
                    events.push(IcsEvent {
                        uid: uid.clone(),
                        title: summary.clone().unwrap_or_else(|| "(无标题)".into()),
                        start_at: timeutil::to_iso(start_dt),
                        end_at: end_dt.map(|d| timeutil::to_iso(d)),
                        all_day,
                        location: loc.clone(),
                        notes: desc.clone(),
                        rrule: rrule.clone(),
                    });
                }
            }
            in_event = false;
            reset!();
            continue;
        }
        if !in_event {
            continue;
        }
        if upper.starts_with("BEGIN:VALARM") {
            in_alarm = true;
            continue;
        }
        if upper.starts_with("END:VALARM") {
            in_alarm = false;
            continue;
        }
        if in_alarm {
            continue;
        }

        let Some((name, params, value)) = split_prop(line) else {
            continue;
        };
        match name.as_str() {
            "UID" => uid = Some(value.clone()),
            "SUMMARY" => summary = Some(unescape(&value)),
            "DESCRIPTION" => desc = Some(unescape(&value)),
            "LOCATION" => loc = Some(unescape(&value)),
            "RRULE" => rrule = Some(value.clone()),
            "DTSTART" | "DTEND" => {
                let value_type = param_value(&params, "VALUE")
                    .map(|v| v.to_ascii_uppercase())
                    .unwrap_or_default();
                let is_date = value_type == "DATE" || value.len() == 8;
                let tzid = param_value(&params, "TZID");
                if name == "DTSTART" {
                    start = Some((value.clone(), is_date, tzid));
                } else {
                    end = Some((value.clone(), is_date));
                }
            }
            _ => {}
        }
    }
    events
}

// ───────────────────────── 生成 ─────────────────────────

fn fold(line: &str) -> String {
    // RFC5545：单行不超过 75 octets，续行以空格开头
    let bytes = line.as_bytes();
    if bytes.len() <= 75 {
        return line.to_string();
    }
    let mut out = String::new();
    let mut i = 0usize;
    let mut first = true;
    while i < bytes.len() {
        let limit = if first { 75 } else { 74 };
        let mut end = (i + limit).min(bytes.len());
        while end < bytes.len() && !is_char_boundary(line, end) {
            end -= 1;
        }
        let chunk = &line[i..end];
        if first {
            out.push_str(chunk);
            first = false;
        } else {
            // RFC5545：折行必须是 CRLF + 一个前导空格
            out.push_str("\r\n ");
            out.push_str(chunk);
        }
        i = end;
    }
    out
}

fn is_char_boundary(s: &str, idx: usize) -> bool {
    s.is_char_boundary(idx)
}

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace("\r\n", "\\n")
        .replace('\n', "\\n")
}

fn repeat_to_rrule(repeat: &str) -> Option<&'static str> {
    match repeat {
        "daily" => Some("FREQ=DAILY"),
        "weekly" => Some("FREQ=WEEKLY"),
        "monthly" => Some("FREQ=MONTHLY"),
        _ => None,
    }
}

/// 从数据库导出全部（未删除）待办为 ICS 文本
pub async fn generate_from_db(db: &Db) -> Result<String> {
    let rows = sqlx::query(
        "SELECT id, title, start_at, end_at, all_day, priority, repeat, remind_before_sec, notes, calendar_id
           FROM todos WHERE deleted_at IS NULL ORDER BY start_at ASC",
    )
    .fetch_all(&db.pool)
    .await?;

    let cal_name: Option<String> = sqlx::query_scalar(
        "SELECT name FROM calendars WHERE id = 'default' LIMIT 1",
    )
    .fetch_optional(&db.pool)
    .await
    .unwrap_or(None);

    let now = timeutil::utc_now();
    let stamp = timeutil::parse_iso(&now)
        .map(|d| timeutil::to_ics_utc(d))
        .unwrap_or_else(|| "19700101T000000Z".into());

    let mut out = String::new();
    out.push_str("BEGIN:VCALENDAR\r\n");
    out.push_str("VERSION:2.0\r\n");
    out.push_str("PRODID:-//DesktopTodoCalendar//CN\r\n");
    out.push_str("CALSCALE:GREGORIAN\r\n");
    out.push_str("METHOD:PUBLISH\r\n");
    out.push_str(&fold(&format!(
        "X-WR-CALNAME:{}",
        esc(&cal_name.unwrap_or_else(|| "桌面待办日历".into()))
    )));
    out.push_str("\r\n");
    out.push_str("X-WR-TIMEZONE:Asia/Shanghai\r\n");

    for r in &rows {
        let id: String = r.get("id");
        let title: String = r.get("title");
        let start_at: String = r.get("start_at");
        let end_at: Option<String> = r.get("end_at");
        let all_day: i64 = r.get("all_day");
        let priority: i64 = r.get("priority");
        let repeat: String = r.get("repeat");
        let remind: i64 = r.get("remind_before_sec");
        let notes: Option<String> = r.get("notes");

        let Some(start) = timeutil::parse_iso(&start_at) else {
            continue;
        };

        out.push_str("BEGIN:VEVENT\r\n");
        out.push_str(&fold(&format!("UID:{id}@desktop-todo-calendar")));
        out.push_str("\r\n");
        out.push_str(&format!("DTSTAMP:{stamp}\r\n"));

        if all_day != 0 {
            out.push_str(&format!(
                "DTSTART;VALUE=DATE:{}\r\n",
                timeutil::to_ics_date(start)
            ));
            let next = timeutil::add_days_utc(start, 1);
            let end = end_at
                .as_ref()
                .and_then(|e| timeutil::parse_iso(e))
                .map(|e| timeutil::add_days_utc(e, 1))
                .unwrap_or(next);
            out.push_str(&format!(
                "DTEND;VALUE=DATE:{}\r\n",
                timeutil::to_ics_date(end)
            ));
        } else {
            out.push_str(&format!(
                "DTSTART:{}\r\n",
                timeutil::to_ics_utc(start)
            ));
            let end = end_at
                .as_ref()
                .and_then(|e| timeutil::parse_iso(e))
                .unwrap_or_else(|| timeutil::add_minutes_utc(start, 30));
            out.push_str(&format!("DTEND:{}\r\n", timeutil::to_ics_utc(end)));
        }

        out.push_str(&fold(&format!("SUMMARY:{}", esc(&title))));
        out.push_str("\r\n");
        if let Some(n) = notes.filter(|s| !s.trim().is_empty()) {
            out.push_str(&fold(&format!("DESCRIPTION:{}", esc(&n))));
            out.push_str("\r\n");
        }
        // iCalendar PRIORITY: 1 最高 ... 9 最低
        let ical_priority = match priority {
            1 => 1,
            3 => 9,
            _ => 5,
        };
        out.push_str(&format!("PRIORITY:{ical_priority}\r\n"));
        out.push_str("STATUS:CONFIRMED\r\n");
        out.push_str("TRANSP:OPAQUE\r\n");
        if let Some(rr) = repeat_to_rrule(&repeat) {
            out.push_str(&format!("RRULE:{rr}\r\n"));
        }
        if remind > 0 && all_day == 0 {
            out.push_str("BEGIN:VALARM\r\n");
            out.push_str("ACTION:DISPLAY\r\n");
            out.push_str(&fold(&format!("DESCRIPTION:{}", esc(&title))));
            out.push_str("\r\n");
            out.push_str(&format!(
                "TRIGGER:-PT{}M\r\n",
                (remind / 60).max(1)
            ));
            out.push_str("END:VALARM\r\n");
        }
        out.push_str("END:VEVENT\r\n");
    }

    out.push_str("END:VCALENDAR\r\n");
    Ok(out)
}

/// 导入外部 .ics（系统日历 / Outlook 导出），落到 external_events 只读表
pub async fn import_ics_file(db: &Db, path: &std::path::Path, calendar_id: &str) -> Result<usize> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| AppError::msg(format!("读取 ics 失败: {e}")))?;
    let events = parse_ics(&text);
    let now = timeutil::utc_now();
    let mut n = 0usize;

    let mut tx = db.pool.begin().await?;
    for ev in &events {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT OR REPLACE INTO external_events(id, uid, calendar_id, title, start_at, end_at, all_day, location, notes, source_path, imported_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        )
        .bind(&id)
        .bind(ev.uid.clone())
        .bind(calendar_id)
        .bind(&ev.title)
        .bind(&ev.start_at)
        .bind(ev.end_at.clone())
        .bind(if ev.all_day { 1i64 } else { 0i64 })
        .bind(ev.location.clone())
        .bind(ev.notes.clone())
        .bind(path.to_string_lossy().to_string())
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        n += 1;
    }
    tx.commit().await?;
    Ok(n)
}