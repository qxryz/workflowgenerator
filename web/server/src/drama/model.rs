//! Row types. Serialized names match `web/src/lib/drama/types.ts`.
use rusqlite::{Connection, Row};
use serde::Serialize;
use serde_json::Value;

use super::{db, Result};

fn json_col(row: &Row, index: usize) -> rusqlite::Result<Value> {
    let raw: Option<String> = row.get(index)?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null))
}

fn list_col(row: &Row, index: usize) -> rusqlite::Result<Value> {
    Ok(match json_col(row, index)? {
        Value::Null => Value::Array(vec![]),
        value => value,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub source_type: String,
    pub brief: String,
    pub aspect: String,
    pub style: Value,
    pub palette: Value,
    pub cover: Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub rev: i64,
}
pub const PROJECT_COLS: &str = "id,title,source_type,brief,aspect,style_json,palette_json,cover_json,created_at,updated_at,rev";
impl Project {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            title: r.get(1)?,
            source_type: r.get(2)?,
            brief: r.get(3)?,
            aspect: r.get(4)?,
            style: json_col(r, 5)?,
            palette: json_col(r, 6)?,
            cover: json_col(r, 7)?,
            created_at: r.get(8)?,
            updated_at: r.get(9)?,
            rev: r.get(10)?,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub label: String,
    pub ord: i64,
    pub title: String,
    pub body: String,
    pub summary: String,
    pub end_state: String,
    pub origin: String,
    pub run_id: Option<String>,
    pub updated_at: i64,
    pub rev: i64,
}
pub const CHAPTER_COLS: &str = "id,ord,title,body,summary,end_state,origin,run_id,updated_at,rev";
impl Chapter {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        let ord: i64 = r.get(1)?;
        Ok(Self {
            id: r.get(0)?,
            label: format!("C{ord}"),
            ord,
            title: r.get(2)?,
            body: r.get(3)?,
            summary: r.get(4)?,
            end_state: r.get(5)?,
            origin: r.get(6)?,
            run_id: r.get(7)?,
            updated_at: r.get(8)?,
            rev: r.get(9)?,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub note: String,
    pub chapter_ords: Value,
    pub status: String,
}
pub const LEDGER_COLS: &str = "id,kind,name,note,chapter_ords_json,status";
impl LedgerEntry {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self { id: r.get(0)?, kind: r.get(1)?, name: r.get(2)?, note: r.get(3)?, chapter_ords: list_col(r, 4)?, status: r.get(5)? })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub name: String,
    pub aliases: Value,
    pub description: String,
    pub appearance: String,
    pub parent_id: Option<String>,
    pub sort: i64,
    pub source_note: String,
    pub run_id: Option<String>,
    pub updated_at: i64,
    pub rev: i64,
}
pub const ENTITY_COLS: &str = "id,seq,kind,name,aliases_json,description,appearance,parent_id,sort,source_note,run_id,updated_at,rev";
impl Entity {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        let seq: i64 = r.get(1)?;
        Ok(Self {
            id: r.get(0)?,
            label: format!("E{seq}"),
            kind: r.get(2)?,
            name: r.get(3)?,
            aliases: list_col(r, 4)?,
            description: r.get(5)?,
            appearance: r.get(6)?,
            parent_id: r.get(7)?,
            sort: r.get(8)?,
            source_note: r.get(9)?,
            run_id: r.get(10)?,
            updated_at: r.get(11)?,
            rev: r.get(12)?,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub kind: String,
    pub label: String,
    pub note: String,
}
pub const RELATION_COLS: &str = "id,from_id,to_id,kind,label,note";
impl Relation {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self { id: r.get(0)?, from_id: r.get(1)?, to_id: r.get(2)?, kind: r.get(3)?, label: r.get(4)?, note: r.get(5)? })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeProgress {
    pub shots: i64,
    pub images: i64,
    pub videos: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: String,
    pub label: String,
    pub ord: i64,
    pub title: String,
    pub outline: String,
    pub target_seconds: i64,
    pub source_chapter_ids: Value,
    pub script: String,
    pub updated_at: i64,
    pub rev: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<EpisodeProgress>,
}
pub const EPISODE_COLS: &str = "id,seq,ord,title,outline,target_seconds,source_chapter_ids_json,script,updated_at,rev";
impl Episode {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        let seq: i64 = r.get(1)?;
        Ok(Self {
            id: r.get(0)?,
            label: format!("P{seq}"),
            ord: r.get(2)?,
            title: r.get(3)?,
            outline: r.get(4)?,
            target_seconds: r.get(5)?,
            source_chapter_ids: list_col(r, 6)?,
            script: r.get(7)?,
            updated_at: r.get(8)?,
            rev: r.get(9)?,
            progress: None,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub id: String,
    pub ord: i64,
    pub seconds: i64,
    pub size: String,
    pub camera: String,
    pub description: String,
    pub dialogue: Value,
    pub narration: String,
    pub transition: String,
    pub start_state: String,
    pub end_state: String,
    pub props: Value,
    pub image_prompt: String,
    pub video_prompt: String,
    pub entity_ids: Vec<String>,
    pub updated_at: i64,
    pub rev: i64,
}
pub const SHOT_COLS: &str = "id,ord,seconds,size,camera,description,dialogue_json,narration,transition,start_state,end_state,props_json,image_prompt,video_prompt,updated_at,rev";
impl Shot {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            ord: r.get(1)?,
            seconds: r.get(2)?,
            size: r.get(3)?,
            camera: r.get(4)?,
            description: r.get(5)?,
            dialogue: list_col(r, 6)?,
            narration: r.get(7)?,
            transition: r.get(8)?,
            start_state: r.get(9)?,
            end_state: r.get(10)?,
            props: list_col(r, 11)?,
            image_prompt: r.get(12)?,
            video_prompt: r.get(13)?,
            entity_ids: vec![],
            updated_at: r.get(14)?,
            rev: r.get(15)?,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub entity_id: Option<String>,
    pub shot_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub media_key: String,
    pub media_url: String,
    pub mime: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub prompt: String,
    pub model: String,
    pub params: Value,
    pub input_hash: String,
    pub provider_task: Value,
    pub error: String,
    pub adopted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
pub const ARTIFACT_COLS: &str = "id,entity_id,shot_id,kind,status,media_key,media_url,mime,width,height,duration_ms,prompt,model,params_json,input_hash,provider_task_json,error,adopted,created_at,updated_at";
impl Artifact {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            entity_id: r.get(1)?,
            shot_id: r.get(2)?,
            kind: r.get(3)?,
            status: r.get(4)?,
            media_key: r.get(5)?,
            media_url: r.get(6)?,
            mime: r.get(7)?,
            width: r.get(8)?,
            height: r.get(9)?,
            duration_ms: r.get(10)?,
            prompt: r.get(11)?,
            model: r.get(12)?,
            params: match json_col(r, 13)? {
                Value::Null => Value::Object(Default::default()),
                value => value,
            },
            input_hash: r.get(14)?,
            provider_task: json_col(r, 15)?,
            error: r.get(16)?,
            adopted: r.get::<_, i64>(17)? != 0,
            created_at: r.get(18)?,
            updated_at: r.get(19)?,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub episode_id: Option<String>,
    pub stage: String,
    pub scope: Value,
    pub instruction: String,
    pub model: String,
    pub status: String,
    pub parent_id: Option<String>,
    pub error: String,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal: Option<Value>,
}
pub const RUN_COLS: &str = "id,episode_id,stage,scope_json,instruction,model,status,parent_id,error,created_at,finished_at";
pub const RUN_FULL_COLS: &str = "id,episode_id,stage,scope_json,instruction,model,status,parent_id,error,created_at,finished_at,output,proposal_json";
impl Run {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            episode_id: r.get(1)?,
            stage: r.get(2)?,
            scope: json_col(r, 3)?,
            instruction: r.get(4)?,
            model: r.get(5)?,
            status: r.get(6)?,
            parent_id: r.get(7)?,
            error: r.get(8)?,
            created_at: r.get(9)?,
            finished_at: r.get(10)?,
            output: None,
            proposal: None,
        })
    }
    pub fn from_full_row(r: &Row) -> rusqlite::Result<Self> {
        let mut run = Self::from_row(r)?;
        run.output = Some(r.get(11)?);
        run.proposal = Some(json_col(r, 12)?);
        Ok(run)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Export {
    pub id: String,
    pub status: String,
    pub options: Value,
    pub media_key: String,
    pub media_url: String,
    pub srt_key: String,
    pub error: String,
    pub created_at: i64,
    pub finished_at: Option<i64>,
}
pub const EXPORT_COLS: &str = "id,status,options_json,media_key,media_url,srt_key,error,created_at,finished_at";
impl Export {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: r.get(0)?,
            status: r.get(1)?,
            options: json_col(r, 2)?,
            media_key: r.get(3)?,
            media_url: r.get(4)?,
            srt_key: r.get(5)?,
            error: r.get(6)?,
            created_at: r.get(7)?,
            finished_at: r.get(8)?,
        })
    }
}

/// `SELECT {cols} FROM {table} WHERE {filter}` mapped through `map`.
pub fn select<T>(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
    map: fn(&Row) -> rusqlite::Result<T>,
) -> Result<Vec<T>> {
    let mut statement = conn.prepare(sql).map_err(db)?;
    let rows = statement.query_map(params, map).map_err(db)?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db)
}
