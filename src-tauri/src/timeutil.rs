//! 时间工具：统一「UTC 存储、本地显示」策略。
//! 数据库里所有时间字段都是 RFC3339 UTC 字符串（...Z），前端用 date-fns-tz 转本地时区。

use chrono::{DateTime, Datelike, Days, Local, NaiveDate, TimeZone, Utc};

/// 当前 UTC 时间，毫秒精度，带 Z 后缀
pub fn utc_now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn to_iso<T: chrono::offset::TimeZone>(dt: DateTime<T>) -> String
where
    T::Offset: std::fmt::Display,
{
    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 解析多种常见 ISO8601 写法，统一转成 UTC
pub fn parse_iso(s: &str) -> Option<DateTime<Utc>> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if let Ok(d) = DateTime::parse_from_rfc3339(t) {
        return Some(d.with_timezone(&Utc));
    }
    // 兼容 "2026-09-20 15:00:00" 这类本地写法
    let naive_fmts = [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ];
    for f in naive_fmts {
        if let Ok(n) = chrono::NaiveDateTime::parse_from_str(t, f) {
            return Some(Local.from_local_datetime(&n).earliest()?.with_timezone(&Utc));
        }
    }
    if let Ok(d) = NaiveDate::parse_from_str(t, "%Y-%m-%d") {
        let n = d.and_hms_opt(0, 0, 0)?;
        return Some(Local.from_local_datetime(&n).earliest()?.with_timezone(&Utc));
    }
    None
}

/// ICS 需要的紧凑 UTC 格式：20260920T073000Z
pub fn to_ics_utc(dt: DateTime<Utc>) -> String {
    dt.format("%Y%m%dT%H%M%SZ").to_string()
}

/// ICS 全天日期：20260920
pub fn to_ics_date(dt: DateTime<Utc>) -> String {
    dt.with_timezone(&Local).format("%Y%m%d").to_string()
}

/// 解析 ICS 的 DTSTART / DTEND
/// 支持：20260920T073000Z / 20260920T073000 / 20260920
pub fn parse_ics_datetime(value: &str, utc: bool) -> Option<DateTime<Utc>> {
    let v = value.trim();
    if v.is_empty() {
        return None;
    }
    if v.ends_with('Z') {
        let n = chrono::NaiveDateTime::parse_from_str(v.trim_end_matches('Z'), "%Y%m%dT%H%M%S").ok()?;
        return Some(Utc.from_utc_datetime(&n));
    }
    if let Ok(n) = chrono::NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S") {
        return Some(if utc {
            Utc.from_utc_datetime(&n)
        } else {
            Local.from_local_datetime(&n).earliest()?.with_timezone(&Utc)
        });
    }
    if v.len() == 8 {
        let d = NaiveDate::parse_from_str(v, "%Y%m%d").ok()?;
        let n = d.and_hms_opt(0, 0, 0)?;
        return Some(
            Local
                .from_local_datetime(&n)
                .earliest()?
                .with_timezone(&Utc),
        );
    }
    // 兜底：标准 ISO
    parse_iso(v)
}

/// 加 n 个月，日期溢出时收敛到当月最后一天（1/31 + 1月 => 2/28）
pub fn add_months(dt: DateTime<Utc>, months: i32) -> DateTime<Utc> {
    use chrono::NaiveDate;
    let total = dt.year() * 12 + (dt.month0() as i32) + months;
    let y = total.div_euclid(12);
    let m = (total.rem_euclid(12) as u32) + 1;
    let last_day = last_day_of_month(y, m);
    let day = dt.day().min(last_day);
    let date = NaiveDate::from_ymd_opt(y, m, day).unwrap_or_else(|| dt.date_naive());
    let naive = date.and_time(dt.time());
    naive.and_utc()
}

pub fn last_day_of_month(year: i32, month: u32) -> u32 {
    let days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let base = days[(month - 1) as usize];
    if month == 2 && is_leap(year) {
        29
    } else {
        base
    }
}

pub fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// 本地「今天」的 UTC 起止（左闭右开），用于晨报与统计
pub fn local_day_range_utc(day: NaiveDate) -> (DateTime<Utc>, DateTime<Utc>) {
    let start = Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .unwrap_or_else(Local::now);
    let end = start + chrono::Duration::days(1);
    (start.with_timezone(&Utc), end.with_timezone(&Utc))
}

pub fn local_today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn add_days_utc(dt: DateTime<Utc>, days: i64) -> DateTime<Utc> {
    if days >= 0 {
        dt.checked_add_days(Days::new(days as u64)).unwrap_or(dt)
    } else {
        dt.checked_sub_days(Days::new((-days) as u64)).unwrap_or(dt)
    }
}
pub fn add_minutes_utc(dt: DateTime<Utc>, minutes: i64) -> DateTime<Utc> {
    dt + chrono::Duration::minutes(minutes)
}

pub fn add_seconds_utc(dt: DateTime<Utc>, seconds: i64) -> DateTime<Utc> {
    dt + chrono::Duration::seconds(seconds)
}