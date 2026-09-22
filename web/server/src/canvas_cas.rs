//! Canvas snapshots are compared and written under one SQLite transaction.
use crate::{
    state::AppState,
    storage::{decode_store_value, encode_store_value, NativeStorage},
};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

const PROJECTS: &str = "canvas-project-v1";
const META: &str = "canvas-project-meta-v1";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    id: String,
    expected: Option<String>,
    value: Option<String>,
}
#[derive(Deserialize)]
struct Commit {
    changes: Vec<Change>,
}
#[derive(Serialize)]
struct ProjectValue {
    id: String,
    value: Option<String>,
}
#[derive(Serialize)]
struct ResultBody {
    projects: Vec<ProjectValue>,
    ids: Vec<String>,
}

pub fn protected_namespace(namespace: &str) -> bool {
    matches!(namespace, PROJECTS | META)
}
pub fn router() -> Router<AppState> {
    Router::new().route(
        "/api/canvas/commit",
        post(commit).layer(DefaultBodyLimit::max(32 * 1024 * 1024)),
    )
}

async fn commit(State(state): State<AppState>, Json(request): Json<Commit>) -> Response {
    match commit_projects(&state.storage, request.changes) {
        Ok(Ok(result)) => Json(result).into_response(),
        Ok(Err(result)) => (StatusCode::CONFLICT, Json(result)).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
    }
}

fn read(
    connection: &rusqlite::Connection,
    namespace: &str,
    key: &str,
) -> Result<Option<String>, String> {
    let row: Option<(Vec<u8>, String)> = connection
        .query_row(
            "SELECT value, encoding FROM kv_store WHERE namespace=?1 AND key=?2",
            params![namespace, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    row.map(|(value, encoding)| decode_store_value(value, &encoding))
        .transpose()
}
fn write(
    connection: &rusqlite::Connection,
    namespace: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let (encoded, encoding) = encode_store_value(value.as_bytes())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    connection.execute("INSERT INTO kv_store(namespace,key,value,encoding,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,encoding=excluded.encoding,updated_at=excluded.updated_at", params![namespace,key,encoded,encoding,now]).map_err(|error| error.to_string())?;
    Ok(())
}

fn commit_projects(
    storage: &NativeStorage,
    changes: Vec<Change>,
) -> Result<Result<ResultBody, ResultBody>, String> {
    let mut seen = HashSet::new();
    for change in &changes {
        if change.id.is_empty() || change.id.len() > 256 || !seen.insert(change.id.clone()) {
            return Err("画布标识无效或重复".into());
        }
        if let Some(value) = &change.value {
            let project: serde_json::Value =
                serde_json::from_str(value).map_err(|_| "画布内容无效")?;
            if project.get("id").and_then(serde_json::Value::as_str) != Some(change.id.as_str())
                || !project
                    .get("nodes")
                    .is_some_and(serde_json::Value::is_array)
            {
                return Err("画布内容与标识不一致".into());
            }
        }
    }
    let mut connection = storage.lock()?;
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut ids: Vec<String> = read(&transaction, META, "projects")?
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default();
    let current = changes
        .iter()
        .map(|change| {
            Ok(ProjectValue {
                id: change.id.clone(),
                value: read(&transaction, PROJECTS, &change.id)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    if changes
        .iter()
        .zip(&current)
        .any(|(change, current)| change.expected != current.value)
    {
        return Ok(Err(ResultBody {
            projects: current,
            ids,
        }));
    }
    for change in &changes {
        if let Some(value) = &change.value {
            write(&transaction, PROJECTS, &change.id, value)?;
            if !ids.contains(&change.id) {
                ids.insert(0, change.id.clone());
            }
        } else {
            let plans_exist: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='zodiac_plans')", [], |row| row.get(0)).map_err(|error| error.to_string())?;
            if plans_exist {
                let requests_exist: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='zodiac_plan_requests')", [], |row| row.get(0)).map_err(|error| error.to_string())?;
                if requests_exist {
                    transaction.execute("DELETE FROM zodiac_plan_requests WHERE plan_id IN (SELECT id FROM zodiac_plans WHERE project_id=?1)", [&change.id]).map_err(|error| error.to_string())?;
                }
                transaction
                    .execute("DELETE FROM zodiac_plans WHERE project_id=?1", [&change.id])
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "DELETE FROM kv_store WHERE namespace=?1 AND key=?2",
                    params![PROJECTS, change.id],
                )
                .map_err(|error| error.to_string())?;
            ids.retain(|id| id != &change.id);
        }
    }
    write(
        &transaction,
        META,
        "projects",
        &serde_json::to_string(&ids).map_err(|error| error.to_string())?,
    )?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(Ok(ResultBody {
        projects: changes
            .into_iter()
            .map(|change| ProjectValue {
                id: change.id,
                value: change.value,
            })
            .collect(),
        ids,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value(id: &str, text: &str) -> String {
        serde_json::json!({"id":id,"nodes":[{"id":"n","metadata":{"content":text}}]}).to_string()
    }
    fn change(id: &str, expected: Option<String>, value: Option<String>) -> Change {
        Change {
            id: id.into(),
            expected,
            value,
        }
    }
    #[test]
    fn stale_tab_cannot_replace_new_text_or_partially_commit() {
        let directory = tempfile::tempdir().unwrap();
        let storage = crate::storage::initialize(directory.path()).unwrap();
        let old = value("a", "old");
        let fresh = value("a", "new");
        assert!(
            commit_projects(&storage, vec![change("a", None, Some(old.clone()))])
                .unwrap()
                .is_ok()
        );
        assert!(commit_projects(
            &storage,
            vec![change("a", Some(old.clone()), Some(fresh.clone()))]
        )
        .unwrap()
        .is_ok());
        assert!(commit_projects(
            &storage,
            vec![
                change("a", Some(old), Some(value("a", "stale overwrite"))),
                change("b", None, Some(value("b", "must not exist")))
            ]
        )
        .unwrap()
        .is_err());
        let connection = storage.lock().unwrap();
        assert_eq!(read(&connection, PROJECTS, "a").unwrap(), Some(fresh));
        assert_eq!(read(&connection, PROJECTS, "b").unwrap(), None);
    }
    #[test]
    fn separate_tabs_additions_preserve_index_and_deletions_compare() {
        let directory = tempfile::tempdir().unwrap();
        let storage = crate::storage::initialize(directory.path()).unwrap();
        for id in ["a", "b"] {
            assert!(
                commit_projects(&storage, vec![change(id, None, Some(value(id, id)))])
                    .unwrap()
                    .is_ok()
            );
        }
        assert!(commit_projects(&storage, vec![change("a", None, None)])
            .unwrap()
            .is_err());
        assert!(
            commit_projects(&storage, vec![change("a", Some(value("a", "a")), None)])
                .unwrap()
                .is_ok()
        );
        let connection = storage.lock().unwrap();
        assert_eq!(
            read(&connection, META, "projects").unwrap(),
            Some("[\"b\"]".into())
        );
    }

    #[test]
    fn plans_are_removed_only_with_a_successful_project_delete() {
        let directory = tempfile::tempdir().unwrap();
        let storage = crate::storage::initialize(directory.path()).unwrap();
        assert!(
            commit_projects(&storage, vec![change("a", None, Some(value("a", "new")))])
                .unwrap()
                .is_ok()
        );
        {
            let connection = storage.lock().unwrap();
            connection.execute_batch("CREATE TABLE zodiac_plans (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, body TEXT NOT NULL); CREATE TABLE zodiac_plan_requests (plan_id TEXT NOT NULL, request_id TEXT NOT NULL); INSERT INTO zodiac_plans VALUES('plan-a','a','{}'); INSERT INTO zodiac_plan_requests VALUES('plan-a','r');").unwrap();
        }
        assert!(
            commit_projects(&storage, vec![change("a", Some(value("a", "old")), None)])
                .unwrap()
                .is_err()
        );
        assert_eq!(
            storage
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM zodiac_plans", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert!(
            commit_projects(&storage, vec![change("a", Some(value("a", "new")), None)])
                .unwrap()
                .is_ok()
        );
        let connection = storage.lock().unwrap();
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM zodiac_plans", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM zodiac_plan_requests", [], |row| row
                    .get::<_, i64>(
                    0
                ))
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn generic_store_routes_cannot_bypass_canvas_comparison() {
        use crate::storage;
        let directory = tempfile::tempdir().unwrap();
        let storage = std::sync::Arc::new(storage::initialize(directory.path()).unwrap());
        let original = value("a", "protected");
        assert!(
            commit_projects(&storage, vec![change("a", None, Some(original.clone()))])
                .unwrap()
                .is_ok()
        );
        assert!(storage::native_store_set(
            State(storage.clone()),
            PROJECTS.into(),
            "a".into(),
            value("a", "overwrite")
        )
        .await
        .is_err());
        assert!(
            storage::native_store_remove(State(storage.clone()), PROJECTS.into(), "a".into())
                .await
                .is_err()
        );
        assert!(
            storage::native_store_clear(State(storage.clone()), PROJECTS.into())
                .await
                .is_err()
        );
        let changes = serde_json::from_value(
            serde_json::json!([{ "namespace":PROJECTS,"key":"a","value":null }]),
        )
        .unwrap();
        assert!(storage::native_store_batch(State(storage.clone()), changes)
            .await
            .is_err());
        assert_eq!(
            read(&storage.lock().unwrap(), PROJECTS, "a").unwrap(),
            Some(original)
        );
    }
}
