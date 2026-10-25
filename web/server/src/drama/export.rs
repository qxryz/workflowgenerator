//! 成片: stitches the adopted shot videos (plus voice and music) into one MP4 and
//! an SRT. One tokio task per export; a single permit keeps encodes sequential.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, LazyLock, Mutex},
};

use axum::{
    extract::{Path as UrlPath, State},
    routing::{get, post},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use tokio::{
    process::Command,
    sync::{watch, Semaphore},
};

use super::model::{select, Export, EXPORT_COLS};
use super::{bad, db, internal, missing, new_id, now, Result};
use crate::{
    media_runtime,
    state::AppState,
    storage::{self, NativeStorage},
};

static GATE: Semaphore = Semaphore::const_new(1);
static CANCELS: LazyLock<Mutex<HashMap<String, watch::Sender<bool>>>> = LazyLock::new(Default::default);

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/drama-episodes/{eid}/exports", post(create))
        .route("/api/drama-exports/{xid}", get(show))
        .route("/api/drama-exports/{xid}/cancel", post(cancel))
}

struct Clip {
    path: PathBuf,
    seconds: f64,
    has_audio: bool,
    voice: Option<PathBuf>,
    /// Display text per dialogue line, speaker prefix included.
    lines: Vec<String>,
}
struct Job {
    width: u32,
    height: u32,
    keep_audio: bool,
    music: Option<(PathBuf, f64)>,
    clips: Vec<Clip>,
}
struct Done {
    media_key: String,
    media_url: String,
    srt_key: String,
}

// ---------- pure helpers ----------

/// Output size for the drama's aspect: `resolution` names the short side.
fn dimensions(aspect: &str, resolution: &str) -> Option<(u32, u32)> {
    let short = match resolution {
        "720p" => 720,
        "1080p" => 1080,
        _ => return None,
    };
    match aspect {
        "16:9" => Some((short * 16 / 9, short)),
        "9:16" => Some((short, short * 16 / 9)),
        "1:1" => Some((short, short)),
        _ => None,
    }
}

fn dialogue_lines(dialogue: &Value, names: &HashMap<String, String>) -> Vec<String> {
    let items = dialogue.as_array().map(Vec::as_slice).unwrap_or_default();
    items
        .iter()
        .filter_map(|line| {
            let text = line["text"].as_str()?.trim();
            if text.is_empty() {
                return None;
            }
            Some(match line["speaker"].as_str().and_then(|id| names.get(id)) {
                Some(name) => format!("{name}：{text}"),
                None => text.to_owned(),
            })
        })
        .collect()
}

fn stamp(seconds: f64) -> String {
    let ms = (seconds * 1000.0).round() as u64;
    format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
}

/// Each shot's lines share that shot's window in proportion to their length.
fn srt(clips: &[Clip]) -> String {
    let mut cues: Vec<String> = Vec::new();
    let mut start = 0.0;
    for clip in clips {
        let total: usize = clip.lines.iter().map(|l| l.chars().count()).sum();
        let mut at = start;
        for line in &clip.lines {
            let end = at + clip.seconds * line.chars().count() as f64 / total as f64;
            // A blank line would end the cue, so squeeze them out.
            let text = line.replace('\r', "").lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n");
            if !text.is_empty() {
                cues.push(format!("{}\n{} --> {}\n{text}\n", cues.len() + 1, stamp(at), stamp(end)));
            }
            at = end;
        }
        start += clip.seconds;
    }
    cues.join("\n")
}

fn secs(n: f64) -> String {
    format!("{n:.3}")
}
fn strs<const N: usize>(values: [&str; N]) -> Vec<String> {
    values.iter().map(|s| s.to_string()).collect()
}
fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Pass 1: one shot to a fixed-size, fixed-length H.264/AAC clip.
fn clip_args(job: &Job, index: usize, out: &str) -> Vec<String> {
    let (w, h) = (job.width, job.height);
    let clip = &job.clips[index];
    let video = format!("[0:v:0]fps=30,scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v]");
    let audio = if job.keep_audio && clip.has_audio {
        "[0:a:0]aresample=48000,aformat=channel_layouts=stereo,apad[a]"
    } else {
        "anullsrc=r=48000:cl=stereo[a]"
    };
    let mut args = strs(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"]);
    args.push(text(&clip.path));
    args.extend(strs(["-filter_complex"]));
    args.push(format!("{video};{audio}"));
    args.extend(strs(["-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t"]));
    args.push(secs(clip.seconds));
    args.push(out.to_owned());
    args
}

/// Pass 2: join `clips.txt`, lay voices at their shot starts, loop the music
/// under everything, and copy the video stream.
fn mix_args(job: &Job, out: &str) -> Vec<String> {
    let total: f64 = job.clips.iter().map(|c| c.seconds).sum();
    let mut args = strs(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "concat", "-safe", "1", "-i", "clips.txt"]);
    let mut graph = vec!["[0:a:0]aresample=async=1:first_pts=0[m0]".to_owned()];
    let mut inputs = vec!["[m0]".to_owned()];
    let mut start = 0.0_f64;
    for clip in &job.clips {
        if let Some(voice) = &clip.voice {
            let n = inputs.len();
            args.extend(["-i".to_owned(), text(voice)]);
            graph.push(format!(
                "[{n}:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=duration={},asetpts=PTS-STARTPTS,adelay={}:all=1[m{n}]",
                secs(clip.seconds),
                (start * 1000.0).round() as u64
            ));
            inputs.push(format!("[m{n}]"));
        }
        start += clip.seconds;
    }
    if let Some((music, volume)) = &job.music {
        let n = inputs.len();
        args.extend(strs(["-stream_loop", "-1", "-i"]));
        args.push(text(music));
        graph.push(format!("[{n}:a:0]aresample=48000,aformat=channel_layouts=stereo,volume={volume:.2},atrim=duration={},asetpts=PTS-STARTPTS[m{n}]", secs(total)));
        inputs.push(format!("[m{n}]"));
    }
    graph.push(format!("{}amix=inputs={}:duration=first:normalize=0,alimiter=limit=0.95[a]", inputs.concat(), inputs.len()));
    args.extend(strs(["-filter_complex"]));
    args.push(graph.join(";"));
    args.extend(strs(["-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t"]));
    args.push(secs(total));
    args.extend(strs(["-movflags", "+faststart"]));
    args.push(out.to_owned());
    args
}

// ---------- request ----------

struct Options {
    resolution: String,
    keep_audio: bool,
    voice: bool,
    music: Option<(String, f64)>,
}

fn options(body: &Value) -> Result<Options> {
    let resolution = body["resolution"].as_str().filter(|r| matches!(*r, "720p" | "1080p")).ok_or_else(|| bad("resolution 无效"))?;
    let music = match body["musicKey"].as_str().filter(|k| !k.is_empty()) {
        Some(key) => {
            let volume = body.get("musicVolume").filter(|v| !v.is_null()).map_or(Some(0.3), Value::as_f64);
            Some((key.to_owned(), volume.filter(|v| (0.0..=1.0).contains(v)).ok_or_else(|| bad("musicVolume 必须在 0 到 1 之间"))?))
        }
        None => None,
    };
    Ok(Options {
        resolution: resolution.to_owned(),
        keep_audio: body["keepOriginalAudio"].as_bool().unwrap_or(false),
        voice: body["includeVoice"].as_bool().unwrap_or(false),
        music,
    })
}

struct Draft {
    width: u32,
    height: u32,
    /// (seconds, video key, voice key, dialogue lines)
    shots: Vec<(f64, String, Option<String>, Vec<String>)>,
}

/// Reads the episode's shots with their adopted video (and voice) keys.
fn draft(conn: &Connection, episode: &str, opts: &Options) -> Result<Draft> {
    let (drama, aspect): (String, String) = conn
        .query_row(
            "SELECT p.id, p.aspect FROM drama_episodes e JOIN drama_projects p ON p.id=e.drama_id WHERE e.id=?1",
            [episode],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db)?
        .ok_or_else(|| missing("分集"))?;
    let (width, height) = dimensions(&aspect, &opts.resolution).ok_or_else(|| bad("画幅无效"))?;
    let names: HashMap<String, String> =
        select(conn, "SELECT id,name FROM drama_entities WHERE drama_id=?1", [&drama], |r| Ok((r.get(0)?, r.get(1)?)))?.into_iter().collect();
    let rows = select(conn, "SELECT id,seconds,dialogue_json FROM drama_shots WHERE episode_id=?1 ORDER BY ord", [episode], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
    })?;
    if rows.is_empty() {
        return Err(bad("这一集还没有镜头"));
    }
    let adopted = |shot: &str, kind: &str| -> Result<Option<String>> {
        conn.query_row(
            "SELECT media_key FROM drama_artifacts WHERE shot_id=?1 AND kind=?2 AND adopted=1 AND status='ready' AND media_key<>'' LIMIT 1",
            params![shot, kind],
            |r| r.get(0),
        )
        .optional()
        .map_err(db)
    };
    let (mut shots, mut missing_video) = (vec![], vec![]);
    for (index, (id, seconds, dialogue)) in rows.iter().enumerate() {
        let Some(video) = adopted(id, "video")? else {
            missing_video.push(format!("第 {} 镜还没有采用视频", index + 1));
            continue;
        };
        let voice = if opts.voice { adopted(id, "audio")? } else { None };
        let dialogue = serde_json::from_str(dialogue).unwrap_or(Value::Null);
        shots.push((*seconds as f64, video, voice, dialogue_lines(&dialogue, &names)));
    }
    if !missing_video.is_empty() {
        return Err(bad(missing_video.join("；")));
    }
    Ok(Draft { width, height, shots })
}

fn file_of(store: &NativeStorage, key: &str, what: &str) -> Result<PathBuf> {
    storage::media_file_path(store, key).map_err(internal)?.filter(|p| p.is_file()).ok_or_else(|| bad(format!("{what}文件找不到，请重新生成或更换")))
}

fn fetch(conn: &Connection, id: &str) -> Result<Export> {
    conn.query_row(&format!("SELECT {EXPORT_COLS} FROM drama_exports WHERE id=?1"), [id], Export::from_row)
        .optional()
        .map_err(db)?
        .ok_or_else(|| missing("导出"))
}

fn reply(export: Export) -> Result<Json<Value>> {
    Ok(Json(serde_json::to_value(export).map_err(|e| internal(e.to_string()))?))
}

async fn create(State(store): State<Arc<NativeStorage>>, UrlPath(eid): UrlPath<String>, Json(body): Json<Value>) -> Result<Json<Value>> {
    let opts = options(&body)?;
    let draft = draft(&*store.lock().map_err(internal)?, &eid, &opts)?;
    media_runtime::binary("ffmpeg").map_err(bad)?;
    media_runtime::binary("ffprobe").map_err(bad)?;
    let mut clips = vec![];
    for (index, (seconds, video, voice, lines)) in draft.shots.into_iter().enumerate() {
        let path = file_of(&store, &video, &format!("第 {} 镜的视频", index + 1))?;
        let voice = voice.map(|key| file_of(&store, &key, &format!("第 {} 镜的配音", index + 1))).transpose()?;
        clips.push(Clip { path, seconds, has_audio: false, voice, lines });
    }
    let music = opts.music.as_ref().map(|(key, volume)| file_of(&store, key, "背景音乐").map(|p| (p, *volume))).transpose()?;
    let job = Job { width: draft.width, height: draft.height, keep_audio: opts.keep_audio, music, clips };

    let id = new_id();
    let options_json = json!({
        "resolution": opts.resolution, "keepOriginalAudio": opts.keep_audio, "includeVoice": opts.voice,
        "musicKey": opts.music.as_ref().map(|m| m.0.clone()), "musicVolume": opts.music.as_ref().map(|m| m.1),
    });
    let export = {
        let conn = store.lock().map_err(internal)?;
        conn.execute(
            "INSERT INTO drama_exports(id,episode_id,status,options_json,created_at) VALUES(?1,?2,'queued',?3,?4)",
            params![id, eid, options_json.to_string(), now()],
        )
        .map_err(db)?;
        fetch(&conn, &id)?
    };
    let (tx, rx) = watch::channel(false);
    CANCELS.lock().map_err(|e| internal(e.to_string()))?.insert(id.clone(), tx);
    tokio::spawn(run(store.clone(), id, job, rx));
    reply(export)
}

async fn show(State(store): State<Arc<NativeStorage>>, UrlPath(xid): UrlPath<String>) -> Result<Json<Value>> {
    reply(fetch(&*store.lock().map_err(internal)?, &xid)?)
}

async fn cancel(State(store): State<Arc<NativeStorage>>, UrlPath(xid): UrlPath<String>) -> Result<Json<Value>> {
    let export = {
        let conn = store.lock().map_err(internal)?;
        let changed = conn
            .execute("UPDATE drama_exports SET status='cancelled', finished_at=?2 WHERE id=?1 AND status IN ('queued','encoding')", params![xid, now()])
            .map_err(db)?;
        if changed > 0 {
            if let Some(token) = CANCELS.lock().map_err(|e| internal(e.to_string()))?.get(&xid) {
                let _ = token.send(true);
            }
        }
        fetch(&conn, &xid)?
    };
    reply(export)
}

// ---------- the encode task ----------

async fn run(store: Arc<NativeStorage>, id: String, job: Job, mut cancelled: watch::Receiver<bool>) {
    let dir = std::env::temp_dir().join(format!("wg-export-{id}"));
    let outcome = tokio::select! {
        result = encode(&store, &id, job, &dir) => Some(result),
        Ok(_) = cancelled.wait_for(|c| *c) => None,
    };
    let _ = std::fs::remove_dir_all(&dir);
    if let Ok(mut cancels) = CANCELS.lock() {
        cancels.remove(&id);
    }
    let (status, error, done) = match outcome {
        None => ("cancelled", String::new(), None),
        Some(Ok(done)) => ("ready", String::new(), Some(done)),
        Some(Err(message)) => ("failed", message, None),
    };
    let (key, url, srt_key) = done.as_ref().map_or(("", "", ""), |d| (&d.media_key, &d.media_url, &d.srt_key));
    if let Ok(conn) = store.lock() {
        let _ = conn.execute(
            "UPDATE drama_exports SET status=?2,error=?3,media_key=?4,media_url=?5,srt_key=?6,finished_at=?7 WHERE id=?1 AND status IN ('queued','encoding')",
            params![id, status, error, key, url, srt_key, now()],
        );
    }
}

async fn tool(binary: &Path, args: &[String], dir: &Path) -> std::result::Result<std::process::Output, String> {
    let output = Command::new(binary)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|_| "媒体工具未能启动".to_owned())?;
    if output.status.success() {
        return Ok(output);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let last = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("未知错误");
    Err(last.chars().take(160).collect())
}

/// Length in seconds and whether the clip carries an audio stream.
async fn probe(ffprobe: &Path, file: &Path, dir: &Path) -> std::result::Result<(f64, bool), String> {
    let mut args = strs(["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json"]);
    args.push(text(file));
    let info: Value = serde_json::from_slice(&tool(ffprobe, &args, dir).await?.stdout).map_err(|e| e.to_string())?;
    let length = info["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).filter(|n| *n > 0.0).ok_or("没有时长")?;
    let audio = info["streams"].as_array().is_some_and(|s| s.iter().any(|v| v["codec_type"] == "audio"));
    Ok((length, audio))
}

async fn publish(store: &Arc<NativeStorage>, file: PathBuf, bucket: &'static str, key: String, mime: &'static str) -> std::result::Result<storage::NativeMediaRecord, String> {
    let store = store.clone();
    tokio::task::spawn_blocking(move || storage::import_native_media_file(&store, &file, bucket, &key, mime).map(|r| r.record))
        .await
        .map_err(|e| e.to_string())?
}

async fn encode(store: &Arc<NativeStorage>, id: &str, mut job: Job, dir: &Path) -> std::result::Result<Done, String> {
    let _turn = GATE.acquire().await.map_err(|e| e.to_string())?;
    let started = store
        .lock()?
        .execute("UPDATE drama_exports SET status='encoding' WHERE id=?1 AND status='queued'", [id])
        .map_err(|e| e.to_string())?;
    if started == 0 {
        return Err("导出已取消".into());
    }
    std::fs::create_dir_all(dir).map_err(|_| "无法创建导出目录")?;
    let (ffmpeg, ffprobe) = (media_runtime::binary("ffmpeg")?, media_runtime::binary("ffprobe")?);
    for (index, clip) in job.clips.iter_mut().enumerate() {
        let (length, has_audio) =
            probe(&ffprobe, &clip.path, dir).await.map_err(|_| format!("第 {} 镜的视频无法读取，请重新生成", index + 1))?;
        clip.seconds = clip.seconds.min(length);
        clip.has_audio = has_audio;
    }
    let mut list = String::new();
    for index in 0..job.clips.len() {
        let name = format!("clip-{index}.mp4");
        tool(&ffmpeg, &clip_args(&job, index, &name), dir).await.map_err(|e| format!("第 {} 镜合成失败：{e}", index + 1))?;
        list += &format!("file '{name}'\n");
    }
    std::fs::write(dir.join("clips.txt"), list).map_err(|_| "无法写入导出文件")?;
    tool(&ffmpeg, &mix_args(&job, "episode.mp4"), dir).await.map_err(|e| format!("合成失败：{e}"))?;

    let subtitles = srt(&job.clips);
    let video = publish(store, dir.join("episode.mp4"), "media", format!("drama-export:{id}"), "video/mp4").await?;
    let mut srt_key = String::new();
    if !subtitles.is_empty() {
        std::fs::write(dir.join("episode.srt"), subtitles).map_err(|_| "无法写入字幕")?;
        srt_key = publish(store, dir.join("episode.srt"), "files", format!("drama-export:{id}:srt"), "application/x-subrip").await?.key;
    }
    Ok(Done { media_key: video.key, media_url: video.url, srt_key })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn clip(seconds: f64, lines: &[&str]) -> Clip {
        Clip { path: "/m/a.mp4".into(), seconds, has_audio: true, voice: None, lines: lines.iter().map(|s| s.to_string()).collect() }
    }
    fn job(keep_audio: bool) -> Job {
        Job { width: 1280, height: 720, keep_audio, music: None, clips: vec![clip(2.0, &[]), clip(3.5, &[])] }
    }

    #[test]
    fn dimensions_follow_aspect_and_resolution() {
        assert_eq!(dimensions("16:9", "1080p"), Some((1920, 1080)));
        assert_eq!(dimensions("16:9", "720p"), Some((1280, 720)));
        assert_eq!(dimensions("9:16", "1080p"), Some((1080, 1920)));
        assert_eq!(dimensions("9:16", "720p"), Some((720, 1280)));
        assert_eq!(dimensions("1:1", "720p"), Some((720, 720)));
        assert_eq!(dimensions("4:3", "720p"), None);
    }

    #[test]
    fn dialogue_lines_prefix_known_speakers_only() {
        let names = HashMap::from([("e1".to_owned(), "林溪".to_owned())]);
        let dialogue = json!([{"speaker":"e1","text":" 你好 "},{"speaker":"","text":"旁白一句"},{"speaker":"gone","text":"路人"},{"speaker":"e1","text":"  "}]);
        assert_eq!(dialogue_lines(&dialogue, &names), vec!["林溪：你好", "旁白一句", "路人"]);
        assert!(dialogue_lines(&Value::Null, &names).is_empty());
    }

    #[test]
    fn srt_splits_each_shot_window_by_text_length() {
        // Shot one: 6 chars + 12 chars over 3s; shot two has none; shot three starts at 5s.
        let clips = vec![clip(3.0, &["林溪：你好", "圆圆：我是邮递机器人呀呀呀"]), clip(2.0, &[]), clip(1.0, &["最后一句\r\n\r\n换行"])];
        let text = srt(&clips);
        let cues: Vec<&str> = text.split("\n\n").collect();
        assert_eq!(cues.len(), 3);
        assert!(cues[0].starts_with("1\n00:00:00,000 --> 00:00:00,"), "{}", cues[0]);
        assert!(cues[1].starts_with("2\n"), "{}", cues[1]);
        assert!(cues[1].contains(" --> 00:00:03,000\n圆圆："), "{}", cues[1]);
        assert_eq!(cues[2], "3\n00:00:05,000 --> 00:00:06,000\n最后一句\n换行\n");
        assert_eq!(srt(&[clip(2.0, &[])]), "");
    }

    #[test]
    fn clip_args_scale_to_target_and_choose_audio_source() {
        let kept = clip_args(&job(true), 1, "clip-1.mp4").join(" ");
        assert!(kept.contains("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2"), "{kept}");
        assert!(kept.contains("[0:a:0]aresample=48000") && !kept.contains("anullsrc"), "{kept}");
        assert!(kept.contains("-t 3.500 clip-1.mp4"), "{kept}");
        let silent = clip_args(&job(false), 0, "clip-0.mp4").join(" ");
        assert!(silent.contains("anullsrc=r=48000:cl=stereo[a]") && silent.contains("-t 2.000"), "{silent}");
        let mut no_track = job(true);
        no_track.clips[0].has_audio = false;
        assert!(clip_args(&no_track, 0, "o.mp4").join(" ").contains("anullsrc"));
    }

    #[test]
    fn mix_args_place_voice_at_shot_start_and_loop_music() {
        let plain = mix_args(&job(true), "episode.mp4").join(" ");
        assert!(plain.contains("amix=inputs=1") && !plain.contains("adelay") && !plain.contains("-stream_loop"), "{plain}");
        assert!(plain.contains("-c:v copy") && plain.contains("-t 5.500 -movflags +faststart episode.mp4"), "{plain}");

        let mut full = job(true);
        full.clips[1].voice = Some("/m/voice.mp3".into());
        full.music = Some(("/m/bgm.mp3".into(), 0.25));
        let args = mix_args(&full, "episode.mp4");
        let graph = args.join(" ");
        assert!(graph.contains("-i /m/voice.mp3") && graph.contains("-stream_loop -1 -i /m/bgm.mp3"), "{graph}");
        assert!(graph.contains("atrim=duration=3.500,asetpts=PTS-STARTPTS,adelay=2000:all=1[m1]"), "{graph}");
        assert!(graph.contains("volume=0.25,atrim=duration=5.500"), "{graph}");
        assert!(graph.contains("[m0][m1][m2]amix=inputs=3:duration=first:normalize=0"), "{graph}");
    }

    #[test]
    fn options_validate_resolution_and_volume() {
        assert!(options(&json!({"resolution":"4k"})).is_err());
        assert!(options(&json!({"resolution":"720p","musicKey":"a","musicVolume":1.5})).is_err());
        let ok = options(&json!({"resolution":"720p","keepOriginalAudio":true,"musicKey":"a"})).unwrap();
        assert!(ok.keep_audio && !ok.voice && ok.music == Some(("a".into(), 0.3)));
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        app: Router,
        store: Arc<NativeStorage>,
    }
    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState { storage: Arc::new(storage::initialize(dir.path()).unwrap()) };
        Fixture { store: state.storage.clone(), app: crate::drama::router().with_state(state), _dir: dir }
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
        /// A drama with one episode and `n` shots; returns (drama, episode, shot ids).
        async fn episode(&self, n: usize) -> (String, String, Vec<String>) {
            let drama = self.ok("POST", "/api/dramas", json!({"title":"雨夜","sourceType":"original","aspect":"16:9"})).await;
            let drama = drama["id"].as_str().unwrap().to_owned();
            let episode = self.ok("POST", &format!("/api/dramas/{drama}/episodes"), json!({"title":"一"})).await;
            let episode = episode["id"].as_str().unwrap().to_owned();
            let mut shots = vec![];
            for _ in 0..n {
                let shot = self.ok("POST", &format!("/api/drama-episodes/{episode}/shots"), json!({})).await;
                shots.push(shot["id"].as_str().unwrap().to_owned());
            }
            (drama, episode, shots)
        }
        async fn adopt(&self, drama: &str, shot: &str, kind: &str, key: &str) {
            let artifact = self.ok("POST", &format!("/api/dramas/{drama}/artifacts"), json!({"shotId":shot,"kind":kind})).await;
            let aid = artifact["id"].as_str().unwrap();
            self.ok("PATCH", &format!("/api/drama-artifacts/{aid}"), json!({"status":"ready","mediaKey":key,"mediaUrl":format!("/media/media/{key}")})).await;
            self.ok("POST", &format!("/api/drama-artifacts/{aid}/adopt"), Value::Null).await;
        }
    }
    fn request() -> Value {
        json!({"resolution":"720p","keepOriginalAudio":true,"includeVoice":false})
    }

    #[tokio::test]
    async fn export_requires_an_adopted_video_for_every_shot() {
        let f = fixture();
        let (drama, episode, shots) = f.episode(3).await;
        f.adopt(&drama, &shots[1], "video", "video:b").await;
        let (status, body) = f.call("POST", &format!("/api/drama-episodes/{episode}/exports"), request()).await;
        assert_eq!(status, 400);
        assert_eq!(body["error"], "第 1 镜还没有采用视频；第 3 镜还没有采用视频");
        let (status, body) = f.call("POST", &format!("/api/drama-episodes/{episode}/exports"), json!({"resolution":"8k"})).await;
        assert_eq!((status, body["error"].as_str().unwrap()), (400, "resolution 无效"));
        let (status, _) = f.call("POST", "/api/drama-episodes/none/exports", request()).await;
        assert_eq!(status, 404);
        let snapshot = f.ok("GET", &format!("/api/drama-episodes/{episode}"), Value::Null).await;
        assert!(snapshot["exports"].as_array().unwrap().is_empty());
    }

    /// Makes a tiny H.264/AAC clip with a system ffmpeg; `None` when unavailable.
    fn make_clip(path: &Path, frequency: u32) -> Option<()> {
        let dir = std::env::var_os("WG_FFMPEG_DIR").map(PathBuf::from);
        let binary = dir.map(|d| d.join("ffmpeg")).filter(|p| p.is_file()).unwrap_or_else(|| "ffmpeg".into());
        let status = std::process::Command::new(binary)
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-f", "lavfi", "-i"])
            .arg(format!("sine=frequency={frequency}:duration=1"))
            .args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
            .arg(path)
            .stdin(Stdio::null())
            .status()
            .ok()?;
        status.success().then_some(())
    }

    #[tokio::test]
    async fn exports_two_shots_into_the_media_store_and_cancel_is_final() {
        let f = fixture();
        let scratch = tempfile::tempdir().unwrap();
        let (a, b) = (scratch.path().join("a.mp4"), scratch.path().join("b.mp4"));
        if media_runtime::binary("ffmpeg").is_err() || media_runtime::binary("ffprobe").is_err() || make_clip(&a, 440).is_none() || make_clip(&b, 660).is_none() {
            eprintln!("skipped: ffmpeg is not available");
            return;
        }
        let (drama, episode, shots) = f.episode(2).await;
        for (index, (shot, file)) in shots.iter().zip([&a, &b]).enumerate() {
            let key = format!("video:test{index}");
            storage::import_native_media_file(&f.store, file, "media", &key, "video/mp4").unwrap();
            f.adopt(&drama, shot, "video", &key).await;
        }
        let first = f.ok("GET", &format!("/api/drama-episodes/{episode}"), Value::Null).await;
        let shot = &first["shots"][0];
        f.ok("PATCH", &format!("/api/drama-shots/{}", shots[0]), json!({"rev": shot["rev"], "seconds": 1, "dialogue":[{"speaker":"","text":"你好"}]})).await;

        let created = f.ok("POST", &format!("/api/drama-episodes/{episode}/exports"), request()).await;
        assert_eq!(created["status"], "queued");
        let id = created["id"].as_str().unwrap().to_owned();
        let mut export = created;
        for _ in 0..600 {
            if matches!(export["status"].as_str(), Some("ready" | "failed")) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            export = f.ok("GET", &format!("/api/drama-exports/{id}"), Value::Null).await;
        }
        assert_eq!(export["status"], "ready", "{export}");
        assert!(export["mediaUrl"].as_str().unwrap().starts_with("/media/media/"));
        let video = storage::media_file_path(&f.store, export["mediaKey"].as_str().unwrap()).unwrap().unwrap();
        let probe = std::process::Command::new(media_runtime::binary("ffprobe").unwrap())
            .args(["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0"])
            .arg(&video)
            .output()
            .unwrap();
        let streams = String::from_utf8_lossy(&probe.stdout).to_string();
        assert!(streams.contains("h264,1280,720") && streams.contains("aac"), "{streams}");
        let srt_file = storage::media_file_path(&f.store, export["srtKey"].as_str().unwrap()).unwrap().unwrap();
        assert_eq!(std::fs::read_to_string(srt_file).unwrap(), "1\n00:00:00,000 --> 00:00:01,000\n你好\n");

        let after = f.ok("POST", &format!("/api/drama-exports/{id}/cancel"), Value::Null).await;
        assert_eq!(after["status"], "ready");
        let snapshot = f.ok("GET", &format!("/api/drama-episodes/{episode}"), Value::Null).await;
        assert_eq!(snapshot["exports"].as_array().unwrap().len(), 1);

        let queued = f.ok("POST", &format!("/api/drama-episodes/{episode}/exports"), request()).await;
        let qid = queued["id"].as_str().unwrap();
        let cancelled = f.ok("POST", &format!("/api/drama-exports/{qid}/cancel"), Value::Null).await;
        assert_eq!(cancelled["status"], "cancelled");
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        assert_eq!(f.ok("GET", &format!("/api/drama-exports/{qid}"), Value::Null).await["status"], "cancelled");
    }
}
