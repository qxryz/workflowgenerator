//! Application-owned OpenCode runtime. Credentials stay in this process; the child
//! receives a scoped loopback provider and MCP bridge, never a user's API key.
use crate::{state::AppState, storage};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, OriginalUri, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Component, Path as FsPath, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::Duration,
};
use tokio::{
    process::{Child, Command},
    sync::{oneshot, Mutex},
};

#[path = "agent_runtime_context.rs"]
mod context;
#[path = "agent_runtime_assets.rs"]
mod assets;

type Result<T> = std::result::Result<T, String>;
type Registry = Mutex<HashMap<String, Arc<Runtime>>>;
static START_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static RUNTIMES: OnceLock<Registry> = OnceLock::new();
fn registry() -> &'static Registry {
    RUNTIMES.get_or_init(Default::default)
}

struct Pending {
    request: Value,
    reply: oneshot::Sender<Value>,
}
struct Bridge {
    token: String,
    tools: Mutex<Vec<Value>>,
    pending: Mutex<HashMap<String, Pending>>,
    provider: Mutex<Provider>,
    waiting_user: AtomicBool,
    authority: Mutex<Option<context::Authority>>,
    tickets: Mutex<HashMap<String, context::Ticket>>,
}
struct Runtime {
    child: Mutex<Child>,
    bridge_task: tokio::task::JoinHandle<()>,
    bridge: Arc<Bridge>,
    origin: String,
    password: String,
    session: String,
    work: PathBuf,
    client: reqwest::Client,
    turn: Mutex<Option<(String, Vec<String>)>>,
    control: PathBuf,
    skills_fingerprint: Mutex<String>,
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.bridge_task.abort();
    }
}
#[derive(Clone)]
struct Provider {
    base: String,
    key: String,
    model: String,
    npm: String,
    anthropic: bool,
    minimax: bool,
    google: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Start {
    project_id: String,
    session_id: String,
    turn_id: String,
    text: String,
    system: String,
    tools: Vec<Value>,
    #[serde(default)]
    skills: Vec<Value>,
    #[serde(default)]
    assets: Vec<Value>,
    #[serde(default)]
    attachments: Vec<Value>,
    #[serde(default)]
    history: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Identity {
    project_id: String,
    session_id: String,
    #[serde(default)]
    turn_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    project_id: String,
    session_id: String,
    id: String,
    result: Value,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/agent/start",
            post(start).layer(DefaultBodyLimit::max(128 * 1024 * 1024)),
        )
        .route("/api/agent/state", post(snapshot))
        .route("/api/agent/monitor", post(monitor))
        .route("/api/agent/events", post(events))
        .route("/api/agent/abort", post(abort))
        .route("/api/agent/tool-result", post(tool_result))
        .route("/api/agent/permission", post(permission))
        .route("/api/agent/file", post(save_file))
        .route("/api/agent/import", post(import_file))
        .route("/api/agent/assets", post(sync_assets))
}
fn fail(e: String) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error":e}))).into_response()
}
fn valid_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 160
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("工作流或会话标识无效".into());
    }
    Ok(())
}
fn safe_child(root: &FsPath, name: &str) -> Result<PathBuf> {
    let relative = FsPath::new(name);
    if name.is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("文件必须位于会话工作区内".into());
    }
    let mut out = root.to_owned();
    for part in relative.components() {
        out.push(part);
        if std::fs::symlink_metadata(&out).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("不能通过符号链接写入工作区".into());
        }
    }
    Ok(out)
}
fn work_dir(state: &AppState, project: &str, session: &str) -> Result<PathBuf> {
    valid_id(project)?;
    valid_id(session)?;
    let root = storage::workspace_root(&state.storage)?;
    let work = safe_child(&root, &format!("workflows/{project}/sessions/{session}"))?;
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    Ok(work)
}
fn key(state: &AppState, id: &Identity) -> Result<String> {
    Ok(work_dir(state, &id.project_id, &id.session_id)?
        .to_string_lossy()
        .into())
}
async fn find(state: &AppState, id: &Identity) -> Result<Arc<Runtime>> {
    registry()
        .lock()
        .await
        .get(&key(state, id)?)
        .cloned()
        .ok_or_else(|| "会话尚未启动，或应用已重新启动。请继续发送消息。".into())
}
fn secret() -> Result<String> {
    use std::io::Read;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|v| format!("{v:02x}")).collect())
}
async fn provider(state: &AppState) -> Result<Provider> {
    let raw = storage::native_store_get(
        State(state.storage.clone()),
        "zustand-v1".into(),
        "workflowgenerator:ai_config_store".into(),
    )
    .await?
    .ok_or("请先配置文本模型")?;
    let record: Value = serde_json::from_str(&raw).map_err(|_| "模型配置无效")?;
    let config = &record["state"]["config"];
    let selected = config["textModel"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or(config["model"].as_str())
        .ok_or("请选择文本模型")?;
    let (channel, model) = if let Some((id, model)) = selected.split_once("::") {
        (
            config["channels"]
                .as_array()
                .and_then(|all| all.iter().find(|c| c["id"] == id))
                .ok_or("文本模型的渠道已不存在")?,
            model,
        )
    } else {
        (config, selected)
    };
    let mut base = channel["baseUrl"]
        .as_str()
        .unwrap_or("")
        .trim_end_matches('/')
        .to_owned();
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return Err("文本模型渠道地址无效".into());
    }
    let format = channel["apiFormat"].as_str().unwrap_or("openai");
    let adapter = channel["models"]
        .as_array()
        .and_then(|a| a.iter().find(|m| m["name"] == model))
        .and_then(|m| m["adapter"].as_str())
        .or(channel["adapter"].as_str())
        .unwrap_or(format);
    let anthropic = adapter.contains("anthropic") || format == "anthropic" || format == "minimax";
    if format == "minimax" {
        let origin = reqwest::Url::parse(&base)
            .map_err(|_| "模型地址无效")?
            .origin()
            .ascii_serialization();
        base = format!("{origin}/anthropic/v1");
    } else if !base.ends_with("/v1") && !base.ends_with("/v1beta") && !base.ends_with("/v3") {
        base.push_str(if format == "gemini" { "/v1beta" } else { "/v1" });
    }
    let npm = if anthropic {
        "@ai-sdk/anthropic"
    } else if adapter.contains("responses") {
        "@ai-sdk/openai"
    } else if format == "gemini" || adapter.contains("google") {
        "@ai-sdk/google"
    } else {
        "@ai-sdk/openai-compatible"
    };
    Ok(Provider {
        base,
        key: channel["apiKey"].as_str().unwrap_or("").into(),
        model: model.into(),
        npm: npm.into(),
        anthropic,
        minimax: format == "minimax",
        google: format == "gemini",
    })
}
fn binary() -> Result<PathBuf> {
    let mut paths = vec![];
    if let Some(path) = std::env::var_os("WG_OPENCODE_BINARY") {
        paths.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths.push(parent.join("../Resources/runtime/opencode"));
        }
    }
    if cfg!(debug_assertions) {
        if let Some(home) = std::env::var_os("HOME") {
            paths.push(PathBuf::from(home).join(".opencode/bin/opencode"));
        }
    }
    paths
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| "应用缺少 Agent 运行组件，请重新安装完整的桌面版本。".into())
}
pub(crate) fn materialize_skills(work: &FsPath, skills: &[Value]) -> Result<PathBuf> {
    let root = safe_child(work, "skills")?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let manifest = safe_child(&root, ".managed.json")?;
    let previous: Vec<String> = std::fs::read(&manifest)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let mut current = Vec::new();
    for skill in skills {
        let id = skill["id"].as_str().ok_or("技能缺少标识")?;
        // Skill IDs can contain dots, but cannot become filesystem traversal.
        let mut name = id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        if name.is_empty() {
            continue;
        }
        if name != id {
            use sha2::{Digest, Sha256};
            let hash = format!("{:x}", Sha256::digest(id.as_bytes()));
            name = format!(
                "{}-{}",
                name.chars().take(60).collect::<String>(),
                &hash[..8]
            );
        }
        current.push(name.clone());
        let folder = safe_child(&root, &name)?;
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        if let Some(files) = skill["files"].as_array() {
            for file in files {
                let path = safe_child(&folder, file["path"].as_str().ok_or("技能文件缺少路径")?)?;
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(path, file["content"].as_str().unwrap_or(""))
                    .map_err(|e| e.to_string())?;
            }
        }
        let body = skill["body"].as_str().unwrap_or("");
        let body = if body.starts_with("---\n") {
            body.to_owned()
        } else {
            format!(
                "---\nname: {}\ndescription: {}\n---\n\n{}",
                name,
                serde_json::to_string(
                    skill["description"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .unwrap_or(id)
                )
                .unwrap(),
                body
            )
        };
        std::fs::write(safe_child(&folder, "SKILL.md")?, body).map_err(|e| e.to_string())?;
    }
    for name in previous {
        if !current.contains(&name) {
            let path = safe_child(&root, &name)?;
            if path.is_dir() {
                std::fs::remove_dir_all(path).map_err(|e| e.to_string())?;
            }
        }
    }
    std::fs::write(
        manifest,
        serde_json::to_vec(&current).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(root)
}
impl Runtime {
    async fn get(&self, path: &str) -> Result<Value> {
        self.json(reqwest::Method::GET, path, None).await
    }
    async fn json(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value> {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.origin))
            .timeout(Duration::from_secs(30))
            .basic_auth("opencode", Some(&self.password));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let result = request
            .send()
            .await
            .map_err(|e| format!("Agent 连接失败：{e}"))?;
        if !result.status().is_success() {
            return Err(format!(
                "Agent 请求失败（{}）：{}",
                result.status(),
                result
                    .text()
                    .await
                    .unwrap_or_default()
                    .chars()
                    .take(1000)
                    .collect::<String>()
            ));
        }
        if result.status() == StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        result.json().await.map_err(|e| e.to_string())
    }
    async fn post(&self, path: &str, body: Value) -> Result<Value> {
        self.json(reqwest::Method::POST, path, Some(body)).await
    }
}
async fn spawn(state: &AppState, input: &Start) -> Result<Arc<Runtime>> {
    storage::sync_skill_files(&state.storage)?;
    let executable = binary()?;
    let work = work_dir(state, &input.project_id, &input.session_id)?;
    let control = safe_child(
        &storage::app_data_root(&state.storage)?.join("runtimes"),
        &format!("{}/{}", input.project_id, input.session_id),
    )?;
    for child in ["config", "data", "cache", "state", "home"] {
        std::fs::create_dir_all(control.join(child)).map_err(|e| e.to_string())?;
    }
    let skill_root = materialize_skills(&work, &input.skills)?;
    let provider = provider(state).await?;
    let model = provider.model.clone();
    let npm = provider.npm.clone();
    let token = secret()?;
    let password = secret()?;
    let bridge = Arc::new(Bridge {
        token: token.clone(),
        tools: Mutex::new(input.tools.clone()),
        pending: Mutex::new(HashMap::new()),
        provider: Mutex::new(provider),
        waiting_user: AtomicBool::new(false),
        authority: Mutex::new(None),
        tickets: Mutex::new(HashMap::new()),
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let bridge_origin = format!(
        "http://{}",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    let app = Router::new()
        .route(
            "/mcp",
            post(mcp)
                .get(|| async { StatusCode::METHOD_NOT_ALLOWED })
                .delete(|| async { StatusCode::NO_CONTENT }),
        )
        .route("/context", post(context::attest))
        .route("/provider/{*path}", post(proxy_model))
        .layer(DefaultBodyLimit::max(128 * 1024 * 1024))
        .with_state(bridge.clone());
    let serve_bridge = async move {
        let _ = axum::serve(listener, app).await;
    };
    let reserve = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = reserve.local_addr().map_err(|e| e.to_string())?.port();
    drop(reserve);
    let plugin = control.join("zodiac-context.mjs");
    std::fs::write(&plugin, include_str!("../runtime/zodiac-context.mjs")).map_err(|e| e.to_string())?;
    let plugin_url = reqwest::Url::from_file_path(&plugin).map_err(|_| "Agent 插件路径无效")?;
    let config = json!({"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","snapshot":false,
    "enabled_providers":["workflowgenerator"],"model":format!("workflowgenerator/{model}"),"small_model":format!("workflowgenerator/{model}"),
    "provider":{"workflowgenerator":{"npm":npm,"name":"WorkflowGenerator","options":{"baseURL":format!("{bridge_origin}/provider"),"apiKey":token},"models":{model.clone():{"name":model,"tool_call":true,"attachment":true,"modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":128000,"output":16384}}}}},
    "mcp":{"wg":{"type":"remote","url":format!("{bridge_origin}/mcp"),"headers":{"Authorization":format!("Bearer {token}")},"oauth":false,"timeout":1800000}},
    "skills":{"paths":[skill_root]},
    "plugin":[plugin_url.as_str()],
    "permission":{"*":"allow","bash":"ask","edit":"ask","external_directory":"ask","doom_loop":"ask","question":"deny"},
    "agent":context::agent_config()});
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(control.join("runtime.log"))
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(executable);
    command
        .args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(&work)
        .env_clear()
        .env(
            "PATH",
            format!(
                "{}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
                std::env::var("PATH").unwrap_or_default()
            ),
        )
        .env("HOME", control.join("home"))
        .env("XDG_CONFIG_HOME", control.join("config"))
        .env("XDG_DATA_HOME", control.join("data"))
        .env("XDG_CACHE_HOME", control.join("cache"))
        .env("XDG_STATE_HOME", control.join("state"))
        .env("TMPDIR", std::env::temp_dir())
        .env("OPENCODE_CONFIG_CONTENT", config.to_string())
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_DISABLE_AUTOUPDATE", "true")
        .env("OPENCODE_DISABLE_DEFAULT_PLUGINS", "true")
        .env("OPENCODE_DISABLE_CLAUDE_CODE", "true")
        .stdin(std::process::Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log)
        .kill_on_drop(true);
    let child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Err(format!("无法启动 Agent：{e}"));
        }
    };
    let bridge_task = tokio::spawn(serve_bridge);
    let mut runtime = Runtime {
        child: Mutex::new(child),
        bridge_task,
        bridge,
        origin: format!("http://127.0.0.1:{port}"),
        password,
        session: String::new(),
        work,
        client: reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .build()
            .map_err(|e| e.to_string())?,
        turn: Mutex::new(None),
        control: control.clone(),
        skills_fingerprint: Mutex::new(
            serde_json::to_string(&input.skills).map_err(|e| e.to_string())?,
        ),
    };
    let mut ready = false;
    for _ in 0..150 {
        if runtime.get("/global/health").await.is_ok() {
            ready = true;
            break;
        }
        if runtime
            .child
            .lock()
            .await
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err("Agent 启动失败，请检查运行日志。".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if !ready {
        return Err("Agent 启动超时。".into());
    }
    let mapping = control.join("session.json");
    let existing = match std::fs::read(&mapping) {
        Ok(bytes) => {
            let record: Value =
                serde_json::from_slice(&bytes).map_err(|_| "已有会话索引损坏，未覆盖历史")?;
            Some(
                record["id"]
                    .as_str()
                    .ok_or("已有会话索引缺少标识")?
                    .to_owned(),
            )
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    runtime.session = if let Some(id) = existing {
        if runtime.get(&format!("/session/{id}")).await.is_ok() {
            id
        } else {
            return Err("已有会话记录不可用，未自动覆盖历史。".into());
        }
    } else {
        let session = runtime
            .post(
                "/session",
                json!({"title":input.text.chars().take(80).collect::<String>()}),
            )
            .await?;
        persist_json(&mapping, &session)?;
        session["id"]
            .as_str()
            .ok_or("Agent 未返回会话标识")?
            .to_owned()
    };
    if let Ok(raw) = std::fs::read_to_string(control.join("turn.json")) {
        *runtime.turn.lock().await = serde_json::from_str(&raw).map_err(|_| "会话执行记录损坏")?;
    }
    Ok(Arc::new(runtime))
}
async fn start(State(state): State<AppState>, Json(input): Json<Start>) -> Response {
    let result = async {
        valid_id(&input.turn_id)?;
        let identity = Identity {
            turn_id: None,
            project_id: input.project_id.clone(),
            session_id: input.session_id.clone(),
        };
        let key = key(&state, &identity)?;
        let create_guard = START_LOCK.get_or_init(|| Mutex::new(())).lock().await;
        let mut existing = registry().lock().await.get(&key).cloned();
        if let Some(candidate) = existing.clone() {
            let selected = provider(&state).await?;
            let old = candidate.bridge.provider.lock().await.clone();
            let dead = candidate
                .child
                .lock()
                .await
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some();
            if dead || old.model != selected.model || old.npm != selected.npm {
                if !dead {
                    let status = candidate.get("/session/status").await?;
                    if status[&candidate.session]["type"]
                        .as_str()
                        .is_some_and(|s| s != "idle")
                    {
                        return Err("请先停止当前任务，再切换模型。".into());
                    }
                    let _ = candidate.child.lock().await.kill().await;
                }
                candidate.bridge_task.abort();
                registry().lock().await.remove(&key);
                existing = None;
            }
        }
        let runtime = if let Some(runtime) = existing {
            runtime
        } else {
            let candidates: Vec<_> = registry()
                .lock()
                .await
                .iter()
                .map(|(k, r)| (k.clone(), r.clone()))
                .collect();
            if candidates.len() >= 8 {
                let mut released = false;
                for (candidate_key, candidate) in candidates {
                    let status = candidate.get("/session/status").await?;
                    if status[&candidate.session]["type"]
                        .as_str()
                        .is_none_or(|s| s == "idle")
                        && candidate.bridge.pending.lock().await.is_empty()
                    {
                        registry().lock().await.remove(&candidate_key);
                        let _ = candidate.child.lock().await.kill().await;
                        candidate.bridge_task.abort();
                        released = true;
                        break;
                    }
                }
                if !released {
                    return Err("当前已有 8 个会话同时工作，请等一个完成后再开始。".into());
                }
            }
            let runtime = spawn(&state, &input).await?;
            registry().lock().await.insert(key, runtime.clone());
            runtime
        };
        drop(create_guard);
        let mut turn = runtime.turn.lock().await;
        if turn.as_ref().is_some_and(|(id, _)| id == &input.turn_id) {
            let delivery = std::fs::read(runtime.control.join("submission.json")).ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
            if delivery.as_ref().is_some_and(|value| value["turnId"] == input.turn_id && value["state"] != "submitted") {
                let messages = runtime.get(&format!("/session/{}/message", runtime.session)).await?;
                let baseline = &turn.as_ref().unwrap().1;
                if !messages.as_array().into_iter().flatten().any(|message| message["info"]["role"] == "user"
                    && !baseline.iter().any(|id| message["info"]["id"] == *id)) {
                    return Err("上次请求是否送达尚未确认，未重复发送。请先检查会话状态，再发起新的请求。".into());
                }
            }
            return Ok(json!({"sessionId":runtime.session,"resumed":true}));
        }
        let statuses = runtime.get("/session/status").await?;
        if statuses[&runtime.session]["type"]
            .as_str()
            .is_some_and(|s| s != "idle")
        {
            return Err("这个会话仍在工作，请等待完成或停止后再发送。".into());
        }
        runtime.bridge.waiting_user.store(false, Ordering::SeqCst);
        runtime.bridge.tickets.lock().await.clear();
        *runtime.bridge.authority.lock().await = Some(context::Authority {
            origin: runtime.origin.clone(), password: runtime.password.clone(), native_root: runtime.session.clone(),
            root_session: input.session_id.clone(), turn_id: input.turn_id.clone(),
        });
        *runtime.bridge.tools.lock().await = input.tools;
        let selected = provider(&state).await?;
        if selected.model != runtime.bridge.provider.lock().await.model {
            return Err("当前会话的模型已改变，请新建会话使用新模型。".into());
        }
        *runtime.bridge.provider.lock().await = selected;
        let fingerprint = serde_json::to_string(&input.skills).map_err(|e| e.to_string())?;
        let mut previous_skills = runtime.skills_fingerprint.lock().await;
        if *previous_skills != fingerprint {
            materialize_skills(&runtime.work, &input.skills)?;
            runtime.post("/instance/dispose", json!({})).await?;
            *previous_skills = fingerprint;
        }
        drop(previous_skills);
        let mut assets = input.assets;
        for (index, attachment) in input.attachments.iter().enumerate() {
            if attachment["type"] != "file" || !attachment["url"].as_str().is_some_and(|s| s.starts_with("data:image/")) {
                return Err("图片附件无效".into());
            }
            assets.push(json!({"id":format!("attachment-{}-{index}", input.turn_id), "name":format!("本轮附件 {}", index + 1),
                "type":"image","origin":"message_attachment","dataUrl":attachment["url"],"selected":true}));
        }
        let manifest = materialize_assets(&state, &runtime.work, &assets, false)?;
        let previous = runtime
            .get(&format!("/session/{}/message", runtime.session))
            .await?;
        let ids = previous
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|m| m["info"]["id"].as_str().map(str::to_owned))
            .collect();
        let next_turn = Some((input.turn_id.clone(), ids));
        persist_json(&runtime.control.join("submission.json"), &json!({"turnId":input.turn_id,"state":"prepared"}))?;
        persist_json(&runtime.control.join("turn.json"), &next_turn)?;
        *turn = next_turn;
        let text = if previous.as_array().is_some_and(|a| a.is_empty()) && !input.history.is_empty()
        {
            format!(
                "此前对话记录（仅作上下文）：\n{}\n\n当前请求：\n{}",
                input.history, input.text
            )
        } else {
            input.text
        };
        let text = format!("{text}\n\n[会话文件索引：.zodiac/assets.json；当前快照：{}。附件条目是消息附件，非画布节点。子任务读取同一工作区。]", manifest["revision"].as_str().unwrap_or(""));
        let mut parts = vec![json!({"type":"text","text":text})];
        parts.extend(input.attachments);
        let submitted = runtime
            .post(
                &format!("/session/{}/prompt_async", runtime.session),
                json!({"agent":"zodiac","system":input.system,"parts":parts}),
            )
            .await;
        persist_json(&runtime.control.join("submission.json"), &json!({"turnId":input.turn_id,
            "state":if submitted.is_ok() { "submitted" } else { "uncertain" }}))?;
        submitted?;
        Ok::<_, String>(json!({"sessionId":runtime.session,"workspace":runtime.work}))
    }
    .await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
async fn monitor(State(state): State<AppState>) -> Response {
    let root = match storage::workspace_root(&state.storage) { Ok(root) => root, Err(e) => return fail(e) };
    let runtimes: Vec<_> = registry().lock().await.values().filter(|r| r.work.starts_with(&root)).cloned().collect();
    let mut sessions = Vec::new();
    for r in runtimes {
        let (pid, alive) = { let mut child = r.child.lock().await; (child.id(), matches!(child.try_wait(), Ok(None))) };
        let observed = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::try_join!(r.get("/session/status"), r.get("/permission"))
        }).await;
        let (status, approvals) = match observed {
            Ok(Ok((status, permissions))) => (status[&r.session]["type"].as_str().unwrap_or("idle").to_owned(), permissions.as_array().map_or(0, Vec::len)),
            _ => (if alive { "unavailable" } else { "stopped" }.to_owned(), 0),
        };
        sessions.push(json!({"sessionId":r.session,"pid":pid,"status":status,"approvals":approvals,
            "pendingTools":r.bridge.pending.lock().await.len(),"waitingUser":r.bridge.waiting_user.load(Ordering::Relaxed),
            "directory":r.work.strip_prefix(&root).unwrap_or(&r.work).to_string_lossy()}));
    }
    sessions.sort_by(|a,b| a["directory"].as_str().cmp(&b["directory"].as_str()));
    Json(json!({"name":"Zodiac Runtime","capacity":8,"workspace":root,
        "dataDirectory":storage::app_data_root(&state.storage).ok(),"sessions":sessions})).into_response()
}

async fn snapshot(State(state): State<AppState>, Json(id): Json<Identity>) -> Response {
    let result=async{
        let runtime=find(&state,&id).await?;
        let messages_path=format!("/session/{}/message",runtime.session);
        let children_path=format!("/session/{}/children",runtime.session);
        let (messages,status,permissions,children)=tokio::try_join!(runtime.get(&messages_path),runtime.get("/session/status"),runtime.get("/permission"),runtime.get(&children_path))?;
        let turn=runtime.turn.lock().await;
        let baseline=turn.as_ref().map(|(_,ids)|ids.as_slice()).unwrap_or(&[]);
        let messages:Vec<_>=messages.as_array().into_iter().flatten().filter(|m|!baseline.iter().any(|id|m["info"]["id"]==*id)).cloned().collect();
        let pending:Vec<_>=runtime.bridge.pending.lock().await.values().map(|p|p.request.clone()).collect();
        Ok::<_,String>(json!({"sessionId":runtime.session,"messages":messages,"status":status[&runtime.session],"permissions":permissions,"tools":pending,"children":children}))
    }.await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
async fn abort(State(state): State<AppState>, Json(id): Json<Identity>) -> Response {
    let result = async {
        let r = find(&state, &id).await?;
        let turn = r.turn.lock().await;
        if id.turn_id.as_ref().is_some_and(|id| turn.as_ref().is_none_or(|(current, _)| current != id)) {
            return Ok(json!({"stale":true}));
        }
        r.bridge.waiting_user.store(true, Ordering::SeqCst);
        r.bridge.tickets.lock().await.clear();
        r.bridge.pending.lock().await.clear();
        let children = r.get(&format!("/session/{}/children", r.session)).await?;
        for child in children.as_array().into_iter().flatten() {
            if let Some(id) = child["id"].as_str() {
                let _ = r.post(&format!("/session/{id}/abort"), json!({})).await;
            }
        }
        let result = r
            .post(&format!("/session/{}/abort", r.session), json!({}))
            .await?;
        Ok::<_, String>(result)
    }
    .await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
async fn tool_result(State(state): State<AppState>, Json(reply): Json<Reply>) -> Response {
    let result = async {
        let r = find(
            &state,
            &Identity {
                turn_id: None,
                project_id: reply.project_id,
                session_id: reply.session_id,
            },
        )
        .await?;
        if let Some(pending) = r.bridge.pending.lock().await.remove(&reply.id) {
            let _ = pending.reply.send(reply.result);
        }
        Ok::<_, String>(json!({"ok":true}))
    }
    .await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
async fn permission(State(state): State<AppState>, Json(reply): Json<Reply>) -> Response {
    let result = async {
        let r = find(
            &state,
            &Identity {
                turn_id: None,
                project_id: reply.project_id,
                session_id: reply.session_id,
            },
        )
        .await?;
        if !reply.id.starts_with("per")
            || !reply
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Err("审批标识无效".into());
        }
        // Approvals are deliberately per operation, never a permanent blanket grant.
        r.post(
            &format!("/permission/{}/reply", reply.id),
            json!({"reply":if reply.result==true && !r.bridge.waiting_user.load(Ordering::SeqCst){"once"}else{"reject"}}),
        )
        .await
    }
    .await;
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileRequest {
    project_id: String,
    session_id: String,
    path: String,
    content: Option<String>,
    storage_key: Option<String>,
}
async fn save_file(State(state): State<AppState>, Json(input): Json<FileRequest>) -> Response {
    let result = (|| {
        let work = work_dir(&state, &input.project_id, &input.session_id)?;
        let path = safe_child(&work, &input.path)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = if let Some(key) = input.storage_key {
            storage::export_workspace_media(&state.storage, &key, &path)?.0
        } else if let Some(content) = input.content {
            std::fs::write(&path, &content).map_err(|e| e.to_string())?;
            content.len() as u64
        } else {
            return Err("请提供文件内容或已保存的画布素材".into());
        };
        Ok::<_, String>(json!({"path":input.path,"bytes":bytes}))
    })();
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v == format!("Bearer {token}"))
        || (headers.get("x-api-key").and_then(|v| v.to_str().ok()) == Some(token)
            || headers.get("x-goog-api-key").and_then(|v| v.to_str().ok()) == Some(token))
}
async fn mcp(
    State(bridge): State<Arc<Bridge>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    if !authorized(&headers, &bridge.token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(id) = body.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };
    let result = match body["method"].as_str().unwrap_or("") {
        "initialize" => {
            json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"workflowgenerator","version":"1.0.0"}})
        }
        "ping" => json!({}),
        "tools/list" => {
            json!({"tools":bridge.tools.lock().await.iter().filter(|t|t["name"]!="task").map(|t|json!({"name":t["name"],"description":t["description"],"inputSchema":t["parameters"]})).collect::<Vec<_>>()})
        }
        "tools/call" => {
            let name = body["params"]["name"].as_str().unwrap_or("");
            if bridge.waiting_user.load(Ordering::SeqCst) {
                return Json(json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":"正在等待用户确认。结束当前回复，不能继续执行工具。"}],"isError":true}})).into_response();
            }
            if !bridge
                .tools
                .lock()
                .await
                .iter()
                .any(|t| t["name"] == name && name != "task")
            {
                return Json(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":"Unknown tool"}})).into_response();
            }
            let mut args = body["params"]["arguments"].clone();
            let actor = match context::consume(&bridge, name, &mut args).await {
                Ok(actor) => actor,
                Err(error) => return Json(json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":error}],"isError":true}})).into_response(),
            };
            use sha2::{Digest, Sha256};
            let call_id = format!("{:x}", Sha256::digest(serde_json::to_vec(&json!([
                actor["turnId"], actor["taskId"], actor["nativeMessageId"], actor["nativeCallId"]
            ])).unwrap()));
            if bridge.pending.lock().await.contains_key(&call_id) {
                return Json(json!({"jsonrpc":"2.0","id":id,"result":{"content":[{"type":"text","text":"此操作仍在执行，请等待原始回执"}],"isError":true}})).into_response();
            }
            let (tx, rx) = oneshot::channel();
            bridge.pending.lock().await.insert(call_id.clone(),Pending{request:json!({"callId":call_id,"name":name,"args":args,"context":actor}),reply:tx});
            let result = match tokio::time::timeout(Duration::from_secs(1800), rx).await {
                Ok(Ok(v)) => v,
                _ => json!({"ok":false,"error":"工具已停止或等待超时"}),
            };
            bridge.pending.lock().await.remove(&call_id);
            if result["ok"] == true
                && (name == "zodiac-ui"
                    || name == "zodiac-ops"
                    || result["result"]["status"] == "waiting_user"
                    || result["result"]["waitingForUser"] == true)
            {
                bridge.waiting_user.store(true, Ordering::SeqCst);
            }
            json!({"content":[{"type":"text","text":result.to_string()}],"isError":result["ok"]==false})
        }
        _ => return Json(
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
        )
        .into_response(),
    };
    Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response()
}
async fn proxy_model(
    State(bridge): State<Arc<Bridge>>,
    Path(path): Path<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if !authorized(&headers, &bridge.token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if path.contains("..")
        || (!["chat/completions", "responses", "messages"].contains(&path.as_str())
            && !path.starts_with("models/"))
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let provider = bridge.provider.lock().await.clone();
    let client = match reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };
    let mut request = client
        .post(format!(
            "{}/{path}{}",
            provider.base,
            if provider.google
                && uri
                    .query()
                    .is_some_and(|q| q.split('&').any(|p| p == "alt=sse"))
            {
                "?alt=sse"
            } else {
                ""
            }
        ))
        .header("content-type", "application/json");
    if provider.minimax {
        request = request
            .bearer_auth(&provider.key)
            .header("anthropic-version", "2023-06-01");
    } else if provider.google {
        request = request.header("x-goog-api-key", &provider.key);
    } else if provider.anthropic {
        request = request
            .header("x-api-key", &provider.key)
            .header("anthropic-version", "2023-06-01");
    } else {
        request = request.bearer_auth(&provider.key);
    }
    match request.body(body).send().await {
        Ok(result) => {
            let status = result.status();
            let content_type = result.headers().get("content-type").cloned();
            let mut response = (status, Body::from_stream(result.bytes_stream())).into_response();
            if let Some(v) = content_type {
                response.headers_mut().insert("content-type", v);
            }
            response
        }
        Err(_) => (StatusCode::BAD_GATEWAY, "模型渠道暂时无法连接").into_response(),
    }
}
pub async fn shutdown() {
    let runtimes: Vec<_> = registry().lock().await.drain().map(|(_, r)| r).collect();
    for runtime in runtimes {
        let _ = tokio::time::timeout(Duration::from_secs(3), async {
            if let Ok(children) = runtime
                .get(&format!("/session/{}/children", runtime.session))
                .await
            {
                for child in children.as_array().into_iter().flatten() {
                    if let Some(id) = child["id"].as_str() {
                        let _ = runtime
                            .post(&format!("/session/{id}/abort"), json!({}))
                            .await;
                    }
                }
            }
            let _ = runtime
                .post(&format!("/session/{}/abort", runtime.session), json!({}))
                .await;
        })
        .await;
        runtime.bridge.pending.lock().await.clear();
        let _ = runtime.child.lock().await.kill().await;
        runtime.bridge_task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_reject_escape_and_symlinks() {
        let d = tempfile::tempdir().unwrap();
        assert!(safe_child(d.path(), "../escape").is_err());
        assert!(safe_child(d.path(), "/escape").is_err());
        assert!(safe_child(d.path(), "scripts/a.py").is_ok());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp", d.path().join("alias")).unwrap();
            assert!(safe_child(d.path(), "alias/x").is_err());
        }
    }
    #[test]
    fn skill_scripts_are_materialized() {
        let d = tempfile::tempdir().unwrap();
        materialize_skills(d.path(),&[json!({"id":"creative-test","body":"Do a thing","files":[{"path":"scripts/build.py","content":"print('ok')"}]})]).unwrap();
        assert_eq!(
            std::fs::read_to_string(d.path().join("skills/creative-test/scripts/build.py"))
                .unwrap(),
            "print('ok')"
        );
        assert!(
            std::fs::read_to_string(d.path().join("skills/creative-test/SKILL.md"))
                .unwrap()
                .starts_with("---\nname:")
        );
    }
}

async fn events(State(state): State<AppState>, Json(id): Json<Identity>) -> Response {
    let runtime = match find(&state, &id).await {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    match runtime
        .client
        .get(format!("{}/event", runtime.origin))
        .basic_auth("opencode", Some(&runtime.password))
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => {
            let mut out = Body::from_stream(response.bytes_stream()).into_response();
            out.headers_mut()
                .insert("content-type", "text/event-stream".parse().unwrap());
            out.headers_mut()
                .insert("cache-control", "no-cache".parse().unwrap());
            out
        }
        _ => (StatusCode::BAD_GATEWAY, "Agent 事件连接失败").into_response(),
    }
}
fn materialize_assets(state: &AppState, work: &FsPath, assets: &[Value], preserve_attachments: bool) -> Result<Value> {
    assets::materialize(state, work, assets, preserve_attachments)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRequest {
    project_id: String,
    session_id: String,
    path: String,
    call_id: String,
}
async fn import_file(State(state): State<AppState>, Json(input): Json<ImportRequest>) -> Response {
    let result = (|| {
        valid_id(&input.call_id)?;
        let work = work_dir(&state, &input.project_id, &input.session_id)?;
        let source = safe_child(&work, &input.path)?;
        if !source.is_file() {
            return Err("工作区中没有这个文件".into());
        }
        let ext = source
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let (kind, mime) = match ext.as_str() {
            "png" => ("image", "image/png"),
            "jpg" | "jpeg" => ("image", "image/jpeg"),
            "webp" => ("image", "image/webp"),
            "gif" => ("image", "image/gif"),
            "mp4" => ("video", "video/mp4"),
            "webm" => ("video", "video/webm"),
            "mov" => ("video", "video/quicktime"),
            "mp3" => ("audio", "audio/mpeg"),
            "wav" => ("audio", "audio/wav"),
            "m4a" => ("audio", "audio/mp4"),
            "ogg" => ("audio", "audio/ogg"),
            "flac" => ("audio", "audio/flac"),
            "txt" | "md" | "json" | "csv" | "srt" | "vtt" => {
                if source.metadata().map_err(|e| e.to_string())?.len() > 200_000 {
                    return Err("文档较大，请拆分后导入画布".into());
                }
                return Ok(
                    json!({"kind":"text","content":std::fs::read_to_string(source).map_err(|e|e.to_string())?}),
                );
            }
            _ => return Err("这个文件类型暂不支持导入画布，可在工作空间中查看。".into()),
        };
        let bucket = if kind == "image" { "images" } else { "media" };
        let key = format!("{kind}:agent-{}-{}", input.session_id, input.call_id);
        let imported =
            storage::import_native_media_file(&state.storage, &source, bucket, &key, mime)?;
        Ok::<_, String>(
            json!({"kind":kind,"storageKey":imported.record.key,"url":imported.record.url,"mimeType":mime,"bytes":imported.record.bytes}),
        )
    })();
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetsRequest {
    project_id: String,
    session_id: String,
    assets: Vec<Value>,
}
async fn sync_assets(State(state): State<AppState>, Json(input): Json<AssetsRequest>) -> Response {
    let result = (|| {
        let work = work_dir(&state, &input.project_id, &input.session_id)?;
        let manifest = materialize_assets(&state, &work, &input.assets, true)?;
        Ok::<_, String>(json!({"ok":true,"manifest":manifest}))
    })();
    match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}

fn persist_json(path: &FsPath, value: &impl serde::Serialize) -> Result<()> {
    use std::io::Write;
    let temporary = path.with_extension(format!("{}.tmp", secret()?));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}
