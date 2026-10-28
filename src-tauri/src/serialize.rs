//! 把 sqlx 的 SqliteRow 转成 serde_json::Value，用于 JSON 快照 / 诊断导出。

use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, TypeInfo};

pub fn row_to_json(row: &SqliteRow) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for (i, col) in row.columns().iter().enumerate() {
        let name = col.name().to_string();
        let ty = col.type_info().name().to_uppercase();
        let value = match ty.as_str() {
            "NULL" => serde_json::Value::Null,
            "INTEGER" | "INT" | "BOOLEAN" => match row.try_get::<i64, _>(i) {
                Ok(v) => serde_json::Value::from(v),
                Err(_) => serde_json::Value::Null,
            },
            "REAL" | "FLOAT" | "DOUBLE" | "NUMERIC" => match row.try_get::<f64, _>(i) {
                Ok(v) => serde_json::Number::from_f64(v)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                Err(_) => serde_json::Value::Null,
            },
            "BLOB" => serde_json::Value::Null, // 快照不落地二进制
            _ => match row.try_get::<String, _>(i) {
                Ok(v) => serde_json::Value::String(v),
                Err(_) => serde_json::Value::Null,
            },
        };
        map.insert(name, value);
    }
    serde_json::Value::Object(map)
}