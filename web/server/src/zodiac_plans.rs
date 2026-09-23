//! Durable creative stages. Only these commands may mutate stage runtime;
//! generic KV writes cannot overwrite the dedicated plan tables.
use crate::state::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

#[path = "zodiac_plan_review.rs"]
mod review;

type Result<T> = std::result::Result<T, Error>;
#[derive(Debug)]
struct Error(StatusCode, String);
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}
fn invalid(message: impl Into<String>) -> Error {
    Error(StatusCode::BAD_REQUEST, message.into())
}
fn conflict(message: impl Into<String>) -> Error {
    Error(StatusCode::CONFLICT, message.into())
}
fn db(error: rusqlite::Error) -> Error {
    Error(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("计划存储失败：{error}"),
    )
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| invalid(format!("缺少 {key}")))
}
fn id<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    let v = text(value, key)?;
    if v.len() > 160
        || !v
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_: .".contains(&c))
    {
        return Err(invalid(format!("{key} 格式无效")));
    }
    Ok(v)
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{key} 必须是数组")))
}
fn schema(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS zodiac_plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS zodiac_plans_project ON zodiac_plans(project_id); CREATE TABLE IF NOT EXISTS zodiac_plan_requests (plan_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, reply TEXT NOT NULL, PRIMARY KEY(plan_id,request_id));").map_err(db)
}
fn read(conn: &Connection, plan_id: &str) -> Result<Value> {
    let body: Option<String> = conn
        .query_row(
            "SELECT body FROM zodiac_plans WHERE id=?1",
            [plan_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)?;
    serde_json::from_str(&body.ok_or_else(|| Error(StatusCode::NOT_FOUND, "计划不存在".into()))?)
        .map_err(|_| invalid("计划数据损坏"))
}
fn digest(value: &Value) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(value).unwrap()))
}
fn replay(conn: &Connection, plan_id: &str, request_id: &str, hash: &str) -> Result<Option<Value>> {
    let previous: Option<(String, String)> = conn
        .query_row(
            "SELECT digest,reply FROM zodiac_plan_requests WHERE plan_id=?1 AND request_id=?2",
            params![plan_id, request_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    if let Some((old, body)) = previous {
        if old != hash {
            return Err(conflict("requestId 已用于其他操作"));
        }
        let mut reply: Value = serde_json::from_str(&body).map_err(|_| invalid("计划回执损坏"))?;
        reply["plan"] = read(conn, plan_id)?;
        reply["replayed"] = json!(true);
        if reply.get("claim").is_some() {
            reply["claim"]["shouldExecute"] = json!(false);
        }
        return Ok(Some(reply));
    }
    Ok(None)
}
fn persist(
    conn: &Connection,
    plan: &Value,
    request_id: &str,
    hash: &str,
    claim: Option<Value>,
) -> Result<Value> {
    conn.execute("INSERT INTO zodiac_plans(id,project_id,body) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![text(plan,"id")?,text(plan,"projectId")?,plan.to_string()]).map_err(db)?;
    let mut reply = json!({"plan":plan,"replayed":false});
    if let Some(claim) = claim {
        reply["claim"] = claim;
    }
    conn.execute(
        "INSERT INTO zodiac_plan_requests(plan_id,request_id,digest,reply) VALUES(?1,?2,?3,?4)",
        params![text(plan, "id")?, request_id, hash, reply.to_string()],
    )
    .map_err(db)?;
    Ok(reply)
}
fn frontier(plan: &Value) -> Option<String> {
    plan["outline"]
        .as_array()?
        .iter()
        .find(|entry| {
            entry["omitted"] != true
                && !plan["stages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|stage| stage["id"] == entry["id"] && stage["runtime"]["status"] == "done")
        })
        .and_then(|entry| entry["id"].as_str().map(String::from))
}
fn validate_outline(outline: &Value) -> Result<()> {
    let entries = outline
        .as_array()
        .filter(|x| !x.is_empty() && x.len() <= 50)
        .ok_or_else(|| invalid("计划需包含 1–50 个阶段"))?;
    let mut ids = HashSet::new();
    for entry in entries {
        if !ids.insert(id(entry, "id")?) {
            return Err(invalid("阶段 ID 重复"));
        }
        if text(entry, "title")?.len() > 240 {
            return Err(invalid("阶段标题过长"));
        }
        if entry.get("workflowStageId").is_some() { id(entry, "workflowStageId")?; }
        if entry.get("omitted").is_some_and(|v| !v.is_boolean()) {
            return Err(invalid("omitted 必须是布尔值"));
        }
    }
    Ok(())
}
fn item_ids(plan: &Value, excluding: &str) -> HashSet<String> {
    plan["stages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["id"] != excluding)
        .flat_map(|s| s["contract"]["workItems"].as_array().unwrap())
        .filter_map(|i| i["id"].as_str().map(String::from))
        .collect()
}
fn validate_draft(plan: &Value, draft: &Value) -> Result<()> {
    id(draft, "id")?;
    if draft
        .as_object()
        .is_none_or(|o| o.keys().any(|k| !matches!(k.as_str(), "id" | "contract")))
    {
        return Err(invalid("Planner 只能写 id 和 contract"));
    }
    let contract = &draft["contract"];
    text(contract, "goal")?;
    if contract.as_object().is_none_or(|o| {
        o.keys()
            .any(|k| !matches!(k.as_str(), "goal" | "workItems" | "review"))
    }) {
        return Err(invalid("合同包含运行状态或未知字段"));
    }
    let items = array(contract, "workItems")?;
    if items.is_empty() || items.len() > 100 {
        return Err(invalid("阶段需包含 1–100 个工作项"));
    }
    let mut ids = item_ids(plan, text(draft, "id")?);
    for item in items {
        if item.as_object().is_none_or(|o| o.keys().any(|key| !matches!(key.as_str(), "id" | "title" | "tool" | "args" | "dependsOn" | "inputItemIds"))) {
            return Err(invalid("工作项只能包含创作内容和依赖，不能包含运行状态"));
        }
        let key = id(item, "id")?;
        if !ids.insert(key.to_string()) {
            return Err(invalid("工作项 ID 必须在计划内唯一"));
        }
        text(item, "title")?;
        let tool = text(item, "tool")?;
        if ![
            "hub_canvas_write_node",
            "hub_generate_image",
            "hub_generate_video",
            "hub_generate_audio",
        ]
        .contains(&tool)
        {
            return Err(invalid("工作项包含未支持的工具"));
        }
        if !item["args"].is_object() {
            return Err(invalid("工具 args 必须是对象"));
        }
        if tool == "hub_canvas_write_node" {
            text(&item["args"], "content")?;
            if item["args"].get("mode").is_some_and(|v| v != "replace") {
                return Err(invalid("阶段文档工作项必须提供完整正文并使用 replace 模式"));
            }
        }

        if item.as_object().unwrap().keys().any(|k| {
            !matches!(
                k.as_str(),
                "id" | "title" | "tool" | "args" | "dependsOn" | "inputItemIds"
            )
        }) {
            return Err(invalid("工作项包含未知字段"));
        }
    }
    let prior: HashSet<String> = plan["stages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["id"] != draft["id"] && s["runtime"]["status"] == "done")
        .flat_map(|s| s["contract"]["workItems"].as_array().unwrap())
        .filter_map(|i| i["id"].as_str().map(String::from))
        .collect();
    // Dependencies may reference only earlier items, making the stored sequence an executable DAG.
    let mut available = prior.clone();
    let mut earlier = HashSet::new();
    for item in items {
        for field in ["dependsOn", "inputItemIds"] {
            if let Some(raw) = item.get(field) {
                let refs = raw
                    .as_array()
                    .ok_or_else(|| invalid("工作项依赖必须是数组"))?;
                for reference in refs {
                    let key = reference.as_str().ok_or_else(|| invalid("依赖 ID 无效"))?;
                    let valid = if field == "dependsOn" {
                        earlier.contains(key)
                    } else {
                        available.contains(key)
                    };
                    if !valid {
                        return Err(invalid(format!("依赖 {key} 不存在或尚未排在当前项之前")));
                    }
                }
            }
        }
        let key = text(item, "id")?.to_string();
        earlier.insert(key.clone());
        available.insert(key);
    }
    if let Some(review) = contract.get("review") {
        let obj = review
            .as_object()
            .ok_or_else(|| invalid("review 必须是对象"))?;
        for (key, v) in obj {
            if !["beforeExecution", "afterExecution"].contains(&key.as_str())
                || v.as_array().is_none_or(|checks| {
                    checks.len() > 20
                        || checks
                            .iter()
                            .any(|c| c.as_str().is_none_or(|t| t.len() > 2000))
                })
            {
                return Err(invalid("审核检查格式无效"));
            }
        }
    }
    Ok(())
}
fn new_stage(draft: &Value, old: Option<&Value>) -> Value {
    let mut items = serde_json::Map::new();
    // Review wording does not change an already saved creative result.
    let same_context = old.is_some();
    let mut changed = HashSet::new();
    for item in draft["contract"]["workItems"].as_array().unwrap() {
        let key = item["id"].as_str().unwrap();
        let previous = old.and_then(|s| {
            s["contract"]["workItems"]
                .as_array()?
                .iter()
                .find(|i| i["id"] == key)
        });
        let old_runtime = old.and_then(|s| s["runtime"]["items"].get(key));
        let dependent_changed = ["dependsOn", "inputItemIds"].iter().any(|f| {
            item[*f].as_array().is_some_and(|a| {
                a.iter()
                    .any(|v| v.as_str().is_some_and(|v| changed.contains(v)))
            })
        });
        if same_context
            && previous == Some(item)
            && !dependent_changed
            && old_runtime.is_some_and(|r| r["status"] == "succeeded")
        {
            items.insert(key.into(), old_runtime.unwrap().clone());
        } else {
            changed.insert(key.to_string());
            let mut superseded = old_runtime
                .and_then(|r| r["supersededOutputs"].as_array())
                .cloned()
                .unwrap_or_default();
            if let Some(output) = old_runtime.and_then(|r| r.get("output")) {
                superseded.push(output.clone());
            }
            items.insert(
                key.into(),
                json!({"status":"pending","supersededOutputs":superseded,"operationId":format!("op-{}",digest(&json!([draft["id"],key,SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_string()])))}),
            );
        }
    }
    json!({"id":draft["id"],"contract":draft["contract"],"runtime":{"status":"waiting_user","waitingReason":"plan_review","items":items}})
}
fn outstanding(stage: &Value) -> bool {
    stage["runtime"]["items"]
        .as_object()
        .unwrap()
        .values()
        .any(|i| matches!(i["status"].as_str(), Some("running" | "interrupted")))
}
fn create(conn: &mut Connection, input: Value) -> Result<Value> {
    schema(conn)?;
    let plan_id = id(&input, "id")?.to_string();
    let request_id = id(&input, "requestId")?.to_string();
    let hash = digest(&input);
    let tx = conn.transaction().map_err(db)?;
    if let Some(reply) = replay(&tx, &plan_id, &request_id, &hash)? {
        return Ok(reply);
    }
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM zodiac_plans WHERE id=?1)",
            [&plan_id],
            |r| r.get(0),
        )
        .map_err(db)?;
    if exists {
        return Err(conflict("计划 ID 已存在"));
    }
    id(&input, "projectId")?;
    text(&input, "title")?;
    id(&input, "workflowId")?;
    validate_outline(&input["outline"])?;
    let mut plan = json!({"version":2,"id":plan_id,"projectId":input["projectId"],"title":input["title"],"workflowId":input["workflowId"],"revision":1,"outline":input["outline"],"stages":[],"createdAt":now(),"updatedAt":now()});
    if let Some(session) = input.get("sessionId") {
        id(&input, "sessionId")?;
        plan["sessionId"] = session.clone();
    }
    if let Some(session) = input.get("plannerSessionId") {
        id(&input, "plannerSessionId")?;
        plan["plannerSessionId"] = session.clone();
    }
    let draft = &input["firstStage"];
    validate_draft(&plan, draft)?;
    if frontier(&plan).as_deref() != draft["id"].as_str() {
        return Err(invalid("必须先编写首个未略过阶段"));
    }
    let mut stage = new_stage(draft, None);
    review::initialize(&plan, draft, &mut stage)?;
    plan["stages"].as_array_mut().unwrap().push(stage);
    let reply = persist(&tx, &plan, &request_id, &hash, None)?;
    tx.commit().map_err(db)?;
    Ok(reply)
}
fn saved_output_node(conn: &Connection, project_id: &str, output: &Value) -> Result<Value> {
    let node_id = text(output, "nodeId")?;
    let row: Option<(Vec<u8>, String)> = conn
        .query_row(
            "SELECT value,encoding FROM kv_store WHERE namespace='canvas-project-v1' AND key=?1",
            [project_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db)?;
    let (bytes, encoding) = row.ok_or_else(|| invalid("画布尚未保存，不能登记产物"))?;
    let project: Value = serde_json::from_str(
        &crate::storage::decode_store_value(bytes, &encoding).map_err(invalid)?,
    )
    .map_err(|_| invalid("画布数据无效"))?;
    project["nodes"]
        .as_array()
        .and_then(|nodes| nodes.iter().find(|node| node["id"] == node_id))
        .cloned()
        .ok_or_else(|| invalid("产物节点尚未保存到此画布"))
}
fn media_bucket(key: &str) -> &'static str {
    if key.starts_with("image:") {
        "images"
    } else {
        "media"
    }
}
fn stored_media_exists(conn: &Connection, key: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM media WHERE bucket=?1 AND key=?2)",
        params![media_bucket(key), key],
        |r| r.get(0),
    )
    .map_err(db)
}
fn validate_output(
    conn: &Connection,
    project_id: &str,
    item: &Value,
    output: &Value,
) -> Result<()> {
    let node = saved_output_node(conn, project_id, output)?;
    let expected_type = match item["tool"].as_str() {
        Some("hub_canvas_write_node") => "text",
        Some("hub_generate_image") => "image",
        Some("hub_generate_video") => "video",
        Some("hub_generate_audio") => "audio",
        _ => return Err(invalid("产物工具类型无效")),
    };
    if node["type"] != expected_type {
        return Err(invalid("产物节点类型与工作项工具不符"));
    }
    if expected_type == "text" {
        let content = text(&node["metadata"], "content")?;
        if content != text(&item["args"], "content")? {
            return Err(invalid("已保存正文与工作项要求不符"));
        }
    } else {
        let key = text(output, "storageKey")?;
        if !key.starts_with(&format!("{expected_type}:"))
            || node["metadata"]["storageKey"] != key
            || node["metadata"]["status"] != "success"
            || node["metadata"]["currentResultVersionId"] != output["resultVersionId"]
        {
            return Err(invalid("生成产物尚未就绪或与回执不符"));
        }
        if !stored_media_exists(conn, key)? {
            return Err(invalid("生成媒体尚未落盘"));
        }
    }
    Ok(())
}

fn mutate(conn: &mut Connection, input: Value, lane: &str) -> Result<Value> {
    schema(conn)?;
    let plan_id = id(&input, "planId")?.to_string();
    let request_id = id(&input, "requestId")?.to_string();
    let command = &input["command"];
    let kind = text(command, "type")?;
    let allowed = match lane {
        "author" => ["write_stage", "replan"].as_slice(),
        "execute" => ["begin_documents", "claim_item", "record_item", "finish"].as_slice(),
        _ => ["approve", "accept", "retry", "cancel", "resolve_item"].as_slice(),
    };
    if !allowed.contains(&kind) {
        return Err(invalid("此入口不能执行该计划操作"));
    }
    let hash = digest(&input);
    let tx = conn.transaction().map_err(db)?;
    if let Some(reply) = replay(&tx, &plan_id, &request_id, &hash)? {
        return Ok(reply);
    }
    let mut plan = read(&tx, &plan_id)?;
    let revision = plan["revision"].as_u64().unwrap();
    if input["expectedRevision"].as_u64() != Some(revision) {
        return Err(conflict("计划版本已变化，请读取最新计划"));
    }
    if lane == "author" && input.get("plannerSessionId").is_some() {
        let planner = id(&input, "plannerSessionId")?;
        if plan.get("plannerSessionId").is_some_and(|existing| existing != planner) {
            return Err(conflict("请继续原 Planner 会话，不能替换计划归属"));
        }
        plan["plannerSessionId"] = json!(planner);
    }
    review::evidence(&tx, &plan, &input, kind)?;
    let mut claim = None;
    if kind == "write_stage" || kind == "replan" {
        let current = frontier(&plan).ok_or_else(|| conflict("计划已完成，不能重写已接受阶段"))?;
        let old = plan["stages"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == current)
            .cloned();
        if old
            .as_ref()
            .is_some_and(|stage| outstanding(stage) || stage["runtime"]["status"] == "doing")
        {
            return Err(conflict("阶段仍在执行，请先停止并核对运行结果"));
        }
        if kind == "replan" {
            text(command, "reason")?;
            validate_outline(&command["outline"])?;
            let old_outline = plan["outline"].as_array().unwrap();
            let front_index = old_outline
                .iter()
                .position(|entry| entry["id"] == current)
                .unwrap();
            let next = command["outline"].as_array().unwrap();
            if next.len() <= front_index || next[..front_index] != old_outline[..front_index] {
                return Err(conflict("重规划不能修改已接受的阶段前缀"));
            }
            plan["outline"] = command["outline"].clone();
            // Only one frontier stage is authored; future entries remain an outline.
            let preserved: HashSet<String> = plan["outline"].as_array().unwrap()[..front_index]
                .iter()
                .filter_map(|e| e["id"].as_str().map(String::from))
                .collect();
            plan["stages"]
                .as_array_mut()
                .unwrap()
                .retain(|s| preserved.contains(s["id"].as_str().unwrap()));
        }
        let draft = &command["stage"];
        if frontier(&plan).as_deref() != draft["id"].as_str() {
            return Err(conflict("只能编写当前第一个未完成阶段"));
        }
        validate_draft(&plan, draft)?;
        let next_ids: HashSet<&str> = draft["contract"]["workItems"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|i| i["id"].as_str())
            .collect();
        let mut retired = plan["retiredOutputs"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if let Some(previous) = old.as_ref() {
            for (key, runtime) in previous["runtime"]["items"].as_object().unwrap() {
                if previous["id"] != draft["id"] || !next_ids.contains(key.as_str()) {
                    if let Some(output) = runtime.get("output") {
                        retired.push(output.clone());
                    }
                    retired.extend(
                        runtime["supersededOutputs"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default(),
                    );
                }
            }
        }
        plan["retiredOutputs"] = json!(retired);
        let old = old.as_ref().filter(|old| old["id"] == draft["id"]);
        let mut stage = new_stage(draft, old);
        review::initialize(&plan, draft, &mut stage)?;
        let stages = plan["stages"].as_array_mut().unwrap();
        if let Some(index) = stages.iter().position(|s| s["id"] == stage["id"]) {
            stages[index] = stage;
        } else {
            stages.push(stage);
        }
    } else {
        let stage_id = id(command, "stageId")?;
        if frontier(&plan).as_deref() != Some(stage_id) {
            return Err(conflict("只能操作当前第一个未完成阶段"));
        }
        let index = plan["stages"]
            .as_array()
            .unwrap()
            .iter()
            .position(|s| s["id"] == stage_id)
            .ok_or_else(|| conflict("此阶段尚未编写"))?;
        let before = plan["stages"][index].clone();
        let status = before["runtime"]["status"].as_str().unwrap();
        let mut stage = before.clone();
        match kind {
            "approve" | "begin_documents" => {
                if kind == "begin_documents" {
                    if status != "ready" || before["runtime"]["reviewPolicy"]["beforeExecution"] != false
                        || !review::documents_only(&before) || review::policy(&plan, &before)?["beforeExecution"] != false {
                        return Err(conflict("此阶段需要用户确认，不能自动执行"));
                    }
                } else if status != "waiting_user" || before["runtime"]["waitingReason"] != "plan_review" {
                    return Err(conflict("此阶段不在等待方案确认"));
                }
                stage["runtime"]["status"] = json!("doing");
                stage["runtime"]["attemptId"] = json!(format!("{}:{}", plan_id, request_id));
                stage["runtime"]
                    .as_object_mut()
                    .unwrap()
                    .remove("waitingReason");
                stage["runtime"]["activeItemIds"] = json!(stage["runtime"]["items"]
                    .as_object()
                    .unwrap()
                    .iter()
                    .filter(|(_, v)| v["status"] != "succeeded")
                    .map(|(k, _)| k.clone())
                    .collect::<Vec<_>>());
            }
            "accept" => {
                if status != "waiting_user" || before["runtime"]["waitingReason"] != "result_review"
                {
                    return Err(conflict("此阶段不在等待结果审核"));
                }
                for item in stage["contract"]["workItems"].as_array().unwrap() {
                    validate_output(
                        &tx,
                        text(&plan, "projectId")?,
                        item,
                        &stage["runtime"]["items"][text(item, "id")?]["output"],
                    )?;
                }
                stage["runtime"]["status"] = json!("done");
                stage["runtime"]
                    .as_object_mut()
                    .unwrap()
                    .remove("waitingReason");
            }
            "cancel" => {
                if !matches!(status, "doing" | "blocked") {
                    return Err(conflict("此阶段没有正在执行的任务"));
                }
                stage["runtime"]["status"] = json!("blocked");
                stage["runtime"]["blockedReason"] =
                    json!("执行已停止；未确认结束的任务需先核对结果");
                for item in stage["runtime"]["items"]
                    .as_object_mut()
                    .unwrap()
                    .values_mut()
                {
                    if item["status"] == "running" {
                        item["status"] = json!("interrupted");
                    }
                }
            }
            "retry" => {
                if status != "blocked" || outstanding(&stage) {
                    return Err(conflict("仍有未确认结束的任务，不能重试"));
                }
                let requested = command
                    .get("itemIds")
                    .map(|v| v.as_array().ok_or_else(|| invalid("itemIds 必须是数组")))
                    .transpose()?;
                if let Some(ids) = requested {
                    for id in ids {
                        let runtime = stage["runtime"]["items"]
                            .get(id.as_str().ok_or_else(|| invalid("工作项 ID 无效"))?)
                            .ok_or_else(|| invalid("重试工作项不存在"))?;
                        if runtime["status"] == "succeeded" {
                            return Err(conflict("不能重试已成功工作项"));
                        }
                    }
                }
                let mut active = Vec::new();
                let mut count = 0;
                for (key, item) in stage["runtime"]["items"].as_object_mut().unwrap() {
                    if item["status"] != "succeeded"
                        && requested.is_none_or(|ids| ids.iter().any(|v| v == key))
                    {
                        item["status"] = json!("pending");
                        item.as_object_mut().unwrap().remove("error");
                        active.push(key.clone());
                        count += 1;
                    }
                }
                if count == 0 {
                    return Err(invalid("没有可重试的工作项"));
                }
                stage["runtime"]["activeItemIds"] = json!(active);
                stage["runtime"]["status"] = json!("doing");
                stage["runtime"]["attemptId"] = json!(format!("{}:{}", plan_id, request_id));
                stage["runtime"]
                    .as_object_mut()
                    .unwrap()
                    .remove("blockedReason");
            }
            "claim_item" | "record_item" | "resolve_item" => {
                let item_id = id(command, "itemId")?;
                let item = before["contract"]["workItems"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|item| item["id"] == item_id)
                    .ok_or_else(|| invalid("工作项不存在"))?;
                let item_status = before["runtime"]["items"][item_id]["status"]
                    .as_str()
                    .unwrap();
                if kind != "resolve_item"
                    && (status != "doing"
                        || command["attemptId"] != before["runtime"]["attemptId"]
                        || command["attemptId"].as_str().is_none())
                {
                    return Err(conflict("执行尝试已失效"));
                }
                if kind == "claim_item" {
                    if before["runtime"]["activeItemIds"]
                        .as_array()
                        .is_some_and(|ids| !ids.iter().any(|v| v == item_id))
                    {
                        return Err(conflict("此工作项不属于本次选择的重试范围"));
                    }
                    if item_status != "pending" {
                        return Err(conflict("此工作项已被领取或已有结果，不能重复执行"));
                    }
                    for field in ["dependsOn", "inputItemIds"] {
                        for dependency in item[field].as_array().into_iter().flatten() {
                            let key = dependency.as_str().unwrap();
                            let available = plan["stages"].as_array().unwrap().iter().any(|s| {
                                (s["id"] == stage_id || s["runtime"]["status"] == "done")
                                    && s["runtime"]["items"][key]["status"] == "succeeded"
                            });
                            if !available {
                                return Err(conflict(format!("依赖 {key} 尚未完成")));
                            }
                        }
                    }
                    stage["runtime"]["items"][item_id]["status"] = json!("running");
                    stage["runtime"]["items"][item_id]["attemptId"] = command["attemptId"].clone();
                    claim = Some(json!({"itemId":item_id,"shouldExecute":true}));
                } else {
                    if kind == "record_item"
                        && (item_status != "running"
                            || before["runtime"]["items"][item_id]["attemptId"]
                                != command["attemptId"])
                    {
                        return Err(conflict("此工作项不属于当前运行尝试"));
                    }
                    if kind == "resolve_item"
                        && (status != "blocked"
                            || !matches!(item_status, "running" | "interrupted"))
                    {
                        return Err(conflict("只能人工核对未确认结束的工作项"));
                    }
                    let output = command.get("output");
                    let error = command
                        .get("error")
                        .and_then(Value::as_str)
                        .filter(|s| !s.trim().is_empty());
                    if output.is_some() == error.is_some() {
                        return Err(invalid("必须提交已保存产物或明确失败原因之一"));
                    }
                    if let Some(previous) =
                        stage["runtime"]["items"][item_id].get("output").cloned()
                    {
                        if output != Some(&previous) {
                            stage["runtime"]["items"][item_id]["supersededOutputs"]
                                .as_array_mut()
                                .unwrap()
                                .push(previous);
                            stage["runtime"]["items"][item_id]
                                .as_object_mut()
                                .unwrap()
                                .remove("output");
                        }
                    }
                    if let Some(output) = output {
                        validate_output(&tx, text(&plan, "projectId")?, item, output)?;
                        stage["runtime"]["items"][item_id]["status"] = json!("succeeded");
                        stage["runtime"]["items"][item_id]["output"] = output.clone();
                        stage["runtime"]["items"][item_id]
                            .as_object_mut()
                            .unwrap()
                            .remove("error");
                    } else {
                        stage["runtime"]["items"][item_id]["status"] = json!("failed");
                        stage["runtime"]["items"][item_id]["error"] = json!(error.unwrap());
                    }
                }
            }
            "finish" => {
                if status != "doing" || command["attemptId"] != before["runtime"]["attemptId"] {
                    return Err(conflict("执行尝试已失效"));
                }
                if outstanding(&stage) {
                    return Err(conflict("仍有未结束工作项，不能完成阶段"));
                }
                let success = stage["runtime"]["items"]
                    .as_object()
                    .unwrap()
                    .values()
                    .all(|i| i["status"] == "succeeded");
                stage["runtime"]["status"] =
                    json!(if success { "waiting_user" } else { "blocked" });
                if success {
                    for item in stage["contract"]["workItems"].as_array().unwrap() {
                        validate_output(&tx, text(&plan, "projectId")?, item, &stage["runtime"]["items"][text(item, "id")?]["output"])?;
                    }
                    review::complete(&mut stage);
                } else {
                    stage["runtime"]["blockedReason"] =
                        json!("部分工作项失败或尚未执行，可重试未完成项");
                }
            }
            _ => return Err(invalid("未知的计划命令")),
        }
        if stage["runtime"]["status"] == "blocked"
            && stage["runtime"]["items"]
                .as_object()
                .unwrap()
                .values()
                .all(|i| i["status"] == "succeeded")
        {
            for item in stage["contract"]["workItems"].as_array().unwrap() {
                validate_output(&tx, text(&plan, "projectId")?, item, &stage["runtime"]["items"][text(item, "id")?]["output"])?;
            }
            review::complete(&mut stage);
        }
        if ["approve", "accept", "retry"].contains(&kind) && input.get("evidence").is_some() {
            let mut evidence = input["evidence"].clone();
            evidence["action"] = json!(kind);
            evidence["revision"] = json!(revision);
            evidence["at"] = json!(now());
            stage["runtime"]["lastConfirmation"] = evidence;
        }
        plan["stages"][index] = stage;
    }
    plan["revision"] = json!(revision + 1);
    plan["updatedAt"] = json!(now());
    let reply = persist(&tx, &plan, &request_id, &hash, claim)?;
    tx.commit().map_err(db)?;
    Ok(reply)
}

// Import snapshots without importing approvals or execution leases. Every saved
// success is checked against the already imported canvas and media transaction.
fn import_plans(conn: &mut Connection, input: Value) -> Result<Value> {
    schema(conn)?;
    let project_id = id(&input, "projectId")?;
    let sources = array(&input, "plans")?;
    if sources.len() > 100 {
        return Err(invalid("一次最多导入 100 个计划"));
    }
    let tx = conn.transaction().map_err(db)?;
    let mut imported = Vec::new();
    for source in sources {
        validate_outline(&source["outline"])?;
        text(source, "title")?;
        id(source, "workflowId")?;
        let origin_id = if source.get("originId").is_some() {
            id(source, "originId")?
        } else {
            id(source, "id")?
        };
        // Origin is a portable identity, not a distributed revision clock. Never
        // overwrite a local execution or edit when restoring the same backup.
        let existing:Option<String>=tx.query_row("SELECT body FROM zodiac_plans WHERE project_id=?1 AND (id=?2 OR json_extract(body,'$.originId')=?2) LIMIT 1",params![project_id,origin_id],|r|r.get(0)).optional().map_err(db)?;
        if let Some(body) = existing {
            imported
                .push(serde_json::from_str::<Value>(&body).map_err(|_| invalid("计划数据损坏"))?);
            continue;
        }

        let random: String = tx
            .query_row("SELECT lower(hex(randomblob(16)))", [], |r| r.get(0))
            .map_err(db)?;
        let mut plan = json!({"version":if source["version"] == 2 { 2 } else { 1 },"id":format!("plan-{random}"),"originId":origin_id,"projectId":project_id,"title":source["title"],"workflowId":source["workflowId"],"revision":1,"outline":source["outline"],"stages":[],"createdAt":now(),"updatedAt":now(),"retiredOutputs":[]});
        let stages = array(source, "stages")?;
        let mut unfinished = false;
        for saved in stages {
            if unfinished || frontier(&plan).as_deref() != saved["id"].as_str() {
                return Err(invalid("导入阶段必须按已完成前缀和当前阶段排列"));
            }
            let draft = json!({"id":saved["id"],"contract":saved["contract"]});
            validate_draft(&plan, &draft)?;
            let mut stage = new_stage(&draft, None);
            review::initialize(&plan, &draft, &mut stage)?;
            stage["runtime"]["status"] = json!("waiting_user");
            stage["runtime"]["waitingReason"] = json!("plan_review");
            let saved_runtime = &saved["runtime"];
            let mut has_interrupted = false;
            for item in draft["contract"]["workItems"].as_array().unwrap() {
                let key = text(item, "id")?;
                let previous = &saved_runtime["items"][key];
                let runtime = &mut stage["runtime"]["items"][key];
                match previous["status"].as_str() {
                    Some("succeeded") => {
                        if saved_runtime["status"] == "done" {
                            // Acceptance is a historical fact. A later canvas edit
                            // does not erase it or turn a restored backup invalid.
                            validate_historical_output(&tx, item, &previous["output"])?;
                            runtime["status"] = json!("succeeded");
                        } else {
                            text(&previous["output"], "nodeId")?;
                            match validate_output(&tx, project_id, item, &previous["output"]) {
                                Ok(()) => runtime["status"] = json!("succeeded"),
                                Err(error) if error.0 == StatusCode::BAD_REQUEST => {
                                    has_interrupted = true;
                                    runtime["status"] = json!("interrupted");
                                    runtime["error"] =
                                        json!("保存的结果已变化，请核对当前画布后确认产物");
                                }
                                Err(error) => return Err(error),
                            }
                        }
                        runtime["output"] = previous["output"].clone();
                    }
                    Some("running" | "interrupted") => {
                        has_interrupted = true;
                        runtime["status"] = json!("interrupted");
                        runtime["error"] = json!("导入前的任务结果需要核对");
                    }
                    Some("failed") => {
                        runtime["status"] = json!("failed");
                        runtime["error"] =
                            json!(previous["error"].as_str().unwrap_or("导入前执行失败"));
                    }
                    Some("pending") => {}
                    _ => return Err(invalid("导入工作项状态无效")),
                }
                if let Some(outputs) = previous.get("supersededOutputs") {
                    validate_archived_outputs(&tx, project_id, outputs)?;
                    runtime["supersededOutputs"] = outputs.clone();
                }
            }
            let success = stage["runtime"]["items"]
                .as_object()
                .unwrap()
                .values()
                .all(|i| i["status"] == "succeeded");
            match saved_runtime["status"].as_str() {
                Some("done") => {
                    if !success {
                        return Err(invalid("已完成阶段缺少成功产物"));
                    }
                    stage["runtime"]["status"] = json!("done");
                    stage["runtime"]
                        .as_object_mut()
                        .unwrap()
                        .remove("waitingReason");
                }
                Some("doing" | "blocked") => {
                    unfinished = true;
                    stage["runtime"]["status"] = json!("blocked");
                    stage["runtime"]["blockedReason"] =
                        json!("已导入；请核对已有结果后重试未完成工作项");
                    stage["runtime"]
                        .as_object_mut()
                        .unwrap()
                        .remove("waitingReason");
                }
                Some("ready" | "waiting_user") => {
                    unfinished = true;
                    if has_interrupted {
                        stage["runtime"]["status"] = json!("blocked");
                        stage["runtime"]
                            .as_object_mut()
                            .unwrap()
                            .remove("waitingReason");
                    } else if success {
                        stage["runtime"]["waitingReason"] = json!("result_review");
                    }
                }
                _ => return Err(invalid("导入阶段状态无效")),
            }
            if success && stage["runtime"]["status"] == "blocked" {
                stage["runtime"]["status"] = json!("waiting_user");
                stage["runtime"]["waitingReason"] = json!("result_review");
                stage["runtime"]
                    .as_object_mut()
                    .unwrap()
                    .remove("blockedReason");
            }
            plan["stages"].as_array_mut().unwrap().push(stage);
        }
        if stages.is_empty() {
            return Err(invalid("导入计划缺少首个阶段"));
        }
        if let Some(outputs) = source.get("retiredOutputs") {
            validate_archived_outputs(&tx, project_id, outputs)?;
            plan["retiredOutputs"] = outputs.clone();
        }
        tx.execute(
            "INSERT INTO zodiac_plans(id,project_id,body) VALUES(?1,?2,?3)",
            params![text(&plan, "id")?, project_id, plan.to_string()],
        )
        .map_err(db)?;
        imported.push(plan);
    }
    tx.commit().map_err(db)?;
    Ok(json!(imported))
}
fn validate_historical_output(conn: &Connection, item: &Value, output: &Value) -> Result<()> {
    text(output, "nodeId")?;
    let kind = match item["tool"].as_str() {
        Some("hub_canvas_write_node") => "text",
        Some("hub_generate_image") => "image",
        Some("hub_generate_video") => "video",
        Some("hub_generate_audio") => "audio",
        _ => return Err(invalid("历史产物工具类型无效")),
    };
    if output.get("kind").is_some_and(|value| value != kind) {
        return Err(invalid("历史产物类型与工具不符"));
    }
    if kind == "text" {
        if output.get("storageKey").is_some() {
            return Err(invalid("历史文档包含无效媒体引用"));
        }
    } else {
        let key = text(output, "storageKey")?;
        if !key.starts_with(&format!("{kind}:")) || !stored_media_exists(conn, key)? {
            return Err(invalid("历史生成媒体类型不符或未导入"));
        }
    }
    Ok(())
}
fn validate_archived_outputs(conn: &Connection, _project_id: &str, outputs: &Value) -> Result<()> {
    for output in outputs
        .as_array()
        .ok_or_else(|| invalid("历史产物列表无效"))?
    {
        text(output, "nodeId")?;
        if let Some(key) = output.get("storageKey") {
            let key = key.as_str().ok_or_else(|| invalid("历史媒体引用无效"))?;
            let exists = stored_media_exists(conn, key)?;
            if !exists {
                return Err(invalid("历史产物媒体未导入"));
            }
        } else {
            // A document can have been edited or removed after its accepted
            // version; its contract retains the historical full text.
            if output.get("kind").is_some_and(|kind| kind != "text") {
                return Err(invalid("历史文档引用类型无效"));
            }
        }
    }
    Ok(())
}
async fn import_route(
    State(state): State<AppState>,
    Json(input): Json<Value>,
) -> Result<Json<Value>> {
    let mut conn = state.storage.lock().map_err(invalid)?;
    Ok(Json(import_plans(&mut conn, input)?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/zodiac/plans/import", post(import_route))
        .route("/api/zodiac/plans/list", post(list))
        .route("/api/zodiac/plans/get", post(get))
        .route("/api/zodiac/plans/create", post(create_route))
        .route("/api/zodiac/plans/author", post(author))
        .route("/api/zodiac/plans/review", post(review))
        .route("/api/zodiac/plans/execute", post(execute))
}
async fn list(State(state): State<AppState>, Json(input): Json<Value>) -> Result<Json<Value>> {
    let conn = state.storage.lock().map_err(invalid)?;
    schema(&conn)?;
    let mut query = conn
        .prepare("SELECT body FROM zodiac_plans WHERE project_id=?1 ORDER BY rowid DESC")
        .map_err(db)?;
    let rows = query
        .query_map([id(&input, "projectId")?], |r| r.get::<_, String>(0))
        .map_err(db)?;
    let mut plans = Vec::new();
    for row in rows {
        plans.push(
            serde_json::from_str::<Value>(&row.map_err(db)?)
                .map_err(|_| invalid("计划数据损坏"))?,
        );
    }
    Ok(Json(json!(plans)))
}
async fn get(State(state): State<AppState>, Json(input): Json<Value>) -> Result<Json<Value>> {
    let conn = state.storage.lock().map_err(invalid)?;
    schema(&conn)?;
    Ok(Json(read(&conn, id(&input, "planId")?)?))
}
async fn create_route(
    State(state): State<AppState>,
    Json(input): Json<Value>,
) -> Result<Json<Value>> {
    let mut conn = state.storage.lock().map_err(invalid)?;
    Ok(Json(create(&mut conn, input)?))
}
async fn author(State(state): State<AppState>, Json(input): Json<Value>) -> Result<Json<Value>> {
    let mut conn = state.storage.lock().map_err(invalid)?;
    Ok(Json(mutate(&mut conn, input, "author")?))
}
async fn review(State(state): State<AppState>, Json(input): Json<Value>) -> Result<Json<Value>> {
    let mut conn = state.storage.lock().map_err(invalid)?;
    Ok(Json(mutate(&mut conn, input, "review")?))
}
async fn execute(State(state): State<AppState>, Json(input): Json<Value>) -> Result<Json<Value>> {
    let mut conn = state.storage.lock().map_err(invalid)?;
    Ok(Json(mutate(&mut conn, input, "execute")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE kv_store(namespace TEXT,key TEXT,value BLOB,encoding TEXT); CREATE TABLE media(bucket TEXT,key TEXT);").unwrap();
        let project =
            json!({"nodes":[{"id":"doc","type":"text","metadata":{"content":"Document"}}]});
        conn.execute(
            "INSERT INTO kv_store VALUES('canvas-project-v1','project',?1,'raw')",
            [project.to_string().into_bytes()],
        )
        .unwrap();
        conn
    }
    fn draft(stage: &str, items: &[&str]) -> Value {
        json!({"id":stage,"contract":{"goal":"Create document","workItems":items.iter().map(|id|json!({"id":id,"title":id,"tool":"hub_canvas_write_node","args":{"content":"Document"}})).collect::<Vec<_>>()}})
    }
    fn initial(conn: &mut Connection) -> Value {
        create(conn,json!({"id":"p","projectId":"project","sessionId":"session","title":"Project","workflowId":"custom","requestId":"create","outline":[{"id":"s1","title":"First"},{"id":"s2","title":"Second"}],"firstStage":draft("s1", &["i1","i2"])})).unwrap()["plan"].clone()
    }
    fn input(plan: &Value, request: &str, command: Value) -> Value {
        json!({"planId":plan["id"],"expectedRevision":plan["revision"],"requestId":request,"command":command,"evidence":{"source":"button","sessionId":"session"}})
    }
    #[test]
    fn legacy_plan_binds_a_planner_and_preserves_ownership() {
        let mut conn = setup();
        let plan = initial(&mut conn);
        let mut request = input(&plan, "bind", json!({"type":"write_stage","stage":draft("s1", &["i1","i2"])}));
        request["plannerSessionId"] = json!("ses_planner");
        let updated = mutate(&mut conn, request, "author").unwrap()["plan"].clone();
        assert_eq!(updated["plannerSessionId"], "ses_planner");
        let mut request = input(&updated, "replace", json!({"type":"write_stage","stage":draft("s1", &["i1","i2"])}));
        request["plannerSessionId"] = json!("ses_other");
        assert!(mutate(&mut conn, request, "author").is_err());
        assert_eq!(read(&conn, "p").unwrap()["plannerSessionId"], "ses_planner");
        let mut invalid = draft("s1", &["i1"]);
        invalid["contract"]["workItems"][0]["runtime"] = json!({"status":"succeeded"});
        assert!(validate_draft(&updated, &invalid).is_err());
    }
    fn command(
        conn: &mut Connection,
        plan: &mut Value,
        request: &str,
        body: Value,
        lane: &str,
    ) -> Value {
        let reply = mutate(conn, input(plan, request, body), lane).unwrap();
        *plan = reply["plan"].clone();
        reply
    }
    fn approve(conn: &mut Connection, plan: &mut Value) {
        command(
            conn,
            plan,
            "approve",
            json!({"type":"approve","stageId":"s1"}),
            "review",
        );
    }
    fn item(conn: &mut Connection, plan: &mut Value, key: &str, success: bool) {
        let attempt = plan["stages"][0]["runtime"]["attemptId"].clone();
        command(
            conn,
            plan,
            &format!("claim-{key}"),
            json!({"type":"claim_item","stageId":"s1","itemId":key,"attemptId":attempt}),
            "execute",
        );
        let mut result =
            json!({"type":"record_item","stageId":"s1","itemId":key,"attemptId":attempt});
        if success {
            result["output"] = json!({"nodeId":"doc"});
        } else {
            result["error"] = json!("Provider failed");
        }
        command(conn, plan, &format!("record-{key}"), result, "execute");
    }
    fn finish(conn: &mut Connection, plan: &mut Value) {
        let attempt = plan["stages"][0]["runtime"]["attemptId"].clone();
        command(
            conn,
            plan,
            "finish",
            json!({"type":"finish","stageId":"s1","attemptId":attempt}),
            "execute",
        );
    }
    #[test]
    fn approval_claim_cas_and_receipt_are_enforced() {
        let mut c = setup();
        let mut p = initial(&mut c);
        assert!(mutate(
            &mut c,
            input(&p, "bad", json!({"type":"approve","stageId":"s1"})),
            "author"
        )
        .is_err());
        let before = p.clone();
        approve(&mut c, &mut p);
        assert!(mutate(
            &mut c,
            input(&before, "stale", json!({"type":"cancel","stageId":"s1"})),
            "review"
        )
        .is_err());
        let attempt = p["stages"][0]["runtime"]["attemptId"].clone();
        let claim = input(
            &p,
            "claim",
            json!({"type":"claim_item","stageId":"s1","itemId":"i1","attemptId":attempt}),
        );
        let claimed = mutate(&mut c, claim.clone(), "execute").unwrap();
        p = claimed["plan"].clone();
        assert_eq!(claimed["claim"]["shouldExecute"], true);
        assert_eq!(
            mutate(&mut c, claim.clone(), "execute").unwrap()["claim"]["shouldExecute"],
            false
        );
        let mut changed = claim;
        changed["command"]["itemId"] = json!("i2");
        assert!(mutate(&mut c, changed, "execute").is_err());
        assert!(mutate(
            &mut c,
            input(
                &p,
                "double",
                json!({"type":"claim_item","stageId":"s1","itemId":"i1","attemptId":attempt})
            ),
            "execute"
        )
        .is_err());
        let invalid = input(
            &p,
            "record",
            json!({"type":"record_item","stageId":"s1","itemId":"i1","attemptId":attempt,"output":{"nodeId":"missing"}}),
        );
        assert!(mutate(&mut c, invalid, "execute").is_err());
        assert_eq!(read(&c, "p").unwrap(), p);
        command(
            &mut c,
            &mut p,
            "record",
            json!({"type":"record_item","stageId":"s1","itemId":"i1","attemptId":attempt,"output":{"nodeId":"doc"}}),
            "execute",
        );
        item(&mut c, &mut p, "i2", true);
        finish(&mut c, &mut p);
        assert_eq!(p["stages"][0]["runtime"]["waitingReason"], "result_review");
        assert!(mutate(
            &mut c,
            input(
                &p,
                "next-early",
                json!({"type":"write_stage","stage":draft("s2",&["i3"])})
            ),
            "author"
        )
        .is_err());
        command(
            &mut c,
            &mut p,
            "accept",
            json!({"type":"accept","stageId":"s1"}),
            "review",
        );
        command(
            &mut c,
            &mut p,
            "next",
            json!({"type":"write_stage","stage":draft("s2",&["i3"])}),
            "author",
        );
        assert_eq!(frontier(&p).unwrap(), "s2");
    }
    #[test]
    fn cancel_requires_resolution_and_retry_is_scoped() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        let old_attempt = p["stages"][0]["runtime"]["attemptId"].clone();
        command(
            &mut c,
            &mut p,
            "claim",
            json!({"type":"claim_item","stageId":"s1","itemId":"i1","attemptId":old_attempt}),
            "execute",
        );
        command(
            &mut c,
            &mut p,
            "cancel",
            json!({"type":"cancel","stageId":"s1"}),
            "review",
        );
        assert!(mutate(
            &mut c,
            input(&p, "retry", json!({"type":"retry","stageId":"s1"})),
            "review"
        )
        .is_err());
        assert!(mutate(&mut c,input(&p,"late",json!({"type":"record_item","stageId":"s1","itemId":"i1","attemptId":old_attempt,"output":{"nodeId":"doc"}})),"execute").is_err());
        command(
            &mut c,
            &mut p,
            "resolve",
            json!({"type":"resolve_item","stageId":"s1","itemId":"i1","error":"Confirmed no output"}),
            "review",
        );
        let operation = p["stages"][0]["runtime"]["items"]["i1"]["operationId"].clone();
        command(
            &mut c,
            &mut p,
            "retry",
            json!({"type":"retry","stageId":"s1","itemIds":["i1"]}),
            "review",
        );
        assert_eq!(
            p["stages"][0]["runtime"]["items"]["i1"]["operationId"],
            operation
        );
        let attempt = p["stages"][0]["runtime"]["attemptId"].clone();
        assert_ne!(old_attempt, attempt);
        assert!(mutate(
            &mut c,
            input(
                &p,
                "not-selected",
                json!({"type":"claim_item","stageId":"s1","itemId":"i2","attemptId":attempt})
            ),
            "execute"
        )
        .is_err());
    }
    #[test]
    fn replan_archives_changed_outputs_and_rejects_runtime_tools() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        item(&mut c, &mut p, "i1", true);
        item(&mut c, &mut p, "i2", false);
        finish(&mut c, &mut p);
        let old = p["stages"][0]["runtime"]["items"]["i1"]["operationId"].clone();
        let mut draft = draft("s1", &["i1"]);
        draft["contract"]["workItems"][0]["args"]["content"] = json!("Changed document");
        command(
            &mut c,
            &mut p,
            "rewrite",
            json!({"type":"write_stage","stage":draft}),
            "author",
        );
        let runtime = &p["stages"][0]["runtime"];
        assert_eq!(runtime["waitingReason"], "plan_review");
        assert_ne!(runtime["items"]["i1"]["operationId"], old);
        assert_eq!(
            runtime["items"]["i1"]["supersededOutputs"][0]["nodeId"],
            "doc"
        );
        let mut bad = draft.clone();
        bad["runtime"] = json!({"status":"done"});
        assert!(mutate(
            &mut c,
            input(&p, "inject", json!({"type":"write_stage","stage":bad})),
            "author"
        )
        .is_err());
        for tool in ["comfyui", "hub_plan_write", "hub_generate_music"] {
            let mut bad = draft.clone();
            bad["contract"]["workItems"][0]["tool"] = json!(tool);
            assert!(validate_draft(&p, &bad).is_err());
        }
    }
    #[test]
    fn imports_do_not_restore_execution_leases() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        let attempt = p["stages"][0]["runtime"]["attemptId"].clone();
        command(
            &mut c,
            &mut p,
            "claim",
            json!({"type":"claim_item","stageId":"s1","itemId":"i1","attemptId":attempt}),
            "execute",
        );
        let imported = import_plans(&mut c, json!({"projectId":"other","plans":[p]})).unwrap();
        let plan = &imported[0];
        assert_ne!(plan["id"], "p");
        assert!(plan.get("sessionId").is_none());
        assert_eq!(plan["stages"][0]["runtime"]["status"], "blocked");
        assert_eq!(
            plan["stages"][0]["runtime"]["items"]["i1"]["status"],
            "interrupted"
        );
        assert!(plan["stages"][0]["runtime"].get("attemptId").is_none());
    }
    #[test]
    fn replan_preserves_done_prefix_and_removed_outputs() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        item(&mut c, &mut p, "i1", true);
        item(&mut c, &mut p, "i2", true);
        finish(&mut c, &mut p);
        command(
            &mut c,
            &mut p,
            "accept",
            json!({"type":"accept","stageId":"s1"}),
            "review",
        );
        let before = p["stages"][0].clone();
        let bad = json!({"type":"replan","reason":"New direction","outline":[{"id":"s1","title":"Changed"},{"id":"s2","title":"Second"}],"stage":draft("s2", &["i3"])});
        assert!(mutate(&mut c, input(&p, "bad-prefix", bad), "author").is_err());
        let next = json!({"type":"replan","reason":"New direction","outline":p["outline"],"stage":draft("s2", &["i3"])});
        command(&mut c, &mut p, "valid-replan", next, "author");
        assert_eq!(p["stages"][0], before);
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        item(&mut c, &mut p, "i1", true);
        item(&mut c, &mut p, "i2", false);
        finish(&mut c, &mut p);
        command(
            &mut c,
            &mut p,
            "remove-output",
            json!({"type":"write_stage","stage":draft("s1", &["i2"])}),
            "author",
        );
        assert_eq!(p["retiredOutputs"][0]["nodeId"], "doc");
    }
    #[test]
    fn media_receipts_require_persisted_media_and_matching_node() {
        let c = setup();
        let node = json!({"nodes":[{"id":"image","type":"image","metadata":{"status":"success","storageKey":"image:asset"}}]});
        c.execute(
            "UPDATE kv_store SET value=?1",
            [node.to_string().into_bytes()],
        )
        .unwrap();
        let item = json!({"tool":"hub_generate_image"});
        let output = json!({"nodeId":"image","storageKey":"image:asset"});
        assert!(validate_output(&c, "project", &item, &output).is_err());
        c.execute("INSERT INTO media VALUES('images','image:asset')", [])
            .unwrap();
        assert!(validate_output(&c, "project", &item, &output).is_ok());
        assert!(validate_output(
            &c,
            "project",
            &item,
            &json!({"nodeId":"image","storageKey":"different"})
        )
        .is_err());
    }
    #[test]
    fn repeated_backup_import_uses_origin_without_overwriting_local_changes() {
        let mut c = setup();
        let p = initial(&mut c);
        let first = import_plans(&mut c, json!({"projectId":"other","plans":[p.clone()]})).unwrap();
        let mut restored = first[0].clone();
        command(
            &mut c,
            &mut restored,
            "local-approve",
            json!({"type":"approve","stageId":"s1"}),
            "review",
        );
        let repeated = import_plans(&mut c, json!({"projectId":"other","plans":[p]})).unwrap();
        assert_eq!(repeated[0], restored);
        let third = import_plans(&mut c, json!({"projectId":"other","plans":[first[0]]})).unwrap();
        assert_eq!(third[0], restored);
        assert_eq!(restored["originId"], "p");
    }
    #[test]
    fn receipts_reject_wrong_tool_types_and_unrelated_text() {
        let c = setup();
        let output = json!({"nodeId":"doc"});
        assert!(validate_output(
            &c,
            "project",
            &json!({"tool":"hub_generate_image"}),
            &output
        )
        .is_err());
        assert!(validate_output(
            &c,
            "project",
            &json!({"tool":"hub_canvas_write_node","args":{"content":"Different document"}}),
            &output
        )
        .is_err());
        assert!(validate_output(
            &c,
            "project",
            &json!({"tool":"hub_canvas_write_node","args":{"content":"Document"}}),
            &output
        )
        .is_ok());
        c.execute("INSERT INTO media VALUES('media','image:archived')", [])
            .unwrap();
        let history = json!([{"nodeId":"old-image","storageKey":"image:archived"}]);
        assert!(validate_archived_outputs(&c, "project", &history).is_err());
        c.execute("INSERT INTO media VALUES('images','image:archived')", [])
            .unwrap();
        assert!(validate_archived_outputs(&c, "project", &history).is_ok());
    }
    #[test]
    fn accepted_documents_remain_historical_after_canvas_edit_and_import() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        item(&mut c, &mut p, "i1", true);
        item(&mut c, &mut p, "i2", true);
        finish(&mut c, &mut p);
        command(
            &mut c,
            &mut p,
            "accept",
            json!({"type":"accept","stageId":"s1"}),
            "review",
        );
        let changed = json!({"nodes":[{"id":"doc","type":"text","metadata":{"content":"User edited after acceptance"}}]});
        c.execute(
            "INSERT INTO kv_store VALUES('canvas-project-v1','restored',?1,'raw')",
            [changed.to_string().into_bytes()],
        )
        .unwrap();
        let imported = import_plans(&mut c, json!({"projectId":"restored","plans":[p]})).unwrap();
        assert_eq!(imported[0]["stages"][0]["runtime"]["status"], "done");
        assert_eq!(
            imported[0]["stages"][0]["runtime"]["items"]["i1"]["output"]["nodeId"],
            "doc"
        );
    }
    #[test]
    fn unaccepted_changed_outputs_import_as_blocked_until_reconciled() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        item(&mut c, &mut p, "i1", true);
        item(&mut c, &mut p, "i2", true);
        finish(&mut c, &mut p);
        let changed = json!({"nodes":[{"id":"doc","type":"text","metadata":{"content":"Changed before acceptance"}}]});
        c.execute(
            "INSERT INTO kv_store VALUES('canvas-project-v1','restored',?1,'raw')",
            [changed.to_string().into_bytes()],
        )
        .unwrap();
        let imported = import_plans(&mut c, json!({"projectId":"restored","plans":[p]})).unwrap();
        let p = &imported[0];
        assert_eq!(p["stages"][0]["runtime"]["status"], "blocked");
        assert_eq!(
            p["stages"][0]["runtime"]["items"]["i1"]["status"],
            "interrupted"
        );
        assert_eq!(
            p["stages"][0]["runtime"]["items"]["i1"]["output"]["nodeId"],
            "doc"
        );
        assert!(mutate(
            &mut c,
            input(p, "retry-invalid", json!({"type":"retry","stageId":"s1"})),
            "review"
        )
        .is_err());
        assert!(mutate(&mut c,input(p,"resolve-invalid",json!({"type":"resolve_item","stageId":"s1","itemId":"i1","output":{"nodeId":"doc"}})),"review").is_err());
    }
    #[test]
    fn resolving_last_uncertain_item_to_saved_output_reopens_result_review() {
        let mut c = setup();
        let mut p = initial(&mut c);
        approve(&mut c, &mut p);
        item(&mut c, &mut p, "i1", true);
        let attempt = p["stages"][0]["runtime"]["attemptId"].clone();
        command(
            &mut c,
            &mut p,
            "claim-last",
            json!({"type":"claim_item","stageId":"s1","itemId":"i2","attemptId":attempt}),
            "execute",
        );
        command(
            &mut c,
            &mut p,
            "cancel-last",
            json!({"type":"cancel","stageId":"s1"}),
            "review",
        );
        command(
            &mut c,
            &mut p,
            "resolve-last",
            json!({"type":"resolve_item","stageId":"s1","itemId":"i2","output":{"nodeId":"doc"}}),
            "review",
        );
        assert_eq!(p["stages"][0]["runtime"]["waitingReason"], "result_review");
        assert_eq!(p["stages"][0]["runtime"]["status"], "waiting_user");
        assert!(p["stages"][0]["runtime"].get("blockedReason").is_none());
    }
    fn workflow_plan(conn: &mut Connection, stage_key: &str) -> Value {
        create(conn, json!({"id":"workflow","projectId":"project","sessionId":"session","title":"Story","workflowId":"drama-series",
            "requestId":"create","outline":[{"id":"s1","title":"Draft","workflowStageId":stage_key}],
            "firstStage":draft("s1", &["i1"])})).unwrap()["plan"].clone()
    }
    fn save_confirmation(conn: &Connection, text: &str) {
        let session = json!({"id":"session","items":[{"id":"message","role":"user","text":text}]});
        conn.execute("DELETE FROM kv_store WHERE namespace='zodiac-sessions-v1'", []).unwrap();
        conn.execute("INSERT INTO kv_store VALUES('zodiac-sessions-v1','project',?1,'raw')", [session.to_string().into_bytes()]).unwrap();
    }
    fn chat(plan: &Value, text: &str, kind: &str) -> Value {
        let mut input = input(plan, "chat", json!({"type":kind,"stageId":"s1"}));
        input["evidence"] = json!({"source":"chat","sessionId":"session","messageId":"message","text":text});
        input
    }

    #[test]
    fn workflow_documents_save_before_review_and_delivery_finishes_without_a_second_gate() {
        for (key, expected) in [("script", "waiting_user"), ("delivery", "done")] {
            let mut conn = setup();
            let mut plan = workflow_plan(&mut conn, key);
            assert_eq!(plan["version"], 2);
            assert_eq!(plan["stages"][0]["runtime"]["status"], "ready");
            command(&mut conn, &mut plan, "begin", json!({"type":"begin_documents","stageId":"s1"}), "execute");
            item(&mut conn, &mut plan, "i1", true);
            finish(&mut conn, &mut plan);
            assert_eq!(plan["stages"][0]["runtime"]["status"], expected);
            if key == "script" {
                save_confirmation(&conn, "结果通过");
                plan = mutate(&mut conn, chat(&plan, "结果通过", "accept"), "review").unwrap()["plan"].clone();
                assert_eq!(plan["stages"][0]["runtime"]["status"], "done");
                assert_eq!(plan["stages"][0]["runtime"]["lastConfirmation"]["messageId"], "message");
            }
        }
    }

    #[test]
    fn document_policy_cannot_authorize_media_or_overwriting_a_node() {
        for args in [json!({"nodeId":"doc","content":"Document"}), json!({"prompt":"image","model":"test"})] {
            let mut conn = setup();
            let mut plan = workflow_plan(&mut conn, "delivery");
            let mut stage = draft("s1", &["i1"]);
            if args.get("prompt").is_some() { stage["contract"]["workItems"][0]["tool"] = json!("hub_generate_image"); }
            stage["contract"]["workItems"][0]["args"] = args;
            command(&mut conn, &mut plan, "rewrite", json!({"type":"write_stage","stage":stage}), "author");
            assert_eq!(plan["stages"][0]["runtime"]["status"], "waiting_user");
            assert!(mutate(&mut conn, input(&plan, "bypass", json!({"type":"begin_documents","stageId":"s1"})), "execute").is_err());
            let mut forged = input(&plan, "approve", json!({"type":"approve","stageId":"s1"}));
            forged.as_object_mut().unwrap().remove("evidence");
            assert!(mutate(&mut conn, forged, "review").is_err());
        }
    }

    #[test]
    fn chat_confirmation_requires_a_saved_unambiguous_current_user_message() {
        let mut conn = setup();
        let plan = initial(&mut conn);
        assert!(mutate(&mut conn, chat(&plan, "确认执行", "approve"), "review").is_err());
        save_confirmation(&conn, "确认执行");
        assert!(mutate(&mut conn, chat(&plan, "继续", "approve"), "review").is_err());
        save_confirmation(&conn, "继续但先改成三张");
        assert!(mutate(&mut conn, chat(&plan, "继续但先改成三张", "approve"), "review").is_err());
        save_confirmation(&conn, "确认执行");
        let mut wrong_session = chat(&plan, "确认执行", "approve");
        wrong_session["evidence"]["sessionId"] = json!("other");
        assert!(mutate(&mut conn, wrong_session, "review").is_err());
        // Another pending plan makes a generic reply ambiguous on the server too.
        let mut second = workflow_plan(&mut conn, "shots");
        save_confirmation(&conn, "继续");
        assert!(mutate(&mut conn, chat(&plan, "继续", "approve"), "review").is_err());
        approve(&mut conn, &mut second);
        let approved = mutate(&mut conn, chat(&plan, "继续", "approve"), "review").unwrap();
        assert_eq!(approved["plan"]["stages"][0]["runtime"]["status"], "doing");
        assert!(mutate(&mut conn, input(&plan, "stale", json!({"type":"approve","stageId":"s1"})), "review").is_err());
    }

    #[test]
    fn changing_review_wording_reuses_successful_outputs_and_restores_never_auto_run() {
        let mut conn = setup();
        let mut plan = workflow_plan(&mut conn, "script");
        command(&mut conn, &mut plan, "begin", json!({"type":"begin_documents","stageId":"s1"}), "execute");
        item(&mut conn, &mut plan, "i1", true);
        finish(&mut conn, &mut plan);
        let mut stage = draft("s1", &["i1"]);
        stage["contract"]["review"] = json!({"afterExecution":["Check exact dialogue"]});
        command(&mut conn, &mut plan, "review-text", json!({"type":"write_stage","stage":stage}), "author");
        assert_eq!(plan["stages"][0]["runtime"]["items"]["i1"]["status"], "succeeded");
        let before = plan["stages"][0]["runtime"]["items"]["i1"]["operationId"].clone();
        command(&mut conn, &mut plan, "second-begin", json!({"type":"begin_documents","stageId":"s1"}), "execute");
        assert_eq!(plan["stages"][0]["runtime"]["items"]["i1"]["operationId"], before);
        assert!(plan["stages"][0]["runtime"]["activeItemIds"].as_array().unwrap().is_empty());
        let mut ready_conn = setup();
        let ready = workflow_plan(&mut ready_conn, "script");
        let restored = import_plans(&mut conn, json!({"projectId":"restored","plans":[ready]})).unwrap();
        assert_eq!(restored[0]["stages"][0]["runtime"]["status"], "waiting_user");
        assert_eq!(restored[0]["stages"][0]["runtime"]["waitingReason"], "plan_review");
    }

    #[test]
    fn legacy_plans_keep_their_review_contract_when_authored_again() {
        let mut conn = setup();
        let mut plan = initial(&mut conn);
        plan["version"] = json!(1);
        plan["outline"][0]["workflowStageId"] = json!("content");
        conn.execute("UPDATE zodiac_plans SET body=?1 WHERE id='p'", [plan.to_string()]).unwrap();
        command(&mut conn, &mut plan, "legacy", json!({"type":"write_stage","stage":draft("s1", &["i1"])}), "author");
        assert_eq!(plan["stages"][0]["runtime"]["waitingReason"], "plan_review");
        assert!(plan["stages"][0]["runtime"].get("reviewPolicy").is_none());
    }

    #[test]
    fn one_chat_message_cannot_approve_execution_and_also_accept_its_result() {
        let mut conn = setup();
        let mut plan = initial(&mut conn);
        save_confirmation(&conn, "继续");
        plan = mutate(&mut conn, chat(&plan, "继续", "approve"), "review").unwrap()["plan"].clone();
        item(&mut conn, &mut plan, "i1", true);
        item(&mut conn, &mut plan, "i2", true);
        finish(&mut conn, &mut plan);
        let mut request = chat(&plan, "继续", "accept");
        request["requestId"] = json!("accept-with-old-message");
        let error = mutate(&mut conn, request, "review").unwrap_err();
        assert!(error.1.contains("已用于另一项操作"));
        assert_eq!(read(&conn, "p").unwrap()["stages"][0]["runtime"]["waitingReason"], "result_review");
    }

}
