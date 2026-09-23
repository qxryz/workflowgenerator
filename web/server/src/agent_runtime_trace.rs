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
            return Ok(json!({"records":[],"before":null,"usage":TraceUsage::default()}));
        }
        read_trace(&file, input.before)
    })();
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => fail(error),
    }
}

fn read_trace(path: &FsPath, before: Option<i64>) -> Result<Value> {
    let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    let db = db.transaction().map_err(|e| e.to_string())?;
    // Read each message once, including child sessions, regardless of part pagination.
    let usage = read_usage(&db)?;
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
        let request_usage = message_usage(&info);
        redact(&mut part);
        redact(&mut info);
        rows.push(json!({"cursor":cursor,"id":id,"messageId":message_id,"sessionId":session_id,"at":at,"part":part,"info":info,"title":title,"parentId":parent,"usage":request_usage}));
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
    Ok(json!({"records":rows,"before":cursor,"usage":usage}))
}

#[derive(Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceTokens {
    input: Option<u64>,
    cache_read: Option<u64>,
    cache_write: Option<u64>,
    output: Option<u64>,
    reasoning: Option<u64>,
}

impl TraceTokens {
    fn add(&mut self, other: Self) {
        fn sum(a: Option<u64>, b: Option<u64>) -> Option<u64> {
            a.zip(b).map(|(a, b)| a.saturating_add(b))
        }
        self.input = sum(self.input, other.input);
        self.cache_read = sum(self.cache_read, other.cache_read);
        self.cache_write = sum(self.cache_write, other.cache_write);
        self.output = sum(self.output, other.output);
        self.reasoning = sum(self.reasoning, other.reasoning);
    }
}

#[derive(Default, serde::Serialize)]
struct TraceUsage {
    requests: u64,
    unreported: u64,
    pending: u64,
    tokens: TraceTokens,
}

fn message_usage(info: &Value) -> Option<TraceTokens> {
    if info["role"] != "assistant" {
        return None;
    }
    let tokens = &info["tokens"];
    // OpenCode 1.18 stores five disjoint buckets: output excludes reasoning.
    let result = TraceTokens {
        input: tokens["input"].as_u64(),
        cache_read: tokens["cache"]["read"].as_u64(),
        cache_write: tokens["cache"]["write"].as_u64(),
        output: tokens["output"].as_u64(),
        reasoning: tokens["reasoning"].as_u64(),
    };
    // Runtime initializes all buckets to zero before a provider reports usage.
    // Do not present that placeholder as a measured zero-token response.
    let measured = tokens["total"].as_u64().is_some()
        || [
            result.input,
            result.cache_read,
            result.cache_write,
            result.output,
            result.reasoning,
        ]
        .iter()
        .any(|n| n.unwrap_or(0) > 0);
    measured.then_some(result)
}

fn read_usage(db: &Connection) -> Result<TraceUsage> {
    let mut usage = TraceUsage::default();
    let mut query = db.prepare("SELECT json_object('role',json_extract(data,'$.role'),'tokens',json_extract(data,'$.tokens'),'time',json_object('completed',json_extract(data,'$.time.completed'))) FROM message WHERE json_extract(data,'$.role')='assistant'").map_err(|e| e.to_string())?;
    let messages = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for message in messages {
        let info: Value = serde_json::from_str(&message.map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if let Some(tokens) = message_usage(&info) {
            if usage.requests == 0 {
                usage.tokens = tokens;
            } else {
                usage.tokens.add(tokens);
            }
            usage.requests += 1;
        } else if info["time"]["completed"].is_number() {
            usage.unreported += 1;
        } else {
            usage.pending += 1;
        }
    }
    Ok(usage)
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
    fn usage_counts_messages_once_across_pages_and_child_sessions() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let db = Connection::open(file.path()).unwrap();
        db.execute_batch("CREATE TABLE session (id TEXT,title TEXT,parent_id TEXT); CREATE TABLE message (id TEXT,data TEXT); CREATE TABLE part (id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO session VALUES ('root','Zodiac',NULL),('child','Executor','root');").unwrap();
        let reported = json!({"role":"assistant","tokens":{"input":100,"output":20,"reasoning":10,"cache":{"read":200,"write":50}},"time":{"completed":10}});
        for (id, info) in [
            ("root-message", reported.clone()),
            ("child-message", reported.clone()),
            (
                "unreported",
                json!({"role":"assistant","tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"time":{"completed":10}}),
            ),
            ("pending", json!({"role":"assistant"})),
            ("user", json!({"role":"user","tokens":{"total":9999}})),
        ] {
            db.execute(
                "INSERT INTO message VALUES (?1,?2)",
                params![id, info.to_string()],
            )
            .unwrap();
        }
        for n in 0..205 {
            db.execute(
                "INSERT INTO part VALUES (?1,?2,?3,?4,?5)",
                params![
                    format!("p{n}"),
                    if n == 0 {
                        "root-message"
                    } else {
                        "child-message"
                    },
                    if n == 0 { "root" } else { "child" },
                    n,
                    r#"{"type":"text","text":"done"}"#
                ],
            )
            .unwrap();
        }
        let page = read_trace(file.path(), None).unwrap();
        assert_eq!(page["records"].as_array().unwrap().len(), 100);
        assert_eq!(
            page["usage"],
            json!({"requests":2,"unreported":1,"pending":1,"tokens":{"input":200,"output":40,"reasoning":20,"cacheRead":400,"cacheWrite":100}})
        );
        let older = read_trace(file.path(), page["before"].as_i64()).unwrap();
        assert_eq!(older["usage"], page["usage"]);
        assert_eq!(page["records"][0]["usage"]["reasoning"], 10);
        // Updating a streamed message replaces its usage; it is not added again.
        db.execute("UPDATE message SET data=?1 WHERE id='child-message'", params![json!({"role":"assistant","tokens":{"input":150,"output":25,"reasoning":5,"cache":{"read":100,"write":0}}}).to_string()]).unwrap();
        let updated = read_trace(file.path(), None).unwrap();
        assert_eq!(updated["usage"]["requests"], 2);
        assert_eq!(updated["usage"]["tokens"]["input"], 250);
        assert_eq!(updated["usage"]["tokens"]["reasoning"], 15);
    }

    #[test]
    fn missing_usage_is_not_measured_zero() {
        assert!(message_usage(&json!({"role":"assistant","tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}})).is_none());
        let zero = message_usage(&json!({"role":"assistant","tokens":{"total":0,"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}})).unwrap();
        assert_eq!(zero.input, Some(0));
        let partial = message_usage(&json!({"role":"assistant","tokens":{"output":5}})).unwrap();
        assert_eq!(partial.input, None);
        assert_eq!(partial.output, Some(5));
        let mut total = zero;
        total.add(partial);
        assert_eq!(total.input, None);
        assert_eq!(total.output, Some(5));
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
