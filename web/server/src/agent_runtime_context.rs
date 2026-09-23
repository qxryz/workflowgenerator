use super::*;
use std::time::Instant;

const ROLE_SOURCE: &str = include_str!("../../src/lib/agent/zodiac-roles.json");

pub(super) fn roles() -> &'static Value {
    static ROLES: OnceLock<Value> = OnceLock::new();
    ROLES.get_or_init(|| serde_json::from_str(ROLE_SOURCE).expect("bundled Zodiac roles"))
}

pub(super) fn agent_config() -> Value {
    let mut agents = serde_json::Map::new();
    for role in roles()["roles"].as_object().unwrap().values() {
        let mut permissions = role["nativePermissions"].clone();
        permissions["wg_*"] = json!("deny");
        // Native skill loading omits the application's dependency report.
        permissions["skill"] = json!("deny");
        for tool in role["appTools"].as_array().unwrap() {
            permissions[format!("wg_{}", tool.as_str().unwrap())] = json!("allow");
        }
        agents.insert(role["nativeName"].as_str().unwrap().into(), json!({
            "mode": role["mode"], "steps": role["steps"], "description": role["description"],
            "prompt": format!("{}\n\n{}", role["prompt"].as_str().unwrap(), roles()["shared"].as_str().unwrap()),
            "permission": permissions,
        }));
    }
    for name in ["title", "build", "plan", "general", "explore"] {
        agents.insert(name.into(), json!({"disable":true}));
    }
    Value::Object(agents)
}

pub(super) fn allows(role: &str, name: &str) -> bool {
    roles()["roles"][role]["appTools"].as_array().is_some_and(|tools|
        tools.iter().any(|tool| tool == "*" || tool == name))
}

#[derive(Clone)]
pub(super) struct Authority {
    pub origin: String,
    pub password: String,
    pub native_root: String,
    pub root_session: String,
    pub turn_id: String,
}

pub(super) struct Ticket {
    name: String,
    args: Value,
    actor: Value,
    created: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Attestation {
    session_id: String,
    call_id: String,
    name: String,
    args: Value,
    #[serde(default)]
    native: bool,
}

impl Authority {
    async fn get(&self, path: &str) -> Result<Value> {
        let response = reqwest::Client::new().get(format!("{}{path}", self.origin))
            .basic_auth("opencode", Some(&self.password))
            .timeout(Duration::from_secs(5)).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() { return Err("无法核对原生任务身份".into()); }
        response.json().await.map_err(|e| e.to_string())
    }
    async fn actor(&self, input: &Attestation) -> Result<Value> {
        valid_id(&input.session_id)?;
        valid_id(&input.call_id)?;
        let mut current = input.session_id.clone();
        let mut rooted = false;
        for _ in 0..8 {
            if current == self.native_root { rooted = true; break; }
            let session = self.get(&format!("/session/{current}")).await?;
            current = session["parentID"].as_str().ok_or("子任务不属于当前会话")?.into();
            valid_id(&current)?;
        }
        if !rooted { return Err("子任务不属于当前会话".into()); }
        let messages = self.get(&format!("/session/{}/message", input.session_id)).await?;
        let tool_name = if input.native { input.name.clone() } else { format!("wg_{}", input.name) };
        let info = messages.as_array().into_iter().flatten().rev()
            .find(|m| m["info"]["role"] == "assistant" && m["parts"].as_array().is_some_and(|parts|
                parts.iter().any(|part| part["type"] == "tool" && part["callID"] == input.call_id && part["tool"] == tool_name
                    && matches!(part["state"]["status"].as_str(), Some("pending" | "running")))))
            .map(|m| &m["info"]).ok_or("原生任务没有对应的待执行工具调用")?;
        let native_role = info["agent"].as_str().ok_or("原生任务缺少角色")?;
        let role = if native_role == "zodiac" { "orchestrator" } else { native_role };
        let allowed = if input.native {
            match input.name.as_str() {
                "bash" | "write" | "edit" => role == "executor",
                "task" => role == "orchestrator",
                _ => false,
            }
        } else { allows(role, &input.name) };
        if (input.session_id == self.native_root) != (role == "orchestrator") || !allowed {
            return Err(format!("当前角色不允许调用工具「{}」", input.name));
        }
        Ok(json!({"role":role,"taskId":input.session_id,"nativeCallId":input.call_id,"nativeMessageId":info["id"],
            "rootSessionId":self.root_session,"turnId":self.turn_id}))
    }
}

pub(super) async fn attest(State(bridge): State<Arc<Bridge>>, headers: HeaderMap, Json(input): Json<Attestation>) -> Response {
    if !authorized(&headers, &bridge.token) { return StatusCode::UNAUTHORIZED.into_response(); }
    let result = async {
        if bridge.waiting_user.load(Ordering::SeqCst) { return Err("正在等待用户确认".into()); }
        let authority = bridge.authority.lock().await.clone().ok_or("会话尚未开始")?;
        let actor = authority.actor(&input).await?;
        let ticket = secret()?;
        let mut tickets = bridge.tickets.lock().await;
        tickets.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(3600));
        if input.native {
            let key = format!("native:{}:{}:{}", authority.turn_id, input.session_id, input.call_id);
            if tickets.contains_key(&key) { return Ok(json!({"ok":true})); }
            let limit = if input.name == "task" { 4 } else if input.name == "bash" { 8 } else { 12 };
            let count = tickets.iter().filter(|(key, entry)| key.starts_with("native:")
                && entry.actor["turnId"] == authority.turn_id && entry.name == input.name).count();
            if count >= limit { return Err("本轮文件或子任务操作已达上限。请交付已有结果并说明未完成项；不要寻找替代工具继续尝试。".into()); }
            tickets.insert(key, Ticket { name: input.name, args: input.args, actor, created: Instant::now() });
            return Ok(json!({"ok":true}));
        }
        if tickets.len() >= 256 { return Err("待确认的工具请求过多".into()); }
        tickets.insert(ticket.clone(), Ticket { name: input.name, args: input.args, actor, created: Instant::now() });
        Ok::<_, String>(json!({"ticket":ticket}))
    }.await;
    match result { Ok(value) => Json(value).into_response(), Err(error) => fail(error) }
}

pub(super) async fn consume(bridge: &Bridge, name: &str, args: &mut Value) -> Result<Value> {
    let ticket = args.as_object_mut().and_then(|args| args.remove("_wg_ticket"))
        .and_then(|v| v.as_str().map(str::to_owned)).ok_or("工具请求缺少可信任务上下文")?;
    let entry = bridge.tickets.lock().await.remove(&ticket).ok_or("任务上下文已失效或已使用")?;
    let authority = bridge.authority.lock().await;
    if entry.created.elapsed() > Duration::from_secs(3600) || entry.name != name || entry.args != *args
        || authority.as_ref().is_none_or(|a| entry.actor["turnId"] != a.turn_id)
        || !allows(entry.actor["role"].as_str().unwrap_or(""), name) {
        return Err("工具请求与原生任务上下文不符".into());
    }
    Ok(entry.actor)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn tickets_bind_turn_tool_and_arguments_and_can_only_be_used_once() {
        let bridge = Bridge {
            token: String::new(), tools: Mutex::new(vec![]), pending: Mutex::new(HashMap::new()),
            provider: Mutex::new(Provider { base: String::new(), key: String::new(), model: String::new(), npm: String::new(), anthropic: false, minimax: false, google: false }),
            waiting_user: AtomicBool::new(false), tickets: Mutex::new(HashMap::new()),
            authority: Mutex::new(Some(Authority { origin: String::new(), password: String::new(), native_root: "native".into(), root_session: "root".into(), turn_id: "turn".into() })),
        };
        let make = || Ticket { name: "hub_read".into(), args: json!({"nodeId":"source"}), actor: json!({"role":"router","turnId":"turn","taskId":"child"}), created: Instant::now() };
        bridge.tickets.lock().await.insert("valid".into(), make());
        let mut args = json!({"nodeId":"source","_wg_ticket":"valid"});
        assert_eq!(consume(&bridge, "hub_read", &mut args).await.unwrap()["role"], "router");
        assert!(args.get("_wg_ticket").is_none());
        assert!(consume(&bridge, "hub_read", &mut json!({"nodeId":"source","_wg_ticket":"valid"})).await.is_err());
        bridge.tickets.lock().await.insert("changed".into(), make());
        assert!(consume(&bridge, "hub_read", &mut json!({"nodeId":"different","_wg_ticket":"changed"})).await.is_err());
        bridge.tickets.lock().await.insert("old".into(), make());
        bridge.authority.lock().await.as_mut().unwrap().turn_id = "next".into();
        assert!(consume(&bridge, "hub_read", &mut json!({"nodeId":"source","_wg_ticket":"old"})).await.is_err());
    }
    #[test]
    fn effective_roles_include_prompts_and_enforced_boundaries() {
        let agents = agent_config();
        assert!(agents["executor"]["prompt"].as_str().unwrap().contains(".zodiac/assets.json"));
        assert_eq!(agents["planner"]["permission"]["wg_hub_plan_write"], "allow");
        assert_eq!(agents["router"]["permission"]["edit"], "deny");
        assert!(!allows("router", "hub_plan_write"));
        assert!(!allows("executor", "hub_generate_video"));
        assert!(!allows("invented", "hub_read"));
    }
}
