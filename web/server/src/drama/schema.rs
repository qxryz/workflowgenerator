//! Drama tables. Ownership is declared with foreign keys so deleting a drama,
//! episode, shot or entity cascades in SQLite instead of in hand-written code.
use rusqlite::Connection;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS drama_projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('original','novel','script')),
    brief TEXT NOT NULL DEFAULT '',
    aspect TEXT NOT NULL CHECK (aspect IN ('16:9','9:16','1:1')),
    style_json TEXT,
    palette_json TEXT,
    cover_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS drama_runs (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    episode_id TEXT REFERENCES drama_episodes(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN ('chapter','settings','episodes','script','shots','review')),
    scope_json TEXT NOT NULL DEFAULT '{}',
    instruction TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('running','review','accepted','rejected','failed','stopped')),
    parent_id TEXT REFERENCES drama_runs(id) ON DELETE SET NULL,
    output TEXT NOT NULL DEFAULT '',
    proposal_json TEXT,
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS drama_runs_drama ON drama_runs(drama_id, created_at);
CREATE TABLE IF NOT EXISTS drama_chapters (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    end_state TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL CHECK (origin IN ('imported','written','manual')),
    run_id TEXT REFERENCES drama_runs(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    UNIQUE (drama_id, ord)
);
CREATE TABLE IF NOT EXISTS drama_ledger (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('character','place','item','world','thread')),
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    chapter_ords_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drama_ledger_drama ON drama_ledger(drama_id);
CREATE TABLE IF NOT EXISTS drama_entities (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('character','scene','prop','world')),
    name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    appearance TEXT NOT NULL DEFAULT '',
    parent_id TEXT REFERENCES drama_entities(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    source_note TEXT NOT NULL DEFAULT '',
    run_id TEXT REFERENCES drama_runs(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    UNIQUE (drama_id, seq)
);
CREATE TABLE IF NOT EXISTS drama_relations (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    from_id TEXT NOT NULL REFERENCES drama_entities(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES drama_entities(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('family','ally','mentor','enemy','love','belong','rival','other')),
    label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    run_id TEXT REFERENCES drama_runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS drama_relations_drama ON drama_relations(drama_id);
CREATE TABLE IF NOT EXISTS drama_episodes (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    ord INTEGER NOT NULL,
    title TEXT NOT NULL,
    outline TEXT NOT NULL DEFAULT '',
    target_seconds INTEGER NOT NULL DEFAULT 60,
    source_chapter_ids_json TEXT NOT NULL DEFAULT '[]',
    script TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    UNIQUE (drama_id, seq)
);
CREATE INDEX IF NOT EXISTS drama_episodes_drama ON drama_episodes(drama_id, ord);
CREATE TABLE IF NOT EXISTS drama_shots (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES drama_episodes(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 5,
    size TEXT NOT NULL DEFAULT '',
    camera TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    dialogue_json TEXT NOT NULL DEFAULT '[]',
    narration TEXT NOT NULL DEFAULT '',
    transition TEXT NOT NULL DEFAULT 'cut' CHECK (transition IN ('continuous','cut','time_jump')),
    start_state TEXT NOT NULL DEFAULT '',
    end_state TEXT NOT NULL DEFAULT '',
    props_json TEXT NOT NULL DEFAULT '[]',
    image_prompt TEXT NOT NULL DEFAULT '',
    video_prompt TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS drama_shots_episode ON drama_shots(episode_id, ord);
CREATE TABLE IF NOT EXISTS drama_shot_entities (
    shot_id TEXT NOT NULL REFERENCES drama_shots(id) ON DELETE CASCADE,
    entity_id TEXT NOT NULL REFERENCES drama_entities(id) ON DELETE CASCADE,
    PRIMARY KEY (shot_id, entity_id)
);
CREATE TABLE IF NOT EXISTS drama_artifacts (
    id TEXT PRIMARY KEY,
    drama_id TEXT NOT NULL REFERENCES drama_projects(id) ON DELETE CASCADE,
    entity_id TEXT REFERENCES drama_entities(id) ON DELETE CASCADE,
    shot_id TEXT REFERENCES drama_shots(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('sheet','image','video','audio')),
    status TEXT NOT NULL CHECK (status IN ('pending','ready','failed')),
    media_key TEXT NOT NULL DEFAULT '',
    media_url TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    params_json TEXT NOT NULL DEFAULT '{}',
    input_hash TEXT NOT NULL DEFAULT '',
    provider_task_json TEXT,
    error TEXT NOT NULL DEFAULT '',
    adopted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK ((entity_id IS NULL) <> (shot_id IS NULL))
);
CREATE INDEX IF NOT EXISTS drama_artifacts_entity ON drama_artifacts(entity_id);
CREATE INDEX IF NOT EXISTS drama_artifacts_shot ON drama_artifacts(shot_id);
CREATE TABLE IF NOT EXISTS drama_exports (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL REFERENCES drama_episodes(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('queued','encoding','ready','failed','cancelled')),
    options_json TEXT NOT NULL DEFAULT '{}',
    media_key TEXT NOT NULL DEFAULT '',
    media_url TEXT NOT NULL DEFAULT '',
    srt_key TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS drama_exports_episode ON drama_exports(episode_id);
";

/// Creates the tables and settles work the previous process could not finish.
/// Video artifacts that carry a provider task id stay pending so the client can
/// resume polling instead of paying for a second generation.
pub(crate) fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.execute_batch(SCHEMA)?;
    let now = super::now();
    conn.execute(
        "UPDATE drama_runs SET status='failed', error='应用关闭，任务已中断', finished_at=?1 WHERE status='running'",
        [now],
    )?;
    conn.execute(
        "UPDATE drama_artifacts SET status='failed', error='应用关闭，生成已中断', updated_at=?1 WHERE status='pending' AND provider_task_json IS NULL",
        [now],
    )?;
    conn.execute(
        "UPDATE drama_exports SET status='failed', error='应用关闭，导出已中断', finished_at=?1 WHERE status IN ('queued','encoding')",
        [now],
    )?;
    Ok(())
}
