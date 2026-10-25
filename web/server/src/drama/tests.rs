use std::sync::Arc;

use axum::{body::Body, http::Request, Router};
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::{state::AppState, storage};

struct Fixture {
    _dir: tempfile::TempDir,
    app: Router,
    state: AppState,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState { storage: Arc::new(storage::initialize(dir.path()).unwrap()) };
    let app = super::router().with_state(state.clone());
    Fixture { _dir: dir, app, state }
}

impl Fixture {
    async fn call(&self, method: &str, uri: &str, body: Value) -> (u16, Value) {
        let request = Request::builder().method(method).uri(uri).header("content-type", "application/json");
        let request = if body.is_null() { request.body(Body::empty()) } else { request.body(Body::from(body.to_string())) }.unwrap();
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status().as_u16();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }
    async fn ok(&self, method: &str, uri: &str, body: Value) -> Value {
        let (status, value) = self.call(method, uri, body).await;
        assert!(status < 300, "{method} {uri} -> {status}: {value}");
        value
    }
    async fn drama(&self) -> String {
        let project = self
            .ok("POST", "/api/dramas", json!({"title":"雨夜","sourceType":"novel","aspect":"16:9","chapters":[{"title":"第一章","body":"林溪回到旧邮局。"},{"title":"第二章","body":"圆圆找到信。"}]}))
            .await;
        project["id"].as_str().unwrap().to_owned()
    }
    async fn run(&self, drama: &str, body: Value) -> String {
        self.ok("POST", &format!("/api/dramas/{drama}/runs"), body).await["id"].as_str().unwrap().to_owned()
    }
}

const SETTINGS: &str = r#"{
  "entities": [
    {"kind":"人物","name":"林溪","aliases":"阿溪、溪溪","description":"年轻修理师","appearance":"短发，灰蓝工装"},
    {"kind":"角色","name":"圆圆","aliases":[],"description":"掌心大小的邮递机器人"},
    {"kind":"地点","name":"旧港邮局","description":"即将关闭的邮局"},
    {"kind":"陈设","name":"黄铜台灯","description":"旧台灯","parent":"旧港邮局"},
    {"kind":"世界观","name":"归航灯","description":"港口的信号传统"}
  ],
  "relations": [
    {"from":"林溪","to":"圆圆","kind":"伙伴","label":"搭档"},
    {"from":"阿溪","to":"旧港邮局","kind":"所属","label":"工作"},
    {"from":"林溪","to":"圆圆","kind":"心照不宣","label":"默契"}
  ]
}"#;

#[tokio::test]
async fn settings_proposal_normalizes_synonyms_and_merges_on_rerun() {
    let f = fixture();
    let drama = f.drama().await;
    let run = f.run(&drama, json!({"stage":"settings"})).await;
    let submitted = f.ok("POST", &format!("/api/drama-runs/{run}/proposal"), json!({"proposal": serde_json::from_str::<Value>(SETTINGS).unwrap()})).await;
    assert_eq!(submitted["status"], "review");
    assert_eq!(submitted["proposal"]["entities"][3]["kind"], "prop");
    assert_eq!(submitted["proposal"]["relations"][2]["kind"], "other");
    f.ok("POST", &format!("/api/drama-runs/{run}/adopt"), Value::Null).await;

    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    let entities = snapshot["entities"].as_array().unwrap();
    assert_eq!(entities.len(), 5);
    let id_of = |name: &str| entities.iter().find(|e| e["name"] == name).unwrap()["id"].clone();
    let lamp = entities.iter().find(|e| e["name"] == "黄铜台灯").unwrap();
    assert_eq!(lamp["parentId"], id_of("旧港邮局"));
    assert_eq!(snapshot["relations"].as_array().unwrap().len(), 3);
    assert_eq!(snapshot["chapters"][1]["label"], "C2");

    // A second run updates by name or label instead of duplicating.
    let again = f.run(&drama, json!({"stage":"settings"})).await;
    let label = entities.iter().find(|e| e["name"] == "圆圆").unwrap()["label"].clone();
    f.ok("POST", &format!("/api/drama-runs/{again}/proposal"), json!({"proposal": {"entities": [
        {"ref": label, "kind": "character", "name": "圆圆", "description": "会投影光字的邮递机器人"},
        {"kind": "character", "name": "林溪", "description": "修理师，擅长修灯"}
    ]}})).await;
    f.ok("POST", &format!("/api/drama-runs/{again}/adopt"), Value::Null).await;
    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    assert_eq!(snapshot["entities"].as_array().unwrap().len(), 5);
    assert!(snapshot["entities"].as_array().unwrap().iter().any(|e| e["description"] == "会投影光字的邮递机器人"));
}

#[tokio::test]
async fn proposal_issues_are_specific_and_keep_the_run_open() {
    let f = fixture();
    let drama = f.drama().await;
    let run = f.run(&drama, json!({"stage":"settings"})).await;
    let (status, body) = f
        .call("POST", &format!("/api/drama-runs/{run}/proposal"), json!({"proposal": {"entities": [{"kind":"人物","name":"林溪","description":"修理师"}], "relations": [{"from":"林溪","to":"陌生人","kind":"朋友"}]}}))
        .await;
    assert_eq!(status, 422);
    assert_eq!(body["issues"][0]["path"], "relations[0].to");
    assert!(body["issues"][0]["message"].as_str().unwrap().contains("陌生人"));
    let run = f.ok("GET", &format!("/api/drama-runs/{run}"), Value::Null).await;
    assert_eq!(run["status"], "running");
}

#[tokio::test]
async fn shots_adopt_binds_entities_and_episode_delete_cascades() {
    let f = fixture();
    let drama = f.drama().await;
    let settings = f.run(&drama, json!({"stage":"settings"})).await;
    f.ok("POST", &format!("/api/drama-runs/{settings}/proposal"), json!({"proposal": serde_json::from_str::<Value>(SETTINGS).unwrap()})).await;
    f.ok("POST", &format!("/api/drama-runs/{settings}/adopt"), Value::Null).await;

    let plan = f.run(&drama, json!({"stage":"episodes"})).await;
    f.ok("POST", &format!("/api/drama-runs/{plan}/proposal"), json!({"proposal": {"episodes": [{"title":"最后一盏灯","outline":"林溪修灯","targetSeconds":"48秒","sourceChapters":["C1", 2]}]}})).await;
    f.ok("POST", &format!("/api/drama-runs/{plan}/adopt"), Value::Null).await;
    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    let episode = snapshot["episodes"][0]["id"].as_str().unwrap().to_owned();
    assert_eq!(snapshot["episodes"][0]["targetSeconds"], 48);
    assert_eq!(snapshot["episodes"][0]["sourceChapterIds"].as_array().unwrap().len(), 2);

    let shots = f.run(&drama, json!({"stage":"shots","episodeId":episode})).await;
    let shot = json!({"seconds":8,"size":"中景","camera":"缓推","description":"林溪按下台灯开关","dialogue":[{"speaker":"林溪","text":"还能亮吗？"},{"speaker":"旁白","text":"雨停了。"}],
        "entities":["林溪","旧港邮局"],"transition":"切镜","startState":"台灯未亮","endState":"台灯亮起",
        "props":[{"entity":"黄铜台灯","quantity":1,"startVisible":true,"endVisible":"是","startHolder":"","endHolder":"林溪"}],
        "imagePrompt":"林溪站在柜台前，台灯未亮","videoPrompt":"林溪按下开关，灯亮起"});
    let mut next = shot.clone();
    next["transition"] = json!("连续");
    let mut opening = shot.clone();
    opening["transition"] = json!("continuous");
    let (status, body) = f.call("POST", &format!("/api/drama-runs/{shots}/proposal"), json!({"proposal": {"shots": [opening]}})).await;
    assert_eq!((status, body["issues"][0]["path"].as_str()), (422, Some("shots[0].transition")));
    // Objects and world settings the shot cannot show are left out instead of failing the whole table.
    next["entities"] = json!(["林溪", "旧港邮局", "湿伞", "归航灯"]);
    next["props"] = json!([{"entity":"黄铜台灯","quantity":1,"startVisible":true,"endVisible":true}, {"entity":"手电筒","quantity":1,"startVisible":true,"endVisible":true}, {"entity":"林溪","quantity":1,"startVisible":true,"endVisible":true}]);
    let submitted = f.ok("POST", &format!("/api/drama-runs/{shots}/proposal"), json!({"proposal": {"shots": [shot, next]}})).await;
    assert_eq!(submitted["proposal"]["shots"][1]["transition"], "continuous");
    f.ok("POST", &format!("/api/drama-runs/{shots}/adopt"), Value::Null).await;

    let detail = f.ok("GET", &format!("/api/drama-episodes/{episode}"), Value::Null).await;
    let first = &detail["shots"][0];
    assert_eq!(first["entityIds"].as_array().unwrap().len(), 3, "speaker, scene and prop are bound");
    assert_eq!(detail["shots"][1]["entityIds"].as_array().unwrap().len(), 3, "unknown objects and the world setting are not bound");
    assert_eq!(detail["shots"][1]["props"].as_array().unwrap().len(), 1);
    assert_eq!(first["dialogue"][1]["speaker"], "");
    let shot_id = first["id"].as_str().unwrap();
    let artifact = f.ok("POST", &format!("/api/dramas/{drama}/artifacts"), json!({"shotId":shot_id,"kind":"image","prompt":"p"})).await;
    let artifact = artifact["id"].as_str().unwrap();
    let (status, _) = f.call("POST", &format!("/api/drama-artifacts/{artifact}/adopt"), Value::Null).await;
    assert_eq!(status, 400, "pending results cannot be adopted");
    f.ok("PATCH", &format!("/api/drama-artifacts/{artifact}"), json!({"status":"ready","mediaKey":"images:a","mediaUrl":"/media/images/a"})).await;
    f.ok("POST", &format!("/api/drama-artifacts/{artifact}/adopt"), Value::Null).await;
    let keys = f.ok("GET", "/api/drama-media-keys", Value::Null).await;
    assert_eq!(keys, json!(["images:a"]));

    f.ok("DELETE", &format!("/api/drama-episodes/{episode}"), Value::Null).await;
    let conn = f.state.storage.lock().unwrap();
    let left: i64 = conn.query_row("SELECT (SELECT COUNT(*) FROM drama_shots)+(SELECT COUNT(*) FROM drama_artifacts)+(SELECT COUNT(*) FROM drama_shot_entities)+(SELECT COUNT(*) FROM drama_runs WHERE episode_id IS NOT NULL)", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn deleting_an_entity_scrubs_shot_json_and_stale_rev_conflicts() {
    let f = fixture();
    let drama = f.drama().await;
    let hero = f.ok("POST", &format!("/api/dramas/{drama}/entities"), json!({"kind":"character","name":"林溪"})).await;
    let lamp = f.ok("POST", &format!("/api/dramas/{drama}/entities"), json!({"kind":"prop","name":"台灯","description":"旧灯"})).await;
    let episode = f.ok("POST", &format!("/api/dramas/{drama}/episodes"), json!({"title":"一"})).await;
    let shot = f.ok("POST", &format!("/api/drama-episodes/{}/shots", episode["id"].as_str().unwrap()), json!({})).await;
    let (hero_id, lamp_id) = (hero["id"].as_str().unwrap(), lamp["id"].as_str().unwrap());
    let updated = f
        .ok("PATCH", &format!("/api/drama-shots/{}", shot["id"].as_str().unwrap()), json!({"rev":shot["rev"],"entityIds":[hero_id,lamp_id],
            "dialogue":[{"speaker":hero_id,"text":"嗯"}],"props":[{"entityId":lamp_id,"quantity":1,"startHolder":hero_id,"endHolder":""}]}))
        .await;
    assert_eq!(updated["entityIds"].as_array().unwrap().len(), 2);
    let (status, _) = f.call("PATCH", &format!("/api/drama-entities/{lamp_id}"), json!({"rev": 99, "name":"铜灯"})).await;
    assert_eq!(status, 409);

    f.ok("DELETE", &format!("/api/drama-entities/{hero_id}"), Value::Null).await;
    let detail = f.ok("GET", &format!("/api/drama-episodes/{}", episode["id"].as_str().unwrap()), Value::Null).await;
    let shot = &detail["shots"][0];
    assert_eq!(shot["dialogue"][0]["speaker"], "");
    assert_eq!(shot["props"][0]["startHolder"], "");
    assert_eq!(shot["entityIds"], json!([lamp_id]));
}

#[tokio::test]
async fn chapter_runs_write_the_target_chapter_and_merge_the_ledger() {
    let f = fixture();
    let drama = f.ok("POST", "/api/dramas", json!({"title":"原创","sourceType":"original","aspect":"9:16"})).await["id"].as_str().unwrap().to_owned();
    for ord in 1..=2 {
        let run = f.run(&drama, json!({"stage":"chapter","scope":{"ord":ord}})).await;
        f.ok("POST", &format!("/api/drama-runs/{run}/proposal"), json!({"proposal": {"title": format!("第{ord}章"), "body":"正文", "summary":"摘要", "endState":"状态",
            "ledger": [{"op":"新增","kind":"伏笔","name":"未寄出的信","note":"信封上没有地址"}, {"op": if ord == 2 {"回收"} else {"新增"}, "kind":"人物","name":"林溪"}]}})).await;
        f.ok("POST", &format!("/api/drama-runs/{run}/adopt"), Value::Null).await;
    }
    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    assert_eq!(snapshot["chapters"].as_array().unwrap().len(), 2);
    let ledger = snapshot["ledger"].as_array().unwrap();
    assert_eq!(ledger.len(), 2);
    let letter = ledger.iter().find(|e| e["name"] == "未寄出的信").unwrap();
    assert_eq!(letter["chapterOrds"], json!([1, 2]));
    assert_eq!(ledger.iter().find(|e| e["name"] == "林溪").unwrap()["status"], "resolved");

    f.ok("DELETE", &format!("/api/drama-chapters/{}", snapshot["chapters"][0]["id"].as_str().unwrap()), Value::Null).await;
    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    assert_eq!(snapshot["chapters"][0]["ord"], 1);
    let letter = snapshot["ledger"].as_array().unwrap().iter().find(|e| e["name"] == "未寄出的信").unwrap().clone();
    assert_eq!(letter["chapterOrds"], json!([1]), "chapter 2 became chapter 1");

    let (status, _) = f.call("POST", &format!("/api/dramas/{drama}/runs"), json!({"stage":"chapter"})).await;
    assert_eq!(status, 400);
    let busy = f.run(&drama, json!({"stage":"review","scope":{"target":"chapters"}})).await;
    let items: Vec<Value> = ["设定一致", "人设", "情节连贯", "AI 腔", "文风", "伏笔", "节奏"].iter().map(|c| json!({"criterion": c, "verdict": "通过", "note": "无问题"})).collect();
    let report = f.ok("POST", &format!("/api/drama-runs/{busy}/proposal"), json!({"proposal": {"items": items}})).await;
    assert_eq!(report["status"], "accepted", "reviews finish without adoption");
    let busy = f.run(&drama, json!({"stage":"review","scope":{"target":"chapters"}})).await;
    let (status, _) = f.call("POST", &format!("/api/dramas/{drama}/runs"), json!({"stage":"review","scope":{"target":"chapters"}})).await;
    assert_eq!(status, 409, "the same task cannot run twice");
    f.run(&drama, json!({"stage":"review","scope":{"target":"settings"}})).await;
    let (status, _) = f.call("DELETE", &format!("/api/drama-runs/{busy}"), Value::Null).await;
    assert_eq!(status, 409);
}

#[tokio::test]
async fn restart_settles_interrupted_work_but_keeps_resumable_video_tasks() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState { storage: Arc::new(storage::initialize(dir.path()).unwrap()) };
    let f = Fixture { app: super::router().with_state(state.clone()), state, _dir: tempfile::tempdir().unwrap() };
    let drama = f.drama().await;
    let run = f.run(&drama, json!({"stage":"settings"})).await;
    let entity = f.ok("POST", &format!("/api/dramas/{drama}/entities"), json!({"kind":"scene","name":"邮局"})).await;
    let sheet = f.ok("POST", &format!("/api/dramas/{drama}/artifacts"), json!({"entityId":entity["id"],"kind":"sheet"})).await;
    let episode = f.ok("POST", &format!("/api/dramas/{drama}/episodes"), json!({"title":"一"})).await;
    let shot = f.ok("POST", &format!("/api/drama-episodes/{}/shots", episode["id"].as_str().unwrap()), json!({})).await;
    let video = f.ok("POST", &format!("/api/dramas/{drama}/artifacts"), json!({"shotId":shot["id"],"kind":"video"})).await;
    f.ok("PATCH", &format!("/api/drama-artifacts/{}", video["id"].as_str().unwrap()), json!({"providerTask":{"id":"t1","provider":"seedance"}})).await;
    drop(f);

    let state = AppState { storage: Arc::new(storage::initialize(dir.path()).unwrap()) };
    let f = Fixture { app: super::router().with_state(state.clone()), state, _dir: dir };
    assert_eq!(f.ok("GET", &format!("/api/drama-runs/{run}"), Value::Null).await["status"], "failed");
    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    assert_eq!(snapshot["artifacts"].as_array().unwrap().iter().find(|a| a["id"] == sheet["id"]).unwrap()["status"], "failed");
    let detail = f.ok("GET", &format!("/api/drama-episodes/{}", episode["id"].as_str().unwrap()), Value::Null).await;
    assert_eq!(detail["artifacts"][0]["status"], "pending");
}

#[tokio::test]
async fn deleting_a_chapter_retargets_pending_chapter_runs() {
    let f = fixture();
    let drama = f.drama().await;
    let rewrite_second = f.run(&drama, json!({"stage":"chapter","scope":{"ord":2}})).await;
    let rewrite_first = f.run(&drama, json!({"stage":"chapter","scope":{"ord":1}})).await;
    let snapshot = f.ok("GET", &format!("/api/dramas/{drama}"), Value::Null).await;
    assert_eq!(snapshot["chapters"][0]["body"], "", "the snapshot lists chapters without bodies");
    assert_eq!(snapshot["chapters"][0]["chars"], 8);
    f.ok("DELETE", &format!("/api/drama-chapters/{}", snapshot["chapters"][0]["id"].as_str().unwrap()), Value::Null).await;

    let moved = f.ok("GET", &format!("/api/drama-runs/{rewrite_second}"), Value::Null).await;
    assert_eq!(moved["scope"]["ord"], 1);
    assert_eq!(moved["status"], "running");
    let orphan = f.ok("GET", &format!("/api/drama-runs/{rewrite_first}"), Value::Null).await;
    assert_eq!(orphan["status"], "rejected");
    let full = f.ok("GET", &format!("/api/dramas/{drama}/chapters"), Value::Null).await;
    assert_eq!(full[0]["body"], "圆圆找到信。");
}
