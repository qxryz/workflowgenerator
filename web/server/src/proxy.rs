use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::extract::State;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use sha2::{Digest, Sha256};

use crate::storage::{self, NativeMediaRecord, NativeStorage};

/// Outbound HTTP for provider credentials and generated media.
///
/// This is the only part of the server that talks to arbitrary remote hosts, so
/// every entry point re-validates the destination instead of trusting the
/// caller: provider URLs must be HTTPS (loopback HTTP is the single exception,
/// for local model servers), and media downloads resolve DNS first so the
/// connection can be pinned to an address that passed the private-network
/// filter.
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

/// Reads a response body while enforcing `max_bytes`.
///
/// The check is applied per chunk rather than after buffering, so an oversized
/// or unbounded provider response is rejected before it is held in memory.
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
    Err("媒体地址指向本机或内网，已停止下载；若使用 Fake-IP 代理，请在“设置 → 本地与网络”开启“允许私有网络媒体下载”".into())
}

/// Resolves and pins the download address, following redirects manually.
///
/// Automatic redirect following would re-enter the client without the
/// private-network check, so each hop is resolved, filtered and pinned again
/// before the next request is issued.
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

pub async fn native_fetch_model_list(
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

/// Credential placement for a provider request.
///
/// Only the one non-Bearer scheme is modelled, so the enum deliberately
/// deserializes from a fixed literal instead of an arbitrary header name.
#[derive(serde::Deserialize)]
pub enum ModelRequestAuth {
    #[serde(rename = "x-goog-api-key")]
    GoogleApiKey,
}

/// Provider protocol headers a caller may set on a proxied request.
///
/// A whitelist rather than passthrough: forwarding arbitrary names would let a
/// caller rewrite `Host`, `Authorization` or `X-Forwarded-*` on a request the
/// server makes with its own credentials. Anthropic-compatible endpoints
/// (MiniMax among them) require `anthropic-version` and reject the request
/// without it.
const ALLOWED_PROVIDER_HEADERS: &[&str] = &["anthropic-version"];

pub type ExtraHeaders = Option<std::collections::HashMap<String, String>>;

fn apply_extra_headers(
    mut request: reqwest::RequestBuilder,
    headers: ExtraHeaders,
) -> Result<reqwest::RequestBuilder, String> {
    for (name, value) in headers.into_iter().flatten() {
        let lowered = name.trim().to_ascii_lowercase();
        if !ALLOWED_PROVIDER_HEADERS.contains(&lowered.as_str()) {
            return Err(format!("不允许透传请求头：{name}"));
        }
        request = request.header(lowered, value);
    }
    Ok(request)
}

fn apply_credential(
    request: reqwest::RequestBuilder,
    api_key: &str,
    auth: Option<ModelRequestAuth>,
) -> reqwest::RequestBuilder {
    match auth {
        Some(ModelRequestAuth::GoogleApiKey) => request.header("x-goog-api-key", api_key),
        None => request.header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}")),
    }
}

pub async fn native_model_json_post(
    url: String,
    api_key: String,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    headers: ExtraHeaders,
) -> Result<serde_json::Value, String> {
    post_model_json(&url, &api_key, body, auth, headers).await
}

async fn post_model_json(
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    headers: ExtraHeaders,
) -> Result<serde_json::Value, String> {
    let parsed = validate_credential_url(url, "模型请求地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let request = apply_extra_headers(apply_credential(client.post(parsed), api_key, auth), headers)?;
    let response = request
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{error}"))?;
    read_model_json_response(response).await
}

/// Opens a provider request and hands the response back unread.
///
/// Streaming cannot go through `post_model_json`, which buffers the whole body
/// under a 16 MiB cap. The caller forwards the status, content type and body
/// straight to the browser so server-sent events arrive as they are produced.
/// The status is deliberately NOT checked here: a provider error body is a
/// normal streaming payload, and the client reports it with more context than a
/// generic message could.
pub async fn native_model_proxy_post(
    url: String,
    api_key: String,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    headers: ExtraHeaders,
) -> Result<reqwest::Response, String> {
    let parsed = validate_credential_url(&url, "模型请求地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let request = apply_extra_headers(apply_credential(client.post(parsed), &api_key, auth), headers)?;
    request
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("模型请求失败：{error}"))
}

pub async fn native_model_raw_json_post(
    url: String,
    api_key: String,
    body: String,
) -> Result<String, String> {
    post_model_raw_json(&url, &api_key, &body).await
}

/// Sends a pre-serialized body so integers that exceed the browser JSON number
/// range reach the provider unchanged.
async fn post_model_raw_json(url: &str, api_key: &str, body: &str) -> Result<String, String> {
    let parsed = validate_credential_url(url, "模型请求地址")?;
    serde_json::from_str::<serde_json::Value>(body).map_err(|_| "模型请求 JSON 无效".to_string())?;

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

pub async fn native_model_multipart_post(
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

pub async fn native_model_json_get(url: String, api_key: String) -> Result<serde_json::Value, String> {
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

/// Downloads a provider result and hands the bytes to native media storage.
/// Fetches a remote URL and returns its bytes plus the reported content type.
///
/// Used for provider results the browser cannot read cross-origin. Applies the
/// same SSRF guard, redirect policy and size cap as the media importer; the only
/// difference is that it persists nothing, because the caller decides where the
/// bytes belong.
pub async fn native_fetch_remote_bytes(
    url: String,
    max_bytes: Option<usize>,
    allow_private_network: bool,
) -> Result<(Option<String>, Vec<u8>), String> {
    const MAX_REMOTE_MEDIA_BYTES: usize = 256 * 1024 * 1024;
    let limit = max_bytes
        .filter(|value| *value > 0)
        .unwrap_or(MAX_REMOTE_MEDIA_BYTES)
        .min(MAX_REMOTE_MEDIA_BYTES);
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "媒体地址无效".to_string())?;
    let (response, _) = request_public_remote_media(parsed, allow_private_network).await?;
    if !response.status().is_success() {
        return Err(format!("下载生成结果失败：HTTP {}", response.status()));
    }
    let (_, headers, bytes) = read_limited_response_bytes(
        response,
        limit,
        "读取生成结果失败",
        "生成结果文件过大，无法保存",
    )
    .await?;
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    Ok((content_type, bytes))
}

pub async fn native_fetch_remote_media(
    storage: State<Arc<NativeStorage>>,
    url: String,
    bucket: String,
    key: String,
    expected_sha256: Option<String>,
    max_bytes: Option<usize>,
    allow_private_network: Option<bool>,
) -> Result<NativeMediaRecord, String> {
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
    storage::save_remote_media(&storage, bucket, key, mime_type, &bytes)
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

/// Trusts the bytes over the `Content-Type` header, then the URL extension.
///
/// The declared type is only accepted when it agrees with the media family the
/// storage key belongs to, so a mislabelled or hostile response cannot smuggle
/// a different media kind past the storage MIME allowlist.
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

#[cfg(test)]
mod tests {
    use super::{
        is_public_remote_address, select_remote_media_addresses, validate_credential_url,
        ModelRequestAuth,
    };
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

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
        let private = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 443);
        let public = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![private, public], false).unwrap(),
            vec![public]
        );
    }

    #[test]
    fn model_json_auth_rejects_arbitrary_header_names() {
        assert!(serde_json::from_str::<ModelRequestAuth>(r#""x-goog-api-key""#).is_ok());
        assert!(serde_json::from_str::<ModelRequestAuth>(r#""x-custom-header""#).is_err());
    }
}
