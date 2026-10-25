//! 剧目 (drama) store and HTTP API. The server is the single validator: the
//! client compiles prompts and calls models, then hands results here.
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{types::Value as Sql, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

mod export;
mod model;
mod proposal;
mod routes;
mod schema;
#[cfg(test)]
mod tests;

pub(crate) use routes::router;
pub(crate) use schema::init;

pub(crate) type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Issue {
    pub path: String,
    pub message: String,
}

#[derive(Debug)]
pub struct Error {
    status: StatusCode,
    message: String,
    issues: Vec<Issue>,
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let body = if self.issues.is_empty() {
            json!({"error": self.message})
        } else {
            json!({"error": self.message, "issues": self.issues})
        };
        (self.status, Json(body)).into_response()
    }
}
pub(crate) fn bad(message: impl Into<String>) -> Error {
    Error { status: StatusCode::BAD_REQUEST, message: message.into(), issues: vec![] }
}
pub(crate) fn missing(what: &str) -> Error {
    Error { status: StatusCode::NOT_FOUND, message: format!("{what}不存在"), issues: vec![] }
}
pub(crate) fn conflict(message: impl Into<String>) -> Error {
    Error { status: StatusCode::CONFLICT, message: message.into(), issues: vec![] }
}
pub(crate) fn rejected(issues: Vec<Issue>) -> Error {
    let message = issues.first().map(|i| i.message.clone()).unwrap_or_default();
    Error { status: StatusCode::UNPROCESSABLE_ENTITY, message, issues }
}
pub(crate) fn db(error: rusqlite::Error) -> Error {
    Error { status: StatusCode::INTERNAL_SERVER_ERROR, message: format!("剧目存储失败：{error}"), issues: vec![] }
}
pub(crate) fn internal(message: String) -> Error {
    Error { status: StatusCode::INTERNAL_SERVER_ERROR, message, issues: vec![] }
}

pub(crate) fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64
}

/// Opaque unique id: time-ordered prefix plus a hashed counter suffix.
pub(crate) fn new_id() -> String {
    use sha2::{Digest, Sha256};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let hash = Sha256::digest(format!("{nanos}:{count}:{}", std::process::id()));
    format!("{:x}{}", nanos / 1_000_000, hex(&hash[..8]))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Field names as users see them in error messages.
pub(crate) fn field(key: &str) -> &str {
    match key {
        "title" => "标题",
        "name" => "名称",
        "body" => "正文",
        "summary" => "摘要",
        "endState" => "章末状态",
        "brief" => "简介",
        "description" => "描述",
        "appearance" => "外观",
        "sourceNote" => "出处说明",
        "outline" => "梗概",
        "script" => "剧本",
        "note" => "说明",
        "label" => "关系标签",
        "prompt" | "imagePrompt" | "videoPrompt" => "提示词",
        "startState" => "开拍状态",
        "narration" => "旁白",
        "size" => "景别",
        "camera" => "运镜",
        "seconds" => "镜头时长",
        "targetSeconds" => "目标时长",
        "aliases" => "别名",
        "instruction" => "补充要求",
        _ => key,
    }
}

/// Reads an optional text field, trimmed and bounded by character count.
pub(crate) fn text_field(body: &Value, key: &str, max: usize) -> Result<Option<String>> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let s = s.trim();
            if s.chars().count() > max {
                return Err(bad(format!("{}不能超过 {max} 个字", field(key))));
            }
            Ok(Some(s.to_owned()))
        }
        Some(_) => Err(bad(format!("{}必须是文字", field(key)))),
    }
}

/// Accumulates a column-whitelisted UPDATE guarded by `rev`.
#[derive(Default)]
pub(crate) struct Patch {
    sets: Vec<String>,
    values: Vec<Sql>,
}
impl Patch {
    pub fn set(&mut self, column: &str, value: Sql) {
        self.sets.push(format!("{column}=?"));
        self.values.push(value);
    }
    pub fn text(&mut self, body: &Value, key: &str, column: &str, max: usize, required: bool) -> Result<()> {
        if let Some(value) = text_field(body, key, max)? {
            if required && value.is_empty() {
                return Err(bad(format!("{}不能为空", field(key))));
            }
            self.set(column, Sql::Text(value));
        }
        Ok(())
    }
    pub fn int(&mut self, body: &Value, key: &str, column: &str, min: i64, max: i64) -> Result<()> {
        if let Some(value) = body.get(key).filter(|v| !v.is_null()) {
            let n = value.as_i64().ok_or_else(|| bad(format!("{}必须是整数", field(key))))?;
            if n < min || n > max {
                return Err(bad(format!("{}必须在 {min} 到 {max} 之间", field(key))));
            }
            self.set(column, Sql::Integer(n));
        }
        Ok(())
    }
    pub fn json(&mut self, column: &str, value: &Value) {
        self.set(column, Sql::Text(value.to_string()));
    }
    pub fn into_parts(self) -> (Vec<String>, Vec<Sql>) {
        (self.sets, self.values)
    }
    pub fn is_empty(&self) -> bool {
        self.sets.is_empty()
    }
    /// Applies the update when `rev` still matches; bumps rev and updated_at.
    pub fn apply(mut self, conn: &Connection, table: &str, id: &str, body: &Value) -> Result<()> {
        let rev = body.get("rev").and_then(Value::as_i64).ok_or_else(|| conflict("内容已在别处修改，请刷新后再试"))?;
        self.sets.push("updated_at=?".into());
        self.values.push(Sql::Integer(now()));
        self.values.push(Sql::Text(id.to_owned()));
        self.values.push(Sql::Integer(rev));
        let sql = format!("UPDATE {table} SET {}, rev=rev+1 WHERE id=? AND rev=?", self.sets.join(","));
        let changed = conn.execute(&sql, rusqlite::params_from_iter(self.values)).map_err(db)?;
        if changed == 0 {
            let exists: bool = conn
                .query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"), [id], |r| r.get(0))
                .map_err(db)?;
            return Err(if exists { conflict("内容已在别处修改，请刷新后再试") } else { missing("内容") });
        }
        Ok(())
    }
}
