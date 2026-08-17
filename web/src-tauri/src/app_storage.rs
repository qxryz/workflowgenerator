use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{
    engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{http, AppHandle, Manager, State};

const GZIP_THRESHOLD: usize = 2 * 1024;
const DATABASE_FILE: &str = "workflowgenerator.sqlite3";
const MEDIA_SCHEME: &str = "wg-media";
const MAX_MEDIA_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const MAX_MEDIA_CHUNK_BYTES: usize = 5 * 1024 * 1024;
const STALE_UPLOAD_AGE_MILLIS: i64 = 24 * 60 * 60 * 1_000;
static MEDIA_REVISION: AtomicU64 = AtomicU64::new(0);

/// Native app storage managed by Tauri.
///
/// Paths deliberately stay private to the Rust process. Public command results
/// only contain opaque media URLs and metadata.
pub struct NativeStorage {
    connection: Mutex<Connection>,
    database_path: PathBuf,
    media_root: PathBuf,
    upload_root: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStoreEntry {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStoreMutation {
    namespace: String,
    key: String,
    value: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMediaRecord {
    pub(crate) key: String,
    pub(crate) url: String,
    pub(crate) mime_type: String,
    pub(crate) bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(crate) struct NativeMediaImportResult {
    pub(crate) record: NativeMediaRecord,
    pub(crate) signature: String,
}

struct StoredMedia {
    key: String,
    url_key: String,
    mime_type: String,
    filename: String,
    bytes: u64,
}

struct MediaUpload {
    bucket: String,
    key: String,
    mime_type: String,
    temporary_filename: String,
    expected_bytes: u64,
    received_bytes: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
struct SourceFileSnapshot {
    bytes: u64,
    modified_nanos: u128,
}

pub fn initialize(app: &tauri::AppHandle) -> Result<NativeStorage, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法确定应用数据目录：{error}"))?;
    let data_root = app_data_dir.join("data");
    let media_root = app_data_dir.join("media");
    let upload_root = media_root.join(".uploads");

    create_private_dir(&app_data_dir)?;
    create_private_dir(&data_root)?;
    create_private_dir(&media_root)?;
    create_private_dir(&upload_root)?;

    let database_path = data_root.join(DATABASE_FILE);
    let connection =
        Connection::open(&database_path).map_err(|error| format!("无法打开应用数据库：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("无法配置数据库等待时间：{error}"))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("无法启用数据库日志：{error}"))?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(|error| format!("无法配置数据库同步模式：{error}"))?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS kv_store (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                value BLOB NOT NULL,
                encoding TEXT NOT NULL CHECK (encoding IN ('raw', 'gzip')),
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, key)
            );

            CREATE TABLE IF NOT EXISTS media (
                bucket TEXT NOT NULL,
                key TEXT NOT NULL,
                url_key TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                bytes INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (bucket, key),
                UNIQUE (bucket, url_key)
            );

            CREATE INDEX IF NOT EXISTS media_bucket_idx ON media(bucket);

            CREATE TABLE IF NOT EXISTS media_uploads (
                upload_id TEXT PRIMARY KEY,
                bucket TEXT NOT NULL,
                key TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                temporary_filename TEXT NOT NULL UNIQUE,
                expected_bytes INTEGER NOT NULL,
                received_bytes INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|error| format!("无法初始化应用数据库：{error}"))?;

    clear_stale_media_uploads(&connection, &upload_root)?;

    set_private_file(&database_path)?;
    set_sqlite_companion_permissions(&database_path);

    Ok(NativeStorage {
        connection: Mutex::new(connection),
        database_path,
        media_root,
        upload_root,
    })
}

#[tauri::command]
pub async fn native_store_get(
    storage: State<'_, NativeStorage>,
    namespace: String,
    key: String,
) -> Result<Option<String>, String> {
    validate_store_identity(&namespace, &key)?;
    let connection = storage.lock()?;
    let row: Option<(Vec<u8>, String)> = connection
        .query_row(
            "SELECT value, encoding FROM kv_store WHERE namespace = ?1 AND key = ?2",
            params![namespace, key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("读取应用数据失败：{error}"))?;

    row.map(|(value, encoding)| decode_store_value(value, &encoding))
        .transpose()
}

#[tauri::command]
pub async fn native_store_set(
    storage: State<'_, NativeStorage>,
    namespace: String,
    key: String,
    value: String,
) -> Result<(), String> {
    validate_store_identity(&namespace, &key)?;
    let (encoded, encoding) = encode_store_value(value.as_bytes())?;
    {
        let connection = storage.lock()?;
        connection
            .execute(
                "
                INSERT INTO kv_store(namespace, key, value, encoding, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    value = excluded.value,
                    encoding = excluded.encoding,
                    updated_at = excluded.updated_at
                ",
                params![namespace, key, encoded, encoding, unix_timestamp()],
            )
            .map_err(|error| format!("保存应用数据失败：{error}"))?;
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(())
}

#[tauri::command]
pub async fn native_store_remove(
    storage: State<'_, NativeStorage>,
    namespace: String,
    key: String,
) -> Result<(), String> {
    validate_store_identity(&namespace, &key)?;
    {
        let connection = storage.lock()?;
        connection
            .execute(
                "DELETE FROM kv_store WHERE namespace = ?1 AND key = ?2",
                params![namespace, key],
            )
            .map_err(|error| format!("删除应用数据失败：{error}"))?;
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(())
}

#[tauri::command]
pub async fn native_store_list(
    storage: State<'_, NativeStorage>,
    namespace: String,
) -> Result<Vec<NativeStoreEntry>, String> {
    validate_namespace(&namespace)?;
    let connection = storage.lock()?;
    let mut statement = connection
        .prepare("SELECT key, value, encoding FROM kv_store WHERE namespace = ?1 ORDER BY key")
        .map_err(|error| format!("读取应用数据失败：{error}"))?;
    let rows = statement
        .query_map(params![namespace], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| format!("读取应用数据失败：{error}"))?;

    let mut entries = Vec::new();
    for row in rows {
        let (key, value, encoding) = row.map_err(|error| format!("读取应用数据失败：{error}"))?;
        entries.push(NativeStoreEntry {
            key,
            value: decode_store_value(value, &encoding)?,
        });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn native_store_clear(
    storage: State<'_, NativeStorage>,
    namespace: String,
) -> Result<(), String> {
    validate_namespace(&namespace)?;
    {
        let connection = storage.lock()?;
        connection
            .execute(
                "DELETE FROM kv_store WHERE namespace = ?1",
                params![namespace],
            )
            .map_err(|error| format!("清理应用数据失败：{error}"))?;
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(())
}

#[tauri::command]
pub async fn native_store_batch(
    storage: State<'_, NativeStorage>,
    mutations: Vec<NativeStoreMutation>,
) -> Result<(), String> {
    let mut prepared = Vec::with_capacity(mutations.len());
    for mutation in mutations {
        validate_store_identity(&mutation.namespace, &mutation.key)?;
        let value = mutation
            .value
            .map(|value| encode_store_value(value.as_bytes()))
            .transpose()?;
        prepared.push((mutation.namespace, mutation.key, value));
    }
    {
        let mut connection = storage.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始应用数据事务：{error}"))?;
        for (namespace, key, value) in prepared {
            if let Some((encoded, encoding)) = value {
                transaction
                    .execute(
                        "
                        INSERT INTO kv_store(namespace, key, value, encoding, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5)
                        ON CONFLICT(namespace, key) DO UPDATE SET
                            value = excluded.value,
                            encoding = excluded.encoding,
                            updated_at = excluded.updated_at
                        ",
                        params![namespace, key, encoded, encoding, unix_timestamp()],
                    )
                    .map_err(|error| format!("保存应用数据失败：{error}"))?;
            } else {
                transaction
                    .execute(
                        "DELETE FROM kv_store WHERE namespace = ?1 AND key = ?2",
                        params![namespace, key],
                    )
                    .map_err(|error| format!("删除应用数据失败：{error}"))?;
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("提交应用数据事务失败：{error}"))?;
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(())
}

#[tauri::command]
pub async fn native_media_put(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
    data_url: String,
) -> Result<NativeMediaRecord, String> {
    let (mime_type, bytes) = decode_data_url(&data_url)?;
    save_media(&storage, bucket, key, mime_type, &bytes)
}

#[tauri::command]
pub async fn native_media_put_raw(
    storage: State<'_, NativeStorage>,
    request: tauri::ipc::Request<'_>,
) -> Result<NativeMediaRecord, String> {
    let bucket = request_header(&request, "x-wg-bucket")?;
    let encoded_key = request_header(&request, "x-wg-key")?;
    let key =
        String::from_utf8(percent_decode(&encoded_key)?).map_err(|_| "媒体键无效".to_string())?;
    let mime_type = request_header(&request, "content-type")?.to_ascii_lowercase();
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("媒体数据格式无效".to_string());
    };
    save_media(&storage, bucket, key, mime_type, bytes)
}

#[tauri::command]
pub async fn native_media_upload_begin(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
    mime_type: String,
    expected_bytes: u64,
) -> Result<String, String> {
    validate_media_identity(&bucket, &key)?;
    let mime_type = mime_type.trim().to_ascii_lowercase();
    validate_upload_metadata(&mime_type, expected_bytes)?;

    let upload_id = new_upload_id();
    validate_upload_id(&upload_id)?;
    let temporary_filename = format!("{upload_id}.part");
    let temporary_path = storage.upload_root.join(&temporary_filename);
    create_private_file(&temporary_path)?;

    let insert_result = match storage.lock() {
        Ok(connection) => connection.execute(
            "
            INSERT INTO media_uploads(
                upload_id, bucket, key, mime_type, temporary_filename,
                expected_bytes, received_bytes, created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)
            ",
            params![
                upload_id,
                bucket,
                key,
                mime_type,
                temporary_filename,
                expected_bytes as i64,
                unix_timestamp()
            ],
        ),
        Err(error) => {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
    };
    if let Err(error) = insert_result {
        let _ = fs::remove_file(temporary_path);
        return Err(format!("无法开始媒体写入：{error}"));
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(upload_id)
}

#[tauri::command]
pub async fn native_media_upload_chunk(
    storage: State<'_, NativeStorage>,
    request: tauri::ipc::Request<'_>,
) -> Result<u64, String> {
    let bucket = request_header(&request, "x-wg-bucket")?;
    let key = decode_request_key(&request)?;
    let mime_type = request_header(&request, "x-wg-mime-type")?
        .trim()
        .to_ascii_lowercase();
    let upload_id = request_header(&request, "x-wg-upload-id")?;
    let expected_bytes = request_header_u64(&request, "x-wg-total-bytes")?;
    let offset = request_header_u64(&request, "x-wg-offset")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("媒体分块格式无效".to_string());
    };

    append_media_upload_chunk(
        &storage,
        bucket,
        key,
        mime_type,
        upload_id,
        expected_bytes,
        offset,
        bytes,
    )
}

/// JSON/base64 fallback for WebViews that strip custom headers from raw IPC
/// requests. Large Seedream images use chunked storage, so this path must stay
/// equivalent to `native_media_upload_chunk` rather than falling back to one
/// oversized data URL payload.
#[tauri::command]
pub async fn native_media_upload_chunk_base64(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
    mime_type: String,
    upload_id: String,
    expected_bytes: u64,
    offset: u64,
    data_base64: String,
) -> Result<u64, String> {
    let bytes = BASE64_STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|_| "媒体分块无法解码".to_string())?;
    append_media_upload_chunk(
        &storage,
        bucket,
        key,
        mime_type,
        upload_id,
        expected_bytes,
        offset,
        &bytes,
    )
}

fn append_media_upload_chunk(
    storage: &NativeStorage,
    bucket: String,
    key: String,
    mime_type: String,
    upload_id: String,
    expected_bytes: u64,
    offset: u64,
    bytes: &[u8],
) -> Result<u64, String> {
    validate_media_identity(&bucket, &key)?;
    validate_upload_metadata(&mime_type, expected_bytes)?;
    validate_upload_id(&upload_id)?;
    if bytes.is_empty() || bytes.len() > MAX_MEDIA_CHUNK_BYTES {
        return Err("媒体分块大小无效".to_string());
    }
    let next_offset = offset
        .checked_add(bytes.len() as u64)
        .filter(|next| *next <= expected_bytes)
        .ok_or_else(|| "媒体分块超出预期大小".to_string())?;

    // Keep the native storage lock for the short append/update pair so two
    // concurrent chunks cannot race on the same upload.
    let connection = storage.lock()?;
    let upload = query_media_upload(&connection, &upload_id)?
        .ok_or_else(|| "媒体写入会话已失效".to_string())?;
    validate_upload_request(&upload, &bucket, &key, &mime_type, expected_bytes)?;
    if upload.received_bytes != offset {
        return Err("媒体分块顺序无效".to_string());
    }
    if !is_safe_upload_filename(&upload.temporary_filename) {
        return Err("媒体写入会话无效".to_string());
    }

    let temporary_path = storage.upload_root.join(&upload.temporary_filename);
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&temporary_path)
        .map_err(|error| format!("无法继续媒体写入：{error}"))?;
    let actual_length = file
        .metadata()
        .map_err(|error| format!("无法检查媒体分块：{error}"))?
        .len();
    if actual_length != offset {
        return Err("媒体分块状态不一致，请重新写入".to_string());
    }
    file.seek(std::io::SeekFrom::Start(offset))
        .map_err(|error| format!("无法定位媒体分块：{error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.flush()) {
        let _ = file.set_len(offset);
        return Err(format!("写入媒体分块失败：{error}"));
    }

    let update_result = connection.execute(
        "
        UPDATE media_uploads
        SET received_bytes = ?1
        WHERE upload_id = ?2 AND received_bytes = ?3
        ",
        params![next_offset as i64, upload_id, offset as i64],
    );
    match update_result {
        Ok(1) => Ok(next_offset),
        Ok(_) => {
            let _ = file.set_len(offset);
            Err("媒体分块状态已变化，请重新写入".to_string())
        }
        Err(error) => {
            let _ = file.set_len(offset);
            Err(format!("保存媒体分块状态失败：{error}"))
        }
    }
}

#[tauri::command]
pub async fn native_media_upload_commit(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
    mime_type: String,
    expected_bytes: u64,
    upload_id: String,
) -> Result<NativeMediaRecord, String> {
    validate_media_identity(&bucket, &key)?;
    let mime_type = mime_type.trim().to_ascii_lowercase();
    validate_upload_metadata(&mime_type, expected_bytes)?;
    validate_upload_id(&upload_id)?;

    // Serializing commit with chunk/abort prevents the temporary file and its
    // database cursor from diverging.
    let mut connection = storage.lock()?;
    let upload = query_media_upload(&connection, &upload_id)?
        .ok_or_else(|| "媒体写入会话已失效".to_string())?;
    validate_upload_request(&upload, &bucket, &key, &mime_type, expected_bytes)?;
    if upload.received_bytes != expected_bytes
        || !is_safe_upload_filename(&upload.temporary_filename)
    {
        return Err("媒体数据尚未完整写入".to_string());
    }

    let temporary_path = storage.upload_root.join(&upload.temporary_filename);
    let temporary_file =
        File::open(&temporary_path).map_err(|error| format!("无法读取待提交媒体：{error}"))?;
    let actual_bytes = temporary_file
        .metadata()
        .map_err(|error| format!("无法检查待提交媒体：{error}"))?
        .len();
    if actual_bytes != expected_bytes {
        return Err("媒体数据长度不一致，请重新写入".to_string());
    }
    temporary_file
        .sync_all()
        .map_err(|error| format!("无法同步待提交媒体：{error}"))?;

    let (url_key, filename) = new_media_version(&key, &mime_type);
    let bucket_dir = storage.media_root.join(&bucket);
    create_private_dir(&bucket_dir)?;
    let media_path = bucket_dir.join(&filename);
    fs::rename(&temporary_path, &media_path)
        .map_err(|error| format!("无法提交媒体文件：{error}"))?;
    if let Err(error) = set_private_file(&media_path) {
        if fs::rename(&media_path, &temporary_path).is_err() {
            let _ = fs::remove_file(&media_path);
            let _ = connection.execute(
                "DELETE FROM media_uploads WHERE upload_id = ?1",
                params![upload_id],
            );
        }
        return Err(error);
    }

    let database_result = (|| -> Result<Option<String>, String> {
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始媒体事务：{error}"))?;
        let previous_filename = transaction
            .query_row(
                "SELECT filename FROM media WHERE bucket = ?1 AND key = ?2",
                params![bucket, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("读取媒体索引失败：{error}"))?;
        transaction
            .execute(
                "
                INSERT INTO media(bucket, key, url_key, mime_type, filename, bytes, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(bucket, key) DO UPDATE SET
                    url_key = excluded.url_key,
                    mime_type = excluded.mime_type,
                    filename = excluded.filename,
                    bytes = excluded.bytes,
                    updated_at = excluded.updated_at
                ",
                params![
                    bucket,
                    key,
                    url_key,
                    mime_type,
                    filename,
                    expected_bytes as i64,
                    unix_timestamp()
                ],
            )
            .map_err(|error| format!("保存媒体索引失败：{error}"))?;
        transaction
            .execute(
                "DELETE FROM media_uploads WHERE upload_id = ?1",
                params![upload_id],
            )
            .map_err(|error| format!("完成媒体写入失败：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("提交媒体事务失败：{error}"))?;
        Ok(previous_filename)
    })();

    let previous_filename = match database_result {
        Ok(previous_filename) => previous_filename,
        Err(error) => {
            if fs::rename(&media_path, &temporary_path).is_err() {
                let _ = fs::remove_file(&media_path);
                let _ = connection.execute(
                    "DELETE FROM media_uploads WHERE upload_id = ?1",
                    params![upload_id],
                );
            }
            return Err(error);
        }
    };

    if let Some(previous_filename) = previous_filename {
        if previous_filename != filename && is_safe_filename(&previous_filename) {
            let _ = fs::remove_file(bucket_dir.join(previous_filename));
        }
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(media_record(
        &key,
        &url_key,
        &bucket,
        &mime_type,
        expected_bytes,
    ))
}

#[tauri::command]
pub async fn native_media_upload_abort(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
    mime_type: String,
    expected_bytes: u64,
    upload_id: String,
) -> Result<(), String> {
    validate_media_identity(&bucket, &key)?;
    let mime_type = mime_type.trim().to_ascii_lowercase();
    validate_upload_metadata(&mime_type, expected_bytes)?;
    validate_upload_id(&upload_id)?;

    let connection = storage.lock()?;
    let Some(upload) = query_media_upload(&connection, &upload_id)? else {
        return Ok(());
    };
    validate_upload_request(&upload, &bucket, &key, &mime_type, expected_bytes)?;
    if !is_safe_upload_filename(&upload.temporary_filename) {
        return Err("媒体写入会话无效".to_string());
    }
    let temporary_path = storage.upload_root.join(upload.temporary_filename);
    match fs::remove_file(temporary_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("清理媒体写入失败：{error}")),
    };
    connection
        .execute(
            "DELETE FROM media_uploads WHERE upload_id = ?1",
            params![upload_id],
        )
        .map_err(|error| format!("取消媒体写入失败：{error}"))?;
    Ok(())
}

fn save_media(
    storage: &NativeStorage,
    bucket: String,
    key: String,
    mime_type: String,
    bytes: &[u8],
) -> Result<NativeMediaRecord, String> {
    validate_media_identity(&bucket, &key)?;
    if !is_safe_mime(&mime_type) {
        return Err("媒体类型无效".to_string());
    }
    let (url_key, filename) = new_media_version(&key, &mime_type);
    let bucket_dir = storage.media_root.join(&bucket);
    create_private_dir(&bucket_dir)?;
    let media_path = bucket_dir.join(&filename);

    let previous_filename = {
        let connection = storage.lock()?;
        connection
            .query_row(
                "SELECT filename FROM media WHERE bucket = ?1 AND key = ?2",
                params![bucket, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("读取媒体索引失败：{error}"))?
    };

    write_private_file_atomically(&media_path, bytes)?;

    let database_result = {
        let connection = storage.lock()?;
        connection.execute(
            "
            INSERT INTO media(bucket, key, url_key, mime_type, filename, bytes, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(bucket, key) DO UPDATE SET
                url_key = excluded.url_key,
                mime_type = excluded.mime_type,
                filename = excluded.filename,
                bytes = excluded.bytes,
                updated_at = excluded.updated_at
            ",
            params![
                bucket,
                key,
                url_key,
                mime_type,
                filename,
                bytes.len() as i64,
                unix_timestamp()
            ],
        )
    };

    if let Err(error) = database_result {
        if previous_filename.as_deref() != Some(filename.as_str()) {
            let _ = fs::remove_file(&media_path);
        }
        return Err(format!("保存媒体索引失败：{error}"));
    }

    if let Some(previous_filename) = previous_filename {
        if previous_filename != filename && is_safe_filename(&previous_filename) {
            let _ = fs::remove_file(bucket_dir.join(previous_filename));
        }
    }

    set_sqlite_companion_permissions(&storage.database_path);
    Ok(media_record(
        &key,
        &url_key,
        &bucket,
        &mime_type,
        bytes.len() as u64,
    ))
}

/// Stores bytes fetched by the native networking layer so provider URLs do not
/// need to satisfy the embedded WebView's cross-origin rules.
pub(crate) fn save_remote_media(
    storage: &NativeStorage,
    bucket: String,
    key: String,
    mime_type: String,
    bytes: &[u8],
) -> Result<NativeMediaRecord, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_MEDIA_BYTES {
        return Err("媒体大小无效".to_string());
    }
    save_media(storage, bucket, key, mime_type, bytes)
}

/// Copies an already-authorized local media file into native app storage.
///
/// The source path is never persisted or returned. The copy is streamed and
/// fingerprinted, then promoted with the same versioned URL/index guarantees
/// as media received through IPC.
#[allow(dead_code)]
pub(crate) fn import_native_media_file(
    storage: &NativeStorage,
    source: &Path,
    bucket: &str,
    key: &str,
    mime_type: &str,
) -> Result<NativeMediaImportResult, String> {
    import_native_media_file_if_changed(storage, source, bucket, key, mime_type, None)?
        .ok_or_else(|| "媒体文件未发生变化".to_string())
}

/// Streams a local media file into native storage unless its content
/// signature is already known by the caller.
pub(crate) fn import_native_media_file_if_changed(
    storage: &NativeStorage,
    source: &Path,
    bucket: &str,
    key: &str,
    mime_type: &str,
    previous_signature: Option<&str>,
) -> Result<Option<NativeMediaImportResult>, String> {
    validate_media_identity(bucket, key)?;
    let mime_type = mime_type.trim().to_ascii_lowercase();
    if !is_safe_mime(&mime_type) {
        return Err("媒体类型无效".to_string());
    }

    let (url_key, filename) = new_media_version(key, &mime_type);
    let bucket_dir = storage.media_root.join(bucket);
    create_private_dir(&bucket_dir)?;
    let temporary_path = bucket_dir.join(format!(".wg-import-{}.tmp", new_upload_id()));
    let media_path = bucket_dir.join(&filename);
    let mut destination = create_private_file(&temporary_path)?;

    let copy_result = copy_stable_source_file(source, &mut destination);
    drop(destination);
    let (bytes, signature) = match copy_result {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
    };
    if previous_signature.is_some_and(|previous| previous == signature) {
        let _ = fs::remove_file(&temporary_path);
        return Ok(None);
    }

    if let Err(error) = fs::rename(&temporary_path, &media_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("无法保存媒体文件：{error}"));
    }
    if let Err(error) = set_private_file(&media_path) {
        let _ = fs::remove_file(&media_path);
        return Err(error);
    }

    let database_result = (|| -> Result<Option<String>, String> {
        let mut connection = storage.lock()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("无法开始媒体事务：{error}"))?;
        let previous_filename = transaction
            .query_row(
                "SELECT filename FROM media WHERE bucket = ?1 AND key = ?2",
                params![bucket, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("读取媒体索引失败：{error}"))?;
        transaction
            .execute(
                "
                INSERT INTO media(bucket, key, url_key, mime_type, filename, bytes, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                ON CONFLICT(bucket, key) DO UPDATE SET
                    url_key = excluded.url_key,
                    mime_type = excluded.mime_type,
                    filename = excluded.filename,
                    bytes = excluded.bytes,
                    updated_at = excluded.updated_at
                ",
                params![
                    bucket,
                    key,
                    url_key,
                    mime_type,
                    filename,
                    bytes as i64,
                    unix_timestamp()
                ],
            )
            .map_err(|error| format!("保存媒体索引失败：{error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("提交媒体事务失败：{error}"))?;
        Ok(previous_filename)
    })();

    let previous_filename = match database_result {
        Ok(previous_filename) => previous_filename,
        Err(error) => {
            let _ = fs::remove_file(&media_path);
            return Err(error);
        }
    };
    if let Some(previous_filename) = previous_filename {
        if previous_filename != filename && is_safe_filename(&previous_filename) {
            let _ = fs::remove_file(bucket_dir.join(previous_filename));
        }
    }

    set_sqlite_companion_permissions(&storage.database_path);
    Ok(Some(NativeMediaImportResult {
        record: media_record(key, &url_key, bucket, &mime_type, bytes),
        signature,
    }))
}

#[tauri::command]
pub async fn native_media_get(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
) -> Result<Option<NativeMediaRecord>, String> {
    validate_media_identity(&bucket, &key)?;
    let connection = storage.lock()?;
    let media = query_media_by_key(&connection, &bucket, &key)?;
    Ok(media.and_then(|media| {
        let path = storage.media_root.join(&bucket).join(&media.filename);
        let metadata = path.metadata().ok()?;
        (metadata.is_file() && metadata.len() == media.bytes).then(|| {
            media_record(
                &media.key,
                &media.url_key,
                &bucket,
                &media.mime_type,
                media.bytes,
            )
        })
    }))
}

/// Returns an already-owned media item as a data URL for request bodies. This
/// avoids asking the embedded WebView to fetch a custom `wg-media:` URL when a
/// provider needs a reference image or video encoded inline.
#[tauri::command]
pub async fn native_media_read_data_url(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
) -> Result<Option<String>, String> {
    validate_media_identity(&bucket, &key)?;
    let media = {
        let connection = storage.lock()?;
        query_media_by_key(&connection, &bucket, &key)?
    };
    let Some(media) = media else {
        return Ok(None);
    };
    if !is_safe_filename(&media.filename) || !is_safe_mime(&media.mime_type) {
        return Err("媒体记录无效".to_string());
    }
    let path = storage.media_root.join(&bucket).join(&media.filename);
    let bytes = fs::read(path).map_err(|error| format!("无法读取媒体：{error}"))?;
    if bytes.len() as u64 != media.bytes {
        return Err("媒体内容不完整".to_string());
    }
    Ok(Some(format!(
        "data:{};base64,{}",
        media.mime_type,
        BASE64_STANDARD.encode(bytes)
    )))
}

/// Exports media through the native filesystem instead of asking the embedded
/// WebView to navigate to a private `wg-media:` URL. WebKit treats that custom
/// URL as a page load during downloads, which surfaces as an unhelpful
/// `Load failed` error in packaged desktop builds.
#[tauri::command]
pub async fn native_media_export_to_downloads(
    app: AppHandle,
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
    suggested_name: String,
) -> Result<String, String> {
    let safe_name = sanitize_export_filename(&suggested_name)?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|error| format!("无法确定下载目录：{error}"))?;
    fs::create_dir_all(&downloads).map_err(|error| format!("无法打开下载目录：{error}"))?;

    for duplicate_index in 0..10_000_u32 {
        let filename = export_filename_for_index(&safe_name, duplicate_index);
        let destination = downloads.join(&filename);
        match copy_native_media_to_path(&storage, &bucket, &key, &destination) {
            Ok(_) => return Ok(filename),
            Err(_error) if destination.exists() => continue,
            Err(error) => return Err(error.replace("终端输入媒体", "媒体")),
        }
    }

    Err("下载目录中同名文件过多，请整理后重试".to_string())
}

/// Copies a native media item to an already-isolated destination without
/// sending its bytes or private filesystem location through the WebView.
pub(crate) fn copy_native_media_to_path(
    storage: &NativeStorage,
    bucket: &str,
    key: &str,
    destination: &Path,
) -> Result<String, String> {
    validate_media_identity(bucket, key)?;
    let (mut source, mime_type, expected_bytes) = {
        let connection = storage.lock()?;
        let media = query_media_by_key(&connection, bucket, key)?
            .ok_or_else(|| "未找到终端输入媒体".to_string())?;
        if !is_safe_filename(&media.filename) || !is_safe_mime(&media.mime_type) {
            return Err("终端输入媒体无效".to_string());
        }
        let path = storage.media_root.join(bucket).join(&media.filename);
        let source = File::open(path).map_err(|error| format!("无法读取终端输入媒体：{error}"))?;
        let actual_bytes = source
            .metadata()
            .map_err(|error| format!("无法检查终端输入媒体：{error}"))?
            .len();
        if actual_bytes != media.bytes {
            return Err("终端输入媒体不完整".to_string());
        }
        (source, media.mime_type, media.bytes)
    };

    let mut target = create_private_file(destination)?;
    let copy_result = std::io::copy(&mut source, &mut target)
        .map_err(|error| format!("无法准备终端输入媒体：{error}"))
        .and_then(|bytes| {
            if bytes != expected_bytes {
                return Err("终端输入媒体不完整".to_string());
            }
            target
                .sync_all()
                .map_err(|error| format!("无法同步终端输入媒体：{error}"))?;
            set_private_file(destination)?;
            Ok(())
        });
    if let Err(error) = copy_result {
        drop(target);
        let _ = fs::remove_file(destination);
        return Err(error);
    }
    Ok(mime_type)
}

#[tauri::command]
pub async fn native_media_remove(
    storage: State<'_, NativeStorage>,
    bucket: String,
    key: String,
) -> Result<(), String> {
    validate_media_identity(&bucket, &key)?;
    let filename = {
        let connection = storage.lock()?;
        let filename = connection
            .query_row(
                "SELECT filename FROM media WHERE bucket = ?1 AND key = ?2",
                params![bucket, key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("读取媒体索引失败：{error}"))?;
        connection
            .execute(
                "DELETE FROM media WHERE bucket = ?1 AND key = ?2",
                params![bucket, key],
            )
            .map_err(|error| format!("删除媒体索引失败：{error}"))?;
        filename
    };

    if let Some(filename) = filename {
        if is_safe_filename(&filename) {
            let _ = fs::remove_file(storage.media_root.join(&bucket).join(filename));
        }
    }
    set_sqlite_companion_permissions(&storage.database_path);
    Ok(())
}

#[tauri::command]
pub async fn native_media_list(
    storage: State<'_, NativeStorage>,
    bucket: String,
) -> Result<Vec<NativeMediaRecord>, String> {
    validate_bucket(&bucket)?;
    let connection = storage.lock()?;
    let mut statement = connection
        .prepare(
            "SELECT key, url_key, mime_type, filename, bytes FROM media WHERE bucket = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|error| format!("读取媒体索引失败：{error}"))?;
    let rows = statement
        .query_map(params![bucket], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|error| format!("读取媒体索引失败：{error}"))?;

    let mut records = Vec::new();
    for row in rows {
        let (key, url_key, mime_type, filename, bytes) =
            row.map_err(|error| format!("读取媒体索引失败：{error}"))?;
        let path = storage.media_root.join(&bucket).join(filename);
        let expected_bytes = bytes.max(0) as u64;
        if path
            .metadata()
            .ok()
            .filter(|metadata| metadata.is_file() && metadata.len() == expected_bytes)
            .is_none()
        {
            continue;
        }
        records.push(media_record(
            &key,
            &url_key,
            &bucket,
            &mime_type,
            expected_bytes,
        ));
    }
    Ok(records)
}

pub fn media_protocol(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    match serve_media(&ctx, &request) {
        Ok(response) => response,
        Err((status, message)) => response_with_text(status, message),
    }
}

fn serve_media(
    ctx: &tauri::UriSchemeContext<'_, tauri::Wry>,
    request: &http::Request<Vec<u8>>,
) -> Result<http::Response<Vec<u8>>, (http::StatusCode, &'static str)> {
    if request.method() != http::Method::GET && request.method() != http::Method::HEAD {
        return Ok(http::Response::builder()
            .status(http::StatusCode::METHOD_NOT_ALLOWED)
            .header(http::header::ALLOW, "GET, HEAD")
            .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Vec::new())
            .unwrap_or_else(|_| http::Response::new(Vec::new())));
    }

    let mut segments = request.uri().path().trim_start_matches('/').split('/');
    let bucket = segments.next().unwrap_or_default();
    let url_key = segments.next().unwrap_or_default();
    if segments.next().is_some() || validate_bucket(bucket).is_err() || !is_url_safe_key(url_key) {
        return Err((http::StatusCode::BAD_REQUEST, "Invalid media URL"));
    }

    let storage = ctx
        .app_handle()
        .try_state::<NativeStorage>()
        .ok_or((http::StatusCode::SERVICE_UNAVAILABLE, "Storage unavailable"))?;
    let media = {
        let connection = storage.connection.lock().map_err(|_| {
            (
                http::StatusCode::INTERNAL_SERVER_ERROR,
                "Storage unavailable",
            )
        })?;
        query_media_by_url_key(&connection, bucket, url_key)
            .map_err(|_| {
                (
                    http::StatusCode::INTERNAL_SERVER_ERROR,
                    "Storage unavailable",
                )
            })?
            .ok_or((http::StatusCode::NOT_FOUND, "Media not found"))?
    };
    if !is_safe_filename(&media.filename) {
        return Err((http::StatusCode::BAD_REQUEST, "Invalid media URL"));
    }

    let path = storage.media_root.join(bucket).join(&media.filename);
    let mut file =
        File::open(path).map_err(|_| (http::StatusCode::NOT_FOUND, "Media not found"))?;
    let length = file
        .metadata()
        .map_err(|_| (http::StatusCode::INTERNAL_SERVER_ERROR, "Media unavailable"))?
        .len();

    let range_header = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|value| value.to_str().ok());
    let requested_range = match range_header {
        Some(value) => match parse_byte_range(value, length) {
            Some(range) => Some(range),
            None => return Ok(range_not_satisfiable(length)),
        },
        None => None,
    };

    let (status, start, end) = requested_range
        .map(|(start, end)| (http::StatusCode::PARTIAL_CONTENT, start, end))
        .unwrap_or_else(|| (http::StatusCode::OK, 0, length.saturating_sub(1)));
    let response_length = if length == 0 { 0 } else { end - start + 1 };

    if start > 0 {
        use std::io::Seek;
        file.seek(std::io::SeekFrom::Start(start))
            .map_err(|_| (http::StatusCode::INTERNAL_SERVER_ERROR, "Media unavailable"))?;
    }
    let mut body = Vec::with_capacity(response_length.min(usize::MAX as u64) as usize);
    if request.method() != http::Method::HEAD && response_length > 0 {
        file.take(response_length)
            .read_to_end(&mut body)
            .map_err(|_| (http::StatusCode::INTERNAL_SERVER_ERROR, "Media unavailable"))?;
    }

    let mut builder = http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, media.mime_type)
        .header(http::header::CONTENT_LENGTH, response_length.to_string())
        .header(http::header::ACCEPT_RANGES, "bytes")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
        .header(
            http::header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        );
    if status == http::StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            http::header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{length}"),
        );
    }
    builder
        .body(body)
        .map_err(|_| (http::StatusCode::INTERNAL_SERVER_ERROR, "Media unavailable"))
}

fn range_not_satisfiable(length: u64) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(http::StatusCode::RANGE_NOT_SATISFIABLE)
        .header(http::header::CONTENT_RANGE, format!("bytes */{length}"))
        .header(http::header::ACCEPT_RANGES, "bytes")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
        .body(Vec::new())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

impl NativeStorage {
    fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.connection
            .lock()
            .map_err(|_| "应用数据库暂时不可用".to_string())
    }
}

fn query_media_by_key(
    connection: &Connection,
    bucket: &str,
    key: &str,
) -> Result<Option<StoredMedia>, String> {
    connection
        .query_row(
            "SELECT key, url_key, mime_type, filename, bytes FROM media WHERE bucket = ?1 AND key = ?2",
            params![bucket, key],
            |row| {
                Ok(StoredMedia {
                    key: row.get(0)?,
                    url_key: row.get(1)?,
                    mime_type: row.get(2)?,
                    filename: row.get(3)?,
                    bytes: row.get::<_, i64>(4)?.max(0) as u64,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取媒体索引失败：{error}"))
}

fn query_media_by_url_key(
    connection: &Connection,
    bucket: &str,
    url_key: &str,
) -> Result<Option<StoredMedia>, String> {
    connection
        .query_row(
            "SELECT key, url_key, mime_type, filename, bytes FROM media WHERE bucket = ?1 AND url_key = ?2",
            params![bucket, url_key],
            |row| {
                Ok(StoredMedia {
                    key: row.get(0)?,
                    url_key: row.get(1)?,
                    mime_type: row.get(2)?,
                    filename: row.get(3)?,
                    bytes: row.get::<_, i64>(4)?.max(0) as u64,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取媒体索引失败：{error}"))
}

fn query_media_upload(
    connection: &Connection,
    upload_id: &str,
) -> Result<Option<MediaUpload>, String> {
    connection
        .query_row(
            "
            SELECT bucket, key, mime_type, temporary_filename, expected_bytes, received_bytes
            FROM media_uploads
            WHERE upload_id = ?1
            ",
            params![upload_id],
            |row| {
                Ok(MediaUpload {
                    bucket: row.get(0)?,
                    key: row.get(1)?,
                    mime_type: row.get(2)?,
                    temporary_filename: row.get(3)?,
                    expected_bytes: row.get::<_, i64>(4)?.max(0) as u64,
                    received_bytes: row.get::<_, i64>(5)?.max(0) as u64,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取媒体写入状态失败：{error}"))
}

fn validate_upload_request(
    upload: &MediaUpload,
    bucket: &str,
    key: &str,
    mime_type: &str,
    expected_bytes: u64,
) -> Result<(), String> {
    if upload.bucket != bucket
        || upload.key != key
        || upload.mime_type != mime_type
        || upload.expected_bytes != expected_bytes
    {
        return Err("媒体写入信息不匹配".to_string());
    }
    Ok(())
}

fn media_record(
    key: &str,
    url_key: &str,
    bucket: &str,
    mime_type: &str,
    bytes: u64,
) -> NativeMediaRecord {
    NativeMediaRecord {
        key: key.to_string(),
        url: format!("{MEDIA_SCHEME}://localhost/{bucket}/{url_key}"),
        mime_type: mime_type.to_string(),
        bytes,
    }
}

fn new_upload_id() -> String {
    let revision = MEDIA_REVISION.fetch_add(1, Ordering::Relaxed);
    URL_SAFE_NO_PAD.encode(
        format!(
            "{}:{}:{revision}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
        .as_bytes(),
    )
}

fn new_media_version(key: &str, mime_type: &str) -> (String, String) {
    let revision = MEDIA_REVISION.fetch_add(1, Ordering::Relaxed);
    let url_key = URL_SAFE_NO_PAD.encode(
        format!(
            "{key}:{}:{revision}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
        .as_bytes(),
    );
    let filename = format!("{url_key}.{}", extension_for_mime(mime_type));
    (url_key, filename)
}

fn encode_store_value(value: &[u8]) -> Result<(Vec<u8>, &'static str), String> {
    if value.len() < GZIP_THRESHOLD {
        return Ok((value.to_vec(), "raw"));
    }
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder
        .write_all(value)
        .map_err(|error| format!("压缩应用数据失败：{error}"))?;
    let compressed = encoder
        .finish()
        .map_err(|error| format!("压缩应用数据失败：{error}"))?;
    Ok((compressed, "gzip"))
}

fn decode_store_value(value: Vec<u8>, encoding: &str) -> Result<String, String> {
    let decoded = match encoding {
        "raw" => value,
        "gzip" => {
            let mut decoder = GzDecoder::new(value.as_slice());
            let mut decoded = Vec::new();
            decoder
                .read_to_end(&mut decoded)
                .map_err(|error| format!("解压应用数据失败：{error}"))?;
            decoded
        }
        _ => return Err("应用数据编码无法识别".to_string()),
    };
    String::from_utf8(decoded).map_err(|_| "应用数据不是有效文本".to_string())
}

fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (header, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "媒体数据格式无效".to_string())?;
    let metadata = header
        .strip_prefix("data:")
        .ok_or_else(|| "媒体数据格式无效".to_string())?;
    let mut metadata_parts = metadata.split(';');
    let mime_type = metadata_parts
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !is_safe_mime(&mime_type) {
        return Err("媒体类型无效".to_string());
    }
    let is_base64 = metadata_parts.any(|part| part.eq_ignore_ascii_case("base64"));
    let bytes = if is_base64 {
        BASE64_STANDARD
            .decode(payload.as_bytes())
            .map_err(|_| "媒体数据无法解码".to_string())?
    } else {
        percent_decode(payload)?
    };
    Ok((mime_type, bytes))
}

fn request_header(request: &tauri::ipc::Request<'_>, name: &str) -> Result<String, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| "媒体请求缺少必要信息".to_string())
}

fn request_header_u64(request: &tauri::ipc::Request<'_>, name: &str) -> Result<u64, String> {
    request_header(request, name)?
        .parse::<u64>()
        .map_err(|_| "媒体请求数值无效".to_string())
}

fn decode_request_key(request: &tauri::ipc::Request<'_>) -> Result<String, String> {
    let encoded_key = request_header(request, "x-wg-key")?;
    String::from_utf8(percent_decode(&encoded_key)?).map_err(|_| "媒体键无效".to_string())
}

fn percent_decode(value: &str) -> Result<Vec<u8>, String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("媒体数据无法解码".to_string());
            }
            let high = hex_value(bytes[index + 1]).ok_or_else(|| "媒体数据无法解码".to_string())?;
            let low = hex_value(bytes[index + 2]).ok_or_else(|| "媒体数据无法解码".to_string())?;
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    Ok(decoded)
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        "application/pdf" => "pdf",
        _ => "bin",
    }
}

fn parse_byte_range(header: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let range = header.strip_prefix("bytes=")?;
    if range.contains(',') {
        return None;
    }
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        let suffix = suffix.min(length);
        return Some((length - suffix, length - 1));
    }
    let start = start.parse::<u64>().ok()?;
    if start >= length {
        return None;
    }
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>().ok()?.min(length - 1)
    };
    (start <= end).then_some((start, end))
}

fn response_with_text(status: http::StatusCode, message: &'static str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

fn validate_store_identity(namespace: &str, key: &str) -> Result<(), String> {
    validate_namespace(namespace)?;
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("存储键无效".to_string());
    }
    Ok(())
}

fn validate_namespace(namespace: &str) -> Result<(), String> {
    if namespace.is_empty() || namespace.len() > 256 || namespace.chars().any(char::is_control) {
        return Err("存储命名空间无效".to_string());
    }
    Ok(())
}

fn validate_media_identity(bucket: &str, key: &str) -> Result<(), String> {
    validate_bucket(bucket)?;
    if key.is_empty() || key.len() > 4096 || key.chars().any(char::is_control) {
        return Err("媒体键无效".to_string());
    }
    Ok(())
}

fn validate_upload_metadata(mime_type: &str, expected_bytes: u64) -> Result<(), String> {
    if !is_safe_mime(mime_type) {
        return Err("媒体类型无效".to_string());
    }
    if expected_bytes == 0 || expected_bytes > MAX_MEDIA_BYTES {
        return Err("媒体大小无效".to_string());
    }
    Ok(())
}

fn validate_upload_id(upload_id: &str) -> Result<(), String> {
    if upload_id.is_empty()
        || upload_id.len() > 128
        || !upload_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err("媒体写入标识无效".to_string());
    }
    Ok(())
}

fn validate_bucket(bucket: &str) -> Result<(), String> {
    if bucket.is_empty()
        || bucket.len() > 64
        || !bucket
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err("媒体分组无效".to_string());
    }
    Ok(())
}

fn is_url_safe_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 5462
        && key
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
}

fn is_safe_filename(filename: &str) -> bool {
    !filename.is_empty()
        && filename.len() <= 5480
        && filename
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_' | b'.'))
        && filename != "."
        && filename != ".."
}

fn sanitize_export_filename(filename: &str) -> Result<String, String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() || trimmed.len() > 180 || trimmed.chars().any(char::is_control) {
        return Err("下载文件名无效".to_string());
    }
    if Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        != Some(trimmed)
        || matches!(trimmed, "." | "..")
    {
        return Err("下载文件名无效".to_string());
    }
    let safe = trimmed
        .chars()
        .map(|value| match value {
            '/' | '\\' | ':' => '-',
            _ => value,
        })
        .collect::<String>();
    Ok(safe)
}

fn export_filename_for_index(filename: &str, duplicate_index: u32) -> String {
    if duplicate_index == 0 {
        return filename.to_string();
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("WorkflowGenerator");
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => {
            format!("{stem} ({duplicate_index}).{extension}")
        }
        _ => format!("{stem} ({duplicate_index})"),
    }
}

fn is_safe_upload_filename(filename: &str) -> bool {
    filename
        .strip_suffix(".part")
        .is_some_and(|upload_id| validate_upload_id(upload_id).is_ok())
}

fn is_safe_mime(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "image/jpeg"
            | "image/png"
            | "image/webp"
            | "image/gif"
            | "image/avif"
            | "video/mp4"
            | "video/webm"
            | "video/quicktime"
            | "audio/mpeg"
            | "audio/mp4"
            | "audio/x-m4a"
            | "audio/wav"
            | "audio/x-wav"
            | "audio/ogg"
            | "audio/flac"
    )
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn clear_stale_media_uploads(connection: &Connection, upload_root: &Path) -> Result<(), String> {
    // Keep recent rows in case another app window is uploading against the
    // same native database. Old partials are not resumable and are reclaimed.
    let cutoff = unix_timestamp().saturating_sub(STALE_UPLOAD_AGE_MILLIS);
    let stale_filenames = {
        let mut statement = connection
            .prepare("SELECT temporary_filename FROM media_uploads WHERE created_at < ?1")
            .map_err(|error| format!("无法检查未完成媒体写入：{error}"))?;
        let rows = statement
            .query_map(params![cutoff], |row| row.get::<_, String>(0))
            .map_err(|error| format!("无法检查未完成媒体写入：{error}"))?;
        let mut filenames = Vec::new();
        for row in rows {
            filenames.push(row.map_err(|error| format!("无法检查未完成媒体写入：{error}"))?);
        }
        filenames
    };
    for filename in stale_filenames {
        if is_safe_upload_filename(&filename) {
            let path = upload_root.join(filename);
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("无法清理未完成媒体写入：{error}")),
            }
        }
    }
    connection
        .execute(
            "DELETE FROM media_uploads WHERE created_at < ?1",
            params![cutoff],
        )
        .map_err(|error| format!("无法清理未完成媒体写入：{error}"))?;

    let entries =
        fs::read_dir(upload_root).map_err(|error| format!("无法检查未完成媒体写入：{error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法检查未完成媒体写入：{error}"))?;
        let filename = entry.file_name();
        let Some(filename) = filename.to_str() else {
            continue;
        };
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法检查未完成媒体写入：{error}"))?;
        let is_stale = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .is_some_and(|modified| modified.as_millis() <= cutoff.max(0) as u128);
        if file_type.is_file() && is_stale && is_safe_upload_filename(filename) {
            fs::remove_file(entry.path())
                .map_err(|error| format!("无法清理未完成媒体写入：{error}"))?;
        }
    }
    Ok(())
}

#[allow(dead_code)]
fn copy_stable_source_file(source: &Path, destination: &mut File) -> Result<(u64, String), String> {
    const BUFFER_BYTES: usize = 1024 * 1024;
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x00000100000001b3;

    let path_before = source_snapshot(
        &fs::metadata(source).map_err(|error| format!("无法读取源媒体：{error}"))?,
    )?;
    if path_before.bytes > MAX_MEDIA_BYTES {
        return Err("媒体大小无效".to_string());
    }
    let mut source_file = File::open(source).map_err(|error| format!("无法打开源媒体：{error}"))?;
    let handle_before = source_snapshot(
        &source_file
            .metadata()
            .map_err(|error| format!("无法检查源媒体：{error}"))?,
    )?;
    if handle_before != path_before {
        return Err("源媒体在读取前发生了变化".to_string());
    }

    let mut buffer = vec![0_u8; BUFFER_BYTES];
    let mut copied_bytes = 0_u64;
    let mut hash = FNV_OFFSET_BASIS;
    loop {
        let length = source_file
            .read(&mut buffer)
            .map_err(|error| format!("读取源媒体失败：{error}"))?;
        if length == 0 {
            break;
        }
        copied_bytes = copied_bytes
            .checked_add(length as u64)
            .filter(|bytes| *bytes <= MAX_MEDIA_BYTES)
            .ok_or_else(|| "媒体大小无效".to_string())?;
        for byte in &buffer[..length] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
        destination
            .write_all(&buffer[..length])
            .map_err(|error| format!("写入媒体失败：{error}"))?;
    }
    destination
        .sync_all()
        .map_err(|error| format!("同步媒体失败：{error}"))?;

    let handle_after = source_snapshot(
        &source_file
            .metadata()
            .map_err(|error| format!("无法复查源媒体：{error}"))?,
    )?;
    let path_after = source_snapshot(
        &fs::metadata(source).map_err(|error| format!("无法复查源媒体：{error}"))?,
    )?;
    if copied_bytes != path_before.bytes || handle_after != path_before || path_after != path_before
    {
        return Err("源媒体在复制过程中发生了变化".to_string());
    }

    Ok((copied_bytes, format!("fnv1a64:{hash:016x}:{copied_bytes}")))
}

#[allow(dead_code)]
fn source_snapshot(metadata: &fs::Metadata) -> Result<SourceFileSnapshot, String> {
    if !metadata.is_file() {
        return Err("源媒体不是普通文件".to_string());
    }
    let modified_nanos = metadata
        .modified()
        .map_err(|error| format!("无法读取源媒体时间：{error}"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "源媒体时间无效".to_string())?
        .as_nanos();
    Ok(SourceFileSnapshot {
        bytes: metadata.len(),
        modified_nanos,
    })
}

fn write_private_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "媒体目录无效".to_string())?;
    create_private_dir(parent)?;
    let temporary_name = format!(".wg-{}.tmp", new_upload_id());
    let temporary_path = parent.join(temporary_name);
    let mut file = create_private_file(&temporary_path)?;
    let write_result = (|| {
        file.write_all(bytes)
            .map_err(|error| format!("写入媒体失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("写入媒体失败：{error}"))?;
        fs::rename(&temporary_path, path).map_err(|error| format!("保存媒体失败：{error}"))?;
        set_private_file(path)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

fn create_private_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|error| format!("无法创建媒体文件：{error}"))
}

fn create_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("无法保护应用数据目录：{error}"))?;
    }
    Ok(())
}

fn set_private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("无法保护应用数据文件：{error}"))?;
    }
    Ok(())
}

fn set_sqlite_companion_permissions(database_path: &Path) {
    let _ = set_private_file(database_path);
    for suffix in ["-wal", "-shm"] {
        let mut companion_name = database_path.as_os_str().to_os_string();
        companion_name.push(suffix);
        let companion = PathBuf::from(companion_name);
        if companion.exists() {
            let _ = set_private_file(&companion);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_ended_and_suffix_ranges() {
        assert_eq!(parse_byte_range("bytes=2-", 10), Some((2, 9)));
        assert_eq!(parse_byte_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_byte_range("bytes=2-30", 10), Some((2, 9)));
        assert_eq!(parse_byte_range("bytes=10-", 10), None);
    }

    #[test]
    fn compresses_only_values_at_or_above_threshold() {
        let (small, small_encoding) = encode_store_value(b"hello").unwrap();
        assert_eq!(small_encoding, "raw");
        assert_eq!(decode_store_value(small, small_encoding).unwrap(), "hello");

        let original = "z".repeat(GZIP_THRESHOLD);
        let (large, large_encoding) = encode_store_value(original.as_bytes()).unwrap();
        assert_eq!(large_encoding, "gzip");
        assert_eq!(decode_store_value(large, large_encoding).unwrap(), original);
    }

    #[test]
    fn creates_safe_unique_download_names() {
        assert_eq!(
            sanitize_export_filename("result.png").unwrap(),
            "result.png"
        );
        assert_eq!(
            sanitize_export_filename("结果: 1.png").unwrap(),
            "结果- 1.png"
        );
        assert!(sanitize_export_filename("../result.png").is_err());
        assert!(sanitize_export_filename("folder/result.png").is_err());
        assert_eq!(export_filename_for_index("result.png", 0), "result.png");
        assert_eq!(export_filename_for_index("result.png", 2), "result (2).png");
        assert_eq!(export_filename_for_index("result", 1), "result (1)");
    }

    #[test]
    fn imports_local_media_as_a_streamed_versioned_asset() {
        let root = std::env::temp_dir().join(format!(
            "workflowgenerator-native-import-{}-{}",
            std::process::id(),
            new_upload_id()
        ));
        let data_root = root.join("data");
        let media_root = root.join("media");
        let upload_root = media_root.join(".uploads");
        create_private_dir(&data_root).unwrap();
        create_private_dir(&media_root).unwrap();
        create_private_dir(&upload_root).unwrap();
        let database_path = data_root.join("test.sqlite3");
        let connection = Connection::open(&database_path).unwrap();
        connection
            .execute_batch(
                "
                CREATE TABLE media (
                    bucket TEXT NOT NULL,
                    key TEXT NOT NULL,
                    url_key TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    bytes INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (bucket, key),
                    UNIQUE (bucket, url_key)
                );
                ",
            )
            .unwrap();
        let storage = NativeStorage {
            connection: Mutex::new(connection),
            database_path,
            media_root: media_root.clone(),
            upload_root,
        };
        let source = root.join("source.bin");
        fs::write(&source, b"hello").unwrap();

        let first =
            import_native_media_file(&storage, &source, "assets", "hero", "image/png").unwrap();
        assert_eq!(first.record.key, "hero");
        assert_eq!(first.record.mime_type, "image/png");
        assert_eq!(first.record.bytes, 5);
        assert_eq!(first.signature, "fnv1a64:a430d84680aabd0b:5");
        assert!(first.record.url.starts_with("wg-media://localhost/assets/"));
        assert!(!first.record.url.contains(root.to_string_lossy().as_ref()));

        let first_filename: String = storage
            .lock()
            .unwrap()
            .query_row(
                "SELECT filename FROM media WHERE bucket = 'assets' AND key = 'hero'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            fs::read(media_root.join("assets").join(&first_filename)).unwrap(),
            b"hello"
        );

        fs::write(&source, b"world!").unwrap();
        let second =
            import_native_media_file(&storage, &source, "assets", "hero", "image/png").unwrap();
        assert_eq!(second.record.bytes, 6);
        assert_ne!(second.record.url, first.record.url);
        assert!(!media_root.join("assets").join(first_filename).exists());
        assert!(import_native_media_file_if_changed(
            &storage,
            &source,
            "assets",
            "hero",
            "image/png",
            Some(&second.signature),
        )
        .unwrap()
        .is_none());

        let terminal_input = root.join("terminal-input.bin");
        assert_eq!(
            copy_native_media_to_path(&storage, "assets", "hero", &terminal_input).unwrap(),
            "image/png"
        );
        assert_eq!(fs::read(&terminal_input).unwrap(), b"world!");

        let retained_url: String = storage
            .lock()
            .unwrap()
            .query_row(
                "SELECT url_key FROM media WHERE bucket = 'assets' AND key = 'hero'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(second.record.url.ends_with(&retained_url));
        assert!(import_native_media_file(
            &storage,
            &source,
            "assets",
            "hero",
            "application/octet-stream"
        )
        .is_err());
        let retained_after_failure: String = storage
            .lock()
            .unwrap()
            .query_row(
                "SELECT url_key FROM media WHERE bucket = 'assets' AND key = 'hero'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained_after_failure, retained_url);

        drop(storage);
        fs::remove_dir_all(root).unwrap();
    }
}
