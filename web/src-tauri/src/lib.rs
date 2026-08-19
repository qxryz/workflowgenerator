mod app_storage;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const PUBLISHER_MINISIGN_PUBLIC_KEY: &str =
    "RWSF/lzGZohk+sJRybkcDaxqLrkxOcM2sw47TT2WAXqqJ8kHZphSxVC3";

fn verify_publisher_payload(payload: &[u8], signature_text: &str) -> Result<(), String> {
    let public_key = minisign_verify::PublicKey::from_base64(PUBLISHER_MINISIGN_PUBLIC_KEY)
        .map_err(|_| "发布者公钥无效".to_string())?;
    let trimmed = signature_text.trim();
    let normalized = if trimmed.starts_with("untrusted comment:") {
        trimmed.to_string()
    } else {
        String::from_utf8(
            BASE64
                .decode(trimmed)
                .map_err(|_| "发布签名格式无效".to_string())?,
        )
        .map_err(|_| "发布签名格式无效".to_string())?
    };
    let signature = minisign_verify::Signature::decode(&normalized)
        .map_err(|_| "发布签名格式无效".to_string())?;
    public_key
        .verify(payload, &signature, false)
        .map_err(|_| "发布签名校验失败".to_string())
}

#[cfg(test)]
mod publisher_signature_tests {
    use super::{verify_publisher_payload, BASE64};
    use base64::Engine;

    const TAURI_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTRi9sekdab2hrK2dDOEdSeFdNNXAxVjVia1hvbHJtTmYyVTkyVlFGQzBjZjlCeW1BcEQ1Q055R3lVVWh6TExXbWNsT28zVWhDK2VyaVRZZlUzUExobm55OENoMk01MGdBPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2OTU0NjkzCWZpbGU6d29ya2Zsb3dnZW5lcmF0b3ItcHVibGlzaGVyLXNpZ25hdHVyZS1maXh0dXJlLnR4dApFUE9KZWdxWDk4d3JqYUJMZ0tSNVlWbVdKU3hWR2pGUGd0MVRYb1BUYTRqODdDOG5uNjRDTDBxalJiNjRyeVZNbWpmNlFVWkZJUHdtSnBscjNyS2ZDUT09Cg==";

    #[test]
    fn verifies_tauri_base64_signature_envelopes_and_raw_minisign_text() {
        let payload = b"v0.1.0\n";
        verify_publisher_payload(payload, TAURI_SIGNATURE).unwrap();
        let raw_signature = String::from_utf8(BASE64.decode(TAURI_SIGNATURE).unwrap()).unwrap();
        verify_publisher_payload(payload, &raw_signature).unwrap();
        assert!(verify_publisher_payload(b"v0.1.1\n", TAURI_SIGNATURE).is_err());
    }
}

#[tauri::command]
fn native_verify_publisher_signature(
    payload_base64: String,
    signature: String,
) -> Result<bool, String> {
    const MAX_SIGNED_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;
    if signature.len() > 16 * 1024 {
        return Err("发布签名文件过大".into());
    }
    let payload = BASE64
        .decode(payload_base64)
        .map_err(|_| "发布内容无法解码".to_string())?;
    if payload.len() > MAX_SIGNED_PAYLOAD_BYTES {
        return Err("发布内容过大".into());
    }
    verify_publisher_payload(&payload, &signature)?;
    Ok(true)
}

fn validate_credential_url(value: &str, label: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(value.trim()).map_err(|_| format!("{label}无效"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!("{label}不能在网址中包含账号或密码"));
    }
    let loopback_http = parsed.scheme() == "http"
        && parsed.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        });
    if parsed.scheme() != "https" && !loopback_http {
        return Err(format!("{label}必须使用 HTTPS；本机 localhost 可使用 HTTP"));
    }
    Ok(parsed)
}

async fn read_limited_response_bytes(
    mut response: reqwest::Response,
    max_bytes: usize,
    read_error: &str,
    too_large: &str,
) -> Result<(reqwest::StatusCode, reqwest::header::HeaderMap, Vec<u8>), String> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > max_bytes)
    {
        return Err(too_large.into());
    }
    let status = response.status();
    let headers = response.headers().clone();
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(max_bytes as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("{read_error}：{error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(too_large.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((status, headers, bytes))
}

fn is_public_remote_address(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224)
        }
        std::net::IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4_mapped() {
                return is_public_remote_address(std::net::IpAddr::V4(ipv4));
            }
            let first = ip.segments()[0];
            !(ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || (ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8))
        }
    }
}

fn select_remote_media_addresses(
    resolved: Vec<std::net::SocketAddr>,
    allow_private_network: bool,
) -> Result<Vec<std::net::SocketAddr>, String> {
    if resolved.is_empty() {
        return Err("无法解析媒体服务器地址".into());
    }
    if allow_private_network {
        return Ok(resolved);
    }
    let public: Vec<_> = resolved
        .iter()
        .copied()
        .filter(|address| is_public_remote_address(address.ip()))
        .collect();
    if !public.is_empty() {
        return Ok(public);
    }
    Err("媒体地址指向本机或内网，已停止下载；若使用 Fake-IP 代理，请在“设置 → 偏好设置”开启“允许私有网络媒体下载”".into())
}

async fn request_public_remote_media(
    mut url: reqwest::Url,
    allow_private_network: bool,
) -> Result<(reqwest::Response, reqwest::Url), String> {
    const MAX_REDIRECTS: usize = 5;
    for redirect_count in 0..=MAX_REDIRECTS {
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err("媒体地址必须使用不含账号信息的 HTTPS 地址".into());
        }
        let host = url
            .host_str()
            .ok_or_else(|| "媒体地址缺少服务器名称".to_string())?;
        let port = url.port_or_known_default().unwrap_or(443);
        let resolved = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| "无法解析媒体服务器地址".to_string())?
            .collect();
        let resolved = select_remote_media_addresses(resolved, allow_private_network)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .resolve_to_addrs(host, &resolved)
            .build()
            .map_err(|error| format!("无法创建媒体下载请求：{error}"))?;
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|error| format!("下载生成结果失败：{error}"))?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err("媒体下载重定向次数过多".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "媒体下载返回了无效重定向".to_string())?;
            url = url
                .join(location)
                .map_err(|_| "媒体下载返回了无效重定向".to_string())?;
            continue;
        }
        return Ok((response, url));
    }
    Err("媒体下载重定向次数过多".into())
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    workspace_dir: PathBuf,
    working_dir: PathBuf,
    artifact_watcher_alive: Arc<AtomicBool>,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        self.artifact_watcher_alive.store(false, Ordering::Relaxed);
        let _ = self.child.kill();
        let _ = fs::remove_dir_all(&self.workspace_dir);
    }
}

struct TerminalSessions(
    Mutex<HashMap<String, TerminalSession>>,
    Mutex<HashSet<String>>,
);

struct TerminalStartGuard<'a> {
    pending: &'a Mutex<HashSet<String>>,
    session_id: String,
}

impl Drop for TerminalStartGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&self.session_id);
        }
    }
}

const TERMINAL_OUTPUT_DIR_REFERENCE: &str = "$WG_OUTPUT_DIR";
const TERMINAL_OUTPUT_HELPER: &str = r#"#!/bin/zsh
value="$1"
if [[ "$value" != /* ]]; then
  value="${value:A}"
fi
case "$value" in
  "$WG_OUTPUT_DIR"/*) printf '__WG_OUTPUT__:$WG_OUTPUT_DIR/%s\n' "${value#"$WG_OUTPUT_DIR"/}" ;;
  "$WG_WORKING_DIR"/*) printf '__WG_OUTPUT__:./%s\n' "${value#"$WG_WORKING_DIR"/}" ;;
  *) printf 'wg-output: 请使用当前工作位置或输出目录中的文件\n' >&2; exit 2 ;;
esac
"#;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalArtifactEvent {
    session_id: String,
    path: String,
    mime_type: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionInput {
    name: String,
    kind: String,
    text: Option<String>,
    data_url: Option<String>,
    storage_key: Option<String>,
    file_name: Option<String>,
    mime_type: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSkillInput {
    id: String,
    name: String,
    version: String,
    body: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputFile {
    data_url: String,
    mime_type: String,
    signature: String,
    bytes: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAgentInstallation {
    id: &'static str,
    name: &'static str,
    command: &'static str,
    path: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAgentScanResult {
    agents: Vec<LocalAgentInstallation>,
    search_paths: Vec<String>,
}

#[tauri::command]
async fn native_fetch_model_list(
    url: String,
    api_key: String,
) -> Result<serde_json::Value, String> {
    const MAX_MODEL_LIST_BYTES: usize = 4 * 1024 * 1024;
    let parsed = validate_credential_url(&url, "模型列表地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型列表请求：{error}"))?;
    let response = client
        .get(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("读取模型列表失败：{error}"))?;
    let (status, _, bytes) = read_limited_response_bytes(
        response,
        MAX_MODEL_LIST_BYTES,
        "读取模型列表失败",
        "模型列表响应过大，已取消读取",
    )
    .await?;
    let payload: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("模型列表响应格式无效（HTTP {status}）"))?;
    if !status.is_success() {
        let detail = payload
            .get("error")
            .and_then(|error| {
                error
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| error.as_str())
            })
            .or_else(|| payload.get("message").and_then(serde_json::Value::as_str))
            .or_else(|| payload.get("msg").and_then(serde_json::Value::as_str))
            .unwrap_or("请求未成功");
        return Err(format!("读取模型列表失败（HTTP {status}）：{detail}"));
    }
    Ok(payload)
}

#[tauri::command]
async fn native_model_json_post(
    url: String,
    api_key: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    post_model_json(&url, &api_key, body).await
}

async fn post_model_json(
    url: &str,
    api_key: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let parsed = validate_credential_url(url, "模型请求地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .post(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{error}"))?;
    read_model_json_response(response).await
}

#[tauri::command]
async fn native_model_raw_json_post(
    url: String,
    api_key: String,
    body: String,
) -> Result<String, String> {
    post_model_raw_json(&url, &api_key, &body).await
}

async fn post_model_raw_json(url: &str, api_key: &str, body: &str) -> Result<String, String> {
    let parsed = validate_credential_url(url, "模型请求地址")?;
    serde_json::from_str::<serde_json::Value>(body)
        .map_err(|_| "模型请求 JSON 无效".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .post(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{error}"))?;
    read_model_json_text_response(response).await
}

#[tauri::command]
async fn native_model_multipart_post(
    url: String,
    api_key: String,
    file_field: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    fields: HashMap<String, String>,
) -> Result<String, String> {
    post_model_multipart(
        &url,
        &api_key,
        &file_field,
        &file_name,
        &mime_type,
        &data_base64,
        fields,
    )
    .await
}

async fn post_model_multipart(
    url: &str,
    api_key: &str,
    file_field: &str,
    file_name: &str,
    mime_type: &str,
    data_base64: &str,
    fields: HashMap<String, String>,
) -> Result<String, String> {
    const MAX_MODEL_UPLOAD_BYTES: usize = 64 * 1024 * 1024;
    let parsed = validate_credential_url(url, "模型请求地址")?;
    if file_field.trim().is_empty() || file_name.trim().is_empty() {
        return Err("模型上传文件信息不完整".into());
    }
    let file_bytes = BASE64
        .decode(data_base64.trim())
        .map_err(|_| "模型上传文件无法解码".to_string())?;
    if file_bytes.len() > MAX_MODEL_UPLOAD_BYTES {
        return Err("模型上传文件过大，已取消请求".into());
    }
    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.trim().to_string())
        .mime_str(mime_type.trim())
        .map_err(|_| "模型上传文件类型无效".to_string())?;
    let mut form = reqwest::multipart::Form::new().part(file_field.trim().to_string(), file_part);
    for (name, value) in fields {
        if !name.trim().is_empty() {
            form = form.text(name, value);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .post(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{error}"))?;
    read_model_json_text_response(response).await
}

#[tauri::command]
async fn native_model_json_get(url: String, api_key: String) -> Result<serde_json::Value, String> {
    let parsed = validate_credential_url(&url, "模型请求地址")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .get(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{error}"))?;
    read_model_json_response(response).await
}

async fn read_model_json_response(
    response: reqwest::Response,
) -> Result<serde_json::Value, String> {
    let raw = read_model_json_text_response(response).await?;
    serde_json::from_str(&raw).map_err(|_| "模型响应格式无效".to_string())
}

async fn read_model_json_text_response(response: reqwest::Response) -> Result<String, String> {
    const MAX_MODEL_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
    let (status, _, bytes) = read_limited_response_bytes(
        response,
        MAX_MODEL_RESPONSE_BYTES,
        "读取模型响应失败",
        "模型响应过大，已取消读取",
    )
    .await?;
    let payload: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| format!("模型响应格式无效（HTTP {status}）"))?;
    if !status.is_success() {
        let detail = payload
            .get("error")
            .and_then(|error| {
                error
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| error.as_str())
            })
            .or_else(|| {
                payload
                    .get("base_resp")
                    .and_then(|base| base.get("status_msg"))
                    .and_then(serde_json::Value::as_str)
            })
            .or_else(|| payload.get("message").and_then(serde_json::Value::as_str))
            .or_else(|| payload.get("msg").and_then(serde_json::Value::as_str))
            .unwrap_or("请求未成功");
        return Err(format!("模型请求失败（HTTP {status}）：{detail}"));
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| format!("模型响应格式无效（HTTP {status}）"))
}

#[cfg(test)]
mod native_model_request_tests {
    use super::{
        is_public_remote_address, post_model_json, post_model_multipart, post_model_raw_json,
        select_remote_media_addresses, validate_credential_url, BASE64,
    };
    use base64::Engine;
    use std::{
        collections::HashMap,
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    #[test]
    fn credential_urls_require_https_except_for_loopback_development() {
        assert!(validate_credential_url("https://api.example.com/v1", "模型请求地址").is_ok());
        assert!(validate_credential_url("http://127.0.0.1:11434/v1", "模型请求地址").is_ok());
        assert!(validate_credential_url("http://localhost:11434/v1", "模型请求地址").is_ok());
        assert!(validate_credential_url("http://api.example.com/v1", "模型请求地址").is_err());
        assert!(
            validate_credential_url("https://user:pass@api.example.com/v1", "模型请求地址")
                .is_err()
        );
    }

    #[test]
    fn remote_media_rejects_private_and_reserved_addresses() {
        use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            127, 0, 0, 1
        ))));
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            10, 0, 0, 1
        ))));
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            169, 254, 169, 254
        ))));
        assert!(!is_public_remote_address(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            198, 18, 0, 1
        ))));
        assert!(is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            1, 1, 1, 1
        ))));
    }

    #[test]
    fn remote_media_allows_all_non_public_addresses_only_when_enabled() {
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};
        let fake_ip = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![fake_ip], true).unwrap(),
            vec![fake_ip]
        );
        assert!(select_remote_media_addresses(vec![fake_ip], false).is_err());

        let private = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 64, 0, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![private], true).unwrap(),
            vec![private]
        );

        let loopback = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 443);
        assert_eq!(
            select_remote_media_addresses(vec![loopback], true).unwrap(),
            vec![loopback]
        );
    }

    #[test]
    fn remote_media_uses_only_public_results_from_mixed_dns_answers() {
        use std::net::{IpAddr, Ipv4Addr, SocketAddr};
        let private = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 443);
        let public = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![private, public], false).unwrap(),
            vec![public]
        );
    }

    #[test]
    fn posts_seedream_json_natively_and_returns_provider_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .map(str::to_string)
                    })
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            sender.send(String::from_utf8(request).unwrap()).unwrap();
            let response_body = r#"{"data":[{"url":"https://example.com/result.png"}]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .unwrap();
        });

        let payload = tauri::async_runtime::block_on(post_model_json(
            &format!("http://{address}/api/v3/images/generations"),
            "test-key",
            serde_json::json!({
                "model": "doubao-seedream-4-5-251128",
                "prompt": "test",
                "size": "2K",
                "response_format": "url",
                "sequential_image_generation": "disabled"
            }),
        ))
        .unwrap();
        let request = receiver.recv().unwrap();
        server.join().unwrap();

        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer test-key"));
        assert!(request.contains("\"response_format\":\"url\""));
        assert!(!request.contains("\"n\":"));
        assert_eq!(payload["data"][0]["url"], "https://example.com/result.png");
    }

    #[test]
    fn posts_multipart_file_and_fields_natively() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .map(str::to_string)
                    })
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            sender.send(String::from_utf8(request).unwrap()).unwrap();
            let response_body =
                r#"{"file":{"file_id":9007199254740993},"base_resp":{"status_code":0}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .unwrap();
        });

        let payload = tauri::async_runtime::block_on(post_model_multipart(
            &format!("http://{address}/v1/files/upload"),
            "test-key",
            "file",
            "voice.wav",
            "audio/wav",
            &BASE64.encode(b"voice-bytes"),
            HashMap::from([("purpose".to_string(), "voice_clone".to_string())]),
        ))
        .unwrap();
        let request = receiver.recv().unwrap();
        server.join().unwrap();
        let lowercase_request = request.to_ascii_lowercase();

        assert!(lowercase_request.contains("authorization: bearer test-key"));
        assert!(lowercase_request.contains("content-type: multipart/form-data; boundary="));
        assert!(request.contains("name=\"file\"; filename=\"voice.wav\""));
        assert!(request.contains("Content-Type: audio/wav"));
        assert!(request.contains("name=\"purpose\""));
        assert!(request.contains("voice_clone"));
        assert!(request.contains("voice-bytes"));
        assert_eq!(
            payload,
            r#"{"file":{"file_id":9007199254740993},"base_resp":{"status_code":0}}"#
        );
    }

    #[test]
    fn posts_exact_int64_json_number_without_serde_reserialization() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .map(str::to_string)
                    })
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            sender.send(String::from_utf8(request).unwrap()).unwrap();
            let response_body =
                r#"{"demo_audio":"https://example.com/demo.mp3","base_resp":{"status_code":0}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .unwrap();
        });

        let body = r#"{"file_id":9007199254740993,"voice_id":"narrator_01","need_noise_reduction":true,"need_volume_normalization":true,"aigc_watermark":false}"#;
        let payload = tauri::async_runtime::block_on(post_model_raw_json(
            &format!("http://{address}/v1/voice_clone"),
            "test-key",
            body,
        ))
        .unwrap();
        let request = receiver.recv().unwrap();
        server.join().unwrap();

        assert!(request
            .to_ascii_lowercase()
            .contains("content-type: application/json"));
        assert!(request.ends_with(body));
        assert_eq!(
            payload,
            r#"{"demo_audio":"https://example.com/demo.mp3","base_resp":{"status_code":0}}"#
        );
    }

    #[test]
    fn reports_minimax_base_resp_message_for_http_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(header_end) = request.windows(4).position(|value| value == b"\r\n\r\n")
                else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(str::trim)
                            .map(str::to_string)
                    })
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let response_body =
                r#"{"base_resp":{"status_code":1008,"status_msg":"voice clone quota exhausted"}}"#;
            write!(
                stream,
                "HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .unwrap();
        });

        let error = tauri::async_runtime::block_on(post_model_raw_json(
            &format!("http://{address}/v1/voice_clone"),
            "test-key",
            r#"{"file_id":9007199254740993}"#,
        ))
        .unwrap_err();
        server.join().unwrap();

        assert!(error.contains("HTTP 429"));
        assert!(error.contains("voice clone quota exhausted"));
    }
}

#[tauri::command]
async fn native_fetch_remote_media(
    storage: State<'_, app_storage::NativeStorage>,
    url: String,
    bucket: String,
    key: String,
    expected_sha256: Option<String>,
    max_bytes: Option<usize>,
    allow_private_network: Option<bool>,
) -> Result<app_storage::NativeMediaRecord, String> {
    const MAX_REMOTE_MEDIA_BYTES: usize = 256 * 1024 * 1024;
    let max_remote_media_bytes = max_bytes
        .filter(|value| *value > 0)
        .unwrap_or(MAX_REMOTE_MEDIA_BYTES)
        .min(MAX_REMOTE_MEDIA_BYTES);
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "媒体地址无效".to_string())?;
    let (response, final_url) =
        request_public_remote_media(parsed, allow_private_network.unwrap_or(false)).await?;
    if !response.status().is_success() {
        return Err(format!("下载生成结果失败：HTTP {}", response.status()));
    }
    let (_, headers, bytes) = read_limited_response_bytes(
        response,
        max_remote_media_bytes,
        "读取生成结果失败",
        "生成结果文件过大，无法保存",
    )
    .await?;
    let reported_mime_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    verify_remote_media_checksum(&bytes, expected_sha256.as_deref())?;
    let mime_type =
        normalize_remote_media_type(reported_mime_type.as_deref(), &final_url, &key, &bytes)
            .ok_or_else(|| "生成结果媒体格式无法识别".to_string())?;
    app_storage::save_remote_media(&storage, bucket, key, mime_type, &bytes)
}

fn verify_remote_media_checksum(bytes: &[u8], expected_sha256: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected_sha256
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    if expected.len() != 64
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("媒体文件校验值无效".into());
    }
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected.to_ascii_lowercase() {
        return Err("媒体文件校验失败，已停止保存".into());
    }
    Ok(())
}

fn normalize_remote_media_type(
    reported: Option<&str>,
    url: &reqwest::Url,
    key: &str,
    bytes: &[u8],
) -> Option<String> {
    let key_family = key.split_once(':').map(|(prefix, _)| prefix).unwrap_or(key);
    let detected = sniff_media_type(bytes, key_family);
    if let Some(mime_type) = detected {
        return Some(mime_type.to_string());
    }
    if let Some(mime_type) = reported.filter(|value| media_type_matches_key(value, key_family)) {
        return Some(mime_type.to_string());
    }
    infer_media_type_from_url(url)
        .filter(|value| media_type_matches_key(value, key_family))
        .map(str::to_string)
}

fn infer_media_type_from_url(url: &reqwest::Url) -> Option<&'static str> {
    match url
        .path()
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "avif" => Some("image/avif"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/x-m4a"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        _ => None,
    }
}

fn media_type_matches_key(mime_type: &str, key_family: &str) -> bool {
    let family = if key_family.starts_with("image") {
        "image/"
    } else if key_family.starts_with("video") {
        "video/"
    } else if key_family.starts_with("audio") {
        "audio/"
    } else {
        return matches!(
            mime_type.split_once('/').map(|(family, _)| family),
            Some("image" | "video" | "audio")
        );
    };
    mime_type.starts_with(family)
}

fn sniff_media_type(bytes: &[u8], key_family: &str) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some("video/webm");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        if key_family.starts_with("audio") {
            return Some("audio/mp4");
        }
        if &bytes[8..10] == b"qt" {
            return Some("video/quicktime");
        }
        return Some("video/mp4");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if bytes.starts_with(b"OggS") {
        return Some("audio/ogg");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("audio/flac");
    }
    if bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
    {
        return Some("audio/mpeg");
    }
    None
}

fn desktop_paths(extra_paths: &[String]) -> Vec<String> {
    let mut paths: Vec<String> = env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .filter(|path| !path.trim().is_empty())
        .map(ToOwned::to_owned)
        .collect();
    let mut defaults = vec![
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    if let Some(home) = env::var_os("HOME") {
        let home = home.to_string_lossy();
        defaults.insert(0, format!("{home}/.local/bin"));
        defaults.insert(1, format!("{home}/.cargo/bin"));
        defaults.insert(2, format!("{home}/.opencode/bin"));
        defaults.insert(3, format!("{home}/.bun/bin"));
        defaults.insert(4, format!("{home}/.npm-global/bin"));
    }
    for path in defaults {
        if !paths.iter().any(|current| current == &path) {
            paths.push(path);
        }
    }
    for path in extra_paths {
        let path = path.trim();
        if !path.is_empty()
            && Path::new(path).is_dir()
            && !paths.iter().any(|current| current == path)
        {
            paths.insert(0, path.to_string());
        }
    }
    paths
}

fn desktop_path() -> String {
    desktop_paths(&[]).join(":")
}

fn find_executable(command: &str, path: &str) -> Option<String> {
    let mut process = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("where");
        cmd.arg(command);
        cmd
    } else {
        let mut cmd = Command::new("/bin/zsh");
        cmd.args(["-lc", &format!("command -v {command}")]);
        cmd
    };
    let output = process.env("PATH", path).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    (!path.is_empty()).then_some(path)
}

#[tauri::command]
fn scan_local_agents(extra_paths: Option<Vec<String>>) -> LocalAgentScanResult {
    let paths = desktop_paths(&extra_paths.unwrap_or_default());
    let path = paths.join(":");
    let agents = [
        ("codex", "Codex", "codex"),
        ("claude", "Claude Code", "claude"),
        ("gemini", "Gemini CLI", "gemini"),
        ("opencode", "OpenCode", "opencode"),
        ("pi", "Pi", "pi"),
        ("kimi-code", "Kimi Code", "kimi"),
    ]
    .into_iter()
    .map(|(id, name, command)| LocalAgentInstallation {
        id,
        name,
        command,
        path: find_executable(command, &path),
    })
    .collect();
    LocalAgentScanResult {
        agents,
        search_paths: paths,
    }
}

#[tauri::command]
fn start_terminal_session(
    app: AppHandle,
    sessions: State<TerminalSessions>,
    storage: State<app_storage::NativeStorage>,
    session_id: String,
    cwd: Option<String>,
    inputs: Option<Vec<TerminalSessionInput>>,
    skills: Option<Vec<TerminalSkillInput>>,
) -> Result<(), String> {
    if let Some(directory) = cwd.as_deref().filter(|value| !value.trim().is_empty()) {
        if !Path::new(directory).is_dir() {
            return Err("工作位置不存在或不可访问".into());
        }
    }
    let requested_directory = cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("应用当前目录");
    let confirmation = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("允许打开本机终端？")
        .set_description(format!(
            "终端中的命令可以读取和修改本机文件。\n\n工作位置：{requested_directory}\n\n仅在你刚刚主动打开终端时继续。"
        ))
        .set_buttons(MessageButtons::YesNo)
        .show();
    if confirmation != MessageDialogResult::Yes {
        return Err("已取消打开终端".into());
    }
    let Some(_start_guard) = reserve_terminal_start(&sessions, &session_id)? else {
        return Ok(());
    };

    let working_dir = cwd
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from("/")));
    let working_dir = working_dir.canonicalize().unwrap_or(working_dir);
    let input_context = materialize_terminal_inputs(
        &storage,
        &session_id,
        inputs.as_deref().unwrap_or_default(),
        skills.as_deref().unwrap_or_default(),
    )?;
    let output_dir = input_context.output_dir.clone();
    let mut known_artifacts = terminal_artifact_snapshot(&output_dir);
    known_artifacts.extend(terminal_working_artifact_snapshot(&working_dir));
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("无法创建终端：{error}"))?;
    let shell = if cfg!(target_os = "windows") {
        "cmd.exe"
    } else {
        "/bin/zsh"
    };
    let mut command = CommandBuilder::new(shell);
    if cfg!(target_os = "windows") {
        command.arg("/K");
    } else {
        command.arg("-i");
    }
    command.env(
        "PATH",
        format!("{}:{}", input_context.bin_dir.display(), desktop_path()),
    );
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("NO_COLOR", "1");
    command.env("WG_INPUT_DIR", &input_context.input_dir);
    command.env("WG_OUTPUT_DIR", &input_context.output_dir);
    command.env("WG_WORKING_DIR", &working_dir);
    command.env("WG_INPUT_TEXT", input_context.text);
    command.env("WG_INPUT_FILES", input_context.files.join(":"));
    command.env("WG_SKILLS_DIR", &input_context.skills_dir);
    command.env(
        "WG_SKILLS_INDEX",
        input_context.skills_dir.join("index.json"),
    );
    command.env(
        "WG_ACTIVE_SKILLS",
        skills
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|skill| skill.id.as_str())
            .collect::<Vec<_>>()
            .join(","),
    );
    command.cwd(&working_dir);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("无法启动终端：{error}"))?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("无法读取终端输出：{error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("无法写入终端：{error}"))?;
    let output_app = app.clone();
    let output_session_id = session_id.clone();
    let artifact_watcher_alive = Arc::new(AtomicBool::new(true));
    let reader_alive = artifact_watcher_alive.clone();
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    let _ = output_app.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            session_id: output_session_id.clone(),
                            data: String::from_utf8_lossy(&buffer[..length]).into_owned(),
                        },
                    );
                }
            }
        }
        reader_alive.store(false, Ordering::Relaxed);
    });
    let artifact_app = app.clone();
    let artifact_session_id = session_id.clone();
    let artifact_working_dir = working_dir.clone();
    let watcher_alive = artifact_watcher_alive.clone();
    thread::spawn(move || {
        let mut pending_artifacts = HashMap::new();
        while watcher_alive.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(1_000));
            let mut current = terminal_artifact_snapshot(&output_dir);
            current.extend(terminal_working_artifact_snapshot(&artifact_working_dir));
            known_artifacts.retain(|path, _| current.contains_key(path));
            pending_artifacts.retain(|path, _| current.contains_key(path));
            for (path, signature) in current {
                if known_artifacts.get(&path) == Some(&signature) {
                    pending_artifacts.remove(&path);
                    continue;
                }
                if pending_artifacts.get(&path) == Some(&signature) {
                    let mime_type = mime_for_path(&path).to_string();
                    if let Some(reference) =
                        terminal_artifact_reference(&output_dir, &artifact_working_dir, &path)
                    {
                        let _ = artifact_app.emit(
                            "terminal-artifact",
                            TerminalArtifactEvent {
                                session_id: artifact_session_id.clone(),
                                path: reference,
                                mime_type,
                            },
                        );
                    }
                    known_artifacts.insert(path.clone(), signature);
                    pending_artifacts.remove(&path);
                } else {
                    pending_artifacts.insert(path, signature);
                }
            }
        }
    });
    let session = TerminalSession {
        master: pair.master,
        writer,
        child,
        workspace_dir: input_context.workspace_dir,
        working_dir,
        artifact_watcher_alive,
    };
    let mut active_sessions = sessions.0.lock().map_err(|_| "终端状态不可用")?;
    active_sessions.entry(session_id).or_insert(session);
    Ok(())
}

fn reserve_terminal_start<'a>(
    sessions: &'a TerminalSessions,
    session_id: &str,
) -> Result<Option<TerminalStartGuard<'a>>, String> {
    if sessions
        .0
        .lock()
        .map_err(|_| "终端状态不可用")?
        .contains_key(session_id)
    {
        return Ok(None);
    }
    let mut pending = sessions.1.lock().map_err(|_| "终端状态不可用")?;
    if !pending.insert(session_id.to_string()) {
        return Ok(None);
    }
    Ok(Some(TerminalStartGuard {
        pending: &sessions.1,
        session_id: session_id.to_string(),
    }))
}

struct TerminalInputContext {
    workspace_dir: PathBuf,
    input_dir: PathBuf,
    output_dir: PathBuf,
    bin_dir: PathBuf,
    skills_dir: PathBuf,
    text: String,
    files: Vec<String>,
}

fn materialize_terminal_inputs(
    storage: &app_storage::NativeStorage,
    session_id: &str,
    inputs: &[TerminalSessionInput],
    skills: &[TerminalSkillInput],
) -> Result<TerminalInputContext, String> {
    let safe_id: String = session_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect();
    let workspace_dir = env::temp_dir()
        .join("workflowgenerator")
        .join("terminal")
        .join(safe_id);
    let _ = fs::remove_dir_all(&workspace_dir);
    let input_dir = workspace_dir.join("inputs");
    let output_dir = workspace_dir.join("outputs");
    let bin_dir = workspace_dir.join("bin");
    let skills_dir = workspace_dir.join("skills");
    fs::create_dir_all(&input_dir).map_err(|error| format!("无法创建终端输入目录：{error}"))?;
    fs::create_dir_all(&output_dir).map_err(|error| format!("无法创建终端输出目录：{error}"))?;
    fs::create_dir_all(&bin_dir).map_err(|error| format!("无法创建终端工具目录：{error}"))?;
    fs::create_dir_all(&skills_dir).map_err(|error| format!("无法准备 Skills：{error}"))?;
    let helper = bin_dir.join("wg-output");
    fs::write(&helper, TERMINAL_OUTPUT_HELPER)
        .map_err(|error| format!("无法创建终端输出工具：{error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("无法设置终端输出工具权限：{error}"))?;
    }
    let mut text_parts = Vec::new();
    let mut files = Vec::new();
    let mut skill_index = Vec::new();
    for skill in skills.iter().take(32) {
        let safe_id: String = skill
            .id
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                    character
                } else {
                    '-'
                }
            })
            .collect();
        let skill_dir = skills_dir.join(safe_id.trim_matches('-'));
        fs::create_dir_all(&skill_dir).map_err(|error| format!("无法准备 Skill：{error}"))?;
        fs::write(skill_dir.join("SKILL.md"), skill.body.as_bytes())
            .map_err(|error| format!("无法准备 Skill：{error}"))?;
        skill_index.push(serde_json::json!({
            "id": skill.id,
            "name": skill.name,
            "version": skill.version,
            "path": skill_dir.join("SKILL.md"),
        }));
    }
    fs::write(
        skills_dir.join("index.json"),
        serde_json::to_vec_pretty(&skill_index)
            .map_err(|error| format!("无法生成 Skill 索引：{error}"))?,
    )
    .map_err(|error| format!("无法写入 Skill 索引：{error}"))?;
    for (index, input) in inputs.iter().enumerate() {
        if input.kind == "text" {
            let value = input.text.as_deref().unwrap_or_default();
            text_parts.push(value.to_string());
            let path = input_dir.join(format!("text-{}.txt", index + 1));
            fs::write(&path, value).map_err(|error| format!("无法写入文本输入：{error}"))?;
            files.push(path.to_string_lossy().into_owned());
            continue;
        }
        let stem: String = input
            .name
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                    character
                } else {
                    '-'
                }
            })
            .collect();
        if let Some(storage_key) = input.storage_key.as_deref() {
            let bucket = if storage_key.starts_with("image:") {
                "images"
            } else if input.kind == "file" && storage_key.starts_with("file:") {
                "files"
            } else {
                "media"
            };
            let temporary_path = input_dir.join(format!(".native-{}", index + 1));
            let mime_type = app_storage::copy_native_media_to_path(
                storage,
                bucket,
                storage_key,
                &temporary_path,
            )?;
            if input.kind != "file" && !mime_type.starts_with(&format!("{}/", input.kind)) {
                let _ = fs::remove_file(&temporary_path);
                return Err("终端输入类型与媒体内容不一致".into());
            }
            if input.kind == "file"
                && input
                    .mime_type
                    .as_deref()
                    .is_some_and(|expected| expected != mime_type)
            {
                let _ = fs::remove_file(&temporary_path);
                return Err("终端输入文件类型与存储记录不一致".into());
            }
            let path = if input.kind == "file" {
                input_dir.join(safe_terminal_input_file_name(
                    index,
                    input.file_name.as_deref().unwrap_or(&input.name),
                    &mime_type,
                ))
            } else {
                let extension = extension_for_mime(&mime_type, &input.kind);
                input_dir.join(format!(
                    "{}-{}.{}",
                    index + 1,
                    stem.trim_matches('-'),
                    extension
                ))
            };
            if let Err(error) = fs::rename(&temporary_path, &path) {
                let _ = fs::remove_file(&temporary_path);
                return Err(format!("无法准备终端输入媒体：{error}"));
            }
            files.push(path.to_string_lossy().into_owned());
            continue;
        }
        let Some(data_url) = input.data_url.as_deref() else {
            continue;
        };
        let (header, encoded) = data_url.split_once(',').ok_or("媒体输入格式无效")?;
        let bytes = BASE64.decode(encoded).map_err(|_| "媒体输入无法解码")?;
        let extension = extension_for_mime(header, &input.kind);
        let path = input_dir.join(format!(
            "{}-{}.{}",
            index + 1,
            stem.trim_matches('-'),
            extension
        ));
        fs::write(&path, bytes).map_err(|error| format!("无法写入媒体输入：{error}"))?;
        files.push(path.to_string_lossy().into_owned());
    }
    fs::write(input_dir.join("input.txt"), text_parts.join("\n\n"))
        .map_err(|error| format!("无法写入终端输入：{error}"))?;
    Ok(TerminalInputContext {
        workspace_dir,
        input_dir,
        output_dir,
        bin_dir,
        skills_dir,
        text: text_parts.join("\n\n"),
        files,
    })
}

fn extension_for_mime(header: &str, kind: &str) -> &'static str {
    if header.contains("image/png") {
        "png"
    } else if header.contains("image/jpeg") {
        "jpg"
    } else if header.contains("image/webp") {
        "webp"
    } else if header.contains("video/webm") {
        "webm"
    } else if header.contains("video/") {
        "mp4"
    } else if header.contains("audio/wav") {
        "wav"
    } else if header.contains("audio/") {
        "mp3"
    } else if header.contains("application/pdf") {
        "pdf"
    } else if header.contains("application/json") {
        "json"
    } else if header.contains("text/csv") {
        "csv"
    } else if header.contains("text/") {
        "txt"
    } else if kind == "image" {
        "png"
    } else if kind == "video" {
        "mp4"
    } else {
        "bin"
    }
}

fn safe_terminal_input_file_name(index: usize, value: &str, mime_type: &str) -> String {
    let normalized = value.replace('\\', "/");
    let leaf = normalized.rsplit('/').next().unwrap_or("file");
    let mut safe = leaf
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| match character {
            '/' | '\\' | ':' => '-',
            _ => character,
        })
        .take(140)
        .collect::<String>();
    safe = safe.trim().trim_matches('.').to_string();
    if safe.is_empty() {
        safe = format!("file.{}", extension_for_mime(mime_type, "file"));
    } else if Path::new(&safe).extension().is_none() {
        safe.push('.');
        safe.push_str(extension_for_mime(mime_type, "file"));
    }
    format!("{}-{safe}", index + 1)
}

fn mime_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "txt" | "md" | "markdown" | "log" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" | "jsx" => "text/plain",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "rtf" => "application/rtf",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "epub" => "application/epub+zip",
        "tsv" => "text/tab-separated-values",
        "jsonl" => "application/x-ndjson",
        "toml" => "application/toml",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        "tar" => "application/x-tar",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",
        "obj" => "model/obj",
        "stl" => "model/stl",
        "gltf" => "model/gltf+json",
        "glb" => "model/gltf-binary",
        _ => "application/octet-stream",
    }
}

fn terminal_artifact_snapshot(output_dir: &Path) -> HashMap<PathBuf, (u64, u128)> {
    terminal_artifact_snapshot_with_depth(output_dir, 5, true)
}

fn terminal_working_artifact_snapshot(working_dir: &Path) -> HashMap<PathBuf, (u64, u128)> {
    // A terminal agent often writes the final file next to the project it is
    // working in. Keep this scan deliberately shallow so a large repository
    // cannot turn the once-per-second watcher into a full tree traversal.
    terminal_artifact_snapshot_with_depth(working_dir, 1, false)
}

fn terminal_artifact_snapshot_with_depth(
    directory: &Path,
    depth: usize,
    include_unknown: bool,
) -> HashMap<PathBuf, (u64, u128)> {
    let mut files = Vec::new();
    collect_terminal_artifacts(directory, depth, include_unknown, &mut files);
    files
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos();
            Some((path, (metadata.len(), modified)))
        })
        .collect()
}

fn terminal_output_reference(output_dir: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(output_dir).ok()?;
    let relative = relative.to_string_lossy().replace('\\', "/");
    (!relative.is_empty()).then(|| format!("{TERMINAL_OUTPUT_DIR_REFERENCE}/{relative}"))
}

fn terminal_artifact_reference(
    output_dir: &Path,
    working_dir: &Path,
    path: &Path,
) -> Option<String> {
    if let Some(reference) = terminal_output_reference(output_dir, path) {
        return Some(reference);
    }
    let relative = path.strip_prefix(working_dir).ok()?;
    let relative = relative.to_string_lossy().replace('\\', "/");
    (!relative.is_empty()).then(|| format!("./{relative}"))
}

fn collect_terminal_artifacts(
    directory: &Path,
    remaining_depth: usize,
    include_unknown: bool,
    files: &mut Vec<PathBuf>,
) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if remaining_depth == 0 {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.')
                || matches!(name.as_ref(), "node_modules" | "target" | "dist" | "build")
            {
                continue;
            }
            collect_terminal_artifacts(&path, remaining_depth - 1, include_unknown, files);
        } else if file_type.is_file()
            && (include_unknown || mime_for_path(&path) != "application/octet-stream")
        {
            files.push(path);
        }
    }
}

#[tauri::command]
fn read_terminal_output_file(
    sessions: State<TerminalSessions>,
    session_id: String,
    path: String,
) -> Result<TerminalOutputFile, String> {
    let candidate = resolve_terminal_output_path(&sessions, &session_id, &path)?;
    let metadata_before =
        fs::metadata(&candidate).map_err(|error| format!("无法读取输出文件：{error}"))?;
    let bytes = fs::read(&candidate).map_err(|error| format!("无法读取输出文件：{error}"))?;
    let metadata_after =
        fs::metadata(&candidate).map_err(|error| format!("无法读取输出文件：{error}"))?;
    if metadata_before.len() != metadata_after.len()
        || metadata_before.modified().ok() != metadata_after.modified().ok()
    {
        return Err("输出文件仍在写入，请稍后再试".into());
    }
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("输出文件超过 64MB，暂不能作为节点媒体导入".into());
    }
    let mime_type = mime_for_path(&candidate).to_string();
    let modified_revision = metadata_after
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let signature = format!("{modified_revision}-{}", terminal_content_signature(&bytes));
    let byte_count = bytes.len();
    Ok(TerminalOutputFile {
        data_url: format!("data:{mime_type};base64,{}", BASE64.encode(bytes)),
        mime_type,
        signature,
        bytes: byte_count,
    })
}

#[tauri::command]
async fn import_terminal_output_file(
    app: AppHandle,
    sessions: State<'_, TerminalSessions>,
    session_id: String,
    path: String,
    output_mode: String,
    storage_key: String,
    previous_signature: Option<String>,
) -> Result<Option<app_storage::NativeMediaImportResult>, String> {
    let candidate = resolve_terminal_output_path(&sessions, &session_id, &path)?;
    let mime_type = mime_for_path(&candidate).to_string();
    let (bucket, required_key_prefix) = match output_mode.as_str() {
        "image" if mime_type.starts_with("image/") => ("images", "image:"),
        "video" if mime_type.starts_with("video/") => ("media", "terminal-output:"),
        "audio" if mime_type.starts_with("audio/") => ("media", "terminal-output:"),
        "file" => ("files", "file:"),
        "image" | "video" | "audio" => return Err("输出文件类型与节点设置不一致".into()),
        _ => return Err("终端输出类型无效".into()),
    };
    if !storage_key.starts_with(required_key_prefix) {
        return Err("终端媒体标识无效".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let storage = app
            .try_state::<app_storage::NativeStorage>()
            .ok_or_else(|| "应用存储尚未准备好".to_string())?;
        app_storage::import_native_media_file_if_changed(
            &storage,
            &candidate,
            bucket,
            &storage_key,
            &mime_type,
            previous_signature.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("导入终端媒体失败：{error}"))?
}

fn resolve_terminal_output_path(
    sessions: &TerminalSessions,
    session_id: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let (workspace_dir, session_working_dir) = {
        let active_sessions = sessions.0.lock().map_err(|_| "终端状态不可用")?;
        let session = active_sessions.get(session_id).ok_or("终端尚未准备好")?;
        (session.workspace_dir.clone(), session.working_dir.clone())
    };
    let output_dir = workspace_dir
        .join("outputs")
        .canonicalize()
        .map_err(|_| "终端输出目录不可用")?;
    let working_dir = session_working_dir
        .canonicalize()
        .unwrap_or(session_working_dir);
    let output_reference_prefix = format!("{TERMINAL_OUTPUT_DIR_REFERENCE}/");
    let (candidate, output_scoped) =
        if let Some(relative) = path.strip_prefix(&output_reference_prefix) {
            (output_dir.join(relative), true)
        } else {
            let requested_path = Path::new(path);
            (
                if requested_path.is_absolute() {
                    requested_path.to_path_buf()
                } else {
                    working_dir.join(requested_path)
                },
                false,
            )
        };
    let candidate = candidate.canonicalize().map_err(|_| "未找到终端输出文件")?;
    if (output_scoped && !candidate.starts_with(&output_dir))
        || (!output_scoped
            && !candidate.starts_with(&output_dir)
            && !candidate.starts_with(&working_dir))
    {
        return Err("输出文件必须位于当前工作目录或 WG_OUTPUT_DIR 中".into());
    }
    Ok(candidate)
}

fn terminal_content_signature(bytes: &[u8]) -> String {
    // Stable FNV-1a checksum keeps same-path overwrite detection deterministic across launches.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{}-{hash:016x}", bytes.len())
}

#[cfg(test)]
mod terminal_artifact_tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        let nonce = UNIX_EPOCH
            .elapsed()
            .expect("system clock should follow unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "workflowgenerator-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn artifact_snapshot_is_scoped_to_the_isolated_output_directory() {
        let root = test_root("artifact-scope");
        let working_dir = root.join("working");
        let output_dir = root.join("isolated").join("outputs");
        fs::create_dir_all(&working_dir).expect("create working directory");
        fs::create_dir_all(output_dir.join("nested")).expect("create output directory");
        let working_asset = working_dir.join("unrelated.png");
        let output_asset = output_dir.join("nested").join("result.png");
        let output_file = output_dir.join("nested").join("report.custom");
        fs::write(&working_asset, b"working").expect("write working asset");
        fs::write(&output_asset, b"output").expect("write output asset");
        fs::write(&output_file, b"generic").expect("write generic output");

        let snapshot = terminal_artifact_snapshot(&output_dir);

        assert!(snapshot.contains_key(&output_asset));
        assert!(snapshot.contains_key(&output_file));
        assert!(!snapshot.contains_key(&working_asset));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn artifact_event_reference_is_relative_and_does_not_expose_local_paths() {
        let root = test_root("artifact-reference");
        let output_dir = root.join("outputs");
        let output_asset = output_dir.join("nested").join("result.png");

        let reference =
            terminal_output_reference(&output_dir, &output_asset).expect("create reference");

        assert_eq!(reference, "$WG_OUTPUT_DIR/nested/result.png");
        assert!(!reference.contains(&root.to_string_lossy().into_owned()));
    }

    #[test]
    fn working_directory_assets_are_discovered_shallowly_and_use_relative_references() {
        let root = test_root("working-artifact");
        let output_dir = root.join("outputs");
        let working_dir = root.join("working");
        let direct_asset = working_dir.join("result.png");
        let nested_asset = working_dir.join("generated").join("preview.png");
        let unknown_asset = working_dir.join("report.custom");
        let deep_asset = working_dir
            .join("generated")
            .join("nested")
            .join("ignored.png");
        fs::create_dir_all(&output_dir).expect("create output directory");
        fs::create_dir_all(
            deep_asset
                .parent()
                .expect("deep asset should have a parent directory"),
        )
        .expect("create nested working directory");
        fs::write(&direct_asset, b"direct").expect("write direct asset");
        fs::write(&nested_asset, b"nested").expect("write nested asset");
        fs::write(&unknown_asset, b"generic").expect("write unknown working asset");
        fs::write(&deep_asset, b"deep").expect("write deep asset");

        let snapshot = terminal_working_artifact_snapshot(&working_dir);

        assert!(snapshot.contains_key(&direct_asset));
        assert!(snapshot.contains_key(&nested_asset));
        assert!(!snapshot.contains_key(&unknown_asset));
        assert!(!snapshot.contains_key(&deep_asset));
        assert_eq!(
            terminal_artifact_reference(&output_dir, &working_dir, &direct_asset),
            Some("./result.png".to_string())
        );
        assert_eq!(
            terminal_artifact_reference(&output_dir, &working_dir, &nested_asset),
            Some("./generated/preview.png".to_string())
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn output_helper_never_prints_absolute_paths() {
        let root = test_root("output-helper");
        let working_dir = root.join("working");
        let nested_working_dir = working_dir.join("nested");
        let output_dir = root.join("outputs");
        let helper = root.join("wg-output");
        fs::create_dir_all(&nested_working_dir).expect("create working directory");
        fs::create_dir_all(&output_dir).expect("create output directory");
        fs::write(&helper, TERMINAL_OUTPUT_HELPER).expect("write output helper");
        let canonical_working_dir = working_dir
            .canonicalize()
            .expect("canonicalize working directory");

        let output_asset = output_dir.join("result.png");
        let output = Command::new("/bin/zsh")
            .arg(&helper)
            .arg(&output_asset)
            .env("WG_OUTPUT_DIR", &output_dir)
            .env("WG_WORKING_DIR", &canonical_working_dir)
            .current_dir(&canonical_working_dir)
            .output()
            .expect("run output helper");
        assert!(
            output.status.success(),
            "helper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "__WG_OUTPUT__:$WG_OUTPUT_DIR/result.png\n"
        );

        let output = Command::new("/bin/zsh")
            .arg(&helper)
            .arg("result.png")
            .env("WG_OUTPUT_DIR", &output_dir)
            .env("WG_WORKING_DIR", &canonical_working_dir)
            .current_dir(&nested_working_dir)
            .output()
            .expect("run output helper");
        assert!(
            output.status.success(),
            "helper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "__WG_OUTPUT__:./nested/result.png\n"
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains(root.to_string_lossy().as_ref()));
        let _ = fs::remove_dir_all(&root);
    }
}

#[tauri::command]
fn write_terminal_input(
    sessions: State<TerminalSessions>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let mut active_sessions = sessions.0.lock().map_err(|_| "终端状态不可用")?;
    let session = active_sessions
        .get_mut(&session_id)
        .ok_or("终端尚未准备好")?;
    session
        .writer
        .write_all(input.as_bytes())
        .map_err(|error| format!("无法写入终端：{error}"))?;
    session
        .writer
        .flush()
        .map_err(|error| format!("无法刷新终端输入：{error}"))
}

#[tauri::command]
fn resize_terminal_session(
    sessions: State<TerminalSessions>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut active_sessions = sessions.0.lock().map_err(|_| "终端状态不可用")?;
    let session = active_sessions
        .get_mut(&session_id)
        .ok_or("终端尚未准备好")?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("无法调整终端大小：{error}"))
}

fn applescript_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\\"'\\\"'"))
}

const DSH_DESKTOP_BUNDLE_ID: &str = "app.workflowgenerator.dsh.desktop";
const DSH_RUNTIME_PACKAGE_PATH: &str =
    "Contents/Resources/runtime/node_modules/@deepseek-ai/dsh/package.json";
const DSH_RUNTIME_NODE_PATH: &str = "Contents/Resources/runtime/node";
const DSH_RUNTIME_ENTRYPOINT_PATH: &str =
    "Contents/Resources/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js";
const DSH_MARKETPLACE_PACKAGE: &str = "dshmarket";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DshDesktopState {
    installed: bool,
    running: bool,
    version: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DshMarketplaceState {
    installed: bool,
    version: Option<String>,
}

fn dsh_desktop_app_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("DSH_DESKTOP_APP_PATH") {
        candidates.push(PathBuf::from(path));
    }
    candidates.push(PathBuf::from("/Applications/DSH.app"));
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications/DSH.app"));
    }
    candidates
}

fn open_macos_application(arguments: &[&str]) -> bool {
    Command::new("/usr/bin/open")
        .args(arguments)
        .output()
        .is_ok_and(|output| output.status.success())
}

fn parse_dsh_package_version(contents: &str) -> Option<String> {
    let package: serde_json::Value = serde_json::from_str(contents).ok()?;
    let version = package.get("version")?.as_str()?.trim();
    (!version.is_empty() && version.chars().count() <= 64).then(|| version.to_owned())
}

fn dsh_profile_has_marketplace(contents: &str) -> bool {
    let package: serde_json::Value = match serde_json::from_str(contents) {
        Ok(package) => package,
        Err(_) => return false,
    };
    let has_dependency = package
        .get("dependencies")
        .and_then(|dependencies| dependencies.get(DSH_MARKETPLACE_PACKAGE))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|version| !version.trim().is_empty());
    let has_bundle = package
        .pointer("/dsh/profile/bundles")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|bundles| {
            bundles.iter().any(|bundle| {
                bundle
                    .as_str()
                    .is_some_and(|name| name == DSH_MARKETPLACE_PACKAGE)
            })
        });
    has_dependency && has_bundle
}

fn dsh_web_profile_path() -> Option<PathBuf> {
    env::var_os("HOME").map(|home| PathBuf::from(home).join(".dsh/profiles/web"))
}

fn read_dsh_marketplace_state() -> DshMarketplaceState {
    let Some(profile) = dsh_web_profile_path() else {
        return DshMarketplaceState {
            installed: false,
            version: None,
        };
    };
    let configured = fs::read_to_string(profile.join("package.json"))
        .ok()
        .is_some_and(|contents| dsh_profile_has_marketplace(&contents));
    let version = fs::read_to_string(profile.join("node_modules/dshmarket/package.json"))
        .ok()
        .and_then(|contents| parse_dsh_package_version(&contents));
    DshMarketplaceState {
        installed: configured && version.is_some(),
        version,
    }
}

fn find_dsh_desktop_version() -> Option<String> {
    dsh_desktop_app_candidates().into_iter().find_map(|path| {
        fs::read_to_string(path.join(DSH_RUNTIME_PACKAGE_PATH))
            .ok()
            .and_then(|contents| parse_dsh_package_version(&contents))
    })
}

fn dsh_desktop_is_running() -> bool {
    Command::new("/usr/bin/pgrep")
        .args(["-x", "DSH"])
        .output()
        .is_ok_and(|output| output.status.success())
}

#[tauri::command]
fn get_dsh_desktop_version() -> Option<String> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    find_dsh_desktop_version()
}

#[tauri::command]
fn get_dsh_desktop_state() -> DshDesktopState {
    if !cfg!(target_os = "macos") {
        return DshDesktopState {
            installed: false,
            running: false,
            version: None,
        };
    }
    DshDesktopState {
        installed: dsh_desktop_app_candidates()
            .into_iter()
            .any(|path| path.is_dir()),
        running: dsh_desktop_is_running(),
        version: find_dsh_desktop_version(),
    }
}

#[tauri::command]
fn get_dsh_marketplace_state() -> DshMarketplaceState {
    if !cfg!(target_os = "macos") {
        return DshMarketplaceState {
            installed: false,
            version: None,
        };
    }
    read_dsh_marketplace_state()
}

fn install_dsh_marketplace_blocking() -> Result<DshMarketplaceState, String> {
    let current = read_dsh_marketplace_state();
    if current.installed {
        return Ok(current);
    }
    let app = dsh_desktop_app_candidates()
        .into_iter()
        .find(|path| path.is_dir())
        .ok_or("请先安装 DSH 桌面端")?;
    let node = app.join(DSH_RUNTIME_NODE_PATH);
    let entrypoint = app.join(DSH_RUNTIME_ENTRYPOINT_PATH);
    if !node.is_file() || !entrypoint.is_file() {
        return Err("DSH 运行环境暂时不可用".into());
    }
    let output = Command::new(node)
        .arg(entrypoint)
        .args(["plugin", "--profile", "web", "add", DSH_MARKETPLACE_PACKAGE])
        .output()
        .map_err(|error| {
            eprintln!("Unable to start DSH marketplace installer: {error}");
            "插件市场安装失败，请稍后重试".to_owned()
        })?;
    if !output.status.success() {
        eprintln!(
            "DSH marketplace installer failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        return Err("插件市场安装失败，请稍后重试".into());
    }
    let installed = read_dsh_marketplace_state();
    if installed.installed {
        Ok(installed)
    } else {
        Err("插件市场安装尚未完成，请重新尝试".into())
    }
}

#[tauri::command]
async fn install_dsh_marketplace() -> Result<DshMarketplaceState, String> {
    if !cfg!(target_os = "macos") {
        return Err("DSH 插件市场目前仅支持 macOS".into());
    }
    tauri::async_runtime::spawn_blocking(install_dsh_marketplace_blocking)
        .await
        .map_err(|error| {
            eprintln!("DSH marketplace installer task failed: {error}");
            "插件市场安装失败，请稍后重试".to_owned()
        })?
}

#[tauri::command]
fn open_dsh_desktop() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("DSH 桌面端目前仅支持 macOS".into());
    }
    if open_macos_application(&["-b", DSH_DESKTOP_BUNDLE_ID]) {
        return Ok(());
    }
    for path in dsh_desktop_app_candidates() {
        if path.is_dir() && open_macos_application(&[path.to_string_lossy().as_ref()]) {
            return Ok(());
        }
    }
    Err("未找到 DSH 桌面端".into())
}

#[cfg(test)]
mod dsh_desktop_tests {
    use super::{dsh_profile_has_marketplace, parse_dsh_package_version};

    #[test]
    fn reads_the_official_dsh_runtime_version() {
        assert_eq!(
            parse_dsh_package_version(r#"{"name":"@deepseek-ai/dsh","version":"0.1.0-rc.6"}"#),
            Some("0.1.0-rc.6".into())
        );
    }

    #[test]
    fn ignores_a_missing_or_empty_dsh_runtime_version() {
        assert_eq!(
            parse_dsh_package_version(r#"{"name":"@deepseek-ai/dsh"}"#),
            None
        );
        assert_eq!(parse_dsh_package_version(r#"{"version":""}"#), None);
    }

    #[test]
    fn detects_a_complete_marketplace_web_profile_registration() {
        assert!(dsh_profile_has_marketplace(
            r#"{"dependencies":{"dshmarket":"^1.5.1"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-web-app","dshmarket"]}}}"#
        ));
        assert!(!dsh_profile_has_marketplace(
            r#"{"dependencies":{"dshmarket":"^1.5.1"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-web-app"]}}}"#
        ));
    }
}

#[tauri::command]
fn open_external_terminal(terminal: String, cwd: Option<String>) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("外部终端目前仅支持 macOS".into());
    }
    let directory = cwd
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| env::var("HOME").unwrap_or_else(|_| "/".into()));
    if !Path::new(&directory).is_dir() {
        return Err("工作位置不存在或不可访问".into());
    }
    let script = match terminal.as_str() {
        "terminal" => {
            let command = applescript_string(&format!("cd {}", shell_quote(&directory)));
            format!("tell application \"Terminal\"\nactivate\ndo script \"{command}\"\nend tell")
        }
        "ghostty" => {
            if !Path::new("/Applications/Ghostty.app").exists() {
                return Err("未找到 Ghostty。请先安装 Ghostty 后再试。".into());
            }
            let directory = applescript_string(&directory);
            format!("tell application \"Ghostty\"\nset cfg to new surface configuration\nset initial working directory of cfg to \"{directory}\"\nnew window with configuration cfg\nactivate\nend tell")
        }
        _ => return Err("不支持的终端".into()),
    };
    Command::new("/usr/bin/osascript")
        .args(["-e", &script])
        .output()
        .map_err(|error| format!("无法打开终端：{error}"))
        .and_then(|output| {
            if output.status.success() {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
            }
        })
}

#[tauri::command]
fn choose_terminal_directory() -> Result<Option<String>, String> {
    if !cfg!(target_os = "macos") {
        return Err("当前系统暂不支持选择工作文件夹".into());
    }
    let output = Command::new("/usr/bin/osascript")
        .args([
            "-e",
            "POSIX path of (choose folder with prompt \"选择终端工作文件夹\")",
        ])
        .output()
        .map_err(|error| format!("无法打开文件夹选择器：{error}"))?;
    if output.status.success() {
        let directory = String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_end_matches('/')
            .to_string();
        return Ok((!directory.is_empty()).then_some(directory));
    }
    let error = String::from_utf8_lossy(&output.stderr);
    if error.contains("-128") || error.contains("User canceled") {
        return Ok(None);
    }
    Err(error.trim().to_string())
}

#[tauri::command]
fn stop_terminal_session(
    sessions: State<TerminalSessions>,
    session_id: String,
) -> Result<(), String> {
    let mut active_sessions = sessions.0.lock().map_err(|_| "终端状态不可用")?;
    if let Some(mut session) = active_sessions.remove(&session_id) {
        session
            .artifact_watcher_alive
            .store(false, Ordering::Relaxed);
        let _ = session.child.kill();
        let _ = session.child.wait();
        let _ = fs::remove_dir_all(&session.workspace_dir);
    }
    Ok(())
}

#[cfg(test)]
mod remote_media_tests {
    use super::{normalize_remote_media_type, verify_remote_media_checksum};

    #[test]
    fn repairs_generic_video_content_type_from_file_signature() {
        let url = reqwest::Url::parse("https://example.com/result").unwrap();
        let mut bytes = vec![0, 0, 0, 24];
        bytes.extend_from_slice(b"ftypisom");
        assert_eq!(
            normalize_remote_media_type(
                Some("application/octet-stream"),
                &url,
                "video:test",
                &bytes
            )
            .as_deref(),
            Some("video/mp4")
        );
    }

    #[test]
    fn does_not_store_an_error_body_as_generated_video() {
        let url = reqwest::Url::parse("https://example.com/result").unwrap();
        assert_eq!(
            normalize_remote_media_type(
                Some("application/json"),
                &url,
                "video:test",
                br#"{"error":"failed"}"#
            ),
            None
        );
    }

    #[test]
    fn rejects_a_reported_media_family_that_does_not_match_the_result() {
        let url = reqwest::Url::parse("https://example.com/result").unwrap();
        assert_eq!(
            normalize_remote_media_type(Some("image/png"), &url, "video:test", b"not-media"),
            None
        );
    }

    #[test]
    fn verifies_author_media_before_it_reaches_local_storage() {
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_remote_media_checksum(b"hello", Some(expected)).is_ok());
        assert!(verify_remote_media_checksum(b"changed", Some(expected)).is_err());
        assert!(verify_remote_media_checksum(b"hello", Some("invalid")).is_err());
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("wg-media", app_storage::media_protocol)
        .setup(|app| {
            let storage = app_storage::initialize(app.handle()).map_err(std::io::Error::other)?;
            app.manage(storage);
            Ok(())
        })
        .manage(TerminalSessions(
            Mutex::new(HashMap::new()),
            Mutex::new(HashSet::new()),
        ))
        .invoke_handler(tauri::generate_handler![
            start_terminal_session,
            write_terminal_input,
            resize_terminal_session,
            stop_terminal_session,
            read_terminal_output_file,
            import_terminal_output_file,
            get_dsh_desktop_version,
            get_dsh_desktop_state,
            get_dsh_marketplace_state,
            install_dsh_marketplace,
            open_dsh_desktop,
            open_external_terminal,
            choose_terminal_directory,
            scan_local_agents,
            native_fetch_model_list,
            native_model_json_post,
            native_model_raw_json_post,
            native_model_json_get,
            native_model_multipart_post,
            native_fetch_remote_media,
            native_verify_publisher_signature,
            app_storage::native_store_get,
            app_storage::native_store_set,
            app_storage::native_store_remove,
            app_storage::native_store_list,
            app_storage::native_store_clear,
            app_storage::native_store_batch,
            app_storage::native_media_put,
            app_storage::native_media_put_raw,
            app_storage::native_media_upload_begin,
            app_storage::native_media_upload_chunk,
            app_storage::native_media_upload_chunk_base64,
            app_storage::native_media_upload_commit,
            app_storage::native_media_upload_abort,
            app_storage::native_media_get,
            app_storage::native_media_read_data_url,
            app_storage::native_media_export_to_downloads,
            app_storage::native_media_remove,
            app_storage::native_media_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running WorkflowGenerator desktop app")
}
