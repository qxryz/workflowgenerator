use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post, put},
    Json, Router,
};
use rusqlite::{params, types::Value as Sql, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::model::*;
use super::proposal::{self, run_info};
use super::{bad, conflict, db, internal, missing, new_id, now, text_field, Patch, Result};
use crate::{state::AppState, storage::NativeStorage};

type Store = State<Arc<NativeStorage>>;
type Reply = Result<Json<Value>>;

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/dramas", get(list_dramas).post(create_drama))
        .route("/api/dramas/{id}", get(snapshot).patch(update_drama).delete(delete_drama))
        .route("/api/dramas/{id}/chapters", get(list_chapters).post(create_chapter))
        .route("/api/drama-chapters/{cid}", get(get_chapter).patch(update_chapter).delete(delete_chapter))
        .route("/api/dramas/{id}/ledger", put(put_ledger))
        .route("/api/dramas/{id}/entities", post(create_entity))
        .route("/api/drama-entities/{eid}", patch(update_entity).delete(delete_entity))
        .route("/api/dramas/{id}/relations", post(create_relation))
        .route("/api/drama-relations/{rid}", patch(update_relation).delete(delete_relation))
        .route("/api/dramas/{id}/episodes", post(create_episode))
        .route("/api/drama-episodes/{eid}", get(episode).patch(update_episode).delete(delete_episode))
        .route("/api/drama-episodes/{eid}/shots", post(create_shot))
        .route("/api/drama-episodes/{eid}/shots/reorder", post(reorder_shots))
        .route("/api/drama-shots/{sid}", patch(update_shot).delete(delete_shot))
        .route("/api/dramas/{id}/artifacts", post(create_artifact))
        .route("/api/drama-artifacts/{aid}", patch(update_artifact).delete(delete_artifact))
        .route("/api/drama-artifacts/{aid}/adopt", post(adopt_artifact))
        .route("/api/dramas/{id}/runs", post(create_run))
        .route("/api/drama-runs/{rid}", get(get_run).patch(update_run).delete(delete_run))
        .route("/api/drama-runs/{rid}/proposal", post(submit_proposal))
        .route("/api/drama-runs/{rid}/adopt", post(adopt_run))
        .route("/api/drama-runs/{rid}/reject", post(reject_run))
        .route("/api/drama-media-keys", get(media_keys))
        .merge(super::export::router())
}

fn conn(store: &NativeStorage) -> Result<std::sync::MutexGuard<'_, Connection>> {
    store.lock().map_err(internal)
}

fn ok<T: serde::Serialize>(value: T) -> Reply {
    Ok(Json(serde_json::to_value(value).map_err(|e| internal(e.to_string()))?))
}

fn one<T>(conn: &Connection, sql: &str, id: &str, map: fn(&rusqlite::Row) -> rusqlite::Result<T>, what: &str) -> Result<T> {
    conn.query_row(sql, [id], map).optional().map_err(db)?.ok_or_else(|| missing(what))
}

fn project(conn: &Connection, id: &str) -> Result<Project> {
    one(conn, &format!("SELECT {PROJECT_COLS} FROM drama_projects WHERE id=?1"), id, Project::from_row, "剧目")
}

fn touch(conn: &Connection, drama: &str) -> Result<()> {
    conn.execute("UPDATE drama_projects SET updated_at=?1 WHERE id=?2", params![now(), drama]).map_err(db)?;
    Ok(())
}

/// The drama an owned row belongs to; also proves the row exists.
fn drama_of(conn: &Connection, table: &str, id: &str, what: &str) -> Result<String> {
    let sql = match table {
        "drama_shots" => "SELECT e.drama_id FROM drama_shots s JOIN drama_episodes e ON e.id=s.episode_id WHERE s.id=?1".to_owned(),
        _ => format!("SELECT drama_id FROM {table} WHERE id=?1"),
    };
    conn.query_row(&sql, [id], |r| r.get(0)).optional().map_err(db)?.ok_or_else(|| missing(what))
}

fn require(body: &Value, key: &str, max: usize) -> Result<String> {
    text_field(body, key, max)?.filter(|s| !s.is_empty()).ok_or_else(|| bad(format!("{key} 不能为空")))
}

fn one_of<'a>(value: &str, allowed: &[&'a str], key: &str) -> Result<&'a str> {
    allowed.iter().find(|a| **a == value).copied().ok_or_else(|| bad(format!("{key} 无效")))
}

fn str_list(value: &Value, key: &str, max_items: usize, max_len: usize) -> Result<Vec<String>> {
    let items = value.as_array().ok_or_else(|| bad(format!("{key} 必须是数组")))?;
    if items.len() > max_items {
        return Err(bad(format!("{key} 最多 {max_items} 项")));
    }
    items
        .iter()
        .map(|v| {
            let s = v.as_str().map(str::trim).ok_or_else(|| bad(format!("{key} 必须是文字数组")))?;
            if s.chars().count() > max_len {
                return Err(bad(format!("{key} 中的项目过长")));
            }
            Ok(s.to_owned())
        })
        .filter(|r| r.as_ref().map_or(true, |s| !s.is_empty()))
        .collect()
}

fn entity_ids_in(conn: &Connection, drama: &str) -> Result<Vec<(String, String)>> {
    select(conn, "SELECT id,kind FROM drama_entities WHERE drama_id=?1", [drama], |r| Ok((r.get(0)?, r.get(1)?)))
}

// ---------- projects ----------

async fn list_dramas(State(store): Store) -> Reply {
    let conn = conn(&store)?;
    let rows = select(
        &conn,
        &format!(
            "SELECT {PROJECT_COLS},
               (SELECT COUNT(*) FROM drama_chapters c WHERE c.drama_id=p.id),
               (SELECT COUNT(*) FROM drama_entities e WHERE e.drama_id=p.id),
               (SELECT COUNT(*) FROM drama_episodes e WHERE e.drama_id=p.id)
             FROM drama_projects p ORDER BY updated_at DESC"
        ),
        [],
        |r| {
            let p = Project::from_row(r)?;
            Ok(json!({
                "id": p.id, "title": p.title, "sourceType": p.source_type, "aspect": p.aspect, "cover": p.cover, "updatedAt": p.updated_at,
                "counts": {"chapters": r.get::<_, i64>(11)?, "entities": r.get::<_, i64>(12)?, "episodes": r.get::<_, i64>(13)?},
            }))
        },
    )?;
    ok(rows)
}

fn style_value(value: &Value) -> Result<Value> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let prompt = text_field(value, "prompt", 4_000)?.unwrap_or_default();
    let mut style = json!({"prompt": prompt});
    if let Some(id) = text_field(value, "presetId", 80)? {
        style["presetId"] = json!(id);
    }
    if let Some(en) = text_field(value, "promptEn", 4_000)? {
        style["promptEn"] = json!(en);
    }
    Ok(style)
}

fn palette_value(value: &Value) -> Result<Value> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let name = require(value, "name", 80)?;
    let colors = str_list(value.get("colors").unwrap_or(&Value::Null), "colors", 8, 7)?;
    if colors.len() < 2 || colors.iter().any(|c| !(c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|h| h.is_ascii_hexdigit()))) {
        return Err(bad("色卡需要 2–8 个 #RRGGBB 颜色"));
    }
    Ok(json!({"name": name, "colors": colors.iter().map(|c| c.to_uppercase()).collect::<Vec<_>>()}))
}

fn cover_value(value: &Value) -> Result<Value> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    if let (Some(key), Some(url)) = (text_field(value, "mediaKey", 300)?, text_field(value, "mediaUrl", 600)?) {
        return Ok(json!({"mediaKey": key, "mediaUrl": url}));
    }
    match (value["variant"].as_i64(), value["seed"].as_i64()) {
        (Some(variant), Some(seed)) => Ok(json!({"variant": variant, "seed": seed})),
        _ => Err(bad("封面无效")),
    }
}

async fn create_drama(State(store): Store, Json(body): Json<Value>) -> Reply {
    let title = require(&body, "title", 120)?;
    let source = one_of(body["sourceType"].as_str().unwrap_or(""), &["original", "novel", "script"], "sourceType")?;
    let aspect = one_of(body["aspect"].as_str().unwrap_or("16:9"), &["16:9", "9:16", "1:1"], "aspect")?;
    let brief = text_field(&body, "brief", 20_000)?.unwrap_or_default();
    let id = new_id();
    let t = now();
    let cover = match body.get("cover") {
        Some(c) if !c.is_null() => cover_value(c)?,
        _ => json!({"variant": t % 5, "seed": t % 100_000}),
    };
    let mut conn = conn(&store)?;
    let tx = conn.transaction().map_err(db)?;
    tx.execute(
        "INSERT INTO drama_projects(id,title,source_type,brief,aspect,cover_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
        params![id, title, source, brief, aspect, cover.to_string(), t],
    )
    .map_err(db)?;
    if let Some(chapters) = body.get("chapters").and_then(Value::as_array) {
        if chapters.len() > 2_000 {
            return Err(bad("章节过多，最多 2000 章"));
        }
        for (i, chapter) in chapters.iter().enumerate() {
            let title = text_field(chapter, "title", 120)?.filter(|s| !s.is_empty()).unwrap_or_else(|| format!("第 {} 章", i + 1));
            let body = text_field(chapter, "body", 200_000)?.unwrap_or_default();
            tx.execute(
                "INSERT INTO drama_chapters(id,drama_id,ord,title,body,origin,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'imported',?6,?6)",
                params![new_id(), id, i as i64 + 1, title, body, t],
            )
            .map_err(db)?;
        }
    }
    tx.commit().map_err(db)?;
    ok(project(&conn, &id)?)
}

async fn snapshot(State(store): Store, Path(id): Path<String>) -> Reply {
    let conn = conn(&store)?;
    let project = project(&conn, &id)?;
    let chapters = select(&conn, &format!("SELECT {CHAPTER_SUMMARY_COLS} FROM drama_chapters WHERE drama_id=?1 ORDER BY ord"), [&id], Chapter::from_row)?;
    let ledger = select(&conn, &format!("SELECT {LEDGER_COLS} FROM drama_ledger WHERE drama_id=?1 ORDER BY kind, name"), [&id], LedgerEntry::from_row)?;
    let entities = select(&conn, &format!("SELECT {ENTITY_COLS} FROM drama_entities WHERE drama_id=?1 ORDER BY sort, seq"), [&id], Entity::from_row)?;
    let relations = select(&conn, &format!("SELECT {RELATION_COLS} FROM drama_relations WHERE drama_id=?1"), [&id], Relation::from_row)?;
    let mut episodes = select(&conn, &format!("SELECT {EPISODE_COLS} FROM drama_episodes WHERE drama_id=?1 ORDER BY ord"), [&id], Episode::from_row)?;
    for episode in &mut episodes {
        episode.progress = Some(conn
            .query_row(
                "SELECT COUNT(*),
                   (SELECT COUNT(*) FROM drama_artifacts a JOIN drama_shots s ON s.id=a.shot_id WHERE s.episode_id=?1 AND a.kind='image' AND a.adopted=1),
                   (SELECT COUNT(*) FROM drama_artifacts a JOIN drama_shots s ON s.id=a.shot_id WHERE s.episode_id=?1 AND a.kind='video' AND a.adopted=1)
                 FROM drama_shots WHERE episode_id=?1",
                [&episode.id],
                |r| Ok(EpisodeProgress { shots: r.get(0)?, images: r.get(1)?, videos: r.get(2)? }),
            )
            .map_err(db)?);
    }
    let artifacts = select(&conn, &recent_artifacts("drama_id=?1 AND entity_id IS NOT NULL", "entity_id"), [&id], Artifact::from_row)?;
    let runs = select(&conn, &format!("SELECT {RUN_COLS} FROM drama_runs WHERE drama_id=?1 ORDER BY created_at DESC LIMIT 300"), [&id], Run::from_row)?;
    ok(json!({"project": project, "chapters": chapters, "ledger": ledger, "entities": entities, "relations": relations, "episodes": episodes, "artifacts": artifacts, "runs": runs}))
}

/// Adopted, pending and the latest few results per owner; older drafts stay in
/// the database but out of every refresh.
fn recent_artifacts(filter: &str, owner: &str) -> String {
    format!(
        "SELECT {ARTIFACT_COLS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY {owner} ORDER BY created_at DESC) AS recent FROM drama_artifacts WHERE {filter})
         WHERE adopted=1 OR status='pending' OR recent<=8 ORDER BY created_at DESC"
    )
}

async fn update_drama(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let mut patch = Patch::default();
    patch.text(&body, "title", "title", 120, true)?;
    patch.text(&body, "brief", "brief", 20_000, false)?;
    if let Some(aspect) = body.get("aspect").and_then(Value::as_str) {
        patch.set("aspect", Sql::Text(one_of(aspect, &["16:9", "9:16", "1:1"], "aspect")?.into()));
    }
    if let Some(style) = body.get("style") {
        patch.json("style_json", &style_value(style)?);
    }
    if let Some(palette) = body.get("palette") {
        patch.json("palette_json", &palette_value(palette)?);
    }
    if let Some(cover) = body.get("cover") {
        patch.json("cover_json", &cover_value(cover)?);
    }
    patch.apply(&conn, "drama_projects", &id, &body)?;
    ok(project(&conn, &id)?)
}

async fn delete_drama(State(store): Store, Path(id): Path<String>) -> Result<StatusCode> {
    conn(&store)?.execute("DELETE FROM drama_projects WHERE id=?1", [&id]).map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- chapters & ledger ----------

fn chapter(conn: &Connection, id: &str) -> Result<Chapter> {
    one(conn, &format!("SELECT {CHAPTER_COLS} FROM drama_chapters WHERE id=?1"), id, Chapter::from_row, "章节")
}

async fn list_chapters(State(store): Store, Path(id): Path<String>) -> Reply {
    let conn = conn(&store)?;
    project(&conn, &id)?;
    ok(select(&conn, &format!("SELECT {CHAPTER_COLS} FROM drama_chapters WHERE drama_id=?1 ORDER BY ord"), [&id], Chapter::from_row)?)
}

async fn get_chapter(State(store): Store, Path(cid): Path<String>) -> Reply {
    let conn = conn(&store)?;
    ok(chapter(&conn, &cid)?)
}

/// Chapter numbers are positions, so inserting or removing one moves every
/// reference after it: ledger mentions and pending chapter runs. A pending run
/// whose chapter was removed can no longer be adopted.
fn shift_chapter_refs(conn: &Connection, drama: &str, at: i64, inserted: bool) -> Result<()> {
    let ledger = select(conn, "SELECT id, chapter_ords_json FROM drama_ledger WHERE drama_id=?1", [drama], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for (id, ords) in ledger {
        let ords: Vec<i64> = serde_json::from_str::<Vec<i64>>(&ords)
            .unwrap_or_default()
            .into_iter()
            .filter(|o| inserted || *o != at)
            .map(|o| if o > at || (inserted && o == at) { o + if inserted { 1 } else { -1 } } else { o })
            .collect();
        conn.execute("UPDATE drama_ledger SET chapter_ords_json=?1 WHERE id=?2", params![json!(ords).to_string(), id]).map_err(db)?;
    }
    let pending = "drama_id=?1 AND stage='chapter' AND status IN ('running','review')";
    if !inserted {
        conn.execute(
            &format!("UPDATE drama_runs SET status='rejected', error='章节已删除', finished_at=?3 WHERE {pending} AND json_extract(scope_json,'$.ord')=?2"),
            params![drama, at, now()],
        )
        .map_err(db)?;
    }
    conn.execute(
        &format!("UPDATE drama_runs SET scope_json=json_set(scope_json,'$.ord',json_extract(scope_json,'$.ord')+?3) WHERE {pending} AND json_extract(scope_json,'$.ord')>=?2"),
        params![drama, if inserted { at } else { at + 1 }, if inserted { 1 } else { -1 }],
    )
    .map_err(db)?;
    Ok(())
}

async fn create_chapter(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    project(&conn, &id)?;
    let title = require(&body, "title", 120)?;
    let text = text_field(&body, "body", 200_000)?.unwrap_or_default();
    let last: i64 = conn.query_row("SELECT COALESCE(MAX(ord),0) FROM drama_chapters WHERE drama_id=?1", [&id], |r| r.get(0)).map_err(db)?;
    let ord = body["ord"].as_i64().filter(|o| (1..=last + 1).contains(o)).unwrap_or(last + 1);
    let chapter_id = new_id();
    let t = now();
    let tx = conn.transaction().map_err(db)?;
    // Shift in two steps so the (drama_id, ord) unique index never collides.
    tx.execute("UPDATE drama_chapters SET ord=-ord-1 WHERE drama_id=?1 AND ord>=?2", params![id, ord]).map_err(db)?;
    tx.execute("UPDATE drama_chapters SET ord=-ord WHERE drama_id=?1 AND ord<0", [&id]).map_err(db)?;
    if ord <= last {
        shift_chapter_refs(&tx, &id, ord, true)?;
    }
    tx.execute(
        "INSERT INTO drama_chapters(id,drama_id,ord,title,body,origin,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'manual',?6,?6)",
        params![chapter_id, id, ord, title, text, t],
    )
    .map_err(db)?;
    touch(&tx, &id)?;
    tx.commit().map_err(db)?;
    ok(chapter(&conn, &chapter_id)?)
}

async fn update_chapter(State(store): Store, Path(cid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let mut patch = Patch::default();
    patch.text(&body, "title", "title", 120, true)?;
    patch.text(&body, "body", "body", 200_000, false)?;
    patch.text(&body, "summary", "summary", 3_000, false)?;
    patch.text(&body, "endState", "end_state", 3_000, false)?;
    patch.apply(&conn, "drama_chapters", &cid, &body)?;
    ok(chapter(&conn, &cid)?)
}

async fn delete_chapter(State(store): Store, Path(cid): Path<String>) -> Result<StatusCode> {
    let mut conn = conn(&store)?;
    let (drama, ord): (String, i64) = conn
        .query_row("SELECT drama_id, ord FROM drama_chapters WHERE id=?1", [&cid], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(db)?
        .ok_or_else(|| missing("章节"))?;
    let tx = conn.transaction().map_err(db)?;
    tx.execute("DELETE FROM drama_chapters WHERE id=?1", [&cid]).map_err(db)?;
    tx.execute("UPDATE drama_chapters SET ord=-(ord-1) WHERE drama_id=?1 AND ord>?2", params![drama, ord]).map_err(db)?;
    tx.execute("UPDATE drama_chapters SET ord=-ord WHERE drama_id=?1 AND ord<0", [&drama]).map_err(db)?;
    shift_chapter_refs(&tx, &drama, ord, false)?;
    tx.commit().map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn put_ledger(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    project(&conn, &id)?;
    let entries = body["entries"].as_array().ok_or_else(|| bad("entries 必须是数组"))?;
    if entries.len() > 1_000 {
        return Err(bad("账本条目过多"));
    }
    let tx = conn.transaction().map_err(db)?;
    tx.execute("DELETE FROM drama_ledger WHERE drama_id=?1", [&id]).map_err(db)?;
    let t = now();
    for entry in entries {
        let kind = one_of(entry["kind"].as_str().unwrap_or(""), &["character", "place", "item", "world", "thread"], "kind")?;
        let status = one_of(entry["status"].as_str().unwrap_or("open"), &["open", "resolved"], "status")?;
        let ords: Vec<i64> = entry["chapterOrds"].as_array().map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
        let entry_id = entry["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 64).map(str::to_owned).unwrap_or_else(new_id);
        tx.execute(
            "INSERT INTO drama_ledger(id,drama_id,kind,name,note,chapter_ords_json,status,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![entry_id, id, kind, require(entry, "name", 80)?, text_field(entry, "note", 2_000)?.unwrap_or_default(), json!(ords).to_string(), status, t],
        )
        .map_err(db)?;
    }
    tx.commit().map_err(db)?;
    ok(select(&conn, &format!("SELECT {LEDGER_COLS} FROM drama_ledger WHERE drama_id=?1 ORDER BY kind, name"), [&id], LedgerEntry::from_row)?)
}

// ---------- entities & relations ----------

const ENTITY_KINDS: &[&str] = &["character", "scene", "prop", "world"];
const RELATION_KINDS: &[&str] = &["family", "ally", "mentor", "enemy", "love", "belong", "rival", "other"];

fn entity(conn: &Connection, id: &str) -> Result<Entity> {
    one(conn, &format!("SELECT {ENTITY_COLS} FROM drama_entities WHERE id=?1"), id, Entity::from_row, "设定")
}

/// `kind` is the entity's kind after this patch. Only props have an owner.
fn entity_patch(conn: &Connection, drama: &str, self_id: &str, kind: &str, body: &Value) -> Result<Patch> {
    let mut patch = Patch::default();
    let kind = one_of(body.get("kind").and_then(Value::as_str).unwrap_or(kind), ENTITY_KINDS, "kind")?;
    if body.get("kind").is_some() {
        patch.set("kind", Sql::Text(kind.into()));
        if kind != "prop" {
            patch.set("parent_id", Sql::Null);
        }
    }
    patch.text(body, "name", "name", 60, true)?;
    patch.text(body, "description", "description", 4_000, false)?;
    patch.text(body, "appearance", "appearance", 4_000, false)?;
    patch.text(body, "sourceNote", "source_note", 1_000, false)?;
    patch.int(body, "sort", "sort", -1_000_000, 1_000_000)?;
    if let Some(aliases) = body.get("aliases") {
        patch.json("aliases_json", &json!(str_list(aliases, "aliases", 20, 60)?));
    }
    match body.get("parentId") {
        Some(Value::Null) => patch.set("parent_id", Sql::Null),
        Some(Value::String(parent)) => {
            let ok = entity_ids_in(conn, drama)?.iter().any(|(id, kind)| id == parent && (kind == "character" || kind == "scene"));
            if kind != "prop" {
                return Err(bad("只有道具可以设置所属"));
            }
            if !ok || parent == self_id {
                return Err(bad("所属对象必须是本剧的人物或场景"));
            }
            patch.set("parent_id", Sql::Text(parent.clone()));
        }
        _ => {}
    }
    Ok(patch)
}

async fn create_entity(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    project(&conn, &id)?;
    let kind = one_of(body["kind"].as_str().unwrap_or(""), ENTITY_KINDS, "kind")?;
    let name = require(&body, "name", 60)?;
    let entity_id = new_id();
    let mut rest = body.clone();
    rest["rev"] = json!(1);
    // Validate everything before the row exists, so a rejected create leaves nothing behind.
    let patch = entity_patch(&conn, &id, &entity_id, kind, &rest)?;
    let seq: i64 = conn.query_row("SELECT COALESCE(MAX(seq),0)+1 FROM drama_entities WHERE drama_id=?1", [&id], |r| r.get(0)).map_err(db)?;
    let t = now();
    let tx = conn.transaction().map_err(db)?;
    tx.execute(
        "INSERT INTO drama_entities(id,drama_id,seq,kind,name,sort,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?3,?6,?6)",
        params![entity_id, id, seq, kind, name, t],
    )
    .map_err(db)?;
    patch.apply(&tx, "drama_entities", &entity_id, &rest)?;
    touch(&tx, &id)?;
    tx.commit().map_err(db)?;
    ok(entity(&conn, &entity_id)?)
}

async fn update_entity(State(store): Store, Path(eid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let drama = drama_of(&conn, "drama_entities", &eid, "设定")?;
    let kind = entity(&conn, &eid)?.kind;
    entity_patch(&conn, &drama, &eid, &kind, &body)?.apply(&conn, "drama_entities", &eid, &body)?;
    ok(entity(&conn, &eid)?)
}

/// Removes the entity and scrubs it from shot JSON fields that cannot carry a
/// foreign key (prop states and dialogue speakers).
async fn delete_entity(State(store): Store, Path(eid): Path<String>) -> Result<StatusCode> {
    let mut conn = conn(&store)?;
    let drama = drama_of(&conn, "drama_entities", &eid, "设定")?;
    let tx = conn.transaction().map_err(db)?;
    let shots = select(
        &tx,
        "SELECT s.id, s.props_json, s.dialogue_json FROM drama_shots s JOIN drama_episodes e ON e.id=s.episode_id WHERE e.drama_id=?1 AND (s.props_json LIKE ?2 OR s.dialogue_json LIKE ?2)",
        params![drama, format!("%{eid}%")],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    )?;
    for (shot, props, dialogue) in shots {
        let mut props: Vec<Value> = serde_json::from_str(&props).unwrap_or_default();
        props.retain(|p| p["entityId"] != eid.as_str());
        for p in &mut props {
            for key in ["startHolder", "endHolder"] {
                if p[key] == eid.as_str() {
                    p[key] = json!("");
                }
            }
        }
        let mut dialogue: Vec<Value> = serde_json::from_str(&dialogue).unwrap_or_default();
        for line in &mut dialogue {
            if line["speaker"] == eid.as_str() {
                line["speaker"] = json!("");
            }
        }
        tx.execute("UPDATE drama_shots SET props_json=?1, dialogue_json=?2 WHERE id=?3", params![json!(props).to_string(), json!(dialogue).to_string(), shot]).map_err(db)?;
    }
    tx.execute("DELETE FROM drama_entities WHERE id=?1", [&eid]).map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

fn relation(conn: &Connection, id: &str) -> Result<Relation> {
    one(conn, &format!("SELECT {RELATION_COLS} FROM drama_relations WHERE id=?1"), id, Relation::from_row, "关系")
}

fn relation_patch(conn: &Connection, drama: &str, body: &Value) -> Result<Patch> {
    let mut patch = Patch::default();
    let ids = entity_ids_in(conn, drama)?;
    for (key, column) in [("fromId", "from_id"), ("toId", "to_id")] {
        if let Some(id) = body.get(key).and_then(Value::as_str) {
            if !ids.iter().any(|(e, _)| e == id) {
                return Err(bad("关系两端必须是本剧设定"));
            }
            patch.set(column, Sql::Text(id.into()));
        }
    }
    if let Some(kind) = body.get("kind").and_then(Value::as_str) {
        patch.set("kind", Sql::Text(one_of(kind, RELATION_KINDS, "kind")?.into()));
    }
    patch.text(body, "label", "label", 40, false)?;
    patch.text(body, "note", "note", 1_000, false)?;
    Ok(patch)
}

async fn create_relation(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    project(&conn, &id)?;
    let ids = entity_ids_in(&conn, &id)?;
    let (from, to) = (body["fromId"].as_str().unwrap_or(""), body["toId"].as_str().unwrap_or(""));
    if from == to || !ids.iter().any(|(e, _)| e == from) || !ids.iter().any(|(e, _)| e == to) {
        return Err(bad("请选择两个不同的设定"));
    }
    let kind = one_of(body["kind"].as_str().unwrap_or("other"), RELATION_KINDS, "kind")?;
    let relation_id = new_id();
    conn.execute(
        "INSERT INTO drama_relations(id,drama_id,from_id,to_id,kind,label,note) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![relation_id, id, from, to, kind, text_field(&body, "label", 40)?.unwrap_or_default(), text_field(&body, "note", 1_000)?.unwrap_or_default()],
    )
    .map_err(db)?;
    ok(relation(&conn, &relation_id)?)
}

/// Relations carry no rev; the graph editor is their only writer.
async fn update_relation(State(store): Store, Path(rid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let drama = drama_of(&conn, "drama_relations", &rid, "关系")?;
    let patch = relation_patch(&conn, &drama, &body)?;
    let current = relation(&conn, &rid)?;
    if body["fromId"].as_str().unwrap_or(&current.from_id) == body["toId"].as_str().unwrap_or(&current.to_id) {
        return Err(bad("请选择两个不同的设定"));
    }
    if !patch.is_empty() {
        let (sets, values) = patch.into_parts();
        let mut values = values;
        values.push(Sql::Text(rid.clone()));
        conn.execute(&format!("UPDATE drama_relations SET {} WHERE id=?", sets.join(",")), rusqlite::params_from_iter(values)).map_err(db)?;
    }
    ok(relation(&conn, &rid)?)
}

async fn delete_relation(State(store): Store, Path(rid): Path<String>) -> Result<StatusCode> {
    conn(&store)?.execute("DELETE FROM drama_relations WHERE id=?1", [&rid]).map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- episodes & shots ----------

fn episode_row(conn: &Connection, id: &str) -> Result<Episode> {
    one(conn, &format!("SELECT {EPISODE_COLS} FROM drama_episodes WHERE id=?1"), id, Episode::from_row, "分集")
}

fn episode_patch(conn: &Connection, drama: &str, body: &Value) -> Result<Patch> {
    let mut patch = Patch::default();
    patch.text(body, "title", "title", 80, true)?;
    patch.text(body, "outline", "outline", 6_000, false)?;
    patch.text(body, "script", "script", 120_000, false)?;
    patch.int(body, "targetSeconds", "target_seconds", 5, 1_800)?;
    if let Some(ids) = body.get("sourceChapterIds") {
        let known: Vec<String> = select(conn, "SELECT id FROM drama_chapters WHERE drama_id=?1", [drama], |r| r.get(0))?;
        let ids: Vec<String> = str_list(ids, "sourceChapterIds", 200, 64)?.into_iter().filter(|id| known.contains(id)).collect();
        patch.json("source_chapter_ids_json", &json!(ids));
    }
    Ok(patch)
}

async fn create_episode(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    project(&conn, &id)?;
    let title = require(&body, "title", 80)?;
    let mut rest = body.clone();
    rest["rev"] = json!(1);
    let patch = episode_patch(&conn, &id, &rest)?;
    let (seq, ord): (i64, i64) = conn
        .query_row("SELECT COALESCE(MAX(seq),0)+1, COALESCE(MAX(ord),0)+1 FROM drama_episodes WHERE drama_id=?1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(db)?;
    let episode_id = new_id();
    let t = now();
    let tx = conn.transaction().map_err(db)?;
    tx.execute(
        "INSERT INTO drama_episodes(id,drama_id,seq,ord,title,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6)",
        params![episode_id, id, seq, ord, title, t],
    )
    .map_err(db)?;
    patch.apply(&tx, "drama_episodes", &episode_id, &rest)?;
    touch(&tx, &id)?;
    tx.commit().map_err(db)?;
    ok(episode_row(&conn, &episode_id)?)
}

async fn update_episode(State(store): Store, Path(eid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let drama = drama_of(&conn, "drama_episodes", &eid, "分集")?;
    episode_patch(&conn, &drama, &body)?.apply(&conn, "drama_episodes", &eid, &body)?;
    ok(episode_row(&conn, &eid)?)
}

async fn delete_episode(State(store): Store, Path(eid): Path<String>) -> Result<StatusCode> {
    let mut conn = conn(&store)?;
    let (drama, ord): (String, i64) = conn
        .query_row("SELECT drama_id, ord FROM drama_episodes WHERE id=?1", [&eid], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(db)?
        .ok_or_else(|| missing("分集"))?;
    let tx = conn.transaction().map_err(db)?;
    tx.execute("DELETE FROM drama_episodes WHERE id=?1", [&eid]).map_err(db)?;
    tx.execute("UPDATE drama_episodes SET ord=ord-1 WHERE drama_id=?1 AND ord>?2", params![drama, ord]).map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

fn shots_of(conn: &Connection, episode: &str) -> Result<Vec<Shot>> {
    let mut shots = select(conn, &format!("SELECT {SHOT_COLS} FROM drama_shots WHERE episode_id=?1 ORDER BY ord"), [episode], Shot::from_row)?;
    let bindings: Vec<(String, String)> = select(
        conn,
        "SELECT b.shot_id, b.entity_id FROM drama_shot_entities b JOIN drama_shots s ON s.id=b.shot_id WHERE s.episode_id=?1",
        [episode],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    for shot in &mut shots {
        shot.entity_ids = bindings.iter().filter(|(s, _)| *s == shot.id).map(|(_, e)| e.clone()).collect();
    }
    Ok(shots)
}

fn shot(conn: &Connection, id: &str) -> Result<Value> {
    let episode: String = conn.query_row("SELECT episode_id FROM drama_shots WHERE id=?1", [id], |r| r.get(0)).optional().map_err(db)?.ok_or_else(|| missing("镜头"))?;
    let shot = shots_of(conn, &episode)?.into_iter().find(|s| s.id == id).ok_or_else(|| missing("镜头"))?;
    serde_json::to_value(shot).map_err(|e| internal(e.to_string()))
}

async fn episode(State(store): Store, Path(eid): Path<String>) -> Reply {
    let conn = conn(&store)?;
    let episode = episode_row(&conn, &eid)?;
    let shots = shots_of(&conn, &eid)?;
    let artifacts = select(
        &conn,
        &recent_artifacts("shot_id IN (SELECT id FROM drama_shots WHERE episode_id=?1)", "shot_id, kind"),
        [&eid],
        Artifact::from_row,
    )?;
    let exports = select(&conn, &format!("SELECT {EXPORT_COLS} FROM drama_exports WHERE episode_id=?1 ORDER BY created_at DESC"), [&eid], Export::from_row)?;
    let runs = select(&conn, &format!("SELECT {RUN_COLS} FROM drama_runs WHERE episode_id=?1 ORDER BY created_at DESC"), [&eid], Run::from_row)?;
    ok(json!({"episode": episode, "shots": shots, "artifacts": artifacts, "exports": exports, "runs": runs}))
}

fn holder_ok(value: &Value, ids: &[(String, String)]) -> bool {
    value.as_str().is_some_and(|h| h.is_empty() || ids.iter().any(|(id, kind)| id == h && kind == "character"))
}

fn shot_patch(conn: &Connection, drama: &str, body: &Value) -> Result<(Patch, Option<Vec<String>>)> {
    let mut patch = Patch::default();
    patch.int(body, "seconds", "seconds", 1, 15)?;
    patch.text(body, "size", "size", 20, false)?;
    patch.text(body, "camera", "camera", 40, false)?;
    patch.text(body, "description", "description", 2_000, false)?;
    patch.text(body, "narration", "narration", 1_000, false)?;
    patch.text(body, "startState", "start_state", 1_000, false)?;
    patch.text(body, "endState", "end_state", 1_000, false)?;
    patch.text(body, "imagePrompt", "image_prompt", 4_000, false)?;
    patch.text(body, "videoPrompt", "video_prompt", 4_000, false)?;
    if let Some(t) = body.get("transition").and_then(Value::as_str) {
        patch.set("transition", Sql::Text(one_of(t, &["continuous", "cut", "time_jump"], "transition")?.into()));
    }
    let ids = entity_ids_in(conn, drama)?;
    if let Some(lines) = body.get("dialogue") {
        let lines = lines.as_array().filter(|l| l.len() <= 30).ok_or_else(|| bad("对白最多 30 句"))?;
        let mut clean = vec![];
        for line in lines {
            if !holder_ok(&line["speaker"], &ids) {
                return Err(bad("说话人必须是本剧人物"));
            }
            let text = text_field(line, "text", 500)?.unwrap_or_default();
            clean.push(json!({"speaker": line["speaker"], "text": text}));
        }
        patch.json("dialogue_json", &json!(clean));
    }
    if let Some(props) = body.get("props") {
        let props = props.as_array().filter(|p| p.len() <= 40).ok_or_else(|| bad("道具状态最多 40 项"))?;
        let mut clean = vec![];
        for p in props {
            let entity = p["entityId"].as_str().filter(|e| ids.iter().any(|(id, _)| id == e)).ok_or_else(|| bad("道具必须是本剧设定"))?;
            let quantity = p["quantity"].as_i64().filter(|q| (0..=99).contains(q)).ok_or_else(|| bad("道具数量必须在 0 到 99 之间"))?;
            if !holder_ok(&p["startHolder"], &ids) || !holder_ok(&p["endHolder"], &ids) {
                return Err(bad("持有人必须是本剧人物"));
            }
            clean.push(json!({
                "entityId": entity, "quantity": quantity,
                "startVisible": p["startVisible"].as_bool().unwrap_or(true), "endVisible": p["endVisible"].as_bool().unwrap_or(true),
                "startHolder": p["startHolder"], "endHolder": p["endHolder"], "note": text_field(p, "note", 300)?.unwrap_or_default(),
            }));
        }
        patch.json("props_json", &json!(clean));
    }
    let bindings = match body.get("entityIds") {
        Some(list) => {
            let list = str_list(list, "entityIds", 40, 64)?;
            if list.iter().any(|e| !ids.iter().any(|(id, _)| id == e)) {
                return Err(bad("出场设定必须是本剧设定"));
            }
            Some(list)
        }
        None => None,
    };
    Ok((patch, bindings))
}

fn bind(conn: &Connection, shot: &str, ids: &[String]) -> Result<()> {
    conn.execute("DELETE FROM drama_shot_entities WHERE shot_id=?1", [shot]).map_err(db)?;
    for id in ids {
        conn.execute("INSERT OR IGNORE INTO drama_shot_entities(shot_id,entity_id) VALUES(?1,?2)", params![shot, id]).map_err(db)?;
    }
    Ok(())
}

async fn create_shot(State(store): Store, Path(eid): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    drama_of(&conn, "drama_episodes", &eid, "分集")?;
    let last: i64 = conn.query_row("SELECT COALESCE(MAX(ord),0) FROM drama_shots WHERE episode_id=?1", [&eid], |r| r.get(0)).map_err(db)?;
    let ord = body["afterOrd"].as_i64().map(|o| o.clamp(0, last) + 1).unwrap_or(last + 1);
    let id = new_id();
    let t = now();
    let tx = conn.transaction().map_err(db)?;
    tx.execute("UPDATE drama_shots SET ord=ord+1 WHERE episode_id=?1 AND ord>=?2", params![eid, ord]).map_err(db)?;
    tx.execute("INSERT INTO drama_shots(id,episode_id,ord,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)", params![id, eid, ord, t]).map_err(db)?;
    tx.commit().map_err(db)?;
    ok(shot(&conn, &id)?)
}

async fn update_shot(State(store): Store, Path(sid): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    let drama = drama_of(&conn, "drama_shots", &sid, "镜头")?;
    let (patch, bindings) = shot_patch(&conn, &drama, &body)?;
    let tx = conn.transaction().map_err(db)?;
    patch.apply(&tx, "drama_shots", &sid, &body)?;
    if let Some(ids) = bindings {
        bind(&tx, &sid, &ids)?;
    }
    tx.commit().map_err(db)?;
    ok(shot(&conn, &sid)?)
}

async fn delete_shot(State(store): Store, Path(sid): Path<String>) -> Result<StatusCode> {
    let mut conn = conn(&store)?;
    let (episode, ord): (String, i64) = conn
        .query_row("SELECT episode_id, ord FROM drama_shots WHERE id=?1", [&sid], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()
        .map_err(db)?
        .ok_or_else(|| missing("镜头"))?;
    let tx = conn.transaction().map_err(db)?;
    tx.execute("DELETE FROM drama_shots WHERE id=?1", [&sid]).map_err(db)?;
    tx.execute("UPDATE drama_shots SET ord=ord-1 WHERE episode_id=?1 AND ord>?2", params![episode, ord]).map_err(db)?;
    tx.commit().map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn reorder_shots(State(store): Store, Path(eid): Path<String>, Json(body): Json<Value>) -> Reply {
    let mut conn = conn(&store)?;
    drama_of(&conn, "drama_episodes", &eid, "分集")?;
    let ids = str_list(&body["ids"], "ids", 500, 64)?;
    let current: Vec<String> = select(&conn, "SELECT id FROM drama_shots WHERE episode_id=?1", [&eid], |r| r.get(0))?;
    let mut sorted = ids.clone();
    sorted.sort();
    let mut expected = current.clone();
    expected.sort();
    if sorted != expected {
        return Err(conflict("镜头列表已变化，请刷新后再排序"));
    }
    let tx = conn.transaction().map_err(db)?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute("UPDATE drama_shots SET ord=?1 WHERE id=?2", params![i as i64 + 1, id]).map_err(db)?;
    }
    tx.commit().map_err(db)?;
    ok(shots_of(&conn, &eid)?)
}

// ---------- artifacts ----------

fn artifact(conn: &Connection, id: &str) -> Result<Artifact> {
    one(conn, &format!("SELECT {ARTIFACT_COLS} FROM drama_artifacts WHERE id=?1"), id, Artifact::from_row, "生成记录")
}

async fn create_artifact(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let kind = one_of(body["kind"].as_str().unwrap_or(""), &["sheet", "image", "video", "audio"], "kind")?;
    let (entity, shot) = match (body["entityId"].as_str(), body["shotId"].as_str()) {
        (Some(e), None) if kind == "sheet" => {
            if drama_of(&conn, "drama_entities", e, "设定")? != id {
                return Err(bad("设定不属于这个剧目"));
            }
            (Some(e), None)
        }
        (None, Some(s)) if kind != "sheet" => {
            if drama_of(&conn, "drama_shots", s, "镜头")? != id {
                return Err(bad("镜头不属于这个剧目"));
            }
            (None, Some(s))
        }
        _ => return Err(bad("生成记录必须属于一个设定或一个镜头")),
    };
    let artifact_id = new_id();
    let t = now();
    conn.execute(
        "INSERT INTO drama_artifacts(id,drama_id,entity_id,shot_id,kind,status,prompt,model,params_json,input_hash,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'pending',?6,?7,?8,?9,?10,?10)",
        params![
            artifact_id, id, entity, shot, kind,
            text_field(&body, "prompt", 20_000)?.unwrap_or_default(), text_field(&body, "model", 300)?.unwrap_or_default(),
            body.get("params").filter(|p| p.is_object()).cloned().unwrap_or(json!({})).to_string(),
            text_field(&body, "inputHash", 128)?.unwrap_or_default(), t
        ],
    )
    .map_err(db)?;
    ok(artifact(&conn, &artifact_id)?)
}

async fn update_artifact(State(store): Store, Path(aid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let current = artifact(&conn, &aid)?;
    let mut patch = Patch::default();
    if let Some(status) = body.get("status").and_then(Value::as_str) {
        patch.set("status", Sql::Text(one_of(status, &["pending", "ready", "failed"], "status")?.into()));
        if current.adopted && status != "ready" {
            return Err(bad("已采用的结果不能改回未完成"));
        }
        if status == "ready" && (body["mediaKey"].as_str().unwrap_or(&current.media_key).is_empty() || body["mediaUrl"].as_str().unwrap_or(&current.media_url).is_empty()) {
            return Err(bad("完成的生成记录必须带媒体文件"));
        }
    }
    patch.text(&body, "mediaKey", "media_key", 300, false)?;
    patch.text(&body, "mediaUrl", "media_url", 600, false)?;
    patch.text(&body, "mime", "mime", 120, false)?;
    patch.text(&body, "error", "error", 2_000, false)?;
    patch.int(&body, "width", "width", 1, 20_000)?;
    patch.int(&body, "height", "height", 1, 20_000)?;
    patch.int(&body, "durationMs", "duration_ms", 0, 3_600_000)?;
    match body.get("providerTask") {
        Some(Value::Null) => patch.set("provider_task_json", Sql::Null),
        Some(task) if task.is_object() => patch.json("provider_task_json", task),
        Some(_) => return Err(bad("providerTask 无效")),
        None => {}
    }
    if patch.is_empty() {
        return ok(current);
    }
    let (mut sets, mut values) = patch.into_parts();
    sets.push("updated_at=?".into());
    values.push(Sql::Integer(now()));
    values.push(Sql::Text(aid.clone()));
    conn.execute(&format!("UPDATE drama_artifacts SET {} WHERE id=?", sets.join(",")), rusqlite::params_from_iter(values)).map_err(db)?;
    ok(artifact(&conn, &aid)?)
}

async fn adopt_artifact(State(store): Store, Path(aid): Path<String>) -> Reply {
    let mut conn = conn(&store)?;
    let current = artifact(&conn, &aid)?;
    if current.status != "ready" {
        return Err(bad("只能采用已完成的结果"));
    }
    let tx = conn.transaction().map_err(db)?;
    tx.execute(
        "UPDATE drama_artifacts SET adopted=0 WHERE kind=?1 AND ((?2 IS NOT NULL AND entity_id=?2) OR (?3 IS NOT NULL AND shot_id=?3))",
        params![current.kind, current.entity_id, current.shot_id],
    )
    .map_err(db)?;
    tx.execute("UPDATE drama_artifacts SET adopted=1, updated_at=?1 WHERE id=?2", params![now(), aid]).map_err(db)?;
    tx.commit().map_err(db)?;
    ok(artifact(&conn, &aid)?)
}

async fn delete_artifact(State(store): Store, Path(aid): Path<String>) -> Result<StatusCode> {
    conn(&store)?.execute("DELETE FROM drama_artifacts WHERE id=?1", [&aid]).map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- runs ----------

fn run_full(conn: &Connection, id: &str) -> Result<Run> {
    one(conn, &format!("SELECT {RUN_FULL_COLS} FROM drama_runs WHERE id=?1"), id, Run::from_full_row, "任务")
}

async fn create_run(State(store): Store, Path(id): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    project(&conn, &id)?;
    let stage = one_of(body["stage"].as_str().unwrap_or(""), &["chapter", "settings", "episodes", "script", "shots", "review"], "stage")?;
    let episode = body["episodeId"].as_str().filter(|s| !s.is_empty());
    if matches!(stage, "script" | "shots") != episode.is_some() {
        return Err(bad(if episode.is_some() { "这类任务不属于单集" } else { "请先选择分集" }));
    }
    if let Some(episode) = episode {
        if drama_of(&conn, "drama_episodes", episode, "分集")? != id {
            return Err(bad("分集不属于这个剧目"));
        }
    }
    let scope = body.get("scope").filter(|s| s.is_object()).cloned().unwrap_or(json!({}));
    if stage == "chapter" && !scope["ord"].as_i64().is_some_and(|o| o >= 1) {
        return Err(bad("请指定要写的章节"));
    }
    let busy: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM drama_runs WHERE drama_id=?1 AND stage=?2 AND status='running' AND COALESCE(episode_id,'')=?3 AND scope_json=?4)",
            params![id, stage, episode.unwrap_or(""), scope.to_string()],
            |r| r.get(0),
        )
        .map_err(db)?;
    if busy {
        return Err(conflict("这项任务正在进行，请等待完成或先停止"));
    }
    let parent = body["parentId"].as_str().filter(|p| !p.is_empty());
    if let Some(parent) = parent {
        if drama_of(&conn, "drama_runs", parent, "任务")? != id {
            return Err(bad("修订来源无效"));
        }
    }
    let run_id = new_id();
    conn.execute(
        "INSERT INTO drama_runs(id,drama_id,episode_id,stage,scope_json,instruction,model,status,parent_id,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'running',?8,?9)",
        params![
            run_id, id, episode, stage, scope.to_string(), text_field(&body, "instruction", 8_000)?.unwrap_or_default(),
            text_field(&body, "model", 300)?.unwrap_or_default(), parent, now()
        ],
    )
    .map_err(db)?;
    ok(run_full(&conn, &run_id)?)
}

async fn get_run(State(store): Store, Path(rid): Path<String>) -> Reply {
    let conn = conn(&store)?;
    ok(run_full(&conn, &rid)?)
}

async fn update_run(State(store): Store, Path(rid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let (_, status) = run_info(&conn, &rid)?;
    if let Some(output) = text_field(&body, "output", 400_000)? {
        conn.execute("UPDATE drama_runs SET output=?1 WHERE id=?2", params![output, rid]).map_err(db)?;
    }
    if let Some(next) = body.get("status").and_then(Value::as_str) {
        let next = one_of(next, &["failed", "stopped"], "status")?;
        if status != "running" {
            return Err(conflict("任务已结束"));
        }
        conn.execute(
            "UPDATE drama_runs SET status=?1, error=?2, finished_at=?3 WHERE id=?4",
            params![next, text_field(&body, "error", 2_000)?.unwrap_or_default(), now(), rid],
        )
        .map_err(db)?;
    }
    ok(run_full(&conn, &rid)?)
}

async fn submit_proposal(State(store): Store, Path(rid): Path<String>, Json(body): Json<Value>) -> Reply {
    let conn = conn(&store)?;
    let (info, status) = run_info(&conn, &rid)?;
    if status != "running" {
        return Err(conflict("任务已结束，不能再提交结果"));
    }
    let normalized = proposal::check(&conn, &info, body.get("proposal").unwrap_or(&Value::Null))?;
    // A review is a report, not something to adopt: it is finished on arrival.
    let status = if info.stage == "review" { "accepted" } else { "review" };
    conn.execute(
        "UPDATE drama_runs SET proposal_json=?1, status=?2, finished_at=?3 WHERE id=?4",
        params![normalized.to_string(), status, now(), rid],
    )
    .map_err(db)?;
    ok(run_full(&conn, &rid)?)
}

async fn adopt_run(State(store): Store, Path(rid): Path<String>) -> Reply {
    let mut conn = conn(&store)?;
    let (info, status) = run_info(&conn, &rid)?;
    if status != "review" {
        return Err(conflict("只有待确认的结果可以采用"));
    }
    let proposal: Value = conn
        .query_row("SELECT proposal_json FROM drama_runs WHERE id=?1", [&rid], |r| r.get::<_, Option<String>>(0))
        .map_err(db)?
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or_else(|| bad("任务没有可采用的结果"))?;
    let tx = conn.transaction().map_err(db)?;
    proposal::adopt(&tx, &rid, &info, &proposal)?;
    tx.execute("UPDATE drama_runs SET status='accepted' WHERE id=?1", [&rid]).map_err(db)?;
    tx.execute(
        "UPDATE drama_runs SET status='rejected' WHERE drama_id=?1 AND stage=?2 AND status='review' AND COALESCE(episode_id,'')=?3 AND scope_json=?4 AND id<>?5",
        params![info.drama_id, info.stage, info.episode_id.clone().unwrap_or_default(), info.scope.to_string(), rid],
    )
    .map_err(db)?;
    touch(&tx, &info.drama_id)?;
    tx.commit().map_err(db)?;
    ok(run_full(&conn, &rid)?)
}

async fn reject_run(State(store): Store, Path(rid): Path<String>) -> Reply {
    let conn = conn(&store)?;
    let (_, status) = run_info(&conn, &rid)?;
    if status != "review" {
        return Err(conflict("只有待确认的结果可以放弃"));
    }
    conn.execute("UPDATE drama_runs SET status='rejected' WHERE id=?1", [&rid]).map_err(db)?;
    ok(run_full(&conn, &rid)?)
}

async fn delete_run(State(store): Store, Path(rid): Path<String>) -> Result<StatusCode> {
    let conn = conn(&store)?;
    let (_, status) = run_info(&conn, &rid)?;
    if status == "running" {
        return Err(conflict("请先停止任务再删除"));
    }
    conn.execute("DELETE FROM drama_runs WHERE id=?1", [&rid]).map_err(db)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every media key the drama tables reference, so global media cleanup keeps them.
async fn media_keys(State(store): Store) -> Reply {
    let conn = conn(&store)?;
    let keys: Vec<String> = select(
        &conn,
        "SELECT media_key FROM drama_artifacts WHERE media_key<>''
         UNION SELECT media_key FROM drama_exports WHERE media_key<>''
         UNION SELECT srt_key FROM drama_exports WHERE srt_key<>''
         UNION SELECT json_extract(options_json,'$.musicKey') FROM drama_exports WHERE json_extract(options_json,'$.musicKey') IS NOT NULL
         UNION SELECT json_extract(cover_json,'$.mediaKey') FROM drama_projects WHERE json_extract(cover_json,'$.mediaKey') IS NOT NULL",
        [],
        |r| r.get(0),
    )?;
    ok(keys)
}
