//! Read-only projection of the bundled runtime's durable message/part records.
use super::*;
use rusqlite::{params, Connection, OpenFlags};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TraceRequest {
    project_id: String,
    session_id: String,
    before: Option<i64>,
}

pub(super) async fn trace(
    State(state): State<AppState>,
    Json(input): Json<TraceRequest>,
) -> Response {
    let result = (|| {
        valid_id(&input.project_id)?;
        valid_id(&input.session_id)?;
        let root = storage::app_data_root(&state.storage)?.join("runtimes");
        let file = safe_child(
            &root,
            &format!(
                "{}/{}/data/opencode/opencode.db",
                input.project_id, input.session_id
            ),
        )?;
        if !file.exists() {
            return Ok(json!({"records":[],"before":null}));
        }
        read_trace(&file, input.before)
    })();
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => fail(error),
    }
}

fn read_trace(path: &FsPath, before: Option<i64>) -> Result<Value> {
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    let mut statement = db.prepare("SELECT p.rowid,p.id,p.message_id,p.session_id,p.time_created,p.data,m.data,s.title,s.parent_id FROM part p JOIN message m ON m.id=p.message_id JOIN session s ON s.id=p.session_id WHERE (?1 IS NULL OR p.rowid<?1) ORDER BY p.rowid DESC LIMIT 101").map_err(|e| e.to_string())?;
    let records = statement
        .query_map(params![before], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for record in records {
        let (cursor, id, message_id, session_id, at, part, info, title, parent) =
            record.map_err(|e| e.to_string())?;
        let mut part: Value = serde_json::from_str(&part).map_err(|e| e.to_string())?;
        let mut info: Value = serde_json::from_str(&info).map_err(|e| e.to_string())?;
        redact(&mut part);
        redact(&mut info);
        rows.push(json!({"cursor":cursor,"id":id,"messageId":message_id,"sessionId":session_id,"at":at,"part":part,"info":info,"title":title,"parentId":parent}));
    }
    let more = rows.len() > 100;
    rows.truncate(100);
    let cursor = if more {
        rows.last()
            .map(|r| r["cursor"].clone())
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    rows.reverse();
    Ok(json!({"records":rows,"before":cursor}))
}

fn redact(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                if [
                    "apikey",
                    "api_key",
                    "authorization",
                    "password",
                    "secret",
                    "access_token",
                ]
                .contains(&key.to_lowercase().as_str())
                {
                    *value = json!("[已隐藏]");
                } else {
                    redact(value);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                redact(value);
            }
        }
        Value::String(text) => {
            if text.starts_with("data:") {
                *text = "[媒体内容]".into();
            } else if text.len() > 200_000 {
                *text = format!(
                    "{}\n[内容过长，已截断]",
                    text.chars().take(50_000).collect::<String>()
                );
            }
        }
        _ => (),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn trace_pages_include_child_tools_without_duplicates() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let db = Connection::open(file.path()).unwrap();
        db.execute_batch(r#"CREATE TABLE session (id TEXT,title TEXT,parent_id TEXT); CREATE TABLE message (id TEXT,data TEXT); CREATE TABLE part (id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO session VALUES ('root','Zodiac',NULL),('child','Executor','root'); INSERT INTO message VALUES ('m','{"role":"assistant","agent":"executor"}');"#).unwrap();
        for n in 0..205 {
            db.execute("INSERT INTO part VALUES (?1,'m',?2,?3,?4)", params![format!("p{n}"), if n%2==0 { "root" } else { "child" }, n, r#"{"type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"echo done"}}}"#]).unwrap();
        }
        let mut ids = std::collections::HashSet::new();
        let mut before = None;
        loop {
            let page = read_trace(file.path(), before).unwrap();
            for row in page["records"].as_array().unwrap() {
                assert!(ids.insert(row["id"].as_str().unwrap().to_owned()));
                if row["sessionId"] == "child" {
                    assert_eq!(row["parentId"], "root");
                }
            }
            before = page["before"].as_i64();
            if before.is_none() {
                break;
            }
        }
        assert_eq!(ids.len(), 205);
    }
    #[test]
    fn trace_redacts_credentials_and_binary_without_hiding_errors() {
        let mut value = json!({"input":{"apiKey":"private","Authorization":"Bearer private"},"url":"data:image/png;base64,AAAA","error":"provider rejected request"});
        redact(&mut value);
        assert_eq!(value["input"]["apiKey"], "[已隐藏]");
        assert_eq!(value["url"], "[媒体内容]");
        assert_eq!(value["error"], "provider rejected request");
    }
}
