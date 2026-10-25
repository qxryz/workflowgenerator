//! One-time import of test dramas saved by the pre-rewrite document store
//! (`drama_documents`) into the `drama_*` tables. The old tables are only read and
//! stay behind as the backup. Each drama is imported at most once, in its own
//! transaction: a failure rolls that drama back, is logged and never stops start-up.
//! Old ids are reused, so a drama that is already present is left alone.
use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::{new_id, now, proposal};

type Res<T> = rusqlite::Result<T>;
static NULL: Value = Value::Null;
/// The five cover designs of `cover-art.tsx`, in variant order.
const COVERS: [&str; 5] = ["moonlit", "stage", "city", "orbit", "portrait"];
/// Which of several current sheets is adopted: single-purpose sheets first, then the library hero shot.
const SHEET_PRIORITY: [&str; 5] = ["identity-sheet", "prop-sheet", "scene-base", "hero", "turnaround"];

struct Doc {
    id: String,
    data: Value,
    created: i64,
    updated: i64,
}
impl Doc {
    fn times(&self) -> (i64, i64) {
        (self.created, self.updated)
    }
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_owned()
}
fn int(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_f64).map(|n| n.round() as i64)
}
fn items<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
fn or(value: String, fallback: impl Into<String>) -> String {
    if value.is_empty() {
        fallback.into()
    } else {
        value
    }
}

fn table_exists(conn: &Connection, name: &str) -> Res<bool> {
    conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name=?1)", [name], |r| r.get(0))
}

/// Keeps the old id unless something else already owns it in `table`.
fn claim(tx: &Connection, table: &str, id: &str) -> Res<String> {
    let taken: bool = tx.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"), [id], |r| r.get(0))?;
    Ok(if id.is_empty() || taken { new_id() } else { id.to_owned() })
}

struct Media {
    key: String,
    url: String,
    mime: String,
}
/// A file counts only when the media table knows it; the URL is built from that row.
fn media(tx: &Connection, key: &str) -> Res<Option<Media>> {
    if key.is_empty() {
        return Ok(None);
    }
    tx.query_row("SELECT bucket,url_key,mime_type FROM media WHERE key=?1 LIMIT 1", [key], |r| {
        Ok(Media { key: key.to_owned(), url: format!("/media/{}/{}", r.get::<_, String>(0)?, r.get::<_, String>(1)?), mime: r.get(2)? })
    })
    .optional()
}

/// Live documents: not deleted and not owned by an archived task bundle.
struct Source<'a> {
    conn: &'a Connection,
    table: &'static str,
}
impl Source<'_> {
    fn docs(&self, drama: &str, kind: &str) -> Res<Vec<Doc>> {
        let sql = format!("SELECT id,data,created_at,updated_at FROM {} WHERE drama_id=?1 AND kind=?2 ORDER BY created_at,id", self.table);
        let mut statement = self.conn.prepare(&sql)?;
        let rows = statement.query_map(params![drama, kind], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get(2)?, r.get(3)?)))?;
        let rows = rows.collect::<Res<Vec<_>>>()?;
        Ok(rows.into_iter().filter_map(|(id, data, created, updated)| Some(Doc { id, data: serde_json::from_str(&data).ok()?, created, updated })).collect())
    }
}

pub(crate) fn migrate(conn: &Connection) {
    if let Err(error) = run(conn) {
        eprintln!("旧剧目迁移未完成：{error}");
    }
}

fn run(conn: &Connection) -> Res<()> {
    if !table_exists(conn, "drama_documents")? {
        return Ok(());
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS drama_legacy_migrated (drama_id TEXT PRIMARY KEY, migrated_at INTEGER NOT NULL)")?;
    let table = if table_exists(conn, "drama_active_documents")? { "drama_active_documents" } else { "(SELECT * FROM drama_documents WHERE deleted=0)" };
    let old = Source { conn, table };
    let ids: Vec<String> = {
        let mut statement = conn.prepare(&format!("SELECT drama_id FROM {table} WHERE kind='project' ORDER BY created_at,drama_id"))?;
        let rows = statement.query_map([], |r| r.get(0))?;
        rows.collect::<Res<_>>()?
    };
    for (n, drama) in ids.iter().enumerate() {
        // A migrated drama the owner deleted later stays deleted: the marker outlives the drama.
        let done: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM drama_projects WHERE id=?1) OR EXISTS(SELECT 1 FROM drama_legacy_migrated WHERE drama_id=?1)",
            [drama],
            |r| r.get(0),
        )?;
        if done {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        match import(&tx, &old, drama, n as i64) {
            Ok(counts) => {
                tx.commit()?;
                eprintln!("旧剧目 {drama} 已迁移：{counts}");
            }
            Err(error) => eprintln!("旧剧目 {drama} 迁移失败，已回滚：{error}"),
        }
    }
    Ok(())
}

fn entity_kind_of(label: &str) -> &'static str {
    match label.trim() {
        "character" => "character",
        "scene" | "location" => "scene",
        "prop" | "object" => "prop",
        other => proposal::entity_kind(other).unwrap_or("world"),
    }
}

fn shot_size(key: &str) -> &str {
    match key {
        "extremeWide" | "extreme_wide" => "大远景",
        "wide" => "远景",
        "full" => "全景",
        "medium" => "中景",
        "mediumClose" | "medium_close" => "中近景",
        "close" => "近景",
        "closeUp" | "close_up" => "特写",
        "detail" | "extremeCloseUp" | "extreme_close_up" => "大特写",
        "overShoulder" | "over_shoulder" => "过肩",
        other => other,
    }
}

/// Old pan/tilt/truck had no direction; the nearest labelled move keeps the English prompt term meaningful.
fn camera_move(key: &str) -> &str {
    match key {
        "static" | "fixed" => "固定",
        "push_in" => "推镜",
        "pull_out" => "拉镜",
        "pan" => "右摇",
        "tilt" => "下摇",
        "truck" => "右移",
        "tracking" => "跟拍",
        "orbit" => "环绕",
        "handheld" => "手持",
        "whip_pan" => "甩镜",
        "zoom_in" => "变焦推近",
        "zoom_out" => "变焦拉远",
        other => other,
    }
}

/// "名字：台词" lines become speaker + text; narration and unknown heads keep an empty speaker.
fn dialogue(script: &str, speakers: &[(String, String)]) -> Vec<Value> {
    script
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            let (mut speaker, mut said) = (String::new(), line);
            if let Some((head, rest)) = line.split_once(['：', ':']).filter(|(head, _)| head.chars().count() <= 24) {
                let name = head.split(['（', '(']).next().unwrap_or_default().trim();
                if let Some((_, id)) = speakers.iter().find(|(known, _)| known == name) {
                    (speaker, said) = (id.clone(), rest);
                } else if matches!(name, "旁白" | "画外音") {
                    said = rest;
                }
            }
            let said = said.trim().trim_matches(['“', '”', '「', '」', '"']).trim();
            (!said.is_empty()).then(|| json!({"speaker": speaker, "text": said}))
        })
        .collect()
}

struct NewEntity<'a> {
    hint: &'a str,
    kind: &'static str,
    name: &'a str,
    aliases: Value,
    description: String,
    appearance: String,
    t: (i64, i64),
}
fn insert_entity(tx: &Connection, drama: &str, seq: &mut i64, e: NewEntity) -> Res<String> {
    *seq += 1;
    let id = claim(tx, "drama_entities", e.hint)?;
    tx.execute(
        "INSERT INTO drama_entities(id,drama_id,seq,kind,name,aliases_json,description,appearance,sort,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?3,?9,?10)",
        params![id, drama, *seq, e.kind, e.name, e.aliases.to_string(), e.description, e.appearance, e.t.0, e.t.1],
    )?;
    Ok(id)
}

struct Art<'a> {
    owner: (&'static str, &'a str),
    kind: &'static str,
    id: &'a str,
    file: &'a Value,
    prompt: String,
    model: String,
    adopted: bool,
    t: (i64, i64),
}
/// Inserts a ready artifact; returns false (and inserts nothing) when the file is not in the media table.
fn insert_artifact(tx: &Connection, drama: &str, a: Art) -> Res<bool> {
    let Some(file) = media(tx, &text(a.file, "storageKey"))? else { return Ok(false) };
    let id = claim(tx, "drama_artifacts", a.id)?;
    let sql = format!(
        "INSERT INTO drama_artifacts(id,drama_id,{},kind,status,media_key,media_url,mime,width,height,duration_ms,prompt,model,params_json,input_hash,adopted,created_at,updated_at)
         VALUES(?1,?2,?3,?4,'ready',?5,?6,?7,?8,?9,?10,?11,?12,'{{\"migrated\":true}}','',?13,?14,?15)",
        a.owner.0
    );
    let mime = or(text(a.file, "mimeType"), file.mime);
    let size = (int(a.file, "width"), int(a.file, "height"), int(a.file, "durationMs"));
    tx.execute(&sql, params![id, drama, a.owner.1, a.kind, file.key, file.url, mime, size.0, size.1, size.2, a.prompt, a.model, a.adopted, a.t.0, a.t.1])?;
    Ok(true)
}

struct ShotInfo {
    id: String,
    image: String,
    video: String,
    image_prompt: String,
    video_prompt: String,
}

fn import(tx: &Connection, old: &Source, drama: &str, salt: i64) -> Res<String> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    let mut bump = |what: &'static str| *counts.entry(what).or_default() += 1;
    let project = old.docs(drama, "project")?.into_iter().next().ok_or(rusqlite::Error::QueryReturnedNoRows)?;
    let p = &project.data;
    let source_type = match text(p, "sourceType").as_str() {
        "novel" => "novel",
        "script" | "screenplay" => "script",
        _ => "original",
    };
    let aspect = or(text(p, "aspect"), "16:9");
    let aspect = if ["16:9", "9:16", "1:1"].contains(&aspect.as_str()) { aspect } else { "16:9".into() };

    let style_id = text(p, "styleVersionId");
    let style_doc = old.docs(drama, "style")?.into_iter().find(|d| d.id == style_id);
    let style = style_doc.as_ref().map(|d| {
        let mut style = json!({"prompt": text(&d.data, "prompt")});
        for key in ["presetId", "promptEn"] {
            if !text(&d.data, key).is_empty() {
                style[key] = json!(text(&d.data, key));
            }
        }
        style
    });
    let palette = style_doc.as_ref().and_then(|d| {
        let colors: Vec<String> = items(d.data.get("palette").unwrap_or(&NULL), "colors").iter().filter_map(Value::as_str).map(str::to_uppercase).collect();
        let hex = |c: &String| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit());
        ((2..=8).contains(&colors.len()) && colors.iter().all(hex)).then(|| json!({"name": or(text(&d.data["palette"], "name"), "色卡"), "colors": colors}))
    });
    let t = now() + salt;
    let kept = p.get("cover").filter(|c| c["variant"].is_i64() && c["seed"].is_i64()).map(|c| json!({"variant": c["variant"], "seed": c["seed"]}));
    let kept = match (kept, p.get("cover")) {
        (Some(cover), _) => Some(cover),
        (None, Some(c)) => media(tx, &text(c, "mediaKey"))?.map(|m| json!({"mediaKey": m.key, "mediaUrl": m.url})),
        _ => None,
    };
    let cover = kept.unwrap_or_else(|| match COVERS.iter().position(|name| *name == text(p, "coverId")) {
        Some(variant) => json!({"variant": variant, "seed": t % 100_000}),
        None => json!({"variant": t % 5, "seed": t % 100_000}),
    });
    tx.execute(
        "INSERT INTO drama_projects(id,title,source_type,brief,aspect,style_json,palette_json,cover_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            drama, or(text(p, "title"), "未命名剧目"), source_type, text(p, "brief"), aspect,
            style.map(|v| v.to_string()), palette.map(|v| v.to_string()), cover.to_string(), project.created, project.updated
        ],
    )?;

    // Chapters. Ledger entries refer to chapters by order, so keep the old order -> new ord map.
    let mut chapters = old.docs(drama, "chapter")?;
    chapters.sort_by_key(|c| int(&c.data, "order").unwrap_or(i64::MAX));
    let origin = if source_type == "original" { "written" } else { "imported" };
    let (mut ords, mut chapter_ids) = (HashMap::new(), HashMap::new());
    for (i, doc) in chapters.iter().enumerate() {
        let (c, ord) = (&doc.data, i as i64 + 1);
        ords.insert(int(c, "order").unwrap_or(ord), ord);
        let id = claim(tx, "drama_chapters", &doc.id)?;
        chapter_ids.insert(doc.id.clone(), id.clone());
        tx.execute(
            "INSERT INTO drama_chapters(id,drama_id,ord,title,body,summary,end_state,origin,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![id, drama, ord, or(text(c, "title"), format!("第 {ord} 章")), text(c, "text"), text(c, "summary"), text(c, "endState"), origin, doc.created, doc.updated],
        )?;
        bump("章节");
    }
    let source_text = text(p, "sourceText");
    if chapters.is_empty() && !source_text.is_empty() {
        let args = params![new_id(), drama, "原文", source_text, project.created, project.updated];
        tx.execute("INSERT INTO drama_chapters(id,drama_id,ord,title,body,origin,created_at,updated_at) VALUES(?1,?2,1,?3,?4,'imported',?5,?6)", args)?;
        bump("章节");
    }

    for doc in old.docs(drama, "story-ledger")? {
        for entry in items(&doc.data, "entries") {
            let name = text(entry, "name");
            if name.is_empty() {
                continue;
            }
            let kind = match text(entry, "category").as_str() {
                "voice" | "character" => "character",
                "prop" | "item" => "item",
                "arc" | "foreshadowing" | "thread" => "thread",
                "place" => "place",
                _ => "world",
            };
            let order = int(entry, "chapterOrder").filter(|o| *o > 0);
            let chapter_ords = json!(order.map(|o| ords.get(&o).copied().unwrap_or(o)).into_iter().collect::<Vec<_>>());
            let status = if text(entry, "status") == "resolved" { "resolved" } else { "open" };
            tx.execute(
                "INSERT INTO drama_ledger(id,drama_id,kind,name,note,chapter_ords_json,status,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![claim(tx, "drama_ledger", &text(entry, "id"))?, drama, kind, name, text(entry, "detail"), chapter_ords.to_string(), status, doc.updated],
            )?;
            bump("台账");
        }
    }

    // Entities: the current version supplies description and sheets; retired ones are dropped.
    let versions = old.docs(drama, "entity-version")?;
    let (mut seq, mut ents, mut kinds, mut by_name) = (0, HashMap::new(), HashMap::new(), HashMap::new());
    let mut speakers: Vec<(String, String)> = vec![];
    for doc in old.docs(drama, "entity")? {
        let e = &doc.data;
        let name = text(e, "name");
        if name.is_empty() || e["retired"].as_bool() == Some(true) {
            continue;
        }
        let current = text(e, "currentVersionId");
        let version = versions.iter().find(|v| v.id == current).or_else(|| versions.iter().rev().find(|v| text(&v.data, "entityId") == doc.id));
        let snap = version.map_or(&NULL, |v| v.data.get("snapshot").unwrap_or(&NULL));
        let fields = snap.get("fields").unwrap_or(&NULL);
        let appearance = ["外观与脸部", "发型", "服装与配件"].iter().map(|k| text(fields, k)).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n");
        let aliases: Vec<&str> = items(e, "aliases").iter().filter_map(Value::as_str).collect();
        let kind = entity_kind_of(&text(e, "entityKind"));
        let description = or(text(snap, "description"), text(fields, "角色定位"));
        let new = NewEntity { hint: &doc.id, kind, name: &name, aliases: json!(aliases), description, appearance, t: doc.times() };
        let id = insert_entity(tx, drama, &mut seq, new)?;
        bump("设定");
        if kind == "character" {
            speakers.extend(aliases.iter().map(|a| (a.to_string(), id.clone())));
            speakers.push((name.clone(), id.clone()));
        }
        // Sheets: every non-avatar picture of the current version; one current picture is adopted.
        let avatar = text(snap, "avatarImageId");
        let pictures: Vec<&Value> = items(snap, "images").iter().filter(|i| text(i, "partId") != "avatar" && text(i, "id") != avatar).collect();
        let rank = |i: &&Value| SHEET_PRIORITY.iter().position(|p| *p == text(i, "partId")).unwrap_or(SHEET_PRIORITY.len());
        let adopted = pictures
            .iter()
            .filter(|i| i["isCurrent"].as_bool() == Some(true) && media(tx, &text(i, "storageKey")).ok().flatten().is_some())
            .min_by(|a, b| rank(a).cmp(&rank(b)).then(text(b, "createdAt").cmp(&text(a, "createdAt"))))
            .map(|i| text(i, "id"));
        let model = if e.get("sourceLibraryAssetId").is_some() { "library" } else { "" };
        for picture in pictures {
            let art = Art { owner: ("entity_id", &id), kind: "sheet", id: &text(picture, "id"), file: picture, prompt: text(picture, "prompt"), model: model.into(), adopted: adopted.as_deref() == Some(&text(picture, "id")), t: doc.times() };
            if insert_artifact(tx, drama, art)? {
                bump("设定图");
            }
        }
        by_name.insert(name, id.clone());
        kinds.insert(id.clone(), kind);
        ents.insert(doc.id, id);
    }

    // The graph: nodes without an entity are settings that only lived there (world, ...).
    let graph = old.docs(drama, "graph")?.into_iter().max_by_key(|d| d.updated);
    let g = graph.as_ref().map_or(&NULL, |d| &d.data);
    let mut nodes: HashMap<String, String> = HashMap::new();
    for node in items(g, "nodes") {
        let (node_id, entity_id, name) = (text(node, "id"), text(node, "entityId"), text(node, "label"));
        if !entity_id.is_empty() {
            if let Some(id) = ents.get(&entity_id) {
                nodes.insert(node_id, id.clone());
            }
        } else if let Some(id) = by_name.get(&name) {
            nodes.insert(node_id, id.clone());
        } else if !name.is_empty() {
            let kind = entity_kind_of(&text(node, "kind"));
            let new = NewEntity { hint: &node_id, kind, name: &name, aliases: json!([]), description: text(node, "description"), appearance: String::new(), t: graph.as_ref().map_or((0, 0), Doc::times) };
            let id = insert_entity(tx, drama, &mut seq, new)?;
            bump("设定");
            kinds.insert(id.clone(), kind);
            by_name.insert(name, id.clone());
            nodes.insert(node_id, id);
        }
    }
    let mut edges = vec![];
    for edge in items(g, "edges") {
        let (Some(from), Some(to)) = (nodes.get(&text(edge, "source")), nodes.get(&text(edge, "target"))) else { continue };
        if from == to {
            continue;
        }
        let label = text(edge, "label");
        let kind = proposal::relation_kind(&label).or_else(|| match text(edge, "category").as_str() {
            "kin" => Some("family"),
            "member" => Some("belong"),
            "love" => Some("love"),
            _ => None,
        });
        tx.execute(
            "INSERT INTO drama_relations(id,drama_id,from_id,to_id,kind,label,note) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![claim(tx, "drama_relations", &text(edge, "id"))?, drama, from, to, kind.unwrap_or("other"), label, text(edge, "description")],
        )?;
        bump("关系");
        edges.push((from, to, label));
    }
    // A prop furnished into a scene or carried by a character belongs to it (furnishing wins over carrying).
    let mut owned = HashSet::new();
    for word in ["陈设", "装备", "持有"] {
        for (from, to, label) in &edges {
            let holder = matches!(kinds.get(*from).copied(), Some("character" | "scene"));
            if holder && kinds.get(*to) == Some(&"prop") && label.contains(word) && owned.insert(*to) {
                tx.execute("UPDATE drama_entities SET parent_id=?1 WHERE id=?2", params![from, to])?;
            }
        }
    }

    // Episodes and shots.
    let mut episodes = old.docs(drama, "episode")?;
    episodes.sort_by_key(|e| int(&e.data, "order").unwrap_or(i64::MAX));
    let mut ep_ids: HashMap<String, String> = HashMap::new();
    for (i, doc) in episodes.iter().enumerate() {
        let (e, seq) = (&doc.data, i as i64 + 1);
        let id = claim(tx, "drama_episodes", &doc.id)?;
        let sources: Vec<&String> = items(e, "sourceChapterIds").iter().filter_map(Value::as_str).filter_map(|c| chapter_ids.get(c)).collect();
        tx.execute(
            "INSERT INTO drama_episodes(id,drama_id,seq,ord,title,outline,source_chapter_ids_json,script,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![id, drama, seq, int(e, "order").unwrap_or(seq), or(text(e, "title"), format!("第 {seq} 集")), text(e, "outline"), json!(sources).to_string(), text(e, "script"), doc.created, doc.updated],
        )?;
        bump("分集");
        ep_ids.insert(doc.id.clone(), id);
    }
    let mut shots: HashMap<String, ShotInfo> = HashMap::new();
    let mut seconds_by_episode: HashMap<String, i64> = HashMap::new();
    let mut shot_docs = old.docs(drama, "shot")?;
    shot_docs.sort_by_key(|s| int(&s.data, "order").unwrap_or(i64::MAX));
    for doc in &shot_docs {
        let (s, Some(episode)) = (&doc.data, ep_ids.get(&text(&doc.data, "episodeId"))) else { continue };
        let id = claim(tx, "drama_shots", &doc.id)?;
        let seconds = int(s, "durationSeconds").unwrap_or(5).clamp(1, 15);
        *seconds_by_episode.entry(episode.clone()).or_default() += seconds;
        let lines = dialogue(&text(s, "dialogue"), &speakers);
        tx.execute(
            "INSERT INTO drama_shots(id,episode_id,ord,seconds,size,camera,description,dialogue_json,image_prompt,video_prompt,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                id, episode, int(s, "order").unwrap_or(0), seconds, shot_size(&text(s, "shotSize")), camera_move(&text(s, "cameraMove")), text(s, "description"),
                json!(lines).to_string(), text(s, "imagePrompt"), text(s, "videoPrompt"), doc.created, doc.updated
            ],
        )?;
        bump("镜头");
        let bound = ["characters", "scenes", "props"].iter().flat_map(|key| items(s, key)).filter_map(|r| ents.get(&text(r, "entityId")));
        let spoken = lines.iter().filter_map(|l| l["speaker"].as_str().filter(|id| !id.is_empty()));
        for entity in bound.map(String::as_str).chain(spoken).filter(|id| kinds.get(*id) != Some(&"world")) {
            tx.execute("INSERT OR IGNORE INTO drama_shot_entities(shot_id,entity_id) VALUES(?1,?2)", params![id, entity])?;
        }
        let info = ShotInfo { id, image: text(s, "currentImageResultId"), video: text(s, "currentVideoResultId"), image_prompt: text(s, "imagePrompt"), video_prompt: text(s, "videoPrompt") };
        shots.insert(doc.id.clone(), info);
    }
    for (episode, seconds) in seconds_by_episode {
        tx.execute("UPDATE drama_episodes SET target_seconds=?1 WHERE id=?2", params![seconds, episode])?;
    }

    // Shot pictures and videos; the shot's current* id decides which one is adopted.
    for (kind, art_kind, field) in [("shot-result", "image", "image"), ("shot-video-result", "video", "video")] {
        for doc in old.docs(drama, kind)? {
            let Some(shot) = shots.get(&text(&doc.data, "shotId")) else { continue };
            let (current, fallback) = if art_kind == "image" { (&shot.image, &shot.image_prompt) } else { (&shot.video, &shot.video_prompt) };
            let spec = &doc.data["input"]["spec"]["shot"];
            let prompt = or(text(spec, if art_kind == "image" { "imagePrompt" } else { "videoPrompt" }), fallback.as_str());
            let model = match text(&doc.data, "source").as_str() {
                imported @ ("upload" | "library") => imported.to_owned(),
                _ => text(&doc.data["parameters"], "model"),
            };
            let art = Art { owner: ("shot_id", &shot.id), kind: art_kind, id: &doc.id, file: &doc.data[field], prompt, model, adopted: doc.id == *current, t: doc.times() };
            if insert_artifact(tx, drama, art)? {
                bump(if art_kind == "image" { "分镜图" } else { "视频" });
            }
        }
    }
    // Voice lines: a cue names its shot and its current result.
    let cues: HashMap<String, Doc> = old.docs(drama, "sound-cue")?.into_iter().map(|d| (d.id.clone(), d)).collect();
    let mut voiced = HashSet::new();
    for doc in old.docs(drama, "sound-result")? {
        let cue = cues.get(&text(&doc.data, "cueId"));
        let Some(shot) = shots.get(&or(text(&doc.data, "shotId"), cue.map_or(String::new(), |c| text(&c.data, "shotId")))) else { continue };
        let adopted = cue.is_some_and(|c| text(&c.data, "currentResultId") == doc.id) && !voiced.contains(&shot.id);
        let prompt = or(text(&doc.data["input"], "text"), cue.map_or(String::new(), |c| text(&c.data, "text")));
        let art = Art { owner: ("shot_id", &shot.id), kind: "audio", id: &doc.id, file: &doc.data["audio"], prompt, model: text(&doc.data["input"]["speech"], "model"), adopted, t: doc.times() };
        if insert_artifact(tx, drama, art)? {
            voiced.extend(adopted.then(|| shot.id.clone()));
            bump("配音");
        }
    }

    // Finished exports whose video file is still in the media store.
    if table_exists(tx, "drama_compositions")? {
        let mut statement = tx.prepare("SELECT id,episode_id,data FROM drama_compositions WHERE drama_id=?1 ORDER BY rowid")?;
        let rows = statement.query_map([drama], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        for (id, episode, data) in rows.collect::<Res<Vec<_>>>()? {
            let (Some(episode), Ok(c)) = (ep_ids.get(&episode), serde_json::from_str::<Value>(&data)) else { continue };
            let Some(video) = media(tx, &text(&c["video"], "storageKey"))?.filter(|_| text(&c, "status") == "ready") else { continue };
            let srt = media(tx, &text(&c["subtitles"], "storageKey"))?.map(|m| m.key).unwrap_or_default();
            let chosen = c["plan"]["selection"]["options"].clone();
            let voice = items(&c["plan"], "clips").iter().any(|clip| !items(clip, "tracks").is_empty());
            let options = json!({"resolution": if int(&chosen, "resolution") == Some(1080) { "1080p" } else { "720p" }, "keepOriginalAudio": chosen["keepNativeAudio"].as_bool().unwrap_or(true), "includeVoice": voice});
            let made = int(&c, "createdAt").unwrap_or_else(now);
            tx.execute(
                "INSERT INTO drama_exports(id,episode_id,status,options_json,media_key,media_url,srt_key,created_at,finished_at) VALUES(?1,?2,'ready',?3,?4,?5,?6,?7,?7)",
                params![claim(tx, "drama_exports", &id)?, episode, options.to_string(), video.key, video.url, srt, made],
            )?;
            bump("导出");
        }
    }
    tx.execute("INSERT INTO drama_legacy_migrated(drama_id,migrated_at) VALUES(?1,?2)", params![drama, now()])?;
    Ok(format!("{counts:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }
    fn put(conn: &Connection, drama: &str, id: &str, kind: &str, data: Value) {
        conn.execute("INSERT INTO drama_documents VALUES(?1,?2,?3,1,?4,0,1000+(SELECT COUNT(*) FROM drama_documents),2000)", params![drama, id, kind, data.to_string()]).unwrap();
    }
    fn file(key: &str, kind: &str) -> Value {
        json!({"storageKey": key, "mimeType": kind, "width": 640, "height": 360, "durationMs": 4000})
    }

    /// Old tables as the previous version left them, plus a media table that knows `m:*` keys.
    fn old_store() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        super::super::schema::init(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE media (bucket TEXT, key TEXT, url_key TEXT, mime_type TEXT, PRIMARY KEY(bucket,key));
             CREATE TABLE drama_documents (drama_id TEXT, id TEXT, kind TEXT, revision INTEGER, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(drama_id,id));
             CREATE TABLE drama_task_owners (drama_id TEXT, id TEXT, bundle_id TEXT, archived INTEGER, PRIMARY KEY(drama_id,id));
             CREATE VIEW drama_active_documents AS SELECT d.* FROM drama_documents d WHERE d.deleted=0
               AND NOT EXISTS(SELECT 1 FROM drama_task_owners o WHERE o.drama_id=d.drama_id AND o.id=d.id AND o.archived=1);
             CREATE TABLE drama_compositions (id TEXT PRIMARY KEY, drama_id TEXT, episode_id TEXT, data TEXT);",
        )
        .unwrap();
        for key in ["m:sheet", "m:old-sheet", "m:img1", "m:img0", "m:vid1", "m:snd", "m:cut", "m:srt"] {
            conn.execute("INSERT INTO media VALUES(?1,?2,?3,'image/png')", params![if key.contains("vid") || key == "m:cut" { "media" } else { "images" }, key, format!("u-{key}")]).unwrap();
        }
        conn
    }

    fn fixture() -> Connection {
        let conn = old_store();
        let d = "d1";
        put(&conn, d, d, "project", json!({"title":"雨夜","aspect":"9:16","sourceType":"original","brief":"简介","styleVersionId":"st","coverId":"city"}));
        put(&conn, d, "st", "style", json!({"name":"莫比斯","presetId":"moebius","prompt":"墨线","promptEn":"ink","palette":{"name":"夜","colors":["#112233","#aabbcc"]}}));
        put(&conn, d, "c2", "chapter", json!({"order":2,"title":"二","text":"圆圆找到信。","summary":"s","endState":"e"}));
        put(&conn, d, "c1", "chapter", json!({"order":1,"title":"一","text":"林溪回到旧邮局。"}));
        put(&conn, d, "c3", "chapter", json!({"order":3,"title":"已删除","text":"x"}));
        conn.execute("UPDATE drama_documents SET deleted=1 WHERE id='c3'", []).unwrap();
        put(&conn, d, "story-ledger", "story-ledger", json!({"entries":[
            {"id":"l1","category":"voice","chapterOrder":2,"name":"林溪","detail":"修理师","status":"resolved"},
            {"id":"l2","category":"prop","chapterOrder":1,"name":"台灯","detail":"铜"},
            {"id":"l3","category":"foreshadowing","chapterOrder":1,"name":"空白收信人","detail":"","status":"open"},
            {"id":"l4","category":"volume","chapterOrder":1,"name":"卷一","detail":""}]}));
        let entity = |id: &str, kind: &str, name: &str, extra: Value| {
            let mut e = json!({"entityKind":kind,"name":name,"aliases":["阿溪"],"currentVersionId":format!("v-{id}"),"retired":false});
            e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            put(&conn, d, id, "entity", e);
        };
        entity("hero", "character", "林溪", json!({}));
        entity("post", "scene", "旧港邮局", json!({}));
        entity("lamp", "prop", "台灯", json!({}));
        entity("gone", "prop", "退役道具", json!({"retired": true}));
        entity("ghost", "prop", "已归档", json!({}));
        conn.execute("INSERT INTO drama_task_owners VALUES(?1,'ghost','b',1)", [d]).unwrap();
        let sheet = |id: &str, part: &str, key: &str, current: bool| json!({"id":id,"partId":part,"storageKey":key,"isCurrent":current,"mimeType":"image/png","width":10,"height":20,"prompt":"p","createdAt":"2026-01-01T00:00:00Z"});
        put(&conn, d, "v-hero", "entity-version", json!({"entityId":"hero","snapshot":{"description":"年轻修理师","fields":{"外观与脸部":"短发"},"avatarImageId":"av","images":[
            sheet("s-old", "identity-sheet", "m:old-sheet", false), sheet("s-new", "identity-sheet", "m:sheet", true), sheet("av", "avatar", "m:sheet", true), sheet("s-gone", "identity-sheet", "missing", true)]}}));
        put(&conn, d, "v-post", "entity-version", json!({"entityId":"post","snapshot":{"description":"邮局","images":[]}}));
        put(&conn, d, "v-lamp", "entity-version", json!({"entityId":"lamp","snapshot":{"description":"黄铜灯","images":[]}}));
        put(&conn, d, "graph", "graph", json!({
            "nodes":[{"id":"n1","entityId":"hero","kind":"character","label":"林溪"},{"id":"n2","entityId":"post","kind":"location","label":"旧港邮局"},{"id":"n3","entityId":"lamp","kind":"object","label":"台灯"},
                     {"id":"n4","kind":"world","label":"雨后旧港","description":"潮湿的港口"},{"id":"n5","entityId":"gone","kind":"object","label":"退役道具"}],
            "edges":[{"id":"e1","source":"n1","target":"n3","label":"修理并持有","category":"neutral"},{"id":"e2","source":"n2","target":"n3","label":"陈设","category":"neutral"},
                     {"id":"e3","source":"n1","target":"n2","label":"同伴","category":"neutral","description":"常去"},{"id":"e4","source":"n4","target":"n1","label":"笼罩"},
                     {"id":"e5","source":"n1","target":"n5","label":"丢失"},{"id":"e6","source":"n1","target":"missing","label":"悬空"}]}));
        put(&conn, d, "ep1", "episode", json!({"order":1,"title":"最后一盏灯","outline":"梗概","script":"剧本"}));
        let shot = |id: &str, order: i64, secs: i64, extra: Value| {
            let mut s = json!({"episodeId":"ep1","order":order,"durationSeconds":secs,"shotSize":"closeUp","cameraMove":"push_in","description":"d","dialogue":"","imagePrompt":"ip","videoPrompt":"vp",
                "characters":[{"entityId":"hero"}],"scenes":[{"entityId":"post"}],"props":[{"entityId":"lamp"},{"entityId":"gone"}]});
            s.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            put(&conn, d, id, "shot", s);
        };
        shot("sh1", 1, 20, json!({"dialogue":"林溪（低声）：“还能亮吗？”\n咔。","currentImageResultId":"r-img1","currentVideoResultId":"r-vid1"}));
        shot("sh2", 2, 0, json!({"shotSize":"strange","cameraMove":"static","characters":[],"props":[]}));
        put(&conn, d, "r-img1", "shot-result", json!({"shotId":"sh1","image":file("m:img1","image/png"),"parameters":{"model":"ch::img"},"input":{"spec":{"shot":{"imagePrompt":"生成时提示词"}}}}));
        put(&conn, d, "r-img0", "shot-result", json!({"shotId":"sh1","image":file("m:img0","image/png"),"source":"upload"}));
        put(&conn, d, "r-lost", "shot-result", json!({"shotId":"sh1","image":file("m:nowhere","image/png")}));
        put(&conn, d, "r-hidden", "shot-result", json!({"shotId":"sh1","image":file("m:img0","image/png")}));
        conn.execute("INSERT INTO drama_task_owners VALUES(?1,'r-hidden','b',1)", [d]).unwrap();
        put(&conn, d, "r-vid1", "shot-video-result", json!({"shotId":"sh1","video":file("m:vid1","video/mp4"),"parameters":{"model":"ch::vid"}}));
        put(&conn, d, "cue", "sound-cue", json!({"shotId":"sh1","currentResultId":"r-snd","text":"旁白"}));
        put(&conn, d, "r-snd", "sound-result", json!({"cueId":"cue","shotId":"sh1","audio":file("m:snd","audio/mpeg"),"input":{"text":"灯亮着","speech":{"model":"tts::m"}}}));
        conn.execute(
            "INSERT INTO drama_compositions VALUES('cmp',?1,'ep1',?2)",
            params![d, json!({"status":"ready","createdAt":3000,"video":{"storageKey":"m:cut"},"subtitles":{"storageKey":"m:srt"},"plan":{"selection":{"options":{"resolution":1080,"keepNativeAudio":false}},"clips":[{"tracks":[{}]}]}}).to_string()],
        )
        .unwrap();
        // A deleted project is not imported; a drama that already exists is left alone.
        put(&conn, "d2", "d2", "project", json!({"title":"已删除"}));
        conn.execute("UPDATE drama_documents SET deleted=1 WHERE id='d2'", []).unwrap();
        put(&conn, "d3", "d3", "project", json!({"title":"旧版本"}));
        put(&conn, "d3", "x", "chapter", json!({"order":1,"title":"旧章","text":"旧"}));
        conn.execute("INSERT INTO drama_projects(id,title,source_type,aspect,created_at,updated_at) VALUES('d3','已有','original','16:9',1,1)", []).unwrap();
        conn
    }

    fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn imports_a_drama_with_everything_it_owns() {
        let conn = fixture();
        migrate(&conn);
        assert_eq!(count(&conn, "drama_projects"), 2, "d1 imported, d2 (deleted) skipped, d3 already there");
        assert_eq!(one::<String>(&conn, "SELECT title FROM drama_projects WHERE id='d3'"), "已有");
        assert_eq!(count(&conn, "drama_chapters WHERE drama_id='d3'"), 0);
        let project: (String, String, String, String) = conn.query_row("SELECT aspect,style_json,palette_json,cover_json FROM drama_projects WHERE id='d1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(project.0, "9:16");
        assert!(project.1.contains("moebius") && project.2.contains("#AABBCC") && project.3.contains("\"variant\":2"), "{project:?}");

        // Chapters keep their order (the deleted one is gone); the ledger points at the new ords.
        assert_eq!(one::<String>(&conn, "SELECT group_concat(title) FROM (SELECT title FROM drama_chapters ORDER BY ord)"), "一,二");
        assert_eq!(one::<String>(&conn, "SELECT kind||status||chapter_ords_json FROM drama_ledger WHERE name='林溪'"), "characterresolved[2]");
        assert_eq!(one::<String>(&conn, "SELECT kind FROM drama_ledger WHERE name='台灯'"), "item");
        assert_eq!(one::<String>(&conn, "SELECT kind FROM drama_ledger WHERE name='空白收信人'"), "thread");
        assert_eq!(one::<String>(&conn, "SELECT kind FROM drama_ledger WHERE name='卷一'"), "world");

        // Entities: retired and archived ones are skipped; the graph-only world node becomes a world entity.
        assert_eq!(one::<String>(&conn, "SELECT group_concat(name) FROM (SELECT name FROM drama_entities ORDER BY seq)"), "林溪,旧港邮局,台灯,雨后旧港");
        assert_eq!(one::<String>(&conn, "SELECT kind||description FROM drama_entities WHERE name='雨后旧港'"), "world潮湿的港口");
        assert_eq!(one::<String>(&conn, "SELECT appearance FROM drama_entities WHERE name='林溪'"), "短发");
        assert_eq!(one::<String>(&conn, "SELECT p.name FROM drama_entities e JOIN drama_entities p ON p.id=e.parent_id WHERE e.name='台灯'"), "旧港邮局", "furnishing wins over carrying");
        // Relations: kind by synonym, label kept, dangling and retired endpoints dropped.
        assert_eq!(count(&conn, "drama_relations"), 4);
        assert_eq!(one::<String>(&conn, "SELECT kind||label FROM drama_relations WHERE id='e3'"), "ally同伴");
        assert_eq!(one::<String>(&conn, "SELECT kind FROM drama_relations WHERE id='e4'"), "other");

        // Sheets: avatar duplicate and missing media skipped, the current sheet adopted.
        assert_eq!(one::<String>(&conn, "SELECT group_concat(id||adopted) FROM (SELECT id,adopted FROM drama_artifacts WHERE kind='sheet' ORDER BY id)"), "s-new1,s-old0");
        assert_eq!(one::<String>(&conn, "SELECT params_json||input_hash||status FROM drama_artifacts WHERE id='s-new'"), "{\"migrated\":true}ready");

        // Episode and shots.
        assert_eq!(one::<i64>(&conn, "SELECT target_seconds FROM drama_episodes"), 16, "15 (clamped) + 1");
        assert_eq!(one::<String>(&conn, "SELECT seconds||size||camera FROM drama_shots WHERE id='sh1'"), "15特写推镜");
        assert_eq!(one::<String>(&conn, "SELECT size||camera FROM drama_shots WHERE id='sh2'"), "strange固定");
        let hero: String = one(&conn, "SELECT id FROM drama_entities WHERE name='林溪'");
        let lines: String = one(&conn, "SELECT dialogue_json FROM drama_shots WHERE id='sh1'");
        assert_eq!(serde_json::from_str::<Value>(&lines).unwrap(), json!([{"speaker": hero, "text": "还能亮吗？"}, {"speaker": "", "text": "咔。"}]));
        assert_eq!(one::<String>(&conn, "SELECT group_concat(name) FROM (SELECT e.name FROM drama_shot_entities b JOIN drama_entities e ON e.id=b.entity_id WHERE shot_id='sh1' ORDER BY e.seq)"), "林溪,旧港邮局,台灯");
        assert_eq!(one::<String>(&conn, "SELECT transition||start_state||end_state||props_json FROM drama_shots WHERE id='sh1'"), "cut[]");

        // Shot media: only live files that exist; the current* ids are adopted.
        let rows = |kind: &str| one::<String>(&conn, &format!("SELECT group_concat(id||adopted||model) FROM (SELECT * FROM drama_artifacts WHERE kind='{kind}' AND shot_id IS NOT NULL ORDER BY id)"));
        assert_eq!(rows("image"), "r-img00upload,r-img11ch::img");
        assert_eq!(one::<String>(&conn, "SELECT prompt FROM drama_artifacts WHERE id='r-img1'"), "生成时提示词");
        assert_eq!(rows("video"), "r-vid11ch::vid");
        assert_eq!(rows("audio"), "r-snd1tts::m");
        let export: (String, String, String, i64) = conn.query_row("SELECT status,options_json,srt_key,finished_at FROM drama_exports WHERE id='cmp'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(export.0, "ready");
        assert_eq!(serde_json::from_str::<Value>(&export.1).unwrap(), json!({"resolution":"1080p","keepOriginalAudio":false,"includeVoice":true}));
        assert_eq!((export.2.as_str(), export.3), ("m:srt", 3000));
    }

    #[test]
    fn running_twice_adds_nothing_and_a_deleted_drama_stays_deleted() {
        let conn = fixture();
        let old_rows = count(&conn, "drama_documents");
        migrate(&conn);
        let tables = ["drama_projects", "drama_chapters", "drama_ledger", "drama_entities", "drama_relations", "drama_episodes", "drama_shots", "drama_shot_entities", "drama_artifacts", "drama_exports"];
        let before: Vec<i64> = tables.iter().map(|t| count(&conn, t)).collect();
        migrate(&conn);
        assert_eq!(before, tables.iter().map(|t| count(&conn, t)).collect::<Vec<_>>());
        conn.execute("DELETE FROM drama_projects WHERE id='d1'", []).unwrap();
        migrate(&conn);
        assert_eq!(count(&conn, "drama_projects WHERE id='d1'"), 0);
        assert_eq!(count(&conn, "drama_documents"), old_rows, "the old rows are untouched");
    }

    #[test]
    fn a_failing_drama_rolls_back_alone() {
        let conn = fixture();
        put(&conn, "d0", "d0", "project", json!({"title":"先导入"}));
        // A trigger makes one drama's episode insert fail half way through its import.
        put(&conn, "d4", "d4", "project", json!({"title":"坏的"}));
        put(&conn, "d4", "bad", "episode", json!({"order":1,"title":"一"}));
        conn.execute_batch("CREATE TRIGGER fail_d4 BEFORE INSERT ON drama_episodes WHEN NEW.drama_id='d4' BEGIN SELECT RAISE(ABORT, 'boom'); END;").unwrap();
        migrate(&conn);
        assert_eq!(count(&conn, "drama_projects WHERE id IN ('d0','d1')"), 2);
        assert_eq!(count(&conn, "drama_projects WHERE id='d4'") + count(&conn, "drama_legacy_migrated WHERE drama_id='d4'"), 0, "rolled back, retried at the next start");
    }

    #[test]
    fn dialogue_splits_speakers_and_keeps_unknown_heads() {
        let speakers = vec![("陆沉".to_owned(), "c1".to_owned())];
        let lines = dialogue("陆沉（画外音，低哑）：鼓楼路……\n旁白：雨停了。\n他说：好。\n\n“引号”", &speakers);
        assert_eq!(lines, vec![json!({"speaker":"c1","text":"鼓楼路……"}), json!({"speaker":"","text":"雨停了。"}), json!({"speaker":"","text":"他说：好。"}), json!({"speaker":"","text":"引号"})]);
    }
}
