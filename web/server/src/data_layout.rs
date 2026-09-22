//! Local desktop data migration. Originals are retained until verified by the user.
use std::{fs, io::Read, path::{Path, PathBuf}};
type Result<T> = std::result::Result<T, String>;

fn move_entry(source: &Path, target: &Path) -> Result<()> {
    if !source.exists() { return Ok(()); }
    if target.exists() { return Err("新旧目录同时存在，已停止迁移以避免覆盖。".into()); }
    fs::rename(source, target).map_err(|e| e.to_string())
}
pub fn prepare(root: &Path) -> Result<()> {
    fs::create_dir_all(root.join("config")).map_err(|e| e.to_string())?;
    let old = root.join("data");
    for file in ["workflowgenerator.sqlite3", "workflowgenerator.sqlite3-wal", "workflowgenerator.sqlite3-shm"] {
        move_entry(&old.join(file), &root.join("config").join(file))?;
    }
    move_entry(&old.join("workspace-outputs/.runtime"), &root.join("runtimes"))?;
    move_entry(&old.join("workspace-outputs"), &root.join("workspace"))?;
    for dir in ["", "config", "workspace", "runtimes", "skills", "plugins", "media"] {
        let path = root.join(dir);
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        if fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_symlink() { return Err("数据目录不能是符号链接".into()); }
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?; }
    }
    if old.is_dir() && fs::read_dir(&old).map_err(|e| e.to_string())?.next().is_none() { fs::remove_dir(old).map_err(|e| e.to_string())?; }
    Ok(())
}
fn copy_verified(source: &Path, target: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() { return Err("旧数据含符号链接，已停止自动迁移。".into()); }
    if meta.is_dir() {
        fs::create_dir(target).map_err(|e| e.to_string())?;
        fs::set_permissions(target, meta.permissions()).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(source).map_err(|e| e.to_string())? { let entry = entry.map_err(|e| e.to_string())?; if entry.file_name() != ".DS_Store" { copy_verified(&entry.path(), &target.join(entry.file_name()))?; } }
    } else if meta.is_file() {
        fs::copy(source, target).map_err(|e| e.to_string())?;
        let mut a = fs::File::open(source).map_err(|e| e.to_string())?;
        let mut b = fs::File::open(target).map_err(|e| e.to_string())?;
        let (mut x, mut y) = (vec![0; 65536], vec![0; 65536]);
        loop { let n = a.read(&mut x).map_err(|e| e.to_string())?; b.read_exact(&mut y[..n]).map_err(|e| e.to_string())?; if x[..n] != y[..n] { return Err("数据迁移校验失败，原文件未删除".into()); } if n == 0 { break; } }
        if a.metadata().map_err(|e| e.to_string())?.len() != b.metadata().map_err(|e| e.to_string())?.len() { return Err("迁移期间文件发生变化，请关闭旧版应用".into()); }
        b.sync_all().map_err(|e| e.to_string())?;
    }
    Ok(())
}
// Native runtime databases index the working directory independently of session IDs.
fn relocate_runtime_paths(dir: &Path, old: &Path, new: &Path) -> Result<()> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.is_dir() { relocate_runtime_paths(&path, old, new)?; }
        else if path.extension().is_some_and(|ext| ext == "db" || ext == "sqlite3") {
            let connection = rusqlite::Connection::open(&path).map_err(|e| e.to_string())?;
            let tables: Vec<String> = connection.prepare("SELECT name FROM sqlite_master WHERE type='table'").map_err(|e| e.to_string())?.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?;
            for table in tables {
                let table = table.replace('"', "\"\"");
                let columns: Vec<String> = connection.prepare(&format!("PRAGMA table_info(\"{table}\")")).map_err(|e| e.to_string())?.query_map([], |r| r.get(1)).map_err(|e| e.to_string())?.collect::<std::result::Result<_, _>>().map_err(|e| e.to_string())?;
                for column in columns.iter().filter(|c| matches!(c.as_str(), "directory" | "worktree")) {
                    connection.execute(&format!("UPDATE \"{table}\" SET \"{column}\" = replace(\"{column}\", ?1, ?2)"), rusqlite::params![old.to_string_lossy(), new.to_string_lossy()]).map_err(|e| e.to_string())?;
                }
            }
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
pub fn desktop_root(home: &Path, legacy: &Path) -> Result<PathBuf> {
    let target = home.join(".zodiac");
    if target.exists() { prepare(&target)?; return Ok(target); }
    if !legacy.exists() { prepare(&target)?; return Ok(target); }
    // A live legacy process must flush first; copying its WAL is not a migration.
    if fs::metadata(legacy.join("data/workflowgenerator.sqlite3-wal")).is_ok_and(|m| m.len() > 0) { return Err("请先退出旧版应用，再启动新版以迁移数据。".into()); }
    let staging = home.join(format!(".zodiac-migration-{}", std::process::id()));
    if staging.exists() { return Err("发现未完成的迁移目录，原数据未覆盖，请先检查迁移目录。".into()); }
    let result = (|| {
        copy_verified(legacy, &staging)?;
        let retired = staging.join("pi-agent");
        if retired.is_dir() { fs::remove_dir_all(retired).map_err(|e| e.to_string())?; }
        prepare(&staging)?;
        relocate_runtime_paths(&staging.join("runtimes"), &legacy.join("data/workspace-outputs"), &target.join("workspace"))?;
        fs::write(staging.join("config/layout-version"), "1\n").map_err(|e| e.to_string())?;
        fs::rename(&staging, &target).map_err(|e| e.to_string())?;
        Ok(target.clone())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(staging); }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_preserves_original_and_never_overwrites_current() {
        let temp = tempfile::tempdir().unwrap(); let old = temp.path().join("old");
        fs::create_dir_all(old.join("data/workspace-outputs/.runtime/p/s")).unwrap();
        fs::write(old.join("data/workflowgenerator.sqlite3"), b"database").unwrap();
        fs::write(old.join("data/workspace-outputs/script.py"), b"print(42)").unwrap();
        let native = rusqlite::Connection::open(old.join("data/workspace-outputs/.runtime/p/s/opencode.db")).unwrap();
        native.execute_batch("CREATE TABLE session (id TEXT, directory TEXT)").unwrap();
        native.execute("INSERT INTO session VALUES ('stable-id', ?1)", [old.join("data/workspace-outputs/workflows/p/sessions/s").to_string_lossy().as_ref()]).unwrap(); drop(native);
        let root = desktop_root(temp.path(), &old).unwrap();
        assert_eq!(fs::read(root.join("config/workflowgenerator.sqlite3")).unwrap(), b"database");
        assert_eq!(fs::read(root.join("workspace/script.py")).unwrap(), b"print(42)");
        let native = rusqlite::Connection::open(root.join("runtimes/p/s/opencode.db")).unwrap();
        let directory: String = native.query_row("SELECT directory FROM session WHERE id='stable-id'", [], |r| r.get(0)).unwrap();
        assert_eq!(directory, root.join("workspace/workflows/p/sessions/s").to_string_lossy());
        assert!(old.join("data/workflowgenerator.sqlite3").exists());
        fs::write(root.join("config/workflowgenerator.sqlite3"), b"current").unwrap(); desktop_root(temp.path(), &old).unwrap();
        assert_eq!(fs::read(root.join("config/workflowgenerator.sqlite3")).unwrap(), b"current");
    }
    #[test]
    fn fresh_install_and_conflict() {
        let temp = tempfile::tempdir().unwrap(); let root = desktop_root(temp.path(), &temp.path().join("absent")).unwrap();
        for d in ["config", "workspace", "runtimes", "skills", "plugins", "media"] { assert!(root.join(d).is_dir()); }
        fs::create_dir_all(root.join("data/workspace-outputs")).unwrap();
        assert!(prepare(&root).is_err());
    }
}
