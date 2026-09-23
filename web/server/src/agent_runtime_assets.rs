use super::*;
use sha2::{Digest, Sha256};
use std::io::Read;

fn hash_file(path: &FsPath) -> Result<String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn extension(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or("") {
        "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp", "image/gif" => "gif",
        "video/mp4" => "mp4", "video/webm" => "webm", "video/quicktime" => "mov",
        "audio/mpeg" => "mp3", "audio/wav" | "audio/x-wav" => "wav", "audio/mp4" => "m4a",
        "audio/ogg" => "ogg", "audio/flac" => "flac", "application/pdf" => "pdf",
        "text/markdown" => "md", "text/plain" => "txt", "application/json" => "json", "text/csv" => "csv",
        _ => "bin",
    }
}

pub(super) fn materialize(state: &AppState, work: &FsPath, assets: &[Value], preserve_attachments: bool) -> Result<Value> {
    // Sync calls can arrive from multiple generation completions. Publish each index atomically.
    static SYNC: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = SYNC.lock().map_err(|_| "素材索引暂不可用")?;
    let blobs = safe_child(work, ".hilo/.blobs")?;
    let manifests = safe_child(work, ".zodiac/manifests")?;
    std::fs::create_dir_all(&blobs).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&manifests).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for asset in assets {
        let node_id = asset["id"].as_str().filter(|s| !s.is_empty()).ok_or("素材缺少节点标识")?;
        if !seen.insert(node_id) { return Err("素材索引含重复节点".into()); }
        let mut entry = json!({"id":node_id,"nodeId":node_id,"name":asset["name"],"type":asset["type"],"ready":false});
        if asset["origin"] == "message_attachment" { entry["nodeId"] = Value::Null; }
        for field in ["resultVersionId", "groupId", "selected", "origin"] {
            if let Some(value) = asset.get(field) { entry[field] = value.clone(); }
        }
        let temporary = safe_child(&blobs, &format!("{}.tmp", secret()?))?;
        let result = (|| {
            let (bytes, mime) = if let Some(data) = asset["dataUrl"].as_str() {
                use base64::Engine;
                let (header, content) = data.split_once(',').ok_or("图片附件无效")?;
                let mime = header.strip_prefix("data:").and_then(|s| s.strip_suffix(";base64")).ok_or("图片附件格式无效")?;
                if !["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime) { return Err("图片附件格式不支持".into()); }
                let decoded = base64::engine::general_purpose::STANDARD.decode(content).map_err(|_| "图片附件编码无效")?;
                std::fs::write(&temporary, &decoded).map_err(|e| e.to_string())?;
                (decoded.len() as u64, mime.into())
            } else if asset["type"] == "text" {
                let content = asset["content"].as_str().ok_or("文档缺少正文")?;
                std::fs::write(&temporary, content).map_err(|e| e.to_string())?;
                (content.len() as u64, "text/markdown".into())
            } else {
                let key = asset["storageKey"].as_str().ok_or("素材尚未保存")?;
                storage::export_workspace_media(&state.storage, key, &temporary)?
            };
            let hash = hash_file(&temporary)?;
            let filename = format!("{}.{}", hash, extension(&mime));
            let target = safe_child(&blobs, &filename)?;
            // Existing snapshots are never overwritten. Detect tampering rather than silently reuse it.
            if target.exists() {
                if hash_file(&target)? != hash { return Err("已有素材副本内容已改变，请重新导出该素材".into()); }
            } else {
                std::fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
            }
            entry["ready"] = json!(true);
            entry["blobRef"] = json!(filename);
            entry["path"] = json!(format!(".hilo/.blobs/{filename}"));
            entry["contentHash"] = json!(hash);
            entry["mimeType"] = json!(mime);
            entry["size"] = json!(bytes);
            Ok::<_, String>(())
        })();
        let _ = std::fs::remove_file(&temporary);
        if let Err(error) = result { entry["error"] = json!(error); }
        entries.push(entry);
    }
    if preserve_attachments {
        let index = safe_child(work, ".zodiac/assets.json")?;
        if index.is_file() {
            let previous: Value = serde_json::from_slice(&std::fs::read(index).map_err(|e| e.to_string())?).map_err(|_| "已有素材索引损坏")?;
            for asset in previous["assets"].as_array().into_iter().flatten().filter(|a| a["origin"] == "message_attachment") {
                if entries.iter().any(|entry| entry["id"] == asset["id"]) { continue; }
                let mut entry = asset.clone();
                if let Some(path) = entry["path"].as_str() {
                    let path = safe_child(work, path)?;
                    if hash_file(&path).ok().as_deref() != entry["contentHash"].as_str() {
                        entry["ready"] = json!(false);
                        entry["error"] = json!("附件副本已变化或不可读取");
                        entry.as_object_mut().unwrap().remove("path");
                    }
                }
                entries.push(entry);
            }
        }
    }
    let revision = format!("{:x}", Sha256::digest(serde_json::to_vec(&entries).map_err(|e| e.to_string())?));
    let manifest = json!({"version":2,"revision":revision,"assets":entries});
    persist_json(&safe_child(&manifests, &format!("{revision}.json"))?, &manifest)?;
    persist_json(&safe_child(work, ".zodiac/assets.json")?, &manifest)?;
    // Older installed skills still read the array-shaped Hub index.
    persist_json(&safe_child(work, ".hilo/assets.json")?, &entries)?;
    Ok(json!({"path":".zodiac/assets.json","revision":revision,"assets":entries}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn content_identity_depends_on_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source");
        std::fs::write(&path, "first").unwrap();
        let first = hash_file(&path).unwrap();
        std::fs::write(&path, "second").unwrap();
        assert_ne!(first, hash_file(&path).unwrap());
        assert_eq!(extension("image/png"), "png");
    }
}
