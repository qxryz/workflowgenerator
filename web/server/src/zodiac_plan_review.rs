//! Workflow review gates are application policy, never model-supplied permissions.
use super::*;
use std::sync::OnceLock;

fn catalog() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../src/lib/agent/zodiac-workflow-catalog.json"
        ))
        .unwrap()
    })
}

pub(super) fn documents_only(draft: &Value) -> bool {
    draft["contract"]["workItems"]
        .as_array()
        .is_some_and(|items| {
            !items.is_empty()
                && items.iter().all(|item| {
                    item["tool"] == "hub_canvas_write_node"
                        && item["args"].get("nodeId").is_none()
                        && item["args"].get("id").is_none()
                        && item["args"]
                            .get("mode")
                            .is_none_or(|mode| mode == "replace")
                })
        })
}

pub(super) fn policy(plan: &Value, draft: &Value) -> Result<Value> {
    let mut policy = json!({"workflowVersion":catalog()["version"],"beforeExecution":true,"afterExecution":true});
    if plan["version"] != 2 {
        return Ok(policy);
    }
    let outline = plan["outline"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == draft["id"]);
    if let Some(key) = outline.and_then(|entry| entry.get("workflowStageId")) {
        let rule = catalog()["workflows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|workflow| workflow["id"] == plan["workflowId"])
            .and_then(|workflow| {
                workflow["stages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|stage| stage["id"] == *key)
            })
            .ok_or_else(|| invalid("流程阶段 ID 无效，请读取当前工作流大纲"))?;
        // Generating media or overwriting a node always needs a review, even if mislabeled as a document stage.
        if documents_only(draft) {
            policy["beforeExecution"] = rule["documentBeforeReview"].clone();
            policy["afterExecution"] = rule["resultReview"].clone();
        }
    }
    Ok(policy)
}

pub(super) fn initialize(plan: &Value, draft: &Value, stage: &mut Value) -> Result<()> {
    if plan["version"] != 2 {
        return Ok(());
    }
    let policy = policy(plan, draft)?;
    if policy["beforeExecution"] == false {
        stage["runtime"]["status"] = json!("ready");
        stage["runtime"]
            .as_object_mut()
            .unwrap()
            .remove("waitingReason");
    }
    stage["runtime"]["reviewPolicy"] = policy;
    Ok(())
}

pub(super) fn complete(stage: &mut Value) {
    let runtime = &mut stage["runtime"];
    if runtime["reviewPolicy"]["afterExecution"] == false {
        runtime["status"] = json!("done");
        runtime.as_object_mut().unwrap().remove("waitingReason");
    } else {
        runtime["status"] = json!("waiting_user");
        runtime["waitingReason"] = json!("result_review");
    }
    runtime.as_object_mut().unwrap().remove("blockedReason");
}

pub(super) fn evidence(conn: &Connection, plan: &Value, input: &Value, kind: &str) -> Result<()> {
    if plan["version"] != 2 || !["approve", "accept", "retry"].contains(&kind) {
        return Ok(());
    }
    let proof = &input["evidence"];
    if plan["sessionId"].is_string() && proof["sessionId"] != plan["sessionId"] {
        return Err(conflict("确认不属于当前会话"));
    }
    match proof["source"].as_str() {
        Some("button") => {
            id(proof, "sessionId")?;
        }
        Some("chat") => {
            id(proof, "sessionId")?;
            id(proof, "messageId")?;
            let used: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM zodiac_plan_requests requests JOIN zodiac_plans plans ON plans.id=requests.plan_id, json_each(requests.reply,'$.plan.stages') stage WHERE plans.project_id=?1 AND json_extract(stage.value,'$.runtime.lastConfirmation.source')='chat' AND json_extract(stage.value,'$.runtime.lastConfirmation.sessionId')=?2 AND json_extract(stage.value,'$.runtime.lastConfirmation.messageId')=?3)",
                params![text(plan, "projectId")?, text(proof, "sessionId")?, text(proof, "messageId")?], |row| row.get(0),
            ).map_err(db)?;
            if used {
                return Err(conflict("这条确认消息已用于另一项操作，请重新确认"));
            }
            let row: Option<(Vec<u8>, String)> = conn.query_row(
                "SELECT value,encoding FROM kv_store WHERE namespace='zodiac-sessions-v1' AND key=?1",
                [text(plan, "projectId")?], |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional().map_err(db)?;
            let (bytes, encoding) = row.ok_or_else(|| conflict("确认消息尚未保存"))?;
            let session: Value = serde_json::from_str(
                &crate::storage::decode_store_value(bytes, &encoding).map_err(invalid)?,
            )
            .map_err(|_| invalid("会话数据损坏"))?;
            let items = array(&session, "items")?;
            let last = items.iter().rev().find(|item| item["role"] == "user");
            if session["id"] != proof["sessionId"]
                || last.is_none_or(|item| {
                    item["id"] != proof["messageId"]
                        || item["text"] != proof["text"]
                        || item["attachments"]
                            .as_array()
                            .is_some_and(|items| !items.is_empty())
                        || item["skills"]
                            .as_array()
                            .is_some_and(|items| !items.is_empty())
                })
            {
                return Err(conflict("确认消息已变化，请重新确认当前阶段"));
            }
            if items.iter().any(|item| {
                item["decision"]["status"] == "pending" || item["tool"]["status"] == "pending"
            }) {
                return Err(conflict("请先处理当前问题或画布提案"));
            }
            let value = text(proof, "text")?
                .trim()
                .trim_end_matches(['。', '！', '!', '.', ' ', '\n'])
                .to_lowercase();
            let intents: Value =
                serde_json::from_str(include_str!("../../src/lib/agent/zodiac-plan-intents.json"))
                    .unwrap();
            // Retry needs an explicit retry request. A generic 'continue' never authorizes another paid attempt.
            let explicit = intents[kind]
                .as_array()
                .unwrap()
                .iter()
                .any(|phrase| phrase == &value);
            let generic = kind != "retry"
                && intents["continue"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|phrase| phrase == &value);
            if !explicit && !generic {
                return Err(invalid("这条消息不是明确的阶段确认"));
            }
            let mut statement = conn
                .prepare("SELECT body FROM zodiac_plans WHERE project_id=?1")
                .map_err(db)?;
            let rows = statement
                .query_map([text(plan, "projectId")?], |row| row.get::<_, String>(0))
                .map_err(db)?;
            let mut candidates = 0;
            for row in rows {
                let candidate: Value =
                    serde_json::from_str(&row.map_err(db)?).map_err(|_| invalid("计划数据损坏"))?;
                if candidate["sessionId"] != proof["sessionId"] {
                    continue;
                }
                let Some(stage_id) = frontier(&candidate) else {
                    continue;
                };
                let Some(stage) = candidate["stages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|stage| stage["id"] == stage_id)
                else {
                    continue;
                };
                let runtime = &stage["runtime"];
                let action = if runtime["status"] == "waiting_user" {
                    match runtime["waitingReason"].as_str() {
                        Some("plan_review") => "approve",
                        Some("result_review") => "accept",
                        _ => "",
                    }
                } else if kind == "retry" && runtime["status"] == "blocked" && !outstanding(stage) {
                    "retry"
                } else {
                    ""
                };
                if !action.is_empty() && (generic || action == kind) {
                    candidates += 1;
                }
            }
            if candidates != 1 {
                return Err(conflict("待确认阶段不唯一，请在对应计划卡上确认"));
            }
        }
        _ => return Err(invalid("需要用户的明确确认")),
    }
    Ok(())
}
