//! Model proposals: one checker per stage that both validates and resolves
//! references, so submit and adopt share exactly the same rules.
//!
//! Checks are lenient where meaning is unambiguous (Chinese synonyms for enums,
//! numbers given as strings, names instead of labels) and strict where a guess
//! would corrupt data. Every issue is phrased so a model can fix it.
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

use super::{bad, db, new_id, now, rejected, Issue, Result};

#[derive(Default)]
struct Issues(Vec<Issue>);
impl Issues {
    fn push(&mut self, path: impl Into<String>, message: impl Into<String>) {
        if self.0.len() < 40 {
            self.0.push(Issue { path: path.into(), message: message.into() });
        }
    }
    fn finish<T>(self, value: T) -> Result<T> {
        if self.0.is_empty() {
            Ok(value)
        } else {
            Err(rejected(self.0))
        }
    }
}

fn plain(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_owned(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Required text: empty or too long is an issue.
fn need(issues: &mut Issues, item: &Value, key: &str, path: &str, label: &str, max: usize) -> String {
    let value = plain(item.get(key));
    if value.is_empty() {
        issues.push(format!("{path}.{key}"), format!("{label}不能为空"));
    } else if value.chars().count() > max {
        issues.push(format!("{path}.{key}"), format!("{label}超过 {max} 字，请精简"));
    }
    value
}

fn opt(issues: &mut Issues, item: &Value, key: &str, path: &str, label: &str, max: usize) -> String {
    let value = plain(item.get(key));
    if value.chars().count() > max {
        issues.push(format!("{path}.{key}"), format!("{label}超过 {max} 字，请精简"));
    }
    value
}

fn number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(n)) => n.as_f64(),
        Some(Value::String(s)) => s.trim().trim_end_matches(['秒', 's']).trim().parse().ok(),
        _ => None,
    }
}

fn boolean(value: Option<&Value>, default: bool) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => match s.trim() {
            "true" | "是" | "可见" | "显示" | "出现" => true,
            "false" | "否" | "不可见" | "隐藏" | "不出现" => false,
            _ => default,
        },
        _ => default,
    }
}

fn list<'a>(issues: &mut Issues, value: &'a Value, key: &str, label: &str, min: usize, max: usize) -> &'a [Value] {
    match value.get(key) {
        Some(Value::Array(items)) => {
            if items.len() < min {
                issues.push(key, format!("{label}至少需要 {min} 项"));
            } else if items.len() > max {
                issues.push(key, format!("{label}最多 {max} 项，请合并或删减"));
            }
            items
        }
        None | Some(Value::Null) if min == 0 => &[],
        _ => {
            issues.push(key, format!("{key} 必须是数组"));
            &[]
        }
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().map(|v| plain(Some(v))).filter(|s| !s.is_empty()).collect(),
        Some(Value::String(s)) => s.split(['、', ',', '，', '/', ';', '；']).map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect(),
        _ => vec![],
    }
}

type Synonyms = &'static [(&'static str, &'static [&'static str])];

fn canonical(value: &str, table: Synonyms) -> Option<&'static str> {
    let key = value.trim().to_lowercase();
    table.iter().find(|(name, synonyms)| *name == key || synonyms.contains(&key.as_str())).map(|(name, _)| *name)
}

const ENTITY_KINDS: Synonyms = &[
    ("character", &["人物", "角色", "人", "主角", "配角", "person", "people"]),
    ("scene", &["场景", "地点", "地方", "场所", "location", "place"]),
    ("prop", &["道具", "陈设", "装备", "物品", "物件", "器物", "道具陈设", "item", "object"]),
    ("world", &["世界观", "阵营", "组织", "势力", "设定", "规则", "背景", "faction", "lore"]),
];
const RELATION_KINDS: Synonyms = &[
    ("family", &["亲属", "家人", "亲人", "家庭", "血缘", "亲缘", "夫妻", "父子", "母女", "兄弟", "姐妹"]),
    ("ally", &["盟友", "朋友", "同伴", "伙伴", "友人", "同盟", "友情", "friend"]),
    ("mentor", &["师徒", "师承", "导师", "师生", "师父", "teacher"]),
    ("enemy", &["敌对", "仇敌", "敌人", "仇人", "对立"]),
    ("love", &["恋人", "爱慕", "情感", "暗恋", "爱情", "恋爱", "情侣", "romance"]),
    ("belong", &["归属", "隶属", "成员", "所属", "从属", "member"]),
    ("rival", &["竞争", "对手", "竞争者", "宿敌", "competitor"]),
    ("other", &["其他", "其它"]),
];
const LEDGER_KINDS: Synonyms = &[
    ("character", &["人物", "角色"]),
    ("place", &["地点", "场景", "地方", "scene", "location"]),
    ("item", &["物件", "道具", "物品", "prop", "object"]),
    ("world", &["世界观", "设定", "规则", "阵营"]),
    ("thread", &["伏笔", "线索", "悬念", "foreshadowing", "clue"]),
];
const LEDGER_OPS: Synonyms = &[("add", &["新增", "添加", "new"]), ("update", &["更新", "修改"]), ("resolve", &["回收", "解决", "完成", "resolved"])];
const TRANSITIONS: Synonyms = &[
    ("continuous", &["连续", "接续", "承接", "连贯", "continue"]),
    ("cut", &["切镜", "切", "切换", "转场", "硬切"]),
    ("time_jump", &["跳时", "时间跳跃", "时间跳转", "跳跃", "timejump", "time-jump"]),
];
const CRITERIA: Synonyms = &[
    ("consistency", &["设定一致", "设定一致性", "一致性"]),
    ("character", &["人设", "人物", "人设一致"]),
    ("plot", &["情节连贯", "情节", "连贯"]),
    ("ai_tone", &["ai腔", "ai 腔", "ai味", "机器腔"]),
    ("style", &["文风", "风格"]),
    ("foreshadowing", &["伏笔", "伏笔回收"]),
    ("pacing", &["节奏"]),
];
const VERDICTS: Synonyms = &[("pass", &["通过", "ok", "good"]), ("issue", &["有问题", "问题", "不通过", "fail"]), ("unknown", &["无法判断", "未知", "不确定"])];

fn display_kinds(table: Synonyms) -> String {
    table.iter().map(|(name, s)| s.first().map(|z| format!("{z}({name})")).unwrap_or_else(|| name.to_string())).collect::<Vec<_>>().join("、")
}

fn enum_field(issues: &mut Issues, item: &Value, key: &str, path: &str, table: Synonyms, fallback: Option<&'static str>) -> &'static str {
    let raw = plain(item.get(key));
    if let Some(kind) = canonical(&raw, table) {
        return kind;
    }
    if let Some(kind) = fallback {
        return kind;
    }
    issues.push(format!("{path}.{key}"), format!("{key}「{raw}」无法识别，只能是：{}", display_kinds(table)));
    table[0].0
}

fn name_key(name: &str) -> String {
    name.trim().trim_matches(['「', '」', '“', '”', '"', '\'', '《', '》']).replace([' ', '\u{3000}'], "").to_lowercase()
}

struct Known {
    id: String,
    seq: i64,
    kind: String,
    name: String,
    aliases: Vec<String>,
}
impl Known {
    fn matches(&self, key: &str) -> bool {
        let key = name_key(key);
        !key.is_empty() && (name_key(&self.name) == key || self.aliases.iter().any(|a| name_key(a) == key))
    }
}

fn known_entities(conn: &Connection, drama: &str) -> Result<Vec<Known>> {
    let mut statement = conn.prepare("SELECT id,seq,kind,name,aliases_json FROM drama_entities WHERE drama_id=?1").map_err(db)?;
    let rows = statement
        .query_map([drama], |r| {
            let aliases: String = r.get(4)?;
            Ok(Known { id: r.get(0)?, seq: r.get(1)?, kind: r.get(2)?, name: r.get(3)?, aliases: serde_json::from_str(&aliases).unwrap_or_default() })
        })
        .map_err(db)?;
    rows.collect::<rusqlite::Result<_>>().map_err(db)
}

fn label_seq(value: &str, prefix: char) -> Option<i64> {
    let v = value.trim();
    v.strip_prefix(prefix).or_else(|| v.strip_prefix(prefix.to_ascii_lowercase())).and_then(|n| n.parse().ok())
}

/// Resolves a label (`E3`) or a name/alias to a known entity.
fn find<'a>(known: &'a [Known], key: &str) -> Option<&'a Known> {
    if let Some(seq) = label_seq(key, 'E') {
        return known.iter().find(|k| k.seq == seq);
    }
    known.iter().find(|k| k.matches(key))
}

pub(crate) struct RunInfo {
    pub drama_id: String,
    pub episode_id: Option<String>,
    pub stage: String,
    pub scope: Value,
}

pub(crate) fn run_info(conn: &Connection, run_id: &str) -> Result<(RunInfo, String)> {
    conn.query_row("SELECT drama_id,episode_id,stage,scope_json,status FROM drama_runs WHERE id=?1", [run_id], |r| {
        let scope: String = r.get(3)?;
        Ok((RunInfo { drama_id: r.get(0)?, episode_id: r.get(1)?, stage: r.get(2)?, scope: serde_json::from_str(&scope).unwrap_or(Value::Null) }, r.get::<_, String>(4)?))
    })
    .optional()
    .map_err(db)?
    .ok_or_else(|| super::missing("任务"))
}

/// Validates and normalizes a proposal. Returns the canonical form to store.
pub(crate) fn check(conn: &Connection, run: &RunInfo, proposal: &Value) -> Result<Value> {
    if !proposal.is_object() {
        return Err(rejected(vec![Issue { path: String::new(), message: "结果必须是一个 JSON 对象".into() }]));
    }
    match run.stage.as_str() {
        "chapter" => chapter(run, proposal).map(|p| p.normalized),
        "settings" => settings(conn, run, proposal).map(|p| p.normalized),
        "episodes" => episodes(conn, run, proposal).map(|p| p.normalized),
        "script" => script(proposal),
        "shots" => shots(conn, run, proposal).map(|p| p.normalized),
        "review" => review(proposal),
        _ => Err(bad("未知任务类型")),
    }
}

/// Applies an accepted proposal inside the caller's transaction.
pub(crate) fn adopt(conn: &Connection, run_id: &str, run: &RunInfo, proposal: &Value) -> Result<()> {
    match run.stage.as_str() {
        "chapter" => apply_chapter(conn, run_id, run, chapter(run, proposal)?),
        "settings" => apply_settings(conn, run_id, run, settings(conn, run, proposal)?),
        "episodes" => apply_episodes(conn, run, episodes(conn, run, proposal)?),
        "script" => {
            let normalized = script(proposal)?;
            let episode = run.episode_id.as_deref().ok_or_else(|| bad("剧本任务缺少分集"))?;
            conn.execute(
                "UPDATE drama_episodes SET script=?1, updated_at=?2, rev=rev+1 WHERE id=?3",
                params![normalized["script"].as_str().unwrap_or(""), now(), episode],
            )
            .map_err(db)?;
            Ok(())
        }
        "shots" => apply_shots(conn, run, shots(conn, run, proposal)?),
        _ => Err(bad("复核结果只供参考，无需采用")),
    }
}

// ---------- chapter ----------

struct ChapterPlan {
    normalized: Value,
    ord: i64,
    ledger: Vec<(String, String, String, String)>,
}

fn chapter(run: &RunInfo, p: &Value) -> Result<ChapterPlan> {
    let mut issues = Issues::default();
    let ord = run.scope.get("ord").and_then(Value::as_i64).filter(|n| *n >= 1).ok_or_else(|| bad("章节任务缺少章节序号"))?;
    let title = need(&mut issues, p, "title", "", "章节标题", 120);
    let body = need(&mut issues, p, "body", "", "正文", 80_000);
    let summary = need(&mut issues, p, "summary", "", "章节摘要", 3_000);
    let end_state = need(&mut issues, p, "endState", "", "章末状态", 3_000);
    let mut ledger = vec![];
    for (i, item) in list(&mut issues, p, "ledger", "账本", 0, 120).iter().enumerate() {
        let path = format!("ledger[{i}]");
        let op = enum_field(&mut issues, item, "op", &path, LEDGER_OPS, Some("add"));
        let kind = enum_field(&mut issues, item, "kind", &path, LEDGER_KINDS, None);
        let name = need(&mut issues, item, "name", &path, "账本条目名称", 80);
        let note = opt(&mut issues, item, "note", &path, "账本说明", 2_000);
        ledger.push((op.to_owned(), kind.to_owned(), name, note));
    }
    let normalized = json!({
        "title": title, "body": body, "summary": summary, "endState": end_state,
        "ledger": ledger.iter().map(|(op, kind, name, note)| json!({"op": op, "kind": kind, "name": name, "note": note})).collect::<Vec<_>>(),
    });
    issues.finish(ChapterPlan { normalized, ord, ledger })
}

fn apply_chapter(conn: &Connection, run_id: &str, run: &RunInfo, plan: ChapterPlan) -> Result<()> {
    let p = &plan.normalized;
    let t = now();
    let existing: Option<String> =
        conn.query_row("SELECT id FROM drama_chapters WHERE drama_id=?1 AND ord=?2", params![run.drama_id, plan.ord], |r| r.get(0)).optional().map_err(db)?;
    let (title, body, summary, end_state) = (p["title"].as_str(), p["body"].as_str(), p["summary"].as_str(), p["endState"].as_str());
    match existing {
        Some(id) => conn.execute(
            "UPDATE drama_chapters SET title=?1, body=?2, summary=?3, end_state=?4, origin='written', run_id=?5, updated_at=?6, rev=rev+1 WHERE id=?7",
            params![title, body, summary, end_state, run_id, t, id],
        ),
        None => conn.execute(
            "INSERT INTO drama_chapters(id,drama_id,ord,title,body,summary,end_state,origin,run_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'written',?8,?9,?9)",
            params![new_id(), run.drama_id, plan.ord, title, body, summary, end_state, run_id, t],
        ),
    }
    .map_err(db)?;
    for (op, kind, name, note) in plan.ledger {
        let mut statement = conn.prepare("SELECT id,name,note,chapter_ords_json FROM drama_ledger WHERE drama_id=?1 AND kind=?2").map_err(db)?;
        let matched = statement
            .query_map(params![run.drama_id, kind], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))
            .map_err(db)?
            .filter_map(|r| r.ok())
            .find(|(_, existing, _, _)| name_key(existing) == name_key(&name));
        let status = if op == "resolve" { "resolved" } else { "open" };
        match matched {
            Some((id, _, old_note, ords)) => {
                let mut ords: Vec<i64> = serde_json::from_str(&ords).unwrap_or_default();
                if !ords.contains(&plan.ord) {
                    ords.push(plan.ord);
                }
                let note = if note.is_empty() { old_note } else { note };
                conn.execute(
                    "UPDATE drama_ledger SET note=?1, chapter_ords_json=?2, status=?3, updated_at=?4 WHERE id=?5",
                    params![note, json!(ords).to_string(), status, now(), id],
                )
                .map_err(db)?;
            }
            None => {
                conn.execute(
                    "INSERT INTO drama_ledger(id,drama_id,kind,name,note,chapter_ords_json,status,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                    params![new_id(), run.drama_id, kind, name, note, json!([plan.ord]).to_string(), status, now()],
                )
                .map_err(db)?;
            }
        }
    }
    Ok(())
}

// ---------- settings ----------

struct EntityPlan {
    target: Option<String>,
    kind: &'static str,
    name: String,
    aliases: Vec<String>,
    description: String,
    appearance: String,
    parent: Option<String>,
    source_note: String,
}
struct SettingsPlan {
    normalized: Value,
    entities: Vec<EntityPlan>,
    /// (from, to) as proposal index or existing id.
    relations: Vec<(Endpoint, Endpoint, &'static str, String, String)>,
}
#[derive(Clone)]
enum Endpoint {
    New(usize),
    Existing(String),
}

fn settings(conn: &Connection, run: &RunInfo, p: &Value) -> Result<SettingsPlan> {
    let mut issues = Issues::default();
    let known = known_entities(conn, &run.drama_id)?;
    let mut entities: Vec<EntityPlan> = vec![];
    for (i, item) in list(&mut issues, p, "entities", "设定", 1, 400).iter().enumerate() {
        let path = format!("entities[{i}]");
        let kind = enum_field(&mut issues, item, "kind", &path, ENTITY_KINDS, None);
        let name = need(&mut issues, item, "name", &path, "设定名称", 60);
        let aliases = strings(item.get("aliases"));
        if aliases.len() > 20 || aliases.iter().any(|a| a.chars().count() > 60) {
            issues.push(format!("{path}.aliases"), "别名最多 20 个，每个不超过 60 字");
        }
        let description = need(&mut issues, item, "description", &path, "设定描述", 4_000);
        let appearance = opt(&mut issues, item, "appearance", &path, "外观描述", 4_000);
        let source_note = opt(&mut issues, item, "sourceNote", &path, "出处说明", 1_000);
        let parent = Some(plain(item.get("parent"))).filter(|s| !s.is_empty());
        let reference = plain(item.get("ref"));
        let target = if !reference.is_empty() {
            match find(&known, &reference) {
                Some(k) => Some(k.id.clone()),
                None => {
                    issues.push(format!("{path}.ref"), format!("ref「{reference}」不是已有设定，新设定请省略 ref"));
                    None
                }
            }
        } else {
            known.iter().find(|k| k.kind == kind && k.matches(&name)).map(|k| k.id.clone())
        };
        if entities.iter().any(|e| e.kind == kind && name_key(&e.name) == name_key(&name)) {
            issues.push(format!("{path}.name"), format!("「{name}」重复出现，请合并为一项"));
        }
        entities.push(EntityPlan { target, kind, name, aliases, description, appearance, parent, source_note });
    }
    let resolve = |key: &str| -> Option<Endpoint> {
        if let Some(i) = entities.iter().position(|e| name_key(&e.name) == name_key(key) || e.aliases.iter().any(|a| name_key(a) == name_key(key))) {
            return Some(Endpoint::New(i));
        }
        find(&known, key).map(|k| Endpoint::Existing(k.id.clone()))
    };
    let kind_of = |endpoint: &Endpoint| -> String {
        match endpoint {
            Endpoint::New(i) => entities[*i].kind.to_owned(),
            Endpoint::Existing(id) => known.iter().find(|k| &k.id == id).map(|k| k.kind.clone()).unwrap_or_default(),
        }
    };
    let mut parents = vec![];
    for (i, e) in entities.iter().enumerate() {
        let Some(parent) = &e.parent else {
            parents.push(None);
            continue;
        };
        match resolve(parent) {
            Some(endpoint) if matches!(kind_of(&endpoint).as_str(), "character" | "scene") && !matches!(endpoint, Endpoint::New(j) if j == i) => parents.push(Some(endpoint)),
            _ => {
                issues.push(format!("entities[{i}].parent"), format!("parent「{parent}」必须是本次列出或已有的人物、场景名称"));
                parents.push(None);
            }
        }
    }
    let mut relations = vec![];
    for (i, item) in list(&mut issues, p, "relations", "关系", 0, 600).iter().enumerate() {
        let path = format!("relations[{i}]");
        let kind = enum_field(&mut issues, item, "kind", &path, RELATION_KINDS, Some("other"));
        let label = opt(&mut issues, item, "label", &path, "关系标签", 40);
        let note = opt(&mut issues, item, "note", &path, "关系说明", 1_000);
        let ends: Vec<Option<Endpoint>> = ["from", "to"]
            .iter()
            .map(|key| {
                let name = plain(item.get(*key));
                let end = resolve(&name);
                if end.is_none() {
                    issues.push(format!("{path}.{key}"), format!("{key}「{name}」不在设定列表中，请使用 entities 里的名称"));
                }
                end
            })
            .collect();
        if let [Some(from), Some(to)] = &ends[..] {
            relations.push((from.clone(), to.clone(), kind, label, note));
        }
    }
    let normalized = json!({
        "entities": entities.iter().map(|e| {
            let mut m = Map::new();
            if let Some(id) = &e.target { if let Some(k) = known.iter().find(|k| &k.id == id) { m.insert("ref".into(), json!(format!("E{}", k.seq))); } }
            m.insert("kind".into(), json!(e.kind)); m.insert("name".into(), json!(e.name)); m.insert("aliases".into(), json!(e.aliases));
            m.insert("description".into(), json!(e.description)); m.insert("appearance".into(), json!(e.appearance));
            if let Some(parent) = &e.parent { m.insert("parent".into(), json!(parent)); }
            m.insert("sourceNote".into(), json!(e.source_note));
            Value::Object(m)
        }).collect::<Vec<_>>(),
        "relations": p.get("relations").and_then(Value::as_array).map(|items| items.iter().zip(relations.iter()).map(|(item, (_, _, kind, label, note))| json!({
            "from": plain(item.get("from")), "to": plain(item.get("to")), "kind": kind, "label": label, "note": note,
        })).collect::<Vec<_>>()).unwrap_or_default(),
    });
    let mut plan = SettingsPlan { normalized, entities, relations };
    for (e, parent) in plan.entities.iter_mut().zip(parents) {
        e.parent = parent.map(|p| match p {
            Endpoint::New(i) => format!("#{i}"),
            Endpoint::Existing(id) => id,
        });
    }
    issues.finish(plan)
}

fn apply_settings(conn: &Connection, run_id: &str, run: &RunInfo, plan: SettingsPlan) -> Result<()> {
    let t = now();
    let mut seq: i64 = conn.query_row("SELECT COALESCE(MAX(seq),0) FROM drama_entities WHERE drama_id=?1", [&run.drama_id], |r| r.get(0)).map_err(db)?;
    let mut ids = vec![];
    for e in &plan.entities {
        let aliases = json!(e.aliases).to_string();
        let id = match &e.target {
            Some(id) => {
                conn.execute(
                    "UPDATE drama_entities SET kind=?1, name=?2, aliases_json=?3, description=?4, appearance=CASE WHEN ?5='' THEN appearance ELSE ?5 END, source_note=?6, updated_at=?7, rev=rev+1 WHERE id=?8",
                    params![e.kind, e.name, aliases, e.description, e.appearance, e.source_note, t, id],
                )
                .map_err(db)?;
                id.clone()
            }
            None => {
                seq += 1;
                let id = new_id();
                conn.execute(
                    "INSERT INTO drama_entities(id,drama_id,seq,kind,name,aliases_json,description,appearance,sort,source_note,run_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?3,?9,?10,?11,?11)",
                    params![id, run.drama_id, seq, e.kind, e.name, aliases, e.description, e.appearance, e.source_note, run_id, t],
                )
                .map_err(db)?;
                id
            }
        };
        ids.push(id);
    }
    let real = |reference: &str| -> String { reference.strip_prefix('#').and_then(|i| i.parse::<usize>().ok()).map(|i| ids[i].clone()).unwrap_or_else(|| reference.to_owned()) };
    for (e, id) in plan.entities.iter().zip(&ids) {
        if let Some(parent) = &e.parent {
            conn.execute("UPDATE drama_entities SET parent_id=?1 WHERE id=?2", params![real(parent), id]).map_err(db)?;
        }
    }
    for (from, to, kind, label, note) in plan.relations {
        let end = |e: Endpoint| match e {
            Endpoint::New(i) => ids[i].clone(),
            Endpoint::Existing(id) => id,
        };
        let (from, to) = (end(from), end(to));
        if from == to {
            continue;
        }
        let existing: Option<String> = conn
            .query_row("SELECT id FROM drama_relations WHERE from_id=?1 AND to_id=?2 AND kind=?3", params![from, to, kind], |r| r.get(0))
            .optional()
            .map_err(db)?;
        match existing {
            Some(id) => conn.execute("UPDATE drama_relations SET label=?1, note=?2 WHERE id=?3", params![label, note, id]),
            None => conn.execute(
                "INSERT INTO drama_relations(id,drama_id,from_id,to_id,kind,label,note,run_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![new_id(), run.drama_id, from, to, kind, label, note, run_id],
            ),
        }
        .map_err(db)?;
    }
    Ok(())
}

// ---------- episodes ----------

struct EpisodePlan {
    target: Option<String>,
    target_label: Option<String>,
    title: String,
    outline: String,
    seconds: i64,
    chapters: Vec<String>,
}
struct EpisodesPlan {
    normalized: Value,
    episodes: Vec<EpisodePlan>,
}

fn episodes(conn: &Connection, run: &RunInfo, p: &Value) -> Result<EpisodesPlan> {
    let mut issues = Issues::default();
    let existing: Vec<(String, i64, String)> = {
        let mut s = conn.prepare("SELECT id,seq,title FROM drama_episodes WHERE drama_id=?1").map_err(db)?;
        let rows = s.query_map([&run.drama_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(db)?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let chapters: Vec<(i64, String)> = {
        let mut s = conn.prepare("SELECT ord,id FROM drama_chapters WHERE drama_id=?1").map_err(db)?;
        let rows = s.query_map([&run.drama_id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db)?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let mut plans = vec![];
    for (i, item) in list(&mut issues, p, "episodes", "分集", 1, 200).iter().enumerate() {
        let path = format!("episodes[{i}]");
        let title = need(&mut issues, item, "title", &path, "分集标题", 80);
        let outline = need(&mut issues, item, "outline", &path, "分集梗概", 6_000);
        let seconds = number(item.get("targetSeconds")).map(|n| n.round() as i64).unwrap_or(60);
        if !(5..=1800).contains(&seconds) {
            issues.push(format!("{path}.targetSeconds"), "targetSeconds 必须在 5 到 1800 秒之间");
        }
        let mut ids = vec![];
        if let Some(Value::Array(sources)) = item.get("sourceChapters") {
            for source in sources {
                let ord = match source {
                    Value::Number(n) => n.as_i64(),
                    Value::String(s) => label_seq(s, 'C').or_else(|| s.trim().parse().ok()),
                    _ => None,
                };
                match ord.and_then(|o| chapters.iter().find(|(c, _)| *c == o)) {
                    Some((_, id)) => ids.push(id.clone()),
                    None => issues.push(format!("{path}.sourceChapters"), format!("来源章节 {source} 不存在")),
                }
            }
        }
        let reference = plain(item.get("ref"));
        let target = if reference.is_empty() {
            existing.iter().find(|(_, _, t)| name_key(t) == name_key(&title))
        } else {
            let found = label_seq(&reference, 'P').and_then(|seq| existing.iter().find(|e| e.1 == seq));
            if found.is_none() {
                issues.push(format!("{path}.ref"), format!("ref「{reference}」不是已有分集，新分集请省略 ref"));
            }
            found
        };
        plans.push(EpisodePlan { target: target.map(|e| e.0.clone()), target_label: target.map(|e| format!("P{}", e.1)), title, outline, seconds, chapters: ids });
    }
    let normalized = json!({"episodes": p.get("episodes").and_then(Value::as_array).map(|items| items.iter().zip(&plans).map(|(item, e)| {
        let mut v = json!({"title": e.title, "outline": e.outline, "targetSeconds": e.seconds, "sourceChapters": item.get("sourceChapters").cloned().unwrap_or(json!([]))});
        // `ref` marks an update of an existing episode, matched by label or title.
        if let Some(label) = &e.target_label { v["ref"] = json!(label); }
        v
    }).collect::<Vec<_>>()).unwrap_or_default()});
    issues.finish(EpisodesPlan { normalized, episodes: plans })
}

fn apply_episodes(conn: &Connection, run: &RunInfo, plan: EpisodesPlan) -> Result<()> {
    let t = now();
    let (mut seq, mut ord): (i64, i64) = conn
        .query_row("SELECT COALESCE(MAX(seq),0), COALESCE(MAX(ord),0) FROM drama_episodes WHERE drama_id=?1", [&run.drama_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(db)?;
    for e in plan.episodes {
        let chapters = json!(e.chapters).to_string();
        match e.target {
            Some(id) => conn.execute(
                "UPDATE drama_episodes SET title=?1, outline=?2, target_seconds=?3, source_chapter_ids_json=?4, updated_at=?5, rev=rev+1 WHERE id=?6",
                params![e.title, e.outline, e.seconds, chapters, t, id],
            ),
            None => {
                seq += 1;
                ord += 1;
                conn.execute(
                    "INSERT INTO drama_episodes(id,drama_id,seq,ord,title,outline,target_seconds,source_chapter_ids_json,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
                    params![new_id(), run.drama_id, seq, ord, e.title, e.outline, e.seconds, chapters, t],
                )
            }
        }
        .map_err(db)?;
    }
    Ok(())
}

// ---------- script / review ----------

fn script(p: &Value) -> Result<Value> {
    let mut issues = Issues::default();
    let script = need(&mut issues, p, "script", "", "剧本", 120_000);
    issues.finish(json!({"script": script}))
}

fn review(p: &Value) -> Result<Value> {
    let mut issues = Issues::default();
    let mut items = vec![];
    for (i, item) in list(&mut issues, p, "items", "复核项", 7, 14).iter().enumerate() {
        let path = format!("items[{i}]");
        let criterion = enum_field(&mut issues, item, "criterion", &path, CRITERIA, None);
        let verdict = enum_field(&mut issues, item, "verdict", &path, VERDICTS, Some("unknown"));
        let note = need(&mut issues, item, "note", &path, "复核说明", 2_000);
        let suggestion = opt(&mut issues, item, "suggestion", &path, "修改建议", 2_000);
        items.push(json!({"criterion": criterion, "verdict": verdict, "note": note, "suggestion": suggestion}));
    }
    for (name, synonyms) in CRITERIA {
        if !items.iter().any(|i| i["criterion"] == *name) && items.len() >= 7 {
            issues.push("items", format!("缺少「{}」一项", synonyms[0]));
        }
    }
    issues.finish(json!({"items": items}))
}

// ---------- shots ----------

struct ShotPlan {
    fields: Value,
    entities: Vec<String>,
}
struct ShotsPlan {
    normalized: Value,
    shots: Vec<ShotPlan>,
}

fn shots(conn: &Connection, run: &RunInfo, p: &Value) -> Result<ShotsPlan> {
    run.episode_id.as_deref().ok_or_else(|| bad("分镜任务缺少分集"))?;
    let mut issues = Issues::default();
    let known = known_entities(conn, &run.drama_id)?;
    let mut plans = vec![];
    for (i, item) in list(&mut issues, p, "shots", "镜头", 1, 150).iter().enumerate() {
        let path = format!("shots[{i}]");
        let seconds = number(item.get("seconds")).map(|n| n.round() as i64).unwrap_or(0);
        if !(1..=15).contains(&seconds) {
            issues.push(format!("{path}.seconds"), "seconds 必须是 1 到 15 的整数秒");
        }
        let mut entity_ids: Vec<String> = vec![];
        for name in strings(item.get("entities")) {
            match find(&known, &name) {
                // A world setting has nothing to film; models list it as "出场" now and then.
                Some(k) if k.kind == "world" => {}
                Some(k) if !entity_ids.contains(&k.id) => entity_ids.push(k.id.clone()),
                Some(_) => {}
                // Incidental objects the settings do not list are scenery; the description already mentions them.
                None => {}
            }
        }
        let character = |name: &str, issues: &mut Issues, field: String| -> String {
            let name = name.trim();
            if name.is_empty() || matches!(name, "旁白" | "画外音" | "narrator" | "无") {
                return String::new();
            }
            match find(&known, name) {
                Some(k) if k.kind == "character" => k.id.clone(),
                _ => {
                    issues.push(field, format!("「{name}」不是设定中的人物"));
                    String::new()
                }
            }
        };
        let mut dialogue = vec![];
        if let Some(Value::Array(lines)) = item.get("dialogue") {
            if lines.len() > 30 {
                issues.push(format!("{path}.dialogue"), "单镜对白最多 30 句");
            }
            for (j, line) in lines.iter().enumerate() {
                let speaker = character(&plain(line.get("speaker")), &mut issues, format!("{path}.dialogue[{j}].speaker"));
                if !speaker.is_empty() && !entity_ids.contains(&speaker) {
                    entity_ids.push(speaker.clone());
                }
                let text = need(&mut issues, line, "text", &format!("{path}.dialogue[{j}]"), "对白", 500);
                dialogue.push(json!({"speaker": speaker, "text": text}));
            }
        }
        let mut props = vec![];
        if let Some(Value::Array(items)) = item.get("props") {
            for (j, prop) in items.iter().enumerate() {
                let field = format!("{path}.props[{j}]");
                let name = plain(prop.get("entity"));
                // Only a prop has a state; a character or scene label here is the model pointing at the holder.
                let Some(entity) = find(&known, &name).filter(|k| k.kind == "prop") else { continue };
                if !entity_ids.contains(&entity.id) {
                    entity_ids.push(entity.id.clone());
                }
                let quantity = number(prop.get("quantity")).map(|n| n.round() as i64).unwrap_or(1);
                if !(0..=99).contains(&quantity) {
                    issues.push(format!("{field}.quantity"), "quantity 必须在 0 到 99 之间");
                }
                let holder = |key: &str, issues: &mut Issues| {
                    let id = character(&plain(prop.get(key)), issues, format!("{field}.{key}"));
                    if !id.is_empty() && !entity_ids.contains(&id) {
                        issues.push(format!("{field}.{key}"), "持有人必须是本镜出场人物");
                    }
                    id
                };
                let start_holder = holder("startHolder", &mut issues);
                let end_holder = holder("endHolder", &mut issues);
                props.push(json!({
                    "entityId": entity.id, "quantity": quantity,
                    "startVisible": boolean(prop.get("startVisible"), true), "endVisible": boolean(prop.get("endVisible"), true),
                    "startHolder": start_holder, "endHolder": end_holder, "note": opt(&mut issues, prop, "note", &field, "道具说明", 300),
                }));
            }
        }
        let transition = enum_field(&mut issues, item, "transition", &path, TRANSITIONS, Some("cut"));
        if i == 0 && transition == "continuous" {
            issues.push(format!("{path}.transition"), "第 1 镜没有上一镜，transition 不能是 continuous，请用 cut");
        }
        let fields = json!({
            "seconds": seconds,
            "size": opt(&mut issues, item, "size", &path, "景别", 20),
            "camera": opt(&mut issues, item, "camera", &path, "运镜", 40),
            "description": need(&mut issues, item, "description", &path, "画面描述", 2_000),
            "dialogue": dialogue,
            "narration": opt(&mut issues, item, "narration", &path, "旁白", 1_000),
            "transition": transition,
            "startState": need(&mut issues, item, "startState", &path, "开拍状态", 1_000),
            "endState": need(&mut issues, item, "endState", &path, "结束状态", 1_000),
            "props": props,
            "imagePrompt": need(&mut issues, item, "imagePrompt", &path, "画面提示词", 4_000),
            "videoPrompt": need(&mut issues, item, "videoPrompt", &path, "视频提示词", 4_000),
        });
        plans.push(ShotPlan { fields, entities: entity_ids });
    }
    // The stored form refers to entities by label so adopt re-resolves it with
    // the same rules; ids stay internal to the plan.
    let label = |id: &Value| -> Value {
        json!(id.as_str().and_then(|id| known.iter().find(|k| k.id == id)).map(|k| format!("E{}", k.seq)).unwrap_or_default())
    };
    let normalized = json!({"shots": plans.iter().map(|s| {
        let mut v = s.fields.clone();
        v["entities"] = json!(s.entities.iter().map(|id| label(&json!(id))).collect::<Vec<_>>());
        for line in v["dialogue"].as_array_mut().into_iter().flatten() {
            line["speaker"] = label(&line["speaker"]);
        }
        for prop in v["props"].as_array_mut().into_iter().flatten() {
            let entity = label(&prop["entityId"]);
            let object = prop.as_object_mut().unwrap();
            object.remove("entityId");
            object.insert("entity".into(), entity);
            for key in ["startHolder", "endHolder"] {
                let holder = label(&object[key]);
                object.insert(key.into(), holder);
            }
        }
        v
    }).collect::<Vec<_>>()});
    issues.finish(ShotsPlan { normalized, shots: plans })
}

fn apply_shots(conn: &Connection, run: &RunInfo, plan: ShotsPlan) -> Result<()> {
    let episode = run.episode_id.as_deref().unwrap_or_default();
    conn.execute("DELETE FROM drama_shots WHERE episode_id=?1", [episode]).map_err(db)?;
    let t = now();
    for (i, shot) in plan.shots.iter().enumerate() {
        let f = &shot.fields;
        let id = new_id();
        conn.execute(
            "INSERT INTO drama_shots(id,episode_id,ord,seconds,size,camera,description,dialogue_json,narration,transition,start_state,end_state,props_json,image_prompt,video_prompt,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)",
            params![
                id, episode, i as i64 + 1, f["seconds"].as_i64(), f["size"].as_str(), f["camera"].as_str(), f["description"].as_str(),
                f["dialogue"].to_string(), f["narration"].as_str(), f["transition"].as_str(), f["startState"].as_str(), f["endState"].as_str(),
                f["props"].to_string(), f["imagePrompt"].as_str(), f["videoPrompt"].as_str(), t
            ],
        )
        .map_err(db)?;
        for entity in &shot.entities {
            conn.execute("INSERT OR IGNORE INTO drama_shot_entities(shot_id,entity_id) VALUES(?1,?2)", params![id, entity]).map_err(db)?;
        }
    }
    conn.execute("UPDATE drama_episodes SET updated_at=?1 WHERE id=?2", params![t, episode]).map_err(db)?;
    Ok(())
}
