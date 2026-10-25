//! Resolve the offline ffmpeg/ffprobe: packaged and checksum-verified, or an
//! explicit `WG_FFMPEG_DIR` for development and containers.
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub(crate) fn binary(name: &str) -> Result<PathBuf, String> {
    if !matches!(name, "ffmpeg" | "ffprobe") {
        return Err("媒体工具名称无效".into());
    }
    if let Some(dir) = std::env::var_os("WG_FFMPEG_DIR") {
        let path = PathBuf::from(dir).join(name);
        return if path.is_file() { Ok(path) } else { Err("媒体工具不可用，请重新安装应用".into()) };
    }
    let mut roots = Vec::new();
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_owned())) {
        roots.push(exe_dir.join("../Resources/runtime/media"));
    }
    #[cfg(debug_assertions)]
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/runtime/media"));
    for root in roots {
        let path = root.join(name);
        if !path.is_file() {
            continue;
        }
        let manifest: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("manifest.json")).map_err(|_| "媒体工具清单缺失，请重新安装应用")?)
                .map_err(|_| "媒体工具清单无效，请重新安装应用")?;
        let actual = format!("{:x}", Sha256::digest(std::fs::read(&path).map_err(|_| "媒体工具无法读取")?));
        let key = if name == "ffmpeg" { "sha256" } else { "ffprobeSha256" };
        if manifest[key].as_str() != Some(&actual) {
            return Err("媒体工具校验失败，请重新安装应用".into());
        }
        return Ok(path);
    }
    Err("媒体工具不可用，请重新安装应用".into())
}
